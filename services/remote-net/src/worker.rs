use std::time::Duration;

use ed25519_dalek::VerifyingKey;
use rand::{Rng, RngCore, rngs::OsRng};
use serde::Deserialize;
use serde_json::json;
use tokio::time::MissedTickBehavior;

use crate::{
    PROTOCOL_VERSION,
    identity::DeviceIdentity,
    protocol::{DeviceHeartbeat, DeviceRegister, Envelope, MessageType, SessionRequest},
    ticket::{TicketClaims, TicketVerifier},
    transport::{CertificatePin, PinnedSocket, PinnedWssClient, TransportError},
};

const INITIAL_RECONNECT_DELAY: Duration = Duration::from_secs(1);
const MAX_RECONNECT_DELAY: Duration = Duration::from_secs(60);
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);

pub struct WorkerRegistration {
    pub device_id: String,
    pub nonce: String,
    pub timestamp: u64,
    pub signature: String,
}

#[derive(Debug, thiserror::Error)]
pub enum WorkerError {
    #[error(transparent)]
    Transport(#[from] TransportError),
    #[error("server did not acknowledge the signed device registration")]
    RegistrationRejected,
    #[error("system clock is before UNIX epoch")]
    Clock,
    #[error("session request failed protocol or ticket validation")]
    SessionRejected,
}

pub struct WorkerClient {
    device_id: String,
    identity: DeviceIdentity,
    transport: PinnedWssClient,
    server_ticket_key: VerifyingKey,
}

impl WorkerClient {
    pub fn new(
        endpoint: &str,
        certificate_pin: CertificatePin,
        device_id: String,
        identity: DeviceIdentity,
        server_ticket_key: VerifyingKey,
    ) -> Result<Self, WorkerError> {
        validate_worker_id(&device_id)?;
        Ok(Self {
            device_id,
            identity,
            transport: PinnedWssClient::new(endpoint, certificate_pin)?,
            server_ticket_key,
        })
    }

    pub async fn connect(&self) -> Result<WorkerConnection, WorkerError> {
        let mut socket = self.transport.connect().await?;
        let request_id = random_id();
        let nonce = random_id();
        let timestamp = unix_seconds()?;
        let registration =
            WorkerRegistration::signed(&self.identity, &self.device_id, nonce, timestamp);
        socket
            .send(&registration.envelope(request_id.clone()))
            .await?;
        let Some(response) = socket.receive::<serde_json::Value>().await? else {
            return Err(WorkerError::RegistrationRejected);
        };
        if response.v != PROTOCOL_VERSION
            || response.id != request_id
            || response.message_type != MessageType::Response
            || response.method != "device.register"
        {
            return Err(WorkerError::RegistrationRejected);
        }
        Ok(WorkerConnection {
            device_id: self.device_id.clone(),
            device_nonce: registration.nonce,
            socket,
            ticket_verifier: TicketVerifier::new(self.server_ticket_key),
        })
    }
}

pub struct WorkerConnection {
    device_id: String,
    device_nonce: String,
    socket: PinnedSocket,
    ticket_verifier: TicketVerifier,
}

pub struct AuthorizedSession {
    pub ticket: String,
    pub claims: TicketClaims,
}

impl WorkerConnection {
    pub async fn run<F>(mut self, mut on_session: F) -> Result<(), WorkerError>
    where
        F: FnMut(AuthorizedSession) -> Result<(), WorkerError>,
    {
        let mut heartbeat = tokio::time::interval(HEARTBEAT_INTERVAL);
        heartbeat.set_missed_tick_behavior(MissedTickBehavior::Delay);
        heartbeat.tick().await;
        loop {
            tokio::select! {
                _ = heartbeat.tick() => {
                    let envelope = heartbeat_envelope(
                        &self.device_id,
                        unix_seconds()?,
                        random_id(),
                    );
                    self.socket.send(&envelope).await?;
                }
                incoming = self.socket.receive::<serde_json::Value>() => {
                    let Some(incoming) = incoming? else { return Ok(()); };
                    if incoming.v != PROTOCOL_VERSION {
                        return Err(WorkerError::RegistrationRejected);
                    }
                    if incoming.message_type == MessageType::Event
                        && incoming.method == "session.request"
                    {
                        on_session(authorize_session_event(
                            &mut self.ticket_verifier,
                            &self.device_id,
                            &self.device_nonce,
                            incoming,
                            unix_seconds()?,
                        )?)?;
                    } else if incoming.message_type == MessageType::Event {
                        return Err(WorkerError::SessionRejected);
                    }
                }
            }
        }
    }
}

fn authorize_session_event(
    verifier: &mut TicketVerifier,
    device_id: &str,
    device_nonce: &str,
    envelope: Envelope<serde_json::Value>,
    now: u64,
) -> Result<AuthorizedSession, WorkerError> {
    let body: SessionRequest = deserialize_payload(envelope.payload)?;
    let claims = verifier
        .verify_and_consume_claims(&body.ticket, now)
        .map_err(|_| WorkerError::SessionRejected)?;
    if body.session_id != claims.session_id
        || device_id != claims.device_id
        || device_nonce != claims.device_nonce
    {
        return Err(WorkerError::SessionRejected);
    }
    Ok(AuthorizedSession {
        ticket: body.ticket,
        claims,
    })
}

fn deserialize_payload<T: for<'de> Deserialize<'de>>(
    value: serde_json::Value,
) -> Result<T, WorkerError> {
    serde_json::from_value(value).map_err(|_| WorkerError::SessionRejected)
}

impl WorkerRegistration {
    pub fn signed(
        identity: &DeviceIdentity,
        device_id: &str,
        nonce: String,
        timestamp: u64,
    ) -> Self {
        Self {
            device_id: device_id.to_owned(),
            signature: identity.sign_registration(device_id, &nonce, timestamp),
            nonce,
            timestamp,
        }
    }

