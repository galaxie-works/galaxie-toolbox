use std::{
    collections::{HashMap, VecDeque},
    net::IpAddr,
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use ed25519_dalek::{Signer, SigningKey};
use hmac::{Hmac, Mac};
use rand::{rngs::OsRng, Rng};
use sha1::Sha1;
use sha2::{Digest, Sha256};
use thiserror::Error;
use tokio::sync::{mpsc, Mutex, RwLock};
use uuid::Uuid;

use crate::protocol::{IceServer, KeyAttestation, ServerMessage, PROTOCOL_VERSION};

type HmacSha1 = Hmac<Sha1>;

#[derive(Clone)]
pub struct AppState {
    inner: Arc<Inner>,
}

struct Inner {
    signer: SigningKey,
    turn_secret: Vec<u8>,
    turn_urls: Vec<String>,
    turn_credential_ttl: Duration,
    code_ttl: Duration,
    max_code_ttl: Duration,
    devices: RwLock<HashMap<String, ConnectedDevice>>,
    codes: Mutex<HashMap<[u8; 32], AssistedCode>>,
    pairings: RwLock<HashMap<String, String>>,
    limiter: SlidingWindowLimiter,
    unattended: Mutex<galaxie_remote_net::authority::UnattendedAuthority>,
    unattended_state_file: Option<PathBuf>,
    unattended_persistence: Mutex<()>,
    unattended_devices: RwLock<HashMap<String, UnattendedDeviceConnection>>,
    unattended_sessions: RwLock<HashMap<String, UnattendedSession>>,
}

#[derive(Clone)]
pub struct ConnectedDevice {
    pub connection_id: Uuid,
    pub outbound: mpsc::Sender<ServerMessage>,
    pub public_key: [u8; 32],
    pub last_seen: Instant,
}

#[derive(Clone)]
pub struct UnattendedDeviceConnection {
    pub connection_id: Uuid,
    pub nonce: String,
    pub outbound: mpsc::Sender<String>,
}

#[derive(Clone)]
pub struct UnattendedSession {
    pub device_id: String,
    pub controller_id: String,
    pub controller_connection_id: Uuid,
    pub controller_outbound: mpsc::Sender<String>,
}

struct AssistedCode {
    creator_device_id: String,
    // A expiração é imposta por `expires_at: Instant` (checado em `redeem_code`).
    // #1076 (RB17): NÃO guardamos mais a versão unix-seconds — ela só era repassada
    // ao resultado do redeem e nunca lida pelo chamador; o valor wall-clock já vai
    // ao criador via `create_code`. Sem campo morto e sem `#[allow(dead_code)]` nu.
    expires_at: Instant,
}

struct SlidingWindowLimiter {
    max_events: usize,
    window: Duration,
    events: Mutex<HashMap<IpAddr, VecDeque<Instant>>>,
}

impl AppState {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        signer: SigningKey,
        turn_secret: impl Into<Vec<u8>>,
        turn_urls: Vec<String>,
        turn_credential_ttl: Duration,
        code_ttl: Duration,
        max_code_ttl: Duration,
        rate_limit_messages: usize,
        rate_limit_window: Duration,
    ) -> Self {
        Self::new_with_opaque(
            signer,
            turn_secret,
            turn_urls,
            turn_credential_ttl,
            code_ttl,
            max_code_ttl,
            rate_limit_messages,
            rate_limit_window,
            galaxie_remote_net::opaque::ServerSecrets::generate(),
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn new_with_opaque(
        signer: SigningKey,
        turn_secret: impl Into<Vec<u8>>,
        turn_urls: Vec<String>,
        turn_credential_ttl: Duration,
        code_ttl: Duration,
        max_code_ttl: Duration,
        rate_limit_messages: usize,
        rate_limit_window: Duration,
        opaque: galaxie_remote_net::opaque::ServerSecrets,
    ) -> Self {
        Self::new_with_opaque_snapshot(
            signer,
            turn_secret,
            turn_urls,
            turn_credential_ttl,
            code_ttl,
            max_code_ttl,
            rate_limit_messages,
            rate_limit_window,
            opaque,
            None,
            None,
        )
        .unwrap_or_else(|_| unreachable!("empty unattended snapshot is valid"))
    }

    #[allow(clippy::too_many_arguments)]
    pub fn new_with_opaque_snapshot(
        signer: SigningKey,
        turn_secret: impl Into<Vec<u8>>,
        turn_urls: Vec<String>,
        turn_credential_ttl: Duration,
        code_ttl: Duration,
        max_code_ttl: Duration,
        rate_limit_messages: usize,
        rate_limit_window: Duration,
        opaque: galaxie_remote_net::opaque::ServerSecrets,
        snapshot: Option<&[u8]>,
        unattended_state_file: Option<PathBuf>,
    ) -> Result<Self, galaxie_remote_net::authority::AuthorityError> {
        let mut unattended =
            galaxie_remote_net::authority::UnattendedAuthority::new(opaque, signer.clone());
        if let Some(snapshot) = snapshot {
            unattended.restore_snapshot_json(snapshot)?;
        }
        Ok(Self {
            inner: Arc::new(Inner {
                signer,
                turn_secret: turn_secret.into(),
                turn_urls,
                turn_credential_ttl,
                code_ttl,
                max_code_ttl,
                devices: RwLock::new(HashMap::new()),
                codes: Mutex::new(HashMap::new()),
                pairings: RwLock::new(HashMap::new()),
                limiter: SlidingWindowLimiter {
                    max_events: rate_limit_messages.max(1),
                    window: rate_limit_window,
                    events: Mutex::new(HashMap::new()),
                },
                unattended: Mutex::new(unattended),
                unattended_state_file,
                unattended_persistence: Mutex::new(()),
                unattended_devices: RwLock::new(HashMap::new()),
                unattended_sessions: RwLock::new(HashMap::new()),
            }),
        })
    }

    pub async fn unattended(
        &self,
    ) -> tokio::sync::MutexGuard<'_, galaxie_remote_net::authority::UnattendedAuthority> {
        self.inner.unattended.lock().await
    }

    pub async fn persist_unattended(&self) -> std::io::Result<()> {
        let _persistence = self.inner.unattended_persistence.lock().await;
        let Some(path) = self.inner.unattended_state_file.as_ref() else {
            return Ok(());
        };
        let bytes = self
            .inner
            .unattended
            .lock()
            .await
            .snapshot_json()
            .map_err(std::io::Error::other)?;
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let temporary = path.with_extension("json.tmp");
        tokio::fs::write(&temporary, bytes).await?;
        tokio::fs::rename(temporary, path).await
    }

    pub fn server_public_key_base64(&self) -> String {
        BASE64.encode(self.inner.signer.verifying_key().as_bytes())
    }

    pub async fn register_unattended_device(
        &self,
        device_id: String,
        nonce: String,
        connection_id: Uuid,
        outbound: mpsc::Sender<String>,
    ) {
        self.inner.unattended_devices.write().await.insert(
            device_id,
            UnattendedDeviceConnection {
                connection_id,
                nonce,
                outbound,
            },
        );
    }

    pub async fn unregister_unattended_device(&self, device_id: &str, connection_id: Uuid) {
        let remove = self
            .inner
            .unattended_devices
            .read()
            .await
            .get(device_id)
            .is_some_and(|connection| connection.connection_id == connection_id);
        if remove {
            self.inner
                .unattended_devices
                .write()
                .await
                .remove(device_id);
            self.inner
                .unattended_sessions
                .write()
                .await
                .retain(|_, session| session.device_id != device_id);
        }
    }

    pub async fn unattended_device(&self, device_id: &str) -> Option<UnattendedDeviceConnection> {
        self.inner
            .unattended_devices
            .read()
            .await
            .get(device_id)
            .cloned()
    }

    pub async fn is_current_unattended_device(
        &self,
        device_id: &str,
        nonce: &str,
        connection_id: Uuid,
    ) -> bool {
        self.inner
            .unattended_devices
            .read()
            .await
            .get(device_id)
            .is_some_and(|device| device.connection_id == connection_id && device.nonce == nonce)
    }

    pub async fn start_unattended_session(
        &self,
        session_id: String,
        device_id: String,
        controller_id: String,
        controller_connection_id: Uuid,
        controller_outbound: mpsc::Sender<String>,
    ) -> bool {
        let mut sessions = self.inner.unattended_sessions.write().await;
        if sessions.contains_key(&session_id) {
            return false;
        }
        sessions.insert(
            session_id,
            UnattendedSession {
                device_id,
                controller_id,
                controller_connection_id,
                controller_outbound,
            },
        );
        true
    }

    pub async fn unattended_session(&self, session_id: &str) -> Option<UnattendedSession> {
        self.inner
            .unattended_sessions
            .read()
            .await
            .get(session_id)
            .cloned()
    }

    pub async fn end_unattended_session(&self, session_id: &str) {
        self.inner
            .unattended_sessions
            .write()
            .await
            .remove(session_id);
    }

    pub async fn remove_controller_sessions(&self, connection_id: Uuid) {
        self.inner
            .unattended_sessions
            .write()
            .await
            .retain(|_, session| session.controller_connection_id != connection_id);
    }

    pub async fn allow_message(&self, ip: IpAddr) -> bool {
        self.inner.limiter.allow(ip).await
    }

    pub async fn register(
        &self,
        device_id: String,
        public_key: [u8; 32],
        connection_id: Uuid,
        outbound: mpsc::Sender<ServerMessage>,
    ) -> Option<mpsc::Sender<ServerMessage>> {
        let mut devices = self.inner.devices.write().await;
        devices
            .insert(
                device_id,
                ConnectedDevice {
                    connection_id,
                    outbound,
                    public_key,
                    last_seen: Instant::now(),
                },
            )
            .map(|previous| previous.outbound)
    }

    pub async fn unregister(&self, device_id: &str, connection_id: Uuid) {
        let should_remove = {
            let devices = self.inner.devices.read().await;
            devices
                .get(device_id)
                .is_some_and(|device| device.connection_id == connection_id)
        };
        if should_remove {
            self.inner.devices.write().await.remove(device_id);
            let peer = self.inner.pairings.write().await.remove(device_id);
            if let Some(peer) = peer {
                self.inner.pairings.write().await.remove(&peer);
            }
        }
    }

    pub async fn touch(&self, device_id: &str, connection_id: Uuid) {
        let mut devices = self.inner.devices.write().await;
        if let Some(device) = devices.get_mut(device_id) {
            if device.connection_id == connection_id {
                device.last_seen = Instant::now();
            }
        }
    }

    pub async fn is_online(&self, device_id: &str) -> bool {
        self.inner.devices.read().await.contains_key(device_id)
    }

    pub async fn outbound_for(&self, device_id: &str) -> Option<mpsc::Sender<ServerMessage>> {
        self.inner
            .devices
            .read()
            .await
            .get(device_id)
            .map(|device| device.outbound.clone())
    }

    pub async fn public_key_for(&self, device_id: &str) -> Option<[u8; 32]> {
        self.inner
            .devices
            .read()
            .await
            .get(device_id)
            .map(|device| device.public_key)
    }

    pub fn attest_key(
        &self,
        device_id: &str,
        peer_public_key: [u8; 32],
    ) -> Result<KeyAttestation, std::time::SystemTimeError> {
        let issued_at_unix_seconds = unix_seconds()?;
        let payload = attestation_payload(device_id, &peer_public_key, issued_at_unix_seconds);
        let signature = self.inner.signer.sign(&payload);
        Ok(KeyAttestation {
            algorithm: "Ed25519".to_owned(),
            device_id: device_id.to_owned(),
            peer_public_key: BASE64.encode(peer_public_key),
            issued_at_unix_seconds,
            server_public_key: self.server_public_key_base64(),
            signature: BASE64.encode(signature.to_bytes()),
        })
    }

    pub fn ice_servers(&self, device_id: &str) -> Result<Vec<IceServer>, TurnCredentialError> {
        let expires_at = unix_seconds()?.saturating_add(self.inner.turn_credential_ttl.as_secs());
        let username = format!("{expires_at}:{device_id}");
        let mut mac = HmacSha1::new_from_slice(&self.inner.turn_secret)
            .map_err(|_| TurnCredentialError::InvalidSecret)?;
        mac.update(username.as_bytes());
        let credential = BASE64.encode(mac.finalize().into_bytes());
        Ok(vec![IceServer {
            urls: self.inner.turn_urls.clone(),
            username,
            credential,
            expires_at_unix_seconds: expires_at,
        }])
    }

    pub async fn create_code(
        &self,
        creator_device_id: &str,
        requested_ttl_seconds: Option<u64>,
    ) -> Result<(String, u64), std::time::SystemTimeError> {
        let ttl = requested_ttl_seconds.map_or_else(
            || self.inner.code_ttl.min(self.inner.max_code_ttl),
            |requested| {
                Duration::from_secs(requested)
                    .clamp(Duration::from_secs(30), self.inner.max_code_ttl)
            },
        );
        let expires_at_unix_seconds = unix_seconds()?.saturating_add(ttl.as_secs());
        let expires_at = Instant::now() + ttl;
        let mut rng = OsRng;

        let mut codes = self.inner.codes.lock().await;
        codes.retain(|_, entry| entry.expires_at > Instant::now());
        loop {
            let code = format!("{:08}", rng.gen_range(0_u32..100_000_000_u32));
            let hash = hash_code(&code);
            if let std::collections::hash_map::Entry::Vacant(entry) = codes.entry(hash) {
                entry.insert(AssistedCode {
                    creator_device_id: creator_device_id.to_owned(),
                    expires_at,
                });
                return Ok((code, expires_at_unix_seconds));
            }
        }
    }

    pub async fn redeem_code(&self, code: &str) -> RedeemResult {
        if code.len() != 8 || !code.bytes().all(|byte| byte.is_ascii_digit()) {
            return RedeemResult::Invalid;
        }

        let hash = hash_code(code);
        let mut codes = self.inner.codes.lock().await;
        let Some(entry) = codes.remove(&hash) else {
            return RedeemResult::Invalid;
        };
        if entry.expires_at <= Instant::now() {
            return RedeemResult::Expired;
        }
        RedeemResult::Ready {
            creator_device_id: entry.creator_device_id,
        }
    }

    pub async fn pair(&self, first: &str, second: &str) {
        let mut pairings = self.inner.pairings.write().await;
        if let Some(old_peer) = pairings.insert(first.to_owned(), second.to_owned()) {
            pairings.remove(&old_peer);
        }
        if let Some(old_peer) = pairings.insert(second.to_owned(), first.to_owned()) {
            pairings.remove(&old_peer);
        }
    }

    pub async fn is_paired(&self, first: &str, second: &str) -> bool {
        self.inner
            .pairings
            .read()
            .await
            .get(first)
            .is_some_and(|peer| peer == second)
    }
}

pub enum RedeemResult {
    Invalid,
    Expired,
    Ready {
        creator_device_id: String,
    },
}

#[derive(Debug, Error)]
pub enum TurnCredentialError {
    #[error("relogio do servidor invalido")]
    Clock(#[from] std::time::SystemTimeError),
    #[error("segredo TURN invalido")]
    InvalidSecret,
}

impl SlidingWindowLimiter {
    async fn allow(&self, ip: IpAddr) -> bool {
        let now = Instant::now();
        let threshold = now.checked_sub(self.window).unwrap_or(now);
        let mut all_events = self.events.lock().await;
        let events = all_events.entry(ip).or_default();
        while events.front().is_some_and(|event| *event <= threshold) {
            events.pop_front();
        }
        if events.len() >= self.max_events {
            return false;
        }
        events.push_back(now);
        true
    }
}

pub fn attestation_payload(
    device_id: &str,
    peer_public_key: &[u8; 32],
    issued_at_unix_seconds: u64,
) -> Vec<u8> {
    let mut payload = Vec::with_capacity(2 + device_id.len() + 1 + 32 + 8);
    payload.extend_from_slice(&PROTOCOL_VERSION.to_be_bytes());
    payload.extend_from_slice(device_id.as_bytes());
    payload.push(0);
    payload.extend_from_slice(peer_public_key);
    payload.extend_from_slice(&issued_at_unix_seconds.to_be_bytes());
    payload
}

fn hash_code(code: &str) -> [u8; 32] {
    Sha256::digest(code.as_bytes()).into()
}

fn unix_seconds() -> Result<u64, std::time::SystemTimeError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
}
