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
    redeem_failures: Mutex<HashMap<IpAddr, RedeemFailState>>,
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

// SEC13 (#1050): rate-limit dedicado às falhas de `redeem_code` por IP. O limite
// geral de mensagens (120/min) não encarece a varredura de códigos de 8 dígitos
// o bastante; este backoff exponencial por-IP torna a força-bruta inviável.
const REDEEM_MAX_FALHAS: usize = 5;
const REDEEM_JANELA: Duration = Duration::from_secs(60);
const REDEEM_BACKOFF_BASE: Duration = Duration::from_secs(2);
const REDEEM_BACKOFF_MAX: Duration = Duration::from_secs(300);

// Estado por-IP das falhas de redeem: janela deslizante de falhas + bloqueio ativo.
#[derive(Default)]
struct RedeemFailState {
    falhas: VecDeque<Instant>,
    bloqueado_ate: Option<Instant>,
    ciclos: u32,
}

// Backoff exponencial puro (testável sem sleep): BASE * 2^(ciclos-1), com teto MAX.
fn duracao_backoff(ciclos: u32) -> Duration {
    if ciclos == 0 {
        return Duration::ZERO;
    }
    let base = REDEEM_BACKOFF_BASE.as_secs();
    let teto = REDEEM_BACKOFF_MAX.as_secs();
    // 2^(ciclos-1) saturando: shift >= 64 vira u64::MAX, evitando overflow em ciclos altos.
    let fator = 1_u64.checked_shl(ciclos - 1).unwrap_or(u64::MAX);
    let segundos = base.saturating_mul(fator).min(teto);
    Duration::from_secs(segundos)
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
                redeem_failures: Mutex::new(HashMap::new()),
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

    // SEC13: true se o IP pode tentar um redeem agora. Falso enquanto em backoff.
    pub async fn allow_redeem(&self, ip: IpAddr) -> bool {
        let now = Instant::now();
        let mut all = self.inner.redeem_failures.lock().await;
        let Some(estado) = all.get_mut(&ip) else {
            return true;
        };
        if let Some(ate) = estado.bloqueado_ate {
            if ate > now {
                return false;
            }
            // backoff expirou: libera novas tentativas (mas preserva `ciclos` p/ escalar).
            estado.bloqueado_ate = None;
        }
        // poda falhas fora da janela para não reter estado velho.
        let threshold = now.checked_sub(REDEEM_JANELA).unwrap_or(now);
        while estado.falhas.front().is_some_and(|evento| *evento <= threshold) {
            estado.falhas.pop_front();
        }
        // sem bloqueio e sem falhas recentes: descarta a entrada (economia de memória).
        if estado.falhas.is_empty() && estado.bloqueado_ate.is_none() {
            all.remove(&ip);
        }
        true
    }

    // SEC13: registra uma falha de redeem; ao atingir o teto na janela, arma o backoff.
    pub async fn register_redeem_failure(&self, ip: IpAddr) {
        let now = Instant::now();
        let threshold = now.checked_sub(REDEEM_JANELA).unwrap_or(now);
        let mut all = self.inner.redeem_failures.lock().await;
        let estado = all.entry(ip).or_default();
        while estado.falhas.front().is_some_and(|evento| *evento <= threshold) {
            estado.falhas.pop_front();
        }
        estado.falhas.push_back(now);
        if estado.falhas.len() >= REDEEM_MAX_FALHAS {
            estado.ciclos = estado.ciclos.saturating_add(1);
            estado.bloqueado_ate = Some(now + duracao_backoff(estado.ciclos));
            estado.falhas.clear();
        }
    }

    // SEC13: um redeem bem-sucedido zera todo o histórico de falhas do IP.
    pub async fn clear_redeem_failures(&self, ip: IpAddr) {
        self.inner.redeem_failures.lock().await.remove(&ip);
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

    /// Gera as credenciais TURN de curta duração a partir do relógio atual
    /// (`now + turn_credential_ttl`). #1148: usado no `Registered` E na renovação
    /// (`RenewIceServers`) — chamar de novo com o relógio adiantado devolve uma
    /// credencial com `expires_at` novo, sem refazer pareamento.
    pub fn ice_servers(&self, device_id: &str) -> Result<Vec<IceServer>, TurnCredentialError> {
        let expires_at = unix_seconds()?.saturating_add(self.inner.turn_credential_ttl.as_secs());
        let ice = montar_ice_server(
            &self.inner.turn_urls,
            &self.inner.turn_secret,
            device_id,
            expires_at,
        )?;
        Ok(vec![ice])
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

/// #1148: monta UMA credencial TURN de curta duração (esquema REST do coturn:
/// `username = "{expires_at}:{device_id}"`, `credential = base64(HMAC-SHA1(secret,
/// username))`). PURA em `expires_at` — o `ice_servers` passa `now + ttl`; o teste
/// passa dois instantes (relógio adiantado) e prova que a renovação gera uma
/// credencial FRESCA (username/credential diferentes, `expires_at` maior).
fn montar_ice_server(
    turn_urls: &[String],
    turn_secret: &[u8],
    device_id: &str,
    expires_at: u64,
) -> Result<IceServer, TurnCredentialError> {
    let username = format!("{expires_at}:{device_id}");
    let mut mac =
        HmacSha1::new_from_slice(turn_secret).map_err(|_| TurnCredentialError::InvalidSecret)?;
    mac.update(username.as_bytes());
    let credential = BASE64.encode(mac.finalize().into_bytes());
    Ok(IceServer {
        urls: turn_urls.to_vec(),
        username,
        credential,
        expires_at_unix_seconds: expires_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    #[test]
    fn renovar_gera_credencial_fresca_com_relogio_adiantado() {
        // #1148: a renovação (RenewIceServers → ice_servers) chamada mais tarde
        // devolve uma credencial com `expires_at` NOVO e credencial distinta — o
        // que permite a sessão relayed sobreviver ao TTL. Prova com o relógio
        // adiantado (t2 > t1) sem depender do relógio real.
        let urls = vec!["turn:localhost:3478".to_owned()];
        let secret = b"turn-secret-de-teste";
        let dev = "device-abc";

        let t1 = 1_000_000u64;
        let t2 = t1 + 1800; // relógio adiantado 30min (um TTL)
        let a = montar_ice_server(&urls, secret, dev, t1).expect("t1");
        let b = montar_ice_server(&urls, secret, dev, t2).expect("t2");

        // expiração renovada pra frente.
        assert_eq!(a.expires_at_unix_seconds, t1);
        assert_eq!(b.expires_at_unix_seconds, t2);
        assert!(b.expires_at_unix_seconds > a.expires_at_unix_seconds);
        // credencial FRESCA: username embute o novo expires_at e o HMAC muda com ele.
        assert_ne!(a.username, b.username);
        assert_ne!(a.credential, b.credential);
        assert!(b.username.starts_with(&format!("{t2}:")));
        // o device e as urls não mudam na renovação (não refaz pareamento).
        assert!(b.username.ends_with(dev));
        assert_eq!(a.urls, b.urls);
        // credencial não-vazia e determinística (mesmo instante → mesma credencial).
        let b2 = montar_ice_server(&urls, secret, dev, t2).expect("t2 de novo");
        assert_eq!(b.credential, b2.credential, "mesmo expires_at → mesma credencial");
        assert!(!b.credential.is_empty());
    }

    fn estado_de_teste() -> AppState {
        AppState::new(
            SigningKey::from_bytes(&[7_u8; 32]),
            b"turn-secret-de-teste".to_vec(),
            vec!["turn:localhost:3478".to_owned()],
            Duration::from_secs(60),
            Duration::from_secs(600),
            Duration::from_secs(600),
            120,
            Duration::from_secs(60),
        )
    }

    #[tokio::test]
    async fn redeem_bloqueia_apos_teto_de_falhas_e_isola_por_ip() {
        let estado = estado_de_teste();
        let alvo = IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1));
        // Até o teto o IP segue permitido; a falha nº REDEEM_MAX_FALHAS arma o backoff.
        for _ in 0..REDEEM_MAX_FALHAS {
            assert!(estado.allow_redeem(alvo).await);
            estado.register_redeem_failure(alvo).await;
        }
        assert!(!estado.allow_redeem(alvo).await, "IP deveria estar em backoff");
        // Outro IP não é afetado (isolamento por-IP).
        let outro = IpAddr::V4(Ipv4Addr::new(10, 0, 0, 2));
        assert!(estado.allow_redeem(outro).await);
    }

    #[tokio::test]
    async fn sucesso_reabre_o_ip_bloqueado() {
        let estado = estado_de_teste();
        let alvo = IpAddr::V4(Ipv4Addr::new(10, 0, 0, 3));
        for _ in 0..REDEEM_MAX_FALHAS {
            estado.register_redeem_failure(alvo).await;
        }
        assert!(!estado.allow_redeem(alvo).await);
        // clear_redeem_failures simula o redeem bem-sucedido: zera o histórico.
        estado.clear_redeem_failures(alvo).await;
        assert!(estado.allow_redeem(alvo).await);
    }

    #[test]
    fn backoff_cresce_exponencialmente_com_teto() {
        assert_eq!(duracao_backoff(0), Duration::ZERO);
        assert_eq!(duracao_backoff(1), Duration::from_secs(2));
        assert_eq!(duracao_backoff(2), Duration::from_secs(4));
        assert_eq!(duracao_backoff(3), Duration::from_secs(8));
        assert_eq!(duracao_backoff(4), Duration::from_secs(16));
        assert_eq!(duracao_backoff(5), Duration::from_secs(32));
        // Teto de 300s atingido e mantido, sem overflow em ciclos altos.
        assert_eq!(duracao_backoff(20), Duration::from_secs(300));
        assert_eq!(duracao_backoff(1000), Duration::from_secs(300));
    }
}
