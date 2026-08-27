//! Probe de relay TURN — prova de MECANISMO (#1666, fatia 1a do #1130).
//!
//! Reusa o codec puro `galaxie_remote_transport::turn` (core, SEM OpenSSL) para
//! provar, contra o NOSSO coturn de produção, que a credencial efêmera é aceite e
//! que os nossos bytes atravessam o relay:
//!
//!   credencial → `Allocate` (long-term auth) → `CreatePermission` → dados E2E.
//!
//! Dois modos, o MESMO binário:
//!   * self-relay (default): duas alocações na MESMA máquina relayam uma à outra
//!     pelo coturn — prova o mecanismo (1a), sem peer externo.
//!   * `--peer <ip:porta>`: uma alocação + um echo externo real — é o modo da
//!     travessia de NAT do #1130(b), rodado de um host de IP público.
//!
//! ⚠️ FRONTEIRA DO SEGREDO: o probe NÃO embute o `turn_secret`. A credencial vem
//! SEMPRE por `--credential` (de um `Registered` v1 real) — hoje é argv-only.
//! Derivar a credencial localmente do `turn_secret` fica como follow-up explícito
//! (sob go do PO); NÃO está implementado aqui.
//!
//! ⚠️ Toca o coturn de PRODUÇÃO (aloca relays reais). Correr só após aviso na
//! #1666 (o gate de produção do @galaxie-altair veria a corrida como anomalia),
//! fora de pico, com `--device-id prova-1666` (alocações atribuíveis nos logs).
//!
//! Sinal decisivo = `Received relay addr` (Allocate-Success + XOR-RELAYED-ADDRESS),
//! NÃO "allocate response received" (que também aparece no desafio 401).

use std::net::{SocketAddr, ToSocketAddrs, UdpSocket};
use std::time::Duration;

use rand::RngCore;

use galaxie_remote_transport::turn::{
    build_allocate_request, build_allocate_request_auth, build_create_permission_request,
    build_send_indication, derive_key, parse_allocate_success, parse_create_permission_success,
    parse_data_indication, parse_error_unauthorized, parse_stale_nonce,
};

/// Resultado de um `Allocate`, já classificado — o coração da nuance do @galaxie-alcor:
/// um `401` no request SEM auth é o DESAFIO (esperado), não falha; só o `401` no
/// request COM auth é credencial errada/expirada.
#[derive(Debug, PartialEq)]
enum AllocOutcome {
    /// Allocate-Success: o relay foi alocado. `Received relay addr`.
    Success { relayed: SocketAddr, lifetime: u32 },
    /// `401 Unauthorized` + REALM/NONCE — o desafio do long-term credential.
    Challenge { realm: String, nonce: String },
    /// `438 Stale Nonce` — reemitir com o nonce novo (não é falha).
    StaleNonce { nonce: String },
    /// `401` no request AUTENTICADO — credencial rejeitada. Falha REAL.
    AuthFailed,
    /// Nada que se reconheça (truncado, txid errado, outro ERROR-CODE).
    Unknown,
}

/// Classifica a resposta a um `Allocate`. `authenticated` diz se ESTE request
/// levava USERNAME/MI — é o que separa desafio-401 de auth-fail-401.
fn classify_allocate(resp: &[u8], txid: &[u8; 12], authenticated: bool) -> AllocOutcome {
    if let Some((relayed, lifetime)) = parse_allocate_success(resp, txid) {
        return AllocOutcome::Success { relayed, lifetime };
    }
    if let Some(nonce) = parse_stale_nonce(resp, txid) {
        return AllocOutcome::StaleNonce { nonce };
    }
    if let Some((realm, nonce)) = parse_error_unauthorized(resp, txid) {
        return if authenticated {
            AllocOutcome::AuthFailed
        } else {
            AllocOutcome::Challenge { realm, nonce }
        };
    }
    AllocOutcome::Unknown
}

#[derive(Debug)]
enum ProbeError {
    /// Credencial ausente/ilegível — mensagem PRÓPRIA, nunca confundida com
    /// "relay falhou" (nuance #3 do @galaxie-alcor).
    SecretAbsent(String),
    /// `expires_at` do username já passou — pré-check antes do round-trip (nuance
    /// #2 do @galaxie-alcor); poupa um `AuthFailed` confuso na corrida de prod.
    Expirada(String),
    /// Credencial rejeitada pelo coturn (401 autenticado).
    AuthFailed,
    /// Sem resposta dentro do timeout.
    Timeout(String),
    /// Resposta inesperada/irreconhecível.
    Unexpected(String),
    Io(std::io::Error),
}

