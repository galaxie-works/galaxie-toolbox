use std::{
    collections::{HashMap, VecDeque},
    net::IpAddr,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
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
    // #1049 T2: tentativas de Register por IP (reusa a mesma forma de janela+backoff).
    register_attempts: Mutex<HashMap<IpAddr, RedeemFailState>>,
    unattended: Mutex<galaxie_remote_net::authority::UnattendedAuthority>,
    unattended_state_file: Option<PathBuf>,
    unattended_persistence: Mutex<()>,
    unattended_devices: RwLock<HashMap<String, UnattendedDeviceConnection>>,
    unattended_sessions: RwLock<HashMap<String, UnattendedSession>>,
    // #1049 passo 2 — enforce da PoP no Register do v1.
    //
    // `AtomicBool` e nao campo de construtor de proposito: (a) nao quebra as 3
    // assinaturas de `new*` que os testes usam; (b) deixa a porta aberta para
    // virar a flag SEM reiniciar o processo, se o `altair` decidir que o
    // requisito 1 do desenho exige isso — hoje ela e setada uma vez no boot.
    require_device_pop: AtomicBool,
    // O numero que o `wagner` precisa para decidir a janela: quantos Register
    // chegam SEM PoP por dia. Sem isto a flag e inutil, porque ninguem sabe
    // quantos clientes velhos existem (requisito 2 do desenho do `altair`).
    pop_contadores: Mutex<PopContadores>,
}

