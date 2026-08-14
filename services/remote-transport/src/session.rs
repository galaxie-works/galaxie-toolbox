//! Sessão WebRTC (str0m, sans-I/O). Um lado é HOST (envia vídeo H.264 + recebe
//! controle); o outro é CONTROLADOR (recebe vídeo + envia controle). ICE usa o
//! nosso coturn (STUN/TURN do S0); E2E é DTLS-SRTP (de graça no WebRTC).
//!
//! Este módulo é o TRANSPORTE: consome [`CodedFrame`] de uma fonte abstrata e
//! não sabe de captura/encode. A conectividade real (ICE racing/relay, DTLS) é
//! validada entre 2 máquinas (live-QA); aqui as peças são unit-testáveis no que
//! não depende de rede real (SDP offer contém vídeo+datachannel, papéis, etc.).

use std::net::SocketAddr;
use std::time::Instant;

use str0m::change::{SdpAnswer, SdpOffer, SdpPendingOffer};
use str0m::channel::ChannelId;
use str0m::format::{Codec, CodecExtra};
use str0m::media::{Direction, Frequency, KeyframeRequestKind, MediaKind, MediaTime, Mid};
use str0m::net::{Protocol, Receive};
use str0m::{Candidate, Event, Input, Output, Rtc};

use crate::command::CommandChannel;
use crate::frame::CodedFrame;
use crate::signaling::{IceServer, SignalMessage};
use crate::stats::Stats;

/// Papel na sessão. HOST compartilha a tela (envia vídeo); CONTROLADOR assiste e
/// comanda (envia controle pelo datachannel).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Papel {
    Host,
    Controlador,
}

#[derive(Debug, thiserror::Error)]
pub enum TransportError {
    #[error("SDP inválido: {0}")]
    Sdp(String),
    #[error("str0m: {0}")]
    Rtc(String),
    #[error("não há offer pendente pra aceitar o answer")]
    SemOfferPendente,
    #[error("a mudança de SDP não gerou offer")]
    SemMudanca,
    #[error("canal de controle ainda não aberto")]
    SemCanal,
    #[error("mídia de vídeo ainda não negociada")]
    SemVideo,
    #[error("mídia de áudio ainda não negociada")]
    SemAudio,
    #[error("candidato ICE inválido: {0}")]
    Candidato(String),
}

/// Config de uma sessão: papel + os servidores ICE do coturn (do `Registered`).
pub struct SessionConfig {
    pub papel: Papel,
    pub ice_servers: Vec<IceServer>,
}

/// O que o driver da sessão precisa que o app faça a cada passo (sans-I/O).
pub enum Passo {
    /// Manda estes bytes por UDP pro destino.
    Transmitir { destino: SocketAddr, dados: Vec<u8> },
    /// Nada a fazer até este instante (agende um timeout).
    Aguardar(Instant),
    /// Um evento de sessão (conectou, dado de controle recebido, etc.).
    Evento(EventoSessao),
    /// A sessão terminou.
    Fim,
}

/// Eventos de alto nível que o app/UI consome.
#[derive(Debug)]
pub enum EventoSessao {
    Conectada,
    Desconectada,
    /// O DataChannel `controle` terminou o handshake e já aceita escrita.
    ControleAberto,
    /// Dado recebido pelo datachannel de controle (input/clipboard/arquivo).
    Controle(Vec<u8>),
    /// Access unit H.264 Annex-B completa recebida do peer.
    Video(CodedFrame),
}

fn frame_h264_recebido(d: str0m::media::MediaData) -> Option<CodedFrame> {
    let CodecExtra::H264(extra) = d.codec_extra else {
        return None;
    };
    Some(CodedFrame::new(
        d.data,
        d.time.as_micros(),
        extra.is_keyframe,
    ))
}

