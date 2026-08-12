//! Abstração de signaling: o transporte PRODUZ/CONSOME SDP + ICE candidates e não
//! sabe QUEM entrega (o WebSocket do `galaxie-remote-signaling`, S0). O app pluga
//! o canal real; o teste pluga um mock. Espelha o `SignalKind` do S0.

use serde::{Deserialize, Serialize};

/// Servidor ICE (STUN/TURN) do nosso coturn — vem no `Registered` do signaling.
/// O transporte usa pra montar os candidatos relay/reflexive.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct IceServer {
    pub urls: Vec<String>,
    pub username: String,
    pub credential: String,
}

impl IceServer {
    /// Só STUN (sem credencial) — `stun:host:porta`.
    pub fn eh_stun_puro(&self) -> bool {
        self.username.is_empty() && self.urls.iter().all(|u| u.starts_with("stun:"))
    }
    /// Tem ao menos uma URL TURN (relay) — precisa de credencial.
    pub fn tem_turn(&self) -> bool {
        self.urls
            .iter()
            .any(|u| u.starts_with("turn:") || u.starts_with("turns:"))
    }
}

/// Um sinal SDP/ICE trocado com o peer via o servidor de signaling. Serializa no
/// `payload` do `Signal` do S0 (o `kind` vira o `SignalKind` de lá).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SignalMessage {
    Offer { sdp: String },
    Answer { sdp: String },
    IceCandidate { candidate: String },
}

#[derive(Debug, thiserror::Error)]
pub enum SignalingError {
    #[error("falha no envio de signaling: {0}")]
    Send(String),
}

/// Canal de signaling: o transporte só chama `send`; os sinais que CHEGAM do peer
/// entram no transporte pelo loop (via `aplicar_sinal`). O app implementa isto
/// sobre o WebSocket do S0; o teste usa [`RecordingSignaling`].
pub trait SignalingChannel: Send {
    fn send(&mut self, msg: &SignalMessage) -> Result<(), SignalingError>;
}

/// Canal de teste: guarda tudo que foi enviado (sem rede), pra asserção.
#[derive(Debug, Default)]
pub struct RecordingSignaling {
    pub enviados: Vec<SignalMessage>,
}

impl SignalingChannel for RecordingSignaling {
    fn send(&mut self, msg: &SignalMessage) -> Result<(), SignalingError> {
        self.enviados.push(msg.clone());
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ice_server_distingue_stun_de_turn() {
        let stun = IceServer {
            urls: vec!["stun:turn.thegalaxie.cloud:3478".into()],
            username: String::new(),
            credential: String::new(),
        };
        assert!(stun.eh_stun_puro() && !stun.tem_turn());

        let turn = IceServer {
            urls: vec!["turn:turn.thegalaxie.cloud:3478".into()],
            username: "u".into(),
            credential: "c".into(),
        };
        assert!(turn.tem_turn() && !turn.eh_stun_puro());
    }

    #[test]
    fn signal_message_serializa_com_kind() {
        let j = serde_json::to_value(SignalMessage::Offer { sdp: "v=0".into() }).unwrap();
        assert_eq!(j["kind"], "offer");
        assert_eq!(j["sdp"], "v=0");
        // round-trip
        let back: SignalMessage = serde_json::from_value(j).unwrap();
        assert_eq!(back, SignalMessage::Offer { sdp: "v=0".into() });
    }

    #[test]
    fn recording_channel_guarda_enviados() {
        let mut ch = RecordingSignaling::default();
        ch.send(&SignalMessage::IceCandidate {
            candidate: "cand".into(),
        })
        .unwrap();
        assert_eq!(ch.enviados.len(), 1);
    }
}