/// Contagem diaria (dia UTC) de `Register` por presenca de PoP.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PopContadores {
    /// Dia UTC (segundos unix / 86400) a que os contadores se referem.
    pub dia_utc: u64,
    pub com_pop: u64,
    pub sem_pop: u64,
    /// Recusados por falta/invalidez de PoP (so acontece com a flag LIGADA).
    pub recusados: u64,
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
// #1049 T2 (adendo §6 do Altair): limitador DEDICADO do Register. Cada Register cunha
// credencial TURN de 30min; um cliente legítimo registra ~1×/sessão. 5/60s tolera
// reconexão mas mata o 120/min do balde genérico. Reusa a forma do redeem (janela +
// ciclos + `duracao_backoff`). NÃO fecha o T2 (isso é o OPAQUE do v2, #1132) — reduz a
// exposição durante a janela.
const REGISTER_MAX: usize = 5;
const REGISTER_JANELA: Duration = Duration::from_secs(60);

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
    /// #1049 passo 2 — liga/desliga o enforce da PoP. Chamado no boot a partir do
    /// `AppConfig`; separado do construtor para nao quebrar as assinaturas
    /// existentes e para permitir virar a quente no futuro.
    pub fn set_require_device_pop(&self, exigir: bool) {
        self.inner
            .require_device_pop
            .store(exigir, Ordering::Relaxed);
    }

    pub fn require_device_pop(&self) -> bool {
        self.inner.require_device_pop.load(Ordering::Relaxed)
    }

    /// Registra UMA tentativa de `Register` na contagem do dia UTC corrente.
    /// Vira o balde quando o dia muda e devolve o snapshot do dia FECHADO, para
    /// quem chamou logar o resumo (o dado que embasa a decisao da janela).
    pub async fn contar_register_pop(
        &self,
        com_pop: bool,
        recusado: bool,
        agora_unix: u64,
    ) -> Option<PopContadores> {
        let dia = agora_unix / 86_400;
        let mut c = self.inner.pop_contadores.lock().await;
        let fechado = if c.dia_utc != dia {
            // Nao emite resumo do "dia zero" (estado recem-criado, sem tentativa).
            let anterior = (c.dia_utc != 0
                && (c.com_pop > 0 || c.sem_pop > 0 || c.recusados > 0))
                .then_some(*c);
            *c = PopContadores {
                dia_utc: dia,
                ..Default::default()
            };
            anterior
        } else {
            None
        };
        if com_pop {
            c.com_pop += 1;
        } else {
            c.sem_pop += 1;
        }
        if recusado {
            c.recusados += 1;
        }
        fechado
    }

    /// Snapshot do dia corrente (observabilidade e testes).
    pub async fn pop_contadores(&self) -> PopContadores {
        *self.inner.pop_contadores.lock().await
    }

    // #1330: o allow pertence AQUI — `new` tem 8 argumentos (teto do clippy é 7).
    // Ele existia antes do #1049; a inserção dos métodos de PoP entrou ENTRE o
    // atributo e a `fn`, deixando o atributo decorando um método de 1 argumento
    // e o construtor descoberto. Clippy só reclamou no gate, não na compilação.
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
                register_attempts: Mutex::new(HashMap::new()),
                require_device_pop: AtomicBool::new(false),
                pop_contadores: Mutex::new(PopContadores::default()),
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

    /// #1295 — CUNHAGEM do ticket de matrícula. Este é o método da SUPERFÍCIE
    /// AUTENTICADA (identidade M365 já verificada pelo app), NÃO uma rota do `/v2/ws`:
    /// não adiciona superfície de runtime na rede. owner/org vêm da identidade provada
    /// pelo chamador; capabilities e teto são decididos aqui pela política do servidor.
    /// O `/v2/ws` apenas VALIDA o ticket resultante.
    pub async fn mint_enrollment_ticket(
        &self,
        owner_id: &str,
        org_id: &str,
        device_id: &str,
    ) -> Result<String, EnrollmentMintError> {
        let now = unix_seconds().map_err(|_| EnrollmentMintError::Clock)?;
        let ticket = self
            .inner
            .unattended
            .lock()
            .await
            .mint_enrollment_ticket(owner_id, org_id, device_id, now)
            .map_err(EnrollmentMintError::Authority)?;
        self.persist_unattended()
            .await
            .map_err(|_| EnrollmentMintError::Persistence)?;
        Ok(ticket)
    }

    /// #1295 — política do operador: teto de devices por owner_id. Fora do wire.
    pub async fn set_enrollment_cap(&self, cap: usize) {
        self.inner.unattended.lock().await.set_enrollment_cap(cap);
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

    // #1049 T2 (adendo §6 do Altair): true se o IP pode registrar agora. Diferente do
    // redeem (que conta FALHAS), aqui conta TODA tentativa — todo Register cunha
    // credencial TURN, então a própria frequência é o abuso. Ao atingir o teto na
    // janela, arma o backoff escalante (reusa `duracao_backoff`). Servidor puro,
    // independente da janela de atualização do cliente.
    pub async fn allow_register(&self, ip: IpAddr) -> bool {
        let now = Instant::now();
        let mut all = self.inner.register_attempts.lock().await;
        let estado = all.entry(ip).or_default();
        if let Some(ate) = estado.bloqueado_ate {
            if ate > now {
                return false;
            }
            // backoff expirou: libera (preserva `ciclos` p/ escalar se reincidir).
            estado.bloqueado_ate = None;
        }
        let threshold = now.checked_sub(REGISTER_JANELA).unwrap_or(now);
        while estado.falhas.front().is_some_and(|evento| *evento <= threshold) {
            estado.falhas.pop_front();
        }
        if estado.falhas.len() >= REGISTER_MAX {
            estado.ciclos = estado.ciclos.saturating_add(1);
            estado.bloqueado_ate = Some(now + duracao_backoff(estado.ciclos));
            estado.falhas.clear();
            return false;
        }
        estado.falhas.push_back(now);
        true
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
        let ttl_seconds = self.inner.turn_credential_ttl.as_secs();
        let expires_at = unix_seconds()?.saturating_add(ttl_seconds);
        let ice = montar_ice_server(
            &self.inner.turn_urls,
            &self.inner.turn_secret,
            device_id,
            expires_at,
            ttl_seconds,
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
    /// #1420 — `turn_secret` vazio ou so espaco. Distinto de `InvalidSecret`
    /// porque a acao do operador e outra: aqui falta configurar, nao corrigir.
    #[error("segredo TURN ausente (turn_secret vazio)")]
    SegredoAusente,
}

/// #1295 — falhas da cunhagem do ticket de matrícula (superfície autenticada).
#[derive(Debug, Error)]
pub enum EnrollmentMintError {
    #[error("relogio do servidor invalido")]
    Clock,
    #[error(transparent)]
    Authority(galaxie_remote_net::authority::AuthorityError),
    #[error("falha ao persistir estado unattended")]
    Persistence,
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
    ttl_seconds: u64,
) -> Result<IceServer, TurnCredentialError> {
    // #1420: `Hmac::new_from_slice` aceita chave de QUALQUER tamanho, inclusive
    // vazia — e propriedade do HMAC, nao detalhe do crate. Sem esta guarda, um
    // servidor com `turn_secret` ausente NAO falha: ele devolve uma credencial
    // perfeitamente bem formada, com HMAC de chave vazia, que o coturn (que tem
    // um segredo de verdade do outro lado) vai rejeitar. O sintoma chega ao
    // usuario como "relay nao funciona", tres camadas longe da causa.
    if turn_secret.iter().all(|b| b.is_ascii_whitespace()) {
        return Err(TurnCredentialError::SegredoAusente);
    }
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
        ttl_seconds,
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

        // `expect`/`unwrap` são deny no crate (clippy::expect_used); desembrulha via
        // match com panic explícito (montar_ice_server só erra com secret inválido).
        let ttl = 1800u64;
        let montar = |exp: u64| match montar_ice_server(&urls, secret, dev, exp, ttl) {
            Ok(v) => v,
            Err(e) => panic!("montar_ice_server({exp}): {e:?}"),
        };

        let t1 = 1_000_000u64;
        let t2 = t1 + 1800; // relógio adiantado 30min (um TTL)
        let a = montar(t1);
        let b = montar(t2);

        // #1527: o ttl (DURAÇÃO) viaja no fio — o cliente arma a reemissão por ele,
        // não pelo `expires_at` absoluto (imune ao skew do relógio do servidor).
        assert_eq!(a.ttl_seconds, ttl);
        assert_eq!(b.ttl_seconds, ttl);

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
        let b2 = montar(t2);
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
    async fn register_bloqueia_apos_teto_e_isola_por_ip() {
        // #1049 T2: diferente do redeem, cada `allow_register` JÁ conta como tentativa
        // (todo Register cunha credencial). As primeiras REGISTER_MAX passam; a próxima
        // arma o backoff. Um IP acima do teto não emite mais credencial na janela.
        let estado = estado_de_teste();
        let alvo = IpAddr::V4(Ipv4Addr::new(10, 0, 0, 10));
        for _ in 0..REGISTER_MAX {
            assert!(estado.allow_register(alvo).await);
        }
        assert!(
            !estado.allow_register(alvo).await,
            "IP acima do teto de Register deveria estar em backoff"
        );
        // Outro IP não é afetado (isolamento por-IP) — legítimo não sofre pelo abuso alheio.
        let outro = IpAddr::V4(Ipv4Addr::new(10, 0, 0, 11));
        assert!(estado.allow_register(outro).await);
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

    // ── #1420: `turn_secret` ausente falha ALTO ──────────────────────────────
    //
    // `Hmac::new_from_slice` aceita chave de qualquer tamanho, inclusive vazia —
    // é propriedade do HMAC, não detalhe do crate. Sem guarda, um servidor com
    // `turn_secret` ausente devolvia uma credencial perfeitamente bem formada
    // (HMAC de chave vazia) que o coturn rejeita do outro lado. O sintoma chega
    // ao usuário como "o relay não funciona", três camadas longe da causa.
    //
    // Achado medindo o #1133, ao descobrir que o ramo de erro que eu tinha
    // acabado de escrever era inalcançável — pelo motivo errado.
    //
    // Nota: este crate NEGA `unwrap`/`expect` (lint do #1057), então os testes
    // abaixo usam `match`/`let else` com panic explícito.

    fn estado_com_segredo(segredo: &[u8]) -> AppState {
        AppState::new(
            SigningKey::from_bytes(&[7_u8; 32]),
            segredo.to_vec(),
            vec!["turn:localhost:3478".to_owned()],
            Duration::from_secs(60),
            Duration::from_secs(600),
            Duration::from_secs(600),
            120,
            Duration::from_secs(60),
        )
    }

    #[test]
    fn turn_secret_vazio_recusa_em_vez_de_entregar_credencial_que_o_coturn_rejeita() {
        for (rotulo, segredo) in [
            ("vazio", b"".as_slice()),
            ("so espaco", b"   ".as_slice()),
            ("so quebra de linha", b"\n".as_slice()),
            ("espaco e tab", b" \t ".as_slice()),
        ] {
            match estado_com_segredo(segredo).ice_servers("device-1") {
                Err(TurnCredentialError::SegredoAusente) => {}
                Err(outro) => panic!(
                    "com turn_secret {rotulo} o erro tem de dizer AUSENTE — a acao do operador e configurar, nao corrigir: {outro:?}"
                ),
                Ok(ice) => panic!(
                    "com turn_secret {rotulo} o servidor ENTREGOU credencial ({n} servidor(es)): ela passa no cliente e morre no coturn",
                    n = ice.len()
                ),
            }
        }
    }

    /// Par positivo: segredo de verdade continua produzindo credencial. Sem isto,
    /// recusar tudo passaria no teste acima e derrubaria o relay inteiro.
    #[test]
    fn turn_secret_valido_continua_entregando_credencial() {
        let ice = match estado_com_segredo(b"turn-secret-de-teste").ice_servers("device-1") {
            Ok(ice) => ice,
            Err(erro) => panic!("segredo valido tem de produzir credencial: {erro}"),
        };
        let Some(primeiro) = ice.first() else {
            panic!("esperava ao menos um servidor TURN, veio lista vazia")
        };
        assert!(!primeiro.credential.is_empty());
        assert!(
            primeiro.username.ends_with(":device-1"),
            "username no formato use-auth-secret: {}",
            primeiro.username
        );
    }

    /// A mensagem é o contrato com quem vai diagnosticar às 3h da manhã: "ausente"
    /// e "relógio inválido" mandam a pessoa para lados opostos da infra.
    #[test]
    fn a_mensagem_de_erro_distingue_ausente_de_relogio() {
        let ausente = TurnCredentialError::SegredoAusente.to_string();
        assert!(
            ausente.contains("ausente") && ausente.contains("turn_secret"),
            "a mensagem tem de NOMEAR o que falta: {ausente:?}"
        );
        assert!(
            !ausente.contains("relogio"),
            "segredo ausente nao pode ser reportado como problema de relogio — era exatamente o que o `Err(_)` do v1 fazia: {ausente:?}"
        );
    }

}