pub struct Transport {
    rtc: Rtc,
    papel: Papel,
    stats: Stats,
    mid_video: Option<Mid>,
    /// #689 S6: track de áudio Opus (host envia o loopback WASAPI).
    mid_audio: Option<Mid>,
    canal_controle: Option<ChannelId>,
    pending: Option<SdpPendingOffer>,
    /// Via S2→S1: quando o peer manda PLI, pedimos keyframe ao encoder (coalescido).
    comando_encoder: CommandChannel,
}

impl Transport {
    /// Cria a sessão. O str0m já habilita H.264/VP8/Opus por padrão; a mídia de
    /// vídeo é negociada como H.264 quando os dois lados suportam. `comando_encoder`
    /// é o lado-transporte do canal de comandos (o encoder fica com o receiver).
    pub fn novo(cfg: SessionConfig, comando_encoder: CommandChannel) -> Self {
        // ICE lite off (queremos ICE completo com relay via coturn). Os candidatos
        // (host/srflx/relay) são adicionados pelo app conforme o gathering.
        let rtc = Rtc::new();
        let _ = &cfg.ice_servers; // usados pelo app no gathering (fora do str0m puro)
        Self {
            rtc,
            papel: cfg.papel,
            stats: Stats::new(),
            mid_video: None,
            mid_audio: None,
            canal_controle: None,
            pending: None,
            comando_encoder,
        }
    }

    pub fn papel(&self) -> Papel {
        self.papel
    }

    pub fn stats(&self) -> &Stats {
        &self.stats
    }

    pub fn video_pronto(&self) -> bool {
        self.mid_video.is_some()
    }

    /// (Offerer) monta o SDP offer com uma mídia de vídeo (envio, no host) + o
    /// datachannel de controle. Devolve o `SignalMessage::Offer` pra mandar ao peer.
    pub fn criar_offer(&mut self) -> Result<SignalMessage, TransportError> {
        let mut api = self.rtc.sdp_api();
        let dir = match self.papel {
            Papel::Host => Direction::SendOnly,
            Papel::Controlador => Direction::RecvOnly,
        };
        let mid = api.add_media(MediaKind::Video, dir, None, None);
        let mid_a = api.add_media(MediaKind::Audio, dir, None, None); // #689 S6: Opus
        let canal = api.add_channel("controle".to_string());
        let (offer, pending) = api.apply().ok_or(TransportError::SemMudanca)?;
        self.mid_video = Some(mid);
        self.mid_audio = Some(mid_a);
        self.canal_controle = Some(canal);
        self.pending = Some(pending);
        Ok(SignalMessage::Offer {
            sdp: offer.to_sdp_string(),
        })
    }

    /// (Offerer) aplica o answer que voltou do peer — fecha a negociação SDP.
    pub fn aceitar_answer(&mut self, sdp: &str) -> Result<(), TransportError> {
        let answer =
            SdpAnswer::from_sdp_string(sdp).map_err(|e| TransportError::Sdp(e.to_string()))?;
        let pending = self
            .pending
            .take()
            .ok_or(TransportError::SemOfferPendente)?;
        self.rtc
            .sdp_api()
            .accept_answer(pending, answer)
            .map_err(|e| TransportError::Rtc(e.to_string()))?;
        Ok(())
    }

    /// (Answerer) recebe o offer do peer e devolve o `SignalMessage::Answer`.
    pub fn responder_offer(&mut self, sdp: &str) -> Result<SignalMessage, TransportError> {
        let offer =
            SdpOffer::from_sdp_string(sdp).map_err(|e| TransportError::Sdp(e.to_string()))?;
        let answer = self
            .rtc
            .sdp_api()
            .accept_offer(offer)
            .map_err(|e| TransportError::Rtc(e.to_string()))?;
        Ok(SignalMessage::Answer {
            sdp: answer.to_sdp_string(),
        })
    }

    /// Adiciona um candidato ICE LOCAL (host/srflx/relay) montado pelo gathering.
    pub fn candidato_local(&mut self, addr: SocketAddr) -> Result<(), TransportError> {
        let c = Candidate::host(addr, Protocol::Udp)
            .map_err(|e| TransportError::Candidato(e.to_string()))?;
        self.rtc.add_local_candidate(c);
        Ok(())
    }