impl std::fmt::Display for ProbeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProbeError::SecretAbsent(m) => write!(f, "credencial ausente/ilegível: {m}"),
            ProbeError::Expirada(m) => write!(f, "{m}"),
            ProbeError::AuthFailed => write!(
                f,
                "credencial REJEITADA pelo coturn (401 autenticado) — cred errada/expirada, \
                 NÃO 'relay não funciona'"
            ),
            ProbeError::Timeout(m) => write!(f, "timeout: {m}"),
            ProbeError::Unexpected(m) => write!(f, "resposta inesperada: {m}"),
            ProbeError::Io(e) => write!(f, "io: {e}"),
        }
    }
}

impl From<std::io::Error> for ProbeError {
    fn from(e: std::io::Error) -> Self {
        ProbeError::Io(e)
    }
}

fn novo_txid() -> [u8; 12] {
    let mut txid = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut txid);
    txid
}

fn troca(sock: &UdpSocket, server: SocketAddr, req: &[u8]) -> Result<Vec<u8>, ProbeError> {
    sock.send_to(req, server)?;
    let mut buf = [0u8; 2048];
    match sock.recv_from(&mut buf) {
        Ok((n, _)) => Ok(buf[..n].to_vec()),
        Err(e) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {
            Err(ProbeError::Timeout(format!("sem resposta de {server}")))
        }
        Err(e) => Err(e.into()),
    }
}

struct Allocation {
    relayed: SocketAddr,
    realm: String,
    nonce: String,
    key: [u8; 16],
}

/// Handshake completo do long-term credential (RFC 5766 §6): Allocate sem auth →
/// desafio 401 → Allocate autenticado. Trata `438 stale-nonce` reemitindo uma vez.
fn allocate(
    sock: &UdpSocket,
    server: SocketAddr,
    username: &str,
    credential: &str,
) -> Result<Allocation, ProbeError> {
    // Fail-fast de expiração (nuance #2 do @galaxie-alcor): username = "{expires_at}:{device_id}".
    // Pega uma cred stale ANTES do round-trip, em vez de um AuthFailed confuso.
    if let Some((exp, _)) = username.split_once(':') {
        if let Ok(exp) = exp.parse::<u64>() {
            let agora = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            if exp != 0 && exp < agora {
                return Err(ProbeError::Expirada(format!(
                    "credencial expirada (expires_at={exp} < agora={agora}) — pega um Registered v1 fresco"
                )));
            }
        }
    }

    // 1º Allocate SEM auth — esperamos o desafio 401 (NÃO é falha).
    let txid0 = novo_txid();
    let resp = troca(sock, server, &build_allocate_request(&txid0))?;
    let (realm, mut nonce) = match classify_allocate(&resp, &txid0, false) {
        AllocOutcome::Challenge { realm, nonce } => (realm, nonce),
        AllocOutcome::Success { relayed, lifetime } => {
            // Coturn não devia alocar sem auth; se o fizer, seguimos com o relayed
            // (realm/nonce/key ficam vazios — não há 2º request).
            eprintln!(
                "[probe] Received relay addr = {relayed} (lifetime {lifetime}s) — coturn alocou \
                 SEM auth (inesperado, mas o mecanismo respondeu)"
            );
            return Ok(Allocation {
                relayed,
                realm: String::new(),
                nonce: String::new(),
                key: [0u8; 16],
            });
        }
        outro => {
            return Err(ProbeError::Unexpected(format!(
                "1º Allocate não devolveu o desafio 401: {outro:?}"
            )))
        }
    };

    // Chave do MESSAGE-INTEGRITY = MD5(username:realm:credential). A `credential`
    // (base64 HMAC-SHA1(turn_secret, username)) É a "senha" do long-term credential.
    let key = derive_key(username, &realm, credential);

    // 2º Allocate AUTENTICADO, com 1 retry em stale-nonce.
    for tentativa in 0..2 {
        let txid = novo_txid();
        let req = build_allocate_request_auth(&txid, username, &realm, &nonce, &key);
        let resp = troca(sock, server, &req)?;
        match classify_allocate(&resp, &txid, true) {
            AllocOutcome::Success { relayed, lifetime } => {
                eprintln!(
                    "[probe] Received relay addr = {relayed} (lifetime {lifetime}s) via {server}"
                );
                return Ok(Allocation { relayed, realm, nonce, key });
            }
            AllocOutcome::StaleNonce { nonce: novo } if tentativa == 0 => {
                nonce = novo; // reemite uma vez com o nonce novo
            }
            AllocOutcome::AuthFailed => return Err(ProbeError::AuthFailed),
            outro => {
                return Err(ProbeError::Unexpected(format!(
                    "Allocate autenticado inesperado: {outro:?}"
                )))
            }
        }
    }
    Err(ProbeError::Unexpected("stale-nonce persistente após retry".into()))
}

