//! Harness E2E do transporte (S2, #685) com fonte **DUMMY** — prova o pipe inteiro
//! `offer → answer → ICE → DTLS-SRTP → media + datachannel` num único processo,
//! ligando dois [`IoDriver`] por **UDP loopback real** (`127.0.0.1`). O Host envia
//! frames sintéticos (`DummyFrameSource`, test-pattern) + o Controlador manda um
//! ping de controle de volta; asserta conexão, round-trip de datachannel e
//! recebimento de vídeo, e reporta latência/bitrate.
//!
//! É o **mesmo caminho** que o app roda entre 2 MÁQUINAS: troca-se o socket
//! loopback + o signaling in-process por socket real + coturn + o WebSocket do
//! `galaxie-remote-signaling`. A conectividade real (ICE racing/relay, NAT
//! simétrico → TURN) é live-QA de 2 máquinas (DoD); este harness prova a LÓGICA
//! do pipe de forma determinística e rodável.
//!
//! Rodar (precisa de toolchain OpenSSL — feature `webrtc`):
//! ```text
//! $env:OPENSSL_DIR = 'C:\Program Files\PostgreSQL\16'; $env:OPENSSL_NO_VENDOR = '1'
//! cargo run --example e2e_dummy --features webrtc
//! ```

use std::net::UdpSocket;
use std::time::{Duration, Instant};

use galaxie_remote_transport::driver::IoDriver;
use galaxie_remote_transport::session::{EventoSessao, Papel, SessionConfig, Transport};
use galaxie_remote_transport::{canal_de_comandos, CodedFrameSource, DummyFrameSource, SignalMessage};

/// Cria um driver com socket loopback + Transport do papel dado. O receiver de
/// comandos é solto (o `pedir_keyframe` tolera `Disconnected` → no-op).
fn cria_driver(papel: Papel) -> IoDriver {
    let socket = UdpSocket::bind("127.0.0.1:0").expect("bind loopback");
    let (cmd, _rx) = canal_de_comandos();
    let transport = Transport::novo(SessionConfig::new(papel, vec![]), cmd);
    IoDriver::novo(socket, transport).expect("driver")
}

fn sdp_de(msg: SignalMessage) -> String {
    match msg {
        SignalMessage::Offer { sdp } | SignalMessage::Answer { sdp } => sdp,
        SignalMessage::IceCandidate { candidate } => candidate,
    }
}