    /// Forma SDP do candidato local para o signaling trickle-ICE do app.
    pub fn candidato_local_sdp(addr: SocketAddr) -> Result<String, TransportError> {
        Candidate::host(addr, Protocol::Udp)
            .map(|candidate| candidate.to_sdp_string())
            .map_err(|e| TransportError::Candidato(e.to_string()))
    }

    /// Adiciona um candidato ICE REMOTO recebido via signaling.
    pub fn candidato_remoto(&mut self, addr: SocketAddr) -> Result<(), TransportError> {
        let c = Candidate::host(addr, Protocol::Udp)
            .map_err(|e| TransportError::Candidato(e.to_string()))?;
        self.rtc.add_remote_candidate(c);
        Ok(())
    }

    /// Adiciona o candidato remoto na forma SDP produzida por `str0m`.
    pub fn candidato_remoto_sdp(&mut self, candidate: &str) -> Result<(), TransportError> {
        let candidate = Candidate::from_sdp_string(candidate)
            .map_err(|e| TransportError::Candidato(e.to_string()))?;
        self.rtc.add_remote_candidate(candidate);
        Ok(())
    }

    /// Escreve um frame codificado na mídia de vídeo (o str0m empacota em RTP).
    /// `timestamp_us` vira RTP time de 90 kHz.
    pub fn escrever_frame(&mut self, frame: &CodedFrame) -> Result<(), TransportError> {
        let mid = self.mid_video.ok_or(TransportError::SemVideo)?;
        let writer = self.rtc.writer(mid).ok_or(TransportError::SemVideo)?;
        // Selecionar o PT do H.264 explicitamente: o str0m negocia VP8/H264/VP9 e o
        // VP8 vem PRIMEIRO na lista — `.next()` pegava o PT errado e o receptor (que
        // filtra por `CodecExtra::H264`) descartava tudo (0 frames no E2E). Nossa
        // mídia é sempre H.264 (do encoder S1).
        let pt = writer
            .payload_params()
            .find(|p| p.spec().codec == Codec::H264)
            .map(|p| p.pt())
            .ok_or(TransportError::SemVideo)?;
        let rtp_time = MediaTime::new(frame.timestamp_us * 90 / 1000, Frequency::NINETY_KHZ);
        writer
            .write(pt, Instant::now(), rtp_time, frame.data.clone())
            .map_err(|e| TransportError::Rtc(e.to_string()))?;
        self.stats.registrar_frame(frame.len());
        Ok(())
    }

    /// Escreve um frame Opus na mídia de áudio (#689 S6). RTP clock de 48 kHz;
    /// `timestamp_us` → amostras de 48 kHz. Só o host (que captura) escreve.
    pub fn escrever_audio(&mut self, opus: &[u8], timestamp_us: u64) -> Result<(), TransportError> {
        let mid = self.mid_audio.ok_or(TransportError::SemAudio)?;
        let writer = self.rtc.writer(mid).ok_or(TransportError::SemAudio)?;
        let pt = writer
            .payload_params()
            .next()
            .map(|p| p.pt())
            .ok_or(TransportError::SemAudio)?;
        let rtp_time = MediaTime::new(timestamp_us * 48 / 1000, Frequency::FORTY_EIGHT_KHZ);
        writer
            .write(pt, Instant::now(), rtp_time, opus.to_vec())
            .map_err(|e| TransportError::Rtc(e.to_string()))?;
        Ok(())
    }

    /// Envia um datagrama de controle pelo datachannel (input/clipboard/arquivo).
    pub fn enviar_controle(&mut self, dados: &[u8]) -> Result<(), TransportError> {
        let cid = self.canal_controle.ok_or(TransportError::SemCanal)?;
        let mut canal = self.rtc.channel(cid).ok_or(TransportError::SemCanal)?;
        canal
            .write(true, dados)
            .map_err(|e| TransportError::Rtc(e.to_string()))?;
        Ok(())
    }

