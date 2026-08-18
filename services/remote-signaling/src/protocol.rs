use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u16 = 1;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    Register {
        device_id: String,
        public_key: String,
    },
    Heartbeat,
    Presence {
        device_id: String,
    },
    CreateAssistedSession {
        #[serde(default)]
        ttl_seconds: Option<u64>,
    },
    RedeemAssistedSession {
        code: String,
    },
    /// #1148: o device JÁ registrado nesta conexão pede uma credencial TURN
    /// FRESCA (o TTL da anterior está perto de expirar) — SEM refazer pareamento
    /// nem novo código. O servidor responde com `IceServersRenewed`.
    RenewIceServers,
    Signal {
        peer_id: String,
        kind: SignalKind,
        payload: String,
    },
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SignalKind {
    Offer,
    Answer,
    IceCandidate,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    Registered {
        protocol_version: u16,
        device_id: String,
        attestation: KeyAttestation,
        ice_servers: Vec<IceServer>,
    },
    Pong {
        unix_seconds: u64,
    },
    Presence {
        device_id: String,
        online: bool,
    },
    AssistedSessionCode {
        code: String,
        expires_at_unix_seconds: u64,
    },
    SessionPaired {
        peer_id: String,
    },
    /// #1148: credencial TURN renovada em resposta a `RenewIceServers`. Mesmo
    /// formato do `ice_servers` do `Registered`, com `expires_at` novo — o cliente
    /// aplica antes do TTL da anterior vencer pra a sessão *relayed* não cair.
    IceServersRenewed {
        ice_servers: Vec<IceServer>,
    },
    Signal {
        peer_id: String,
        kind: SignalKind,
        payload: String,
    },
    Error {
        code: ErrorCode,
        message: String,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct KeyAttestation {
    pub algorithm: String,
    pub device_id: String,
    pub peer_public_key: String,
    pub issued_at_unix_seconds: u64,
    pub server_public_key: String,
    pub signature: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct IceServer {
    pub urls: Vec<String>,
    pub username: String,
    pub credential: String,
    pub expires_at_unix_seconds: u64,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    InvalidFrame,
    InvalidDeviceId,
    InvalidPublicKey,
    NotRegistered,
    DeviceReplaced,
    InvalidCode,
    CodeExpired,
    PeerOffline,
    NotPaired,
    RateLimited,
    PayloadTooLarge,
    Internal,
}

impl ServerMessage {
    pub fn error(code: ErrorCode, message: impl Into<String>) -> Self {
        Self::Error {
            code,
            message: message.into(),
        }
    }
}