fn main() {
    let mut host = cria_driver(Papel::Host);
    let mut ctrl = cria_driver(Papel::Controlador);
    let addr_h = host.local_addr();
    let addr_c = ctrl.local_addr();
    println!("host={addr_h}  controlador={addr_c}");

    // --- signaling in-process: offer/answer (o app troca isto pelo WebSocket S0) ---
    let offer = host.transport().criar_offer().expect("criar_offer");
    let answer = ctrl
        .transport()
        .responder_offer(&sdp_de(offer))
        .expect("responder_offer");
    host.transport()
        .aceitar_answer(&sdp_de(answer))
        .expect("aceitar_answer");

    // --- ICE: candidatos host via loopback (o app usa host/srflx/relay do coturn) ---
    host.transport().candidato_local(addr_h).expect("cand local h");
    ctrl.transport().candidato_local(addr_c).expect("cand local c");
    host.transport().candidato_remoto(addr_c).expect("cand rem h");
    ctrl.transport().candidato_remoto(addr_h).expect("cand rem c");

    // --- loop de bombeamento (single-thread, alterna os dois drivers) ---
    const ALVO_VIDEO: usize = 60; // frames de vídeo a receber
    let mut fonte = DummyFrameSource::new(60, 30).com_limite(ALVO_VIDEO as u64);

    let mut host_conectado = false;
    let mut ctrl_conectado = false;
    let mut controle_aberto_ctrl = false;
    let mut ping_enviado = false;
    let mut ping_recebido_host = false;
    let mut video_recebido = 0usize;
    let mut video_enviado = 0usize;
    let mut primeiro_erro_envio: Option<String> = None;

    let inicio = Instant::now();
    let mut ultimo_envio = inicio;
    let mut t_conexao: Option<Instant> = None;
    let mut t_primeiro_video: Option<Instant> = None;
    let deadline = inicio + Duration::from_secs(20);

    loop {
        let agora = Instant::now();

        for ev in host.bombear(agora).expect("host.bombear") {
            match ev {
                EventoSessao::Conectada => {
                    if !host_conectado {
                        host_conectado = true;
                        if t_conexao.is_none() {
                            t_conexao = Some(agora);
                        }
                    }
                }
                EventoSessao::Controle(dados) => {
                    if dados == b"ping-controlador" {
                        ping_recebido_host = true;
                    }
                }
                _ => {}
            }
        }

        for ev in ctrl.bombear(agora).expect("ctrl.bombear") {
            match ev {
                EventoSessao::Conectada => ctrl_conectado = true,
                EventoSessao::ControleAberto => controle_aberto_ctrl = true,
                EventoSessao::Video(frame) => {
                    if t_primeiro_video.is_none() {
                        t_primeiro_video = Some(agora);
                    }
                    assert!(!frame.is_empty(), "frame de vídeo vazio");
                    video_recebido += 1;
                }
                _ => {}
            }
        }

        // Controlador → Host: ping de controle (prova o datachannel nos 2 sentidos).
        if controle_aberto_ctrl && !ping_enviado {
            if ctrl.transport().enviar_controle(b"ping-controlador").is_ok() {
                ping_enviado = true;
            }
        }

        // Host → Controlador: frames dummy (~60 fps), uma vez conectado + vídeo pronto.
        if host_conectado
            && host.transport().video_pronto()
            && agora.duration_since(ultimo_envio) >= Duration::from_millis(16)
        {
            if let Some(f) = fonte.next_frame() {
                match host.transport().escrever_frame(&f) {
                    Ok(()) => video_enviado += 1,
                    Err(e) => {
                        if primeiro_erro_envio.is_none() {
                            primeiro_erro_envio = Some(e.to_string());
                        }
                    }
                }
                ultimo_envio = agora;
            }
        }

        let pronto = host_conectado
            && ctrl_conectado
            && ping_recebido_host
            && video_recebido >= ALVO_VIDEO;
        if pronto || agora >= deadline {
            break;
        }
        std::thread::sleep(Duration::from_millis(1));
    }

    // --- relatório ---
    let dur_conexao = t_conexao.map(|t| t.duration_since(inicio));
    let latencia_1o_video =
        match (t_conexao, t_primeiro_video) {
            (Some(c), Some(v)) => Some(v.duration_since(c)),
            _ => None,
        };
    let snap = ctrl.transport().stats().snapshot();

    println!("--- relatório E2E (dummy, loopback) ---");
    println!("host conectado ......... {host_conectado}");
    println!("controlador conectado .. {ctrl_conectado}");
    println!("datachannel round-trip . {ping_recebido_host} (ctrl→host)");
    println!("vídeo enviado (host) ... {video_enviado} frames");
    println!(
        "erro 1º envio .......... {}",
        primeiro_erro_envio.as_deref().unwrap_or("nenhum")
    );
    println!("vídeo recebido ......... {video_recebido}/{ALVO_VIDEO} frames");
    println!(
        "tempo até conectar ..... {}",
        dur_conexao
            .map(|d| format!("{} ms", d.as_millis()))
            .unwrap_or_else(|| "n/a".into())
    );
    println!(
        "1º vídeo pós-conexão ... {}",
        latencia_1o_video
            .map(|d| format!("{} ms", d.as_millis()))
            .unwrap_or_else(|| "n/a".into())
    );
    println!(
        "bitrate (controlador) .. {:.0} kbps ({} bytes)",
        snap.bitrate_bps / 1000.0,
        snap.bytes
    );

    let sucesso = host_conectado && ctrl_conectado && ping_recebido_host && video_recebido > 0;
    if sucesso {
        println!("\nE2E OK — pipe conectou, datachannel round-trip e vídeo fluíram.");
    } else {
        eprintln!("\nE2E FALHOU — ver relatório acima.");
        std::process::exit(1);
    }
}