/// Instala a permissão pra o relay aceitar tráfego de/para `peer`. Um
/// CreatePermission-Success não tem atributos além do header — casa pelo txid.
fn create_permission(
    sock: &UdpSocket,
    server: SocketAddr,
    alloc: &Allocation,
    username: &str,
    peer: SocketAddr,
) -> Result<(), ProbeError> {
    // Retry de stale-nonce simétrico ao `allocate` (nit do @galaxie-alcor): o nonce
    // pode rodar entre o Allocate e o CreatePermission.
    let mut nonce = alloc.nonce.clone();
    for tentativa in 0..2 {
        let txid = novo_txid();
        let req = build_create_permission_request(
            &txid, peer, username, &alloc.realm, &nonce, &alloc.key,
        );
        let resp = troca(sock, server, &req)?;
        if parse_create_permission_success(&resp, &txid) {
            return Ok(());
        }
        match parse_stale_nonce(&resp, &txid) {
            Some(novo) if tentativa == 0 => nonce = novo, // reemite com o nonce novo
            _ => {
                return Err(ProbeError::Unexpected(format!(
                    "CreatePermission sem sucesso pra peer {peer}"
                )))
            }
        }
    }
    Err(ProbeError::Unexpected(
        "CreatePermission: stale-nonce persistente após retry".into(),
    ))
}

/// Envia `payload` a `peer` pelo relay (Send Indication) e espera recebê-lo de
/// volta numa Data Indication. `sock` já tem a permissão pro `peer`.
fn envia_e_espera(
    sock: &UdpSocket,
    server: SocketAddr,
    peer: SocketAddr,
    payload: &[u8],
) -> Result<(SocketAddr, Vec<u8>), ProbeError> {
    let ind = build_send_indication(&novo_txid(), peer, payload);
    sock.send_to(&ind, server)?;
    let mut buf = [0u8; 2048];
    // Pode chegar ruído; laçamos até uma Data Indication ou o timeout.
    loop {
        match sock.recv_from(&mut buf) {
            Ok((n, _)) => {
                if let Some((origem, dados)) = parse_data_indication(&buf[..n]) {
                    return Ok((origem, dados));
                }
                // não é Data Indication — ignora e continua até o timeout
            }
            Err(e)
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                return Err(ProbeError::Timeout(
                    "nenhuma Data Indication chegou pelo relay".into(),
                ))
            }
            Err(e) => return Err(e.into()),
        }
    }
}

struct Args {
    server: String,
    username: String,
    credential: Option<String>,
    payload: String,
    peer: Option<String>,
    timeout_ms: u64,
}

fn parse_args() -> Result<Args, String> {
    let mut server = None;
    let mut username = None;
    let mut credential = None;
    let mut payload = "galaxie-turn-probe-1666".to_string();
    let mut peer = None;
    let mut timeout_ms = 3000u64;
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        let val = |it: &mut dyn Iterator<Item = String>| it.next().ok_or(format!("falta valor pra {a}"));
        match a.as_str() {
            "--server" => server = Some(val(&mut it)?),
            "--username" => username = Some(val(&mut it)?),
            "--credential" => credential = Some(val(&mut it)?),
            "--payload" => payload = val(&mut it)?,
            "--peer" => peer = Some(val(&mut it)?),
            "--timeout-ms" => timeout_ms = val(&mut it)?.parse().map_err(|_| "timeout-ms inválido".to_string())?,
            "-h" | "--help" => return Err(USAGE.to_string()),
            outro => return Err(format!("arg desconhecido: {outro}\n\n{USAGE}")),
        }
    }
    Ok(Args {
        server: server.ok_or("--server obrigatório")?,
        username: username.ok_or("--username obrigatório")?,
        credential,
        payload,
        peer,
        timeout_ms,
    })
}