    /// Pede um novo IDR ao host depois de perda/atraso no consumidor local.
    pub fn pedir_keyframe_remoto(&mut self) -> Result<(), TransportError> {
        let mid = self.mid_video.ok_or(TransportError::SemVideo)?;
        let mut writer = self.rtc.writer(mid).ok_or(TransportError::SemVideo)?;
        writer
            .request_keyframe(None, KeyframeRequestKind::Pli)
            .map_err(|e| TransportError::Rtc(e.to_string()))
    }

    /// Entrega um datagrama UDP recebido pra dentro do str0m.
    pub fn receber_udp(
        &mut self,
        origem: SocketAddr,
        destino: SocketAddr,
        dados: &[u8],
    ) -> Result<(), TransportError> {
        let receive = Receive::new(Protocol::Udp, origem, destino, dados)
            .map_err(|e| TransportError::Rtc(e.to_string()))?;
        self.rtc
            .handle_input(Input::Receive(Instant::now(), receive))
            .map_err(|e| TransportError::Rtc(e.to_string()))?;
        Ok(())
    }

    /// Avança o relógio da sessão (chamar quando o timeout do `Passo::Aguardar` vence).
    pub fn atender_timeout(&mut self, agora: Instant) -> Result<(), TransportError> {
        self.rtc
            .handle_input(Input::Timeout(agora))
            .map_err(|e| TransportError::Rtc(e.to_string()))?;
        Ok(())
    }

    /// Puxa o próximo passo do str0m (transmitir/aguardar/evento/fim). O app roda
    /// isto num loop, cuidando do UDP e do timer.
    pub fn passo(&mut self) -> Result<Passo, TransportError> {
        match self
            .rtc
            .poll_output()
            .map_err(|e| TransportError::Rtc(e.to_string()))?
        {
            Output::Timeout(t) => Ok(Passo::Aguardar(t)),
            Output::Transmit(t) => Ok(Passo::Transmitir {
                destino: t.destination,
                dados: t.contents.to_vec(),
            }),
            Output::Event(ev) => Ok(self.traduzir_evento(ev)),
        }
    }

    fn traduzir_evento(&mut self, ev: Event) -> Passo {
        match ev {
            Event::Connected => Passo::Evento(EventoSessao::Conectada),
            Event::MediaAdded(media) => {
                match media.kind {
                    MediaKind::Video => self.mid_video = Some(media.mid),
                    MediaKind::Audio => self.mid_audio = Some(media.mid),
                }
                Passo::Aguardar(Instant::now())
            }
            Event::ChannelOpen(id, label) if label == "controle" => {
                self.canal_controle = Some(id);
                Passo::Evento(EventoSessao::ControleAberto)
            }
            Event::ChannelClose(id) if Some(id) == self.canal_controle => {
                self.canal_controle = None;
                Passo::Evento(EventoSessao::Desconectada)
            }
            Event::IceConnectionStateChange(estado) => {
                use str0m::IceConnectionState::*;
                match estado {
                    Connected | Completed => Passo::Evento(EventoSessao::Conectada),
                    Disconnected => Passo::Evento(EventoSessao::Desconectada),
                    _ => Passo::Aguardar(Instant::now()),
                }
            }
            Event::ChannelData(d) => Passo::Evento(EventoSessao::Controle(d.data)),
            Event::MediaData(d) if Some(d.mid) == self.mid_video => {
                if let Some(frame) = frame_h264_recebido(d) {
                    self.stats.registrar_frame(frame.len());
                    Passo::Evento(EventoSessao::Video(frame))
                } else {
                    Passo::Aguardar(Instant::now())
                }
            }
            // PLI/keyframe request do peer → pede IDR ao encoder (coalescido).
            Event::KeyframeRequest(_) => {
                self.comando_encoder.pedir_keyframe();
                Passo::Aguardar(Instant::now())
            }
            _ => Passo::Aguardar(Instant::now()),
        }
    }
}