    pub fn envelope(&self, id: String) -> Envelope<serde_json::Value> {
        Envelope {
            v: PROTOCOL_VERSION,
            id,
            message_type: MessageType::Request,
            method: "device.register".into(),
            payload: serde_json::to_value(DeviceRegister {
                device_id: self.device_id.clone(),
                nonce: self.nonce.clone(),
                timestamp: self.timestamp,
                signature: self.signature.clone(),
            })
            .unwrap_or_else(|_| json!({})),
        }
    }
}

pub fn heartbeat_envelope(
    device_id: &str,
    timestamp: u64,
    id: String,
) -> Envelope<serde_json::Value> {
    Envelope {
        v: PROTOCOL_VERSION,
        id,
        message_type: MessageType::Request,
        method: "device.heartbeat".into(),
        payload: serde_json::to_value(DeviceHeartbeat {
            device_id: device_id.to_owned(),
            timestamp,
        })
        .unwrap_or_else(|_| json!({})),
    }
}

fn random_id() -> String {
    let mut bytes = [0_u8; 24];
    OsRng.fill_bytes(&mut bytes);
    base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, bytes)
}

fn unix_seconds() -> Result<u64, WorkerError> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|_| WorkerError::Clock)
}

fn validate_worker_id(value: &str) -> Result<(), WorkerError> {
    if (1..=128).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        Ok(())
    } else {
        Err(WorkerError::RegistrationRejected)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReconnectBackoff {
    current: Duration,
}

impl Default for ReconnectBackoff {
    fn default() -> Self {
        Self {
            current: INITIAL_RECONNECT_DELAY,
        }
    }
}

impl ReconnectBackoff {
    pub fn next_delay(&mut self) -> Duration {
        let jitter_limit = (self.current.as_millis() / 4) as u64;
        let jitter = if jitter_limit == 0 {
            0
        } else {
            OsRng.gen_range(0..=jitter_limit)
        };
        let delay = self.current + Duration::from_millis(jitter);
        self.current = self.current.saturating_mul(2).min(MAX_RECONNECT_DELAY);
        delay
    }

    pub fn reset(&mut self) {
        self.current = INITIAL_RECONNECT_DELAY;
    }

    pub fn heartbeat_interval() -> Duration {
        HEARTBEAT_INTERVAL
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registration_is_signed_and_method_is_frozen() {
        let identity = DeviceIdentity::generate();
        let registration = WorkerRegistration::signed(&identity, "device-1", "nonce-1".into(), 100);
        let envelope = registration.envelope("request-1".into());
        assert_eq!(envelope.v, PROTOCOL_VERSION);
        assert_eq!(envelope.method, "device.register");
        assert!(!registration.signature.is_empty());
    }

    #[test]
    fn reconnect_is_bounded_and_resets_after_success() {
        let mut backoff = ReconnectBackoff::default();
        for _ in 0..16 {
            assert!(backoff.next_delay() <= Duration::from_secs(75));
        }
        backoff.reset();
        assert!(backoff.next_delay() <= Duration::from_millis(1_250));
        assert_eq!(
            ReconnectBackoff::heartbeat_interval(),
            Duration::from_secs(30)
        );
    }

    #[test]
    fn worker_id_rejects_controls_and_path_syntax() {
        assert!(validate_worker_id("device-01").is_ok());
        for invalid in ["", "device\0bad", "../device", "device/name", "device name"] {
            assert!(validate_worker_id(invalid).is_err());
        }
    }
}