const USAGE: &str = "\
turn_relay_probe — prova de mecanismo do relay TURN (#1666)

  --server <host:porta>     coturn (ex.: telemetry.thegalaxie.cloud:3478)   [obrig.]
  --username <u>            username da credencial efêmera (Registered v1)  [obrig.]
  --credential <c>          credential (base64 HMAC) da MESMA registração   [obrig.]
  --peer <ip:porta>         modo travessia (#1130-b): echo externo real     [opc.]
  --payload <txt>           bytes a relayar                                  [opc.]
  --timeout-ms <n>          timeout de recv (default 3000)                   [opc.]

⚠️ toca o coturn de produção — avise na #1666 ANTES de correr, fora de pico.";

fn resolve(addr: &str) -> Result<SocketAddr, ProbeError> {
    addr.to_socket_addrs()?
        .next()
        .ok_or_else(|| ProbeError::Unexpected(format!("não resolveu {addr}")))
}

fn run() -> Result<(), ProbeError> {
    let args = match parse_args() {
        Ok(a) => a,
        Err(msg) => {
            eprintln!("{msg}");
            std::process::exit(2);
        }
    };
    let server = resolve(&args.server)?;
    let credential = args.credential.ok_or_else(|| {
        ProbeError::SecretAbsent(
            "forneça --credential de um Registered v1 (o probe NÃO deriva do turn_secret)".into(),
        )
    })?;
    let timeout = Some(Duration::from_millis(args.timeout_ms));

    if let Some(peer) = args.peer {
        // Modo #1130-b: uma alocação + peer externo real que ecoa.
        let peer = resolve(&peer)?;
        let sock = UdpSocket::bind("0.0.0.0:0")?;
        sock.set_read_timeout(timeout)?;
        let alloc = allocate(&sock, server, &args.username, &credential)?;
        create_permission(&sock, server, &alloc, &args.username, peer)?;
        let (origem, dados) = envia_e_espera(&sock, server, peer, args.payload.as_bytes())?;
        println!("E2E via TURN OK (peer externo {origem}): {} bytes de volta", dados.len());
        return Ok(());
    }

    // Modo 1a self-relay: duas alocações na mesma máquina, relayando pelo coturn.
    let sock_a = UdpSocket::bind("0.0.0.0:0")?;
    let sock_b = UdpSocket::bind("0.0.0.0:0")?;
    sock_a.set_read_timeout(timeout)?;
    sock_b.set_read_timeout(timeout)?;

    let alloc_a = allocate(&sock_a, server, &args.username, &credential)?;
    let alloc_b = allocate(&sock_b, server, &args.username, &credential)?;
    println!(
        "Received relay addr A={} B={}",
        alloc_a.relayed, alloc_b.relayed
    );

    // Cada lado autoriza o endereço relayed do outro (ambos públicos → o
    // denied-peer-ip de faixas privadas NÃO os bloqueia).
    create_permission(&sock_a, server, &alloc_a, &args.username, alloc_b.relayed)?;
    create_permission(&sock_b, server, &alloc_b, &args.username, alloc_a.relayed)?;

    // A → B
    let (origem, dados) = {
        let ind = build_send_indication(&novo_txid(), alloc_b.relayed, args.payload.as_bytes());
        sock_a.send_to(&ind, server)?;
        envia_e_espera_em(&sock_b)?
    };
    verifica("A→B", &origem, &dados, alloc_a.relayed, args.payload.as_bytes())?;

    // B → A
    {
        let ind = build_send_indication(&novo_txid(), alloc_a.relayed, args.payload.as_bytes());
        sock_b.send_to(&ind, server)?;
        let (o, d) = envia_e_espera_em(&sock_a)?;
        verifica("B→A", &o, &d, alloc_b.relayed, args.payload.as_bytes())?;
    }

    println!("E2E via TURN OK (self-relay, ambos os sentidos) — MECANISMO provado");
    Ok(())
}

/// Espera uma Data Indication num socket que JÁ teve o Send Indication enviado por
/// fora (usado no self-relay, onde o send e o recv são em sockets diferentes).
fn envia_e_espera_em(sock: &UdpSocket) -> Result<(SocketAddr, Vec<u8>), ProbeError> {
    let mut buf = [0u8; 2048];
    loop {
        match sock.recv_from(&mut buf) {
            Ok((n, _)) => {
                if let Some(par) = parse_data_indication(&buf[..n]) {
                    return Ok(par);
                }
            }
            Err(e)
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                return Err(ProbeError::Timeout("nenhuma Data Indication pelo relay".into()))
            }
            Err(e) => return Err(e.into()),
        }
    }
}

