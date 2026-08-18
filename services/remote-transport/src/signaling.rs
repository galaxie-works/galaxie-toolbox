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

    /// #1130 fatia 2 (Confucius): endpoints `host:porta` dos TURN servers UDP deste
    /// `IceServer` — só `turn:` (NÃO `turns:`, que é TLS) com transporte UDP (default
    /// RFC 5928, ou `?transport=udp` explícito; `transport=tcp` fica de fora). O
    /// handshake Allocate do relay (gather_relay) roda sobre UDP no MESMO socket da
    /// sessão, então TLS/TCP não servem. Devolve os endpoints já sem o prefixo `turn:`
    /// e sem a query, na ordem das `urls`. PURO (sem DNS): quem resolve em `SocketAddr`
    /// é o app (`resolver_turn_alvos` no remote.rs). O `username`/`credential` seguem
    /// nos campos — nunca são logados.
    pub fn turn_udp_endpoints(&self) -> Vec<&str> {
        self.urls
            .iter()
            .filter_map(|u| {
                // `turns:` (TLS) não casa `strip_prefix("turn:")` — fica de fora aqui.
                let resto = u.strip_prefix("turn:")?;
                let (hostport, query) = match resto.split_once('?') {
                    Some((hp, q)) => (hp, Some(q)),
                    None => (resto, None),
                };
                // Sem query → UDP (default). Com query → UDP só se todo `transport=`
                // presente for `udp` (um `transport=tcp` exclui o endpoint).
                let udp = match query {
                    None => true,
                    Some(q) => q
                        .split('&')
                        .filter_map(|kv| kv.strip_prefix("transport="))
                        .all(|t| t.eq_ignore_ascii_case("udp")),
                };
                udp.then_some(hostport)
            })
            .collect()
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
    fn turn_udp_endpoints_pega_so_turn_udp() {
        // `turn:` sem query = UDP (default); `?transport=udp` explícito idem.
        let s = IceServer {
            urls: vec![
                "turn:turn.thegalaxie.cloud:3478".into(),
                "turn:turn.thegalaxie.cloud:3478?transport=udp".into(),
            ],
            username: "u".into(),
            credential: "segredo".into(),
        };
        assert_eq!(
            s.turn_udp_endpoints(),
            vec![
                "turn.thegalaxie.cloud:3478",
                "turn.thegalaxie.cloud:3478",
            ]
        );
    }

    #[test]
    fn turn_udp_endpoints_exclui_tcp_tls_e_stun() {
        // `transport=tcp` (TCP), `turns:` (TLS) e `stun:` NÃO entram no gathering UDP.
        let s = IceServer {
            urls: vec![
                "turn:host:3478?transport=tcp".into(),
                "turns:host:5349".into(),
                "turns:host:5349?transport=udp".into(), // turns = TLS mesmo com udp
                "stun:host:3478".into(),
            ],
            username: "u".into(),
            credential: "segredo".into(),
        };
        assert!(
            s.turn_udp_endpoints().is_empty(),
            "só turn: UDP pode virar alvo de Allocate"
        );
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
