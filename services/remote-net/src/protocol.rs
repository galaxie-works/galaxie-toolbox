use serde::{Deserialize, Serialize};

use crate::{MAX_MESSAGE_BYTES, PROTOCOL_VERSION};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Envelope<T> {
    pub v: u16,
    pub id: String,
    #[serde(rename = "type")]
    pub message_type: MessageType,
    pub method: String,
    pub payload: T,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MessageType {
    Request,
    Response,
    Event,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "method", content = "payload")]
pub enum NetMessage {
    #[serde(rename = "device.enroll.begin")]
    DeviceEnrollBegin(DeviceEnrollBegin),
    #[serde(rename = "device.enroll.finish")]
    DeviceEnrollFinish(DeviceEnrollFinish),
    #[serde(rename = "device.register")]
    DeviceRegister(DeviceRegister),
    #[serde(rename = "device.heartbeat")]
    DeviceHeartbeat(DeviceHeartbeat),
    #[serde(rename = "unattended.auth.begin")]
    AuthBegin(AuthBegin),
    #[serde(rename = "unattended.auth.finish")]
    AuthFinish(AuthFinish),
    #[serde(rename = "session.request")]
    SessionRequest(SessionRequest),
    #[serde(rename = "session.accept")]
    SessionAccept(SessionDecision),
    #[serde(rename = "session.reject")]
    SessionReject(SessionDecision),
    #[serde(rename = "session.revoke")]
    SessionRevoke(SessionDecision),
    #[serde(rename = "session.end")]
    SessionEnd(SessionDecision),
    #[serde(rename = "session.signal")]
    SessionSignal(SessionSignal),
}

/// Capabilities da sessão remota — o tipo ÚNICO (#1070 RB7): assinado no ticket S8
/// (remote-net) e, a partir de agora, o que cruza o IPC do app (substitui o antigo
/// `RemoteCapabilities` de 2 campos). `#[serde(default)]`: um campo AUSENTE no payload
/// desserializa como `false` = **DENY** (fail-closed) — casa com o `Default` e deixa o
/// front atual (que manda só `screen`/`input`) válido, com file/clipboard/audio negados
/// até serem concedidos. `Copy` porque são 5 bools (o app copia por valor).
#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct Capabilities {
    pub screen: bool,
    pub input: bool,
    pub file_transfer: bool,
    pub clipboard: bool,
    pub audio: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceEnrollBegin {
    pub device_id: String,
    pub owner_id: String,
    pub org_id: String,
    pub name: String,
    pub public_key: String,
    pub opaque_request: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceEnrollFinish {
    pub device_id: String,
    pub opaque_upload: String,
    pub capabilities: Capabilities,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceRegister {
    pub device_id: String,
    pub nonce: String,
    pub timestamp: u64,
    pub signature: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceHeartbeat {
    pub device_id: String,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthBegin {
    pub device_id: String,
    pub controller_id: String,
    pub owner_id: String,
    pub org_id: String,
    pub device_nonce: String,
    pub controller_nonce: String,
    pub requested_capabilities: Capabilities,
    pub opaque_request: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthFinish {
    pub auth_id: String,
    pub opaque_finalization: String,
    pub controller_nonce: String,
    pub requested_capabilities: Capabilities,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionRequest {
    pub session_id: String,
    pub ticket: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionDecision {
    pub session_id: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionSignal {
    pub session_id: String,
    pub peer_id: String,
    pub kind: SignalKind,
    pub payload: String,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SignalKind {
    Offer,
    Answer,
    IceCandidate,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ProtocolError {
    #[error("frame must contain 1..65536 UTF-8 bytes")]
    MessageSize,
    #[error("invalid JSON: {0}")]
    Json(String),
    #[error("unsupported protocol version")]
    Version,
    #[error("request id must contain 1..64 safe ASCII characters")]
    RequestId,
    #[error("method is not allowed for this payload")]
    Method,
}

pub fn decode_envelope<T>(bytes: &[u8]) -> Result<Envelope<T>, ProtocolError>
where
    T: for<'de> Deserialize<'de>,
{
    if bytes.is_empty() || bytes.len() > MAX_MESSAGE_BYTES {
        return Err(ProtocolError::MessageSize);
    }
    let envelope: Envelope<T> =
        serde_json::from_slice(bytes).map_err(|error| ProtocolError::Json(error.to_string()))?;
    if envelope.v != PROTOCOL_VERSION {
        return Err(ProtocolError::Version);
    }
    if !is_safe_identifier(&envelope.id, 64) {
        return Err(ProtocolError::RequestId);
    }
    Ok(envelope)
}

pub fn decode_net_message(bytes: &[u8]) -> Result<Envelope<serde_json::Value>, ProtocolError> {
    let envelope = decode_envelope::<serde_json::Value>(bytes)?;
    if !ALLOWED_METHODS.contains(&envelope.method.as_str()) {
        return Err(ProtocolError::Method);
    }
    Ok(envelope)
}

pub const ALLOWED_METHODS: &[&str] = &[
    "device.enroll.begin",
    "device.enroll.finish",
    "device.register",
    "device.heartbeat",
    "unattended.auth.begin",
    "unattended.auth.finish",
    "session.request",
    "session.accept",
    "session.reject",
    "session.revoke",
    "session.end",
    "session.signal",
];

fn is_safe_identifier(value: &str, max_len: usize) -> bool {
    !value.is_empty()
        && value.len() <= max_len
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_v1_and_oversize() {
        let v1 = br#"{"v":1,"id":"x","type":"request","method":"x","payload":{}}"#;
        assert_eq!(
            decode_envelope::<serde_json::Value>(v1),
            Err(ProtocolError::Version)
        );
        assert_eq!(
            decode_envelope::<serde_json::Value>(&vec![b'x'; MAX_MESSAGE_BYTES + 1]),
            Err(ProtocolError::MessageSize)
        );
    }

    #[test]
    fn capabilities_are_default_deny() {
        assert_eq!(
            Capabilities::default(),
            Capabilities {
                screen: false,
                input: false,
                file_transfer: false,
                clipboard: false,
                audio: false,
            }
        );
    }

    #[test]
    fn request_id_and_method_fail_closed() {
        let nul = b"{\"v\":2,\"id\":\"x\\u0000y\",\"type\":\"request\",\"method\":\"device.register\",\"payload\":{}}";
        assert_eq!(decode_net_message(nul), Err(ProtocolError::RequestId));
        let unknown = b"{\"v\":2,\"id\":\"x\",\"type\":\"request\",\"method\":\"device.destroyEverything\",\"payload\":{}}";
        assert_eq!(decode_net_message(unknown), Err(ProtocolError::Method));
    }
}