fn verifica(
    sentido: &str,
    origem: &SocketAddr,
    dados: &[u8],
    esperado_origem: SocketAddr,
    esperado_payload: &[u8],
) -> Result<(), ProbeError> {
    if dados != esperado_payload {
        return Err(ProbeError::Unexpected(format!(
            "{sentido}: payload divergente ({} bytes)",
            dados.len()
        )));
    }
    // A origem reportada pela Data Indication é o relayed do emissor.
    if *origem != esperado_origem {
        eprintln!(
            "[probe] aviso {sentido}: origem {origem} ≠ esperado {esperado_origem} \
             (payload confere; coturn pode reescrever a origem)"
        );
    }
    Ok(())
}

fn main() {
    if let Err(e) = run() {
        eprintln!("[probe] FALHA: {e}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Monta um `Allocate Error` STUN sintético com um ERROR-CODE + REALM + NONCE,
    /// pra provar a nuance do @galaxie-alcor sem falar com o coturn.
    fn erro_sintetico(code: u16, txid: &[u8; 12]) -> Vec<u8> {
        // Cabeçalho: tipo 0x0113 (Allocate Error), length preenchido no fim.
        let mut buf = vec![0x01, 0x13, 0x00, 0x00];
        buf.extend_from_slice(&0x2112A442u32.to_be_bytes()); // magic cookie
        buf.extend_from_slice(txid);
        // ERROR-CODE (0x0009): 2 reservados + classe + número.
        let class = (code / 100) as u8;
        let number = (code % 100) as u8;
        let ec = [0u8, 0u8, class, number];
        push_tlv(&mut buf, 0x0009, &ec);
        // REALM (0x0014) e NONCE (0x0015).
        push_tlv(&mut buf, 0x0014, b"galaxie");
        push_tlv(&mut buf, 0x0015, b"nonce-xyz");
        let attrs_len = (buf.len() - 20) as u16;
        buf[2..4].copy_from_slice(&attrs_len.to_be_bytes());
        buf
    }

    fn push_tlv(buf: &mut Vec<u8>, t: u16, v: &[u8]) {
        buf.extend_from_slice(&t.to_be_bytes());
        buf.extend_from_slice(&(v.len() as u16).to_be_bytes());
        buf.extend_from_slice(v);
        let pad = (4 - v.len() % 4) % 4;
        buf.resize(buf.len() + pad, 0);
    }

    #[test]
    fn quatrocentos_e_um_sem_auth_e_desafio_nao_falha() {
        let txid = [7u8; 12];
        let resp = erro_sintetico(401, &txid);
        // Mesmíssimos bytes: sem auth = desafio; com auth = falha real.
        match classify_allocate(&resp, &txid, false) {
            AllocOutcome::Challenge { realm, nonce } => {
                assert_eq!(realm, "galaxie");
                assert_eq!(nonce, "nonce-xyz");
            }
            outro => panic!("esperava Challenge, veio {outro:?}"),
        }
        assert_eq!(
            classify_allocate(&resp, &txid, true),
            AllocOutcome::AuthFailed,
            "401 no request AUTENTICADO tem de ser auth-fail, não desafio"
        );
    }

    #[test]
    fn quatrocentos_e_trinta_e_oito_e_stale_nonce() {
        let txid = [9u8; 12];
        let resp = erro_sintetico(438, &txid);
        match classify_allocate(&resp, &txid, true) {
            AllocOutcome::StaleNonce { nonce } => assert_eq!(nonce, "nonce-xyz"),
            outro => panic!("esperava StaleNonce, veio {outro:?}"),
        }
    }

    #[test]
    fn txid_errado_nao_casa() {
        let resp = erro_sintetico(401, &[1u8; 12]);
        assert_eq!(
            classify_allocate(&resp, &[2u8; 12], false),
            AllocOutcome::Unknown
        );
    }
}
