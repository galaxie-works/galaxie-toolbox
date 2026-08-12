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

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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
    #[error("request id must contain 1..64 characters")]
    RequestId,
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
    if envelope.id.is_empty() || envelope.id.len() > 64 {
        return Err(ProtocolError::RequestId);
    }
    Ok(envelope)
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
}
