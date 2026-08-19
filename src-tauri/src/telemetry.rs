//! Telemetria — TelemetryPolicy Rust-owned (#388, S2 do épico #380).
//!
//! O React/WebView manda só ENVELOPES tipados por IPC (categoria + evento +
//! atributos enum/bucket). Aqui carimbamos o contexto confiável (versão, canal,
//! OS coarse, session-id efêmero), aplicamos a POLICY (consentimento por
//! categoria + denylist de PII + caps + sampling) e enfileiramos localmente
//! (bounded, cifrada via DPAPI). O exporter S1/#387 so inicia com endpoint E
//! credencial injetados; sem os dois, **NADA vai pra rede**. Consentimento e
//! revogacao continuam sendo aplicados antes da fila e do envio.
//!
//! **Denylist de PII é LEI:** qualquer atributo cuja CHAVE case com a denylist é
//! descartado antes de enfileirar; e o VALOR é estruturalmente restrito a
//! enum/bucket/inteiro/bool (sem texto livre onde PII se esconderia).

use std::collections::{BTreeMap, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;
use rand::Rng;
use reqwest::blocking::{Client, RequestBuilder};
use reqwest::header::{HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};

const SCHEMA_VERSION: u32 = 1;
/// Teto da fila local (drop-oldest ao exceder) — evita crescer sem limite antes
/// do transporte drenar (S1).
const FILA_MAX: usize = 500;
/// #1238 — janela de coalescência da persistência da fila. Rajada de N eventos
/// vira UMA escrita por janela, não N. Curta o bastante para que um kill duro
/// perca no máximo esta janela de eventos (a fila é buffer, não banco).
const PERSIST_DEBOUNCE: Duration = Duration::from_millis(750);
/// Caps defensivos por envelope.
const MAX_ATRIBUTOS: usize = 32;
const MAX_CHAVE_LEN: usize = 64;
const MAX_VALOR_LEN: usize = 96;
const EVENTOS_PERMITIDOS: &[&str] = &[
    "app_session_started",
    "module_opened",
    "feature_action_completed",
    "sync_cycle_completed",
    "update_check_completed",
    "app_crashed",
];

// --- Categorias / consentimento --------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Categoria {
    Crash,
    Diagnostico,
    Analytics,
}

/// Consentimento por categoria. **Default: tudo ON** (#388 — diagnóstico
/// anônimo ligado por padrão, opt-OUT por categoria). Precedência
/// admin>tenant>usuário é resolvida no front (S3) antes de chegar aqui.
///
/// O default só vale quando NÃO há consent gravado (1º run / instalação nova):
/// aí `carregar_consent().unwrap_or_default()` cai neste `Default` (tudo ON) e
/// o front mostra o aviso de transparência do 1º run (#389). Quem já gravou uma
/// escolha mantém exatamente o que salvou.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Consentimento {
    #[serde(default = "verdadeiro")]
    pub crash: bool,
    #[serde(default = "verdadeiro")]
    pub diagnostico: bool,
    #[serde(default = "verdadeiro")]
    pub analytics: bool,
}

/// Default de campo do consent quando ausente no JSON: ON (#388). Mantém a
/// coerência com `Default` mesmo em JSON parcial.
fn verdadeiro() -> bool {
    true
}

impl Default for Consentimento {
    fn default() -> Self {
        Self {
            crash: true,
            diagnostico: true,
            analytics: true,
        }
    }
}

impl Consentimento {
    /// Todas as categorias OFF. Distinto do `Default` (tudo ON, #388): é o que
    /// o "Revoke all" (#389) aplica e a base explícita dos testes.
    pub const fn nenhum() -> Self {
        Self {
            crash: false,
            diagnostico: false,
            analytics: false,
        }
    }

    fn permite(&self, categoria: Categoria) -> bool {
        match categoria {
            Categoria::Crash => self.crash,
            Categoria::Diagnostico => self.diagnostico,
            Categoria::Analytics => self.analytics,
        }
    }
}

/// Taxa de amostragem por categoria (0.0–1.0). Crash sempre vai; diagnóstico e
/// analytics amostram pra conter volume.
fn taxa_amostragem(categoria: Categoria) -> f64 {
    match categoria {
        Categoria::Crash => 1.0,
        Categoria::Diagnostico => 0.5,
        Categoria::Analytics => 0.25,
    }
}

// --- Atributos (sem texto livre) -------------------------------------------

/// Valor de atributo: só enum/bucket/inteiro/bool — NUNCA string livre com PII.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", content = "v", rename_all = "snake_case")]
pub enum Valor {
    /// Rótulo de um conjunto fechado (ex.: "navegador", "control-room").
    Enum(String),
    /// Faixa/bucket (ex.: "100-500ms", "10-50").
    Bucket(String),
    Int(i64),
    Bool(bool),
}

impl Valor {
    fn texto_len(&self) -> usize {
        match self {
            Valor::Enum(s) | Valor::Bucket(s) => s.len(),
            _ => 0,
        }
    }
}

// --- Denylist de PII (LEI) --------------------------------------------------

/// Substrings PROIBIDAS em chaves de atributo (case-insensitive). Denylist
/// absoluta e propositalmente agressiva (falha a favor da privacidade): e-mail/
/// UPN/nome/empresa, tokens/segredos, mailbox, assunto/corpo, contatos, URL/
/// paths/arquivos, telefone, ids de usuário/tenant/conta, IP/host/endereço.
const DENYLIST: &[&str] = &[
    "email", "e-mail", "upn", "mail", "nome", "name", "empresa", "company", "token", "senha",
    "password", "secret", "assunto", "subject", "corpo", "body", "contato", "contact", "url",
    "uri", "path", "caminho", "arquivo", "file", "telefone", "phone", "cpf", "user", "usuario",
    "tenant", "account", "conta", "ip", "host", "endereco", "address",
];

/// `true` se a chave casa com a denylist (deve ser descartada).
fn chave_proibida(chave: &str) -> bool {
    let baixa = chave.to_lowercase();
    DENYLIST.iter().any(|proibida| baixa.contains(proibida))
}

// --- Envelopes --------------------------------------------------------------

/// Envelope como o front manda (IPC). O contexto confiável é carimbado aqui, não
/// pelo front (que não pode forjar versão/OS nem vazar PII pelo contexto).
#[derive(Clone, Debug, Deserialize)]
pub struct EnvelopeEntrada {
    pub categoria: Categoria,
    pub evento: String,
    #[serde(default)]
    pub atributos: BTreeMap<String, Valor>,
}

/// Envelope carimbado e higienizado — o que entra na fila / vai pro transporte.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct EnvelopeCarimbado {
    pub schema_version: u32,
    pub app_version: String,
    pub build_channel: String,
    pub os: String,
    pub arch: String,
    pub session_id: String,
    pub ts_unix: u64,
    pub categoria: Categoria,
    pub evento: String,
    pub atributos: BTreeMap<String, Valor>,
}

/// Contexto confiável carimbado em todo envelope.
#[derive(Clone, Debug)]
pub struct Contexto {
    pub app_version: String,
    pub build_channel: String,
    pub os: String,
    pub arch: String,
}

impl Contexto {
    fn atual() -> Self {
        Self {
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            build_channel: if cfg!(debug_assertions) {
                "dev".to_string()
            } else {
                "stable".to_string()
            },
            os: std::env::consts::OS.to_string(),
            arch: std::env::consts::ARCH.to_string(),
        }
    }
}

// --- Policy (núcleo puro, testável) ----------------------------------------

/// Resultado de aplicar a policy a um envelope de entrada.
#[derive(Debug)]
pub enum Decisao {
    Aceito(Box<EnvelopeCarimbado>),
    /// Motivo estável (telemetria interna/log), nunca contém dado do envelope.
    Rejeitado(&'static str),
}

/// Aplica consentimento → scrub (denylist + caps) → sampling → carimbo.
/// `amostrar` é injetável pra testar sampling de forma determinística
/// (retorna `true` = mantém).
fn aplicar_policy(
    entrada: EnvelopeEntrada,
    consent: &Consentimento,
    ctx: &Contexto,
    session_id: &str,
    ts_unix: u64,
    amostrar: &mut dyn FnMut(Categoria) -> bool,
) -> Decisao {
    // 1) Consentimento por categoria — sem opt-in, nada passa.
    if !consent.permite(entrada.categoria) {
        return Decisao::Rejeitado("sem-consentimento");
    }
    if !EVENTOS_PERMITIDOS.contains(&entrada.evento.as_str()) {
        return Decisao::Rejeitado("evento-nao-permitido");
    }
    // 2) Scrub: descarta chaves proibidas e aplica caps defensivos.
    let mut limpos: BTreeMap<String, Valor> = BTreeMap::new();
    for (chave, valor) in entrada.atributos.into_iter() {
        if limpos.len() >= MAX_ATRIBUTOS {
            break;
        }
        if chave.is_empty() || chave.len() > MAX_CHAVE_LEN {
            continue;
        }
        if chave_proibida(&chave) {
            continue;
        }
        if valor.texto_len() > MAX_VALOR_LEN {
            continue;
        }
        limpos.insert(chave, valor);
    }
    // 3) Sampling por categoria.
    if !amostrar(entrada.categoria) {
        return Decisao::Rejeitado("amostragem");
    }
    Decisao::Aceito(Box::new(EnvelopeCarimbado {
        schema_version: SCHEMA_VERSION,
        app_version: ctx.app_version.clone(),
        build_channel: ctx.build_channel.clone(),
        os: ctx.os.clone(),
        arch: ctx.arch.clone(),
        session_id: session_id.to_string(),
        ts_unix,
        categoria: entrada.categoria,
        evento: entrada.evento,
        atributos: limpos,
    }))
}

/// Empurra na fila com teto (drop-oldest). Puro/testável.
fn empurrar_bounded(fila: &mut VecDeque<EnvelopeCarimbado>, env: EnvelopeCarimbado, max: usize) {
    fila.push_back(env);
    while fila.len() > max {
        fila.pop_front();
    }
}

// --- Utilidades -------------------------------------------------------------

fn agora_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Session-id efêmero (só existe na memória do processo; a fila persistida pode
/// conter ids de sessões anteriores, mas o id vivo reinicia a cada processo e
/// a cada revogação).
fn novo_session_id() -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let mut rng = rand::thread_rng();
    (0..24)
        .map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char)
        .collect()
}

// --- Persistência (best-effort) --------------------------------------------

fn dir_base() -> Option<PathBuf> {
    let base = std::env::var("LOCALAPPDATA").ok()?;
    let dir = std::path::Path::new(&base).join("GALAXIE");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn caminho_consent() -> Option<PathBuf> {
    dir_base().map(|d| d.join("telemetria-consent.json"))
}

fn caminho_fila() -> Option<PathBuf> {
    dir_base().map(|d| d.join("telemetria-fila.bin"))
}

fn caminho_crashes() -> Option<PathBuf> {
    dir_base().map(|d| d.join("telemetria-crashes.log"))
}

/// Consent não é segredo (só booleans) → JSON puro (padrão do `estado.rs`).
fn carregar_consent() -> Consentimento {
    caminho_consent()
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

/// Existe consent gravado? Distingue "1º run / instalação nova" (default ON,
/// #388) de "usuário já escolheu". O front usa isto pro aviso de transparência
/// do 1º run (#389) — mostrado até o usuário interagir/confirmar.
fn consent_existe() -> bool {
    caminho_consent().is_some_and(|p| p.exists())
}

fn gravar_consent(c: &Consentimento) {
    if let (Some(p), Ok(txt)) = (caminho_consent(), serde_json::to_vec_pretty(c)) {
        if let Err(e) = std::fs::write(&p, txt) {
            log::error!("[telemetry] falha ao gravar consent: {e}");
        }
    }
}

/// A fila pode conter dados de evento → cifrada com DPAPI (mesmo mecanismo do
/// refresh token em `auth.rs`).
fn carregar_fila() -> VecDeque<EnvelopeCarimbado> {
    let Some(p) = caminho_fila() else {
        return VecDeque::new();
    };
    let Ok(cifrado) = std::fs::read(&p) else {
        return VecDeque::new();
    };
    crate::dpapi::decifrar(&cifrado)
        .and_then(|claro| serde_json::from_slice::<Vec<EnvelopeCarimbado>>(&claro).ok())
        .map(VecDeque::from)
        .unwrap_or_default()
}

/// #1238 — instrumentação de TESTE da persistência. Os ACs falam em "quantas
/// escritas" e "o lock está livre durante a escrita", não no conteúdo do
/// arquivo; então em teste a escrita é contada e sondada, não executada.
#[cfg(test)]
static ESCRITAS_FILA: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
/// Fila cujo Mutex deve estar LIVRE no instante da escrita (AC2).
#[cfg(test)]
static SONDA_INNER: Mutex<Option<Arc<Mutex<Interno>>>> = Mutex::new(None);
#[cfg(test)]
static SONDA_LIVRE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// Serializa os testes que leem os contadores globais acima.
#[cfg(test)]
static TESTE_PERSIST: Mutex<()> = Mutex::new(());

#[cfg(test)]
fn gravar_fila(itens: &[EnvelopeCarimbado]) {
    use std::sync::atomic::Ordering;
    let _ = itens;
    ESCRITAS_FILA.fetch_add(1, Ordering::Relaxed);
    // AC2 verificado no instante exato da "escrita": se alguém tivesse chegado
    // aqui segurando o guard, este `try_lock` falharia.
    let sonda = SONDA_INNER.lock().ok().and_then(|s| s.clone());
    if let Some(inner) = sonda {
        SONDA_LIVRE.store(inner.try_lock().is_ok(), Ordering::Relaxed);
    }
}

/// #1238 — recebe um SNAPSHOT já clonado, nunca a fila viva emprestada de um
/// `MutexGuard`. É o funil: quem quiser gravar tem de ter soltado o lock antes,
/// porque não existe mais assinatura que aceite `&i.fila`.
#[cfg(not(test))]
fn gravar_fila(itens: &[EnvelopeCarimbado]) {
    let Some(p) = caminho_fila() else { return };
    if itens.is_empty() {
        let _ = std::fs::remove_file(&p);
        return;
    }
    match serde_json::to_vec(&itens) {
        Ok(claro) => match crate::dpapi::cifrar(&claro) {
            Some(cifrado) => {
                if let Err(e) = std::fs::write(&p, &cifrado) {
                    log::error!("[telemetry] falha ao gravar fila: {e}");
                }
            }
            None => log::error!("[telemetry] DPAPI falhou ao cifrar a fila"),
        },
        Err(e) => log::error!("[telemetry] falha ao serializar a fila: {e}"),
    }
}

/// #1238 (AC2) — FUNIL da persistência da fila. Recebe o `Arc`, nunca um guard:
/// o lock é tomado, o snapshot clonado e o guard MORRE no fim do bloco; só então
/// serde + DPAPI + `fs::write` acontecem. Nenhum chamador consegue segurar o
/// Mutex através da escrita porque nenhum chamador tem o guard na mão.
fn snapshot_e_gravar(inner: &Arc<Mutex<Interno>>) {
    let snapshot: Vec<EnvelopeCarimbado> = {
        let Ok(i) = inner.lock() else {
            log::error!("[telemetry] mutex envenenado: fila NÃO persistida (#1238)");
            return;
        };
        i.fila.iter().cloned().collect()
    };
    gravar_fila(&snapshot);
}

// --- Transporte OTLP/HTTP (#387, S1) --------------------------------------

/// Configuracao injetavel do exporter. Endpoint e credenciais nao possuem
/// default de producao: sem configuracao explicita, nenhuma rede e iniciada.
#[derive(Clone, Debug)]
pub struct TransporteConfig {
    /// URL completa do endpoint OTLP/HTTP Logs (normalmente `/v1/logs`).
    pub endpoint: String,
    pub timeout: Duration,
    pub batch_max: usize,
    pub poll_interval: Duration,
    pub backoff_inicial: Duration,
    pub backoff_maximo: Duration,
}

impl TransporteConfig {
    pub fn nova(endpoint: impl Into<String>) -> Self {
        Self {
            endpoint: endpoint.into(),
            timeout: Duration::from_secs(10),
            batch_max: 50,
            poll_interval: Duration::from_secs(15),
            backoff_inicial: Duration::from_secs(2),
            backoff_maximo: Duration::from_secs(5 * 60),
        }
    }

    fn validar(&self) -> Result<(), TransporteErro> {
        let url = reqwest::Url::parse(&self.endpoint)
            .map_err(|_| TransporteErro::Configuracao("endpoint-invalido"))?;
        if self.batch_max == 0 {
            return Err(TransporteErro::Configuracao("batch-vazio"));
        }
        if self.backoff_inicial.is_zero() || self.backoff_maximo < self.backoff_inicial {
            return Err(TransporteErro::Configuracao("backoff-invalido"));
        }
        // Em release, telemetria nunca sai por HTTP claro. Loopback fica
        // disponivel somente em debug para os mocks/testes locais.
        let loopback_debug = cfg!(debug_assertions)
            && url.scheme() == "http"
            && url.host_str().is_some_and(|host| {
                host.eq_ignore_ascii_case("localhost") || host == "127.0.0.1" || host == "::1"
            });
        if url.scheme() != "https" && !loopback_debug {
            return Err(TransporteErro::Configuracao("https-obrigatorio"));
        }
        Ok(())
    }
}

/// Autenticacao separada do exporter: o fluxo definitivo do installation-token
/// pode ser conectado depois sem embutir segredo ou alterar o dreno da fila.
pub trait AuthProvider: Send + Sync + 'static {
    fn aplicar(&self, request: RequestBuilder) -> Result<RequestBuilder, TransporteErro>;
}

/// Autenticacao exigida pelo OTLP/HTTP do OpenObserve self-hosted. O token de
/// ingestao e combinado ao identificador do emissor apenas em memoria e o
/// header resultante e marcado como sensivel para nunca entrar em logs.
pub struct OpenObserveAuthProvider {
    authorization: HeaderValue,
    stream: HeaderValue,
}

impl OpenObserveAuthProvider {
    pub fn novo(email: &str, token: &str, stream: &str) -> Result<Self, TransporteErro> {
        let email = email.trim();
        let token = token.trim();
        let stream = stream.trim();
        if email.is_empty() || email.contains(':') {
            return Err(TransporteErro::Configuracao("email-invalido"));
        }
        if token.is_empty() {
            return Err(TransporteErro::Configuracao("token-vazio"));
        }
        if stream.is_empty() {
            return Err(TransporteErro::Configuracao("stream-vazio"));
        }

        let credencial =
            base64::engine::general_purpose::STANDARD.encode(format!("{email}:{token}"));
        let mut authorization = HeaderValue::from_str(&format!("Basic {credencial}"))
            .map_err(|_| TransporteErro::Configuracao("token-invalido"))?;
        authorization.set_sensitive(true);
        let stream = HeaderValue::from_str(stream)
            .map_err(|_| TransporteErro::Configuracao("stream-invalido"))?;

        Ok(Self {
            authorization,
            stream,
        })
    }
}

impl AuthProvider for OpenObserveAuthProvider {
    fn aplicar(&self, request: RequestBuilder) -> Result<RequestBuilder, TransporteErro> {
        Ok(request
            .header(AUTHORIZATION, self.authorization.clone())
            .header("stream-name", self.stream.clone()))
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum TransporteErro {
    Configuracao(&'static str),
    Http(u16),
    Rede,
}

/// Contrato pequeno para testar o dreno sem rede e trocar o AuthProvider sem
/// acoplar a fila ao reqwest.
pub trait Exporter: Send + Sync + 'static {
    fn exportar(&self, batch: &[EnvelopeCarimbado]) -> Result<(), TransporteErro>;
}

pub struct OtlpHttpExporter<A: AuthProvider> {
    config: TransporteConfig,
    client: Client,
    auth: A,
}

impl<A: AuthProvider> OtlpHttpExporter<A> {
    pub fn novo(config: TransporteConfig, auth: A) -> Result<Self, TransporteErro> {
        config.validar()?;
        let client = Client::builder()
            .timeout(config.timeout)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| TransporteErro::Configuracao("cliente-http"))?;
        Ok(Self {
            config,
            client,
            auth,
        })
    }
}

impl<A: AuthProvider> Exporter for OtlpHttpExporter<A> {
    fn exportar(&self, batch: &[EnvelopeCarimbado]) -> Result<(), TransporteErro> {
        if batch.is_empty() {
            return Ok(());
        }
        let payload = payload_otlp_logs(batch);
        let request = self
            .client
            .post(&self.config.endpoint)
            .header(CONTENT_TYPE, "application/json")
            .json(&payload);
        let response = self
            .auth
            .aplicar(request)?
            .send()
            .map_err(|_| TransporteErro::Rede)?;
        let status = response.status();
        if status.is_success() {
            Ok(())
        } else {
            Err(TransporteErro::Http(status.as_u16()))
        }
    }
}

fn valor_otlp(valor: &Valor) -> serde_json::Value {
    match valor {
        Valor::Enum(v) | Valor::Bucket(v) => serde_json::json!({ "stringValue": v }),
        // OTLP/JSON representa int64 como string para nao perder precisao.
        Valor::Int(v) => serde_json::json!({ "intValue": v.to_string() }),
        Valor::Bool(v) => serde_json::json!({ "boolValue": v }),
    }
}

fn atributo_otlp(chave: &str, valor: serde_json::Value) -> serde_json::Value {
    serde_json::json!({ "key": chave, "value": valor })
}

/// OTLP/HTTP JSON Logs. Os atributos livres ja passaram pela policy; contexto
/// confiavel e taxonomia sao adicionados aqui com chaves fixas.
fn payload_otlp_logs(batch: &[EnvelopeCarimbado]) -> serde_json::Value {
    let registros: Vec<serde_json::Value> = batch
        .iter()
        .map(|env| {
            let mut atributos = vec![
                atributo_otlp(
                    "telemetry.schema_version",
                    serde_json::json!({ "intValue": env.schema_version.to_string() }),
                ),
                atributo_otlp(
                    "app.version",
                    serde_json::json!({ "stringValue": env.app_version }),
                ),
                atributo_otlp(
                    "build.channel",
                    serde_json::json!({ "stringValue": env.build_channel }),
                ),
                atributo_otlp("os.type", serde_json::json!({ "stringValue": env.os })),
                atributo_otlp("host.arch", serde_json::json!({ "stringValue": env.arch })),
                atributo_otlp(
                    "session.id",
                    serde_json::json!({ "stringValue": env.session_id }),
                ),
                atributo_otlp(
                    "telemetry.category",
                    serde_json::json!({
                        "stringValue": match env.categoria {
                            Categoria::Crash => "crash",
                            Categoria::Diagnostico => "diagnostico",
                            Categoria::Analytics => "analytics",
                        }
                    }),
                ),
            ];
            atributos.extend(
                env.atributos
                    .iter()
                    .map(|(chave, valor)| atributo_otlp(chave, valor_otlp(valor))),
            );
            let (severity_number, severity_text) = if env.categoria == Categoria::Crash {
                (17, "ERROR")
            } else {
                (9, "INFO")
            };
            serde_json::json!({
                "timeUnixNano": (env.ts_unix as u128 * 1_000_000_000u128).to_string(),
                "observedTimeUnixNano": (agora_unix() as u128 * 1_000_000_000u128).to_string(),
                "severityNumber": severity_number,
                "severityText": severity_text,
                "body": { "stringValue": env.evento },
                "attributes": atributos,
            })
        })
        .collect();

    serde_json::json!({
        "resourceLogs": [{
            "resource": {
                "attributes": [
                    atributo_otlp("service.name", serde_json::json!({ "stringValue": "galaxie-toolbox" }))
                ]
            },
            "scopeLogs": [{
                "scope": { "name": "galaxie.telemetry", "version": "1" },
                "logRecords": registros
            }]
        }]
    })
}

#[derive(Debug, PartialEq, Eq)]
enum ResultadoDreno {
    Vazio,
    Enviado(usize),
}

/// Clona o lote sob lock, envia fora do lock e remove somente o prefixo que
/// ainda corresponde ao lote confirmado. Falha mantem a fila intacta.
fn drenar_uma_vez(
    inner: &Arc<Mutex<Interno>>,
    exporter: &dyn Exporter,
    batch_max: usize,
) -> Result<ResultadoDreno, TransporteErro> {
    let batch: Vec<EnvelopeCarimbado> = {
        let i = inner.lock().map_err(|_| TransporteErro::Rede)?;
        i.fila.iter().take(batch_max).cloned().collect()
    };
    if batch.is_empty() {
        return Ok(ResultadoDreno::Vazio);
    }
    exporter.exportar(&batch)?;
    let mut removidos = 0;
    // #1238 (AC2): o guard vive só neste bloco; a escrita acontece depois dele.
    let snapshot: Option<Vec<EnvelopeCarimbado>> = match inner.lock() {
        Ok(mut i) => {
            for esperado in &batch {
                if i.fila.front() != Some(esperado) {
                    break;
                }
                i.fila.pop_front();
                removidos += 1;
            }
            (removidos > 0).then(|| i.fila.iter().cloned().collect())
        }
        Err(_) => None,
    };
    if let Some(snap) = snapshot {
        persistir_fila_drenada(&snap);
    }
    Ok(ResultadoDreno::Enviado(removidos))
}

fn persistir_fila_drenada(itens: &[EnvelopeCarimbado]) {
    #[cfg(not(test))]
    gravar_fila(itens);
    #[cfg(test)]
    let _ = itens;
}

fn backoff_exponencial(config: &TransporteConfig, tentativa: u32, jitter: f64) -> Duration {
    let fator = 2u32.saturating_pow(tentativa.min(20));
    let bruto = config.backoff_inicial.saturating_mul(fator);
    let limitado = bruto.min(config.backoff_maximo);
    let jitter = jitter.clamp(0.5, 1.0);
    Duration::from_secs_f64(limitado.as_secs_f64() * jitter)
}

// --- Crash: panic hook + drenagem no boot (#391, S5) -----------------------

/// Instala um panic hook que, além do comportamento anterior (log), grava um
/// breadcrumb best-effort num arquivo append-only. Fazer IO/lock pesado DENTRO
/// do unwind é arriscado (deadlock/corrupção); então o hook só anexa a
/// LOCALIZAÇÃO (caminho de código, não PII) e o boot seguinte drena isso pra
/// fila via policy — fora do unwind. Chamado uma vez no setup.
pub fn registrar_panic_hook() {
    let anterior = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if let Some(p) = caminho_crashes() {
            let local = info
                .location()
                .map(|l| format!("{}:{}", l.file(), l.line()))
                .unwrap_or_else(|| "?".to_string());
            let linha = format!("{}|rust_panic|{}\n", agora_unix(), local);
            if let Ok(mut f) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&p)
            {
                use std::io::Write;
                let _ = f.write_all(linha.as_bytes());
            }
        }
        anterior(info);
    }));
}

/// Drena os breadcrumbs de crash de runs anteriores → envelopes de crash na
/// fila (via policy: só entra se houver consent de crash). Depois apaga o
/// arquivo (mesmo sem consent — não guarda crash pendente sem opt-in).
fn drenar_crashes_pendentes(
    fila: &mut VecDeque<EnvelopeCarimbado>,
    consent: &Consentimento,
    ctx: &Contexto,
    session_id: &str,
) {
    let Some(p) = caminho_crashes() else { return };
    let Ok(conteudo) = std::fs::read_to_string(&p) else {
        return;
    };
    let mut algum = false;
    let mut sempre = |_: Categoria| true; // crash tem taxa 1.0
    for linha in conteudo.lines() {
        if linha.trim().is_empty() {
            continue;
        }
        // formato: ts|origem|local — só a origem (enum) vai; local é code path.
        let origem = linha.split('|').nth(1).unwrap_or("rust_panic").to_string();
        let mut atributos = BTreeMap::new();
        atributos.insert("origem".to_string(), Valor::Enum(origem));
        let entrada = EnvelopeEntrada {
            categoria: Categoria::Crash,
            evento: "app_crashed".to_string(),
            atributos,
        };
        if let Decisao::Aceito(env) =
            aplicar_policy(entrada, consent, ctx, session_id, agora_unix(), &mut sempre)
        {
            empurrar_bounded(fila, *env, FILA_MAX);
            algum = true;
        }
    }
    let _ = std::fs::remove_file(&p);
    if algum {
        let snapshot: Vec<EnvelopeCarimbado> = fila.iter().cloned().collect();
        gravar_fila(&snapshot);
    }
}

// --- Estado gerenciado (Tauri State) ---------------------------------------

/// #1238 (AC3) — coalescência da persistência. `track` só marca sujo e toca o
/// sino; quem grava é o worker, uma vez por janela de debounce. Rajada de N
/// eventos = 1 escrita, não N.
///
/// Sem `iniciar()` explícito nenhuma thread existe (mesmo contrato do
/// transporte, §S1): em teste o worker não sobe e a persistência é exercitada
/// chamando o funil direto.
struct Persistidor {
    sujo: Mutex<bool>,
    sino: Condvar,
}

/// O que o worker deve fazer ao acordar. Explícito de propósito (ver
/// `esperar_sujo`).
#[derive(Debug, PartialEq, Eq)]
enum Espera {
    /// Há mudança pendente: persistir.
    Grave,
    /// Estado irrecuperável (mutex envenenado): o worker morre — ruidosamente.
    Encerrar,
}

impl Persistidor {
    fn novo() -> Self {
        Self {
            sujo: Mutex::new(false),
            sino: Condvar::new(),
        }
    }

    /// Marca que a fila mudou e acorda o worker. Custo: um lock de `bool` —
    /// nenhum IO, nenhuma serialização, nada de disco na thread do IPC.
    fn marcar_sujo(&self) {
        if let Ok(mut sujo) = self.sujo.lock() {
            *sujo = true;
            self.sino.notify_one();
        }
    }

    /// Espera ficar sujo e dorme a janela de debounce (para engolir a rajada).
    ///
    /// Devolve enum, não `bool`: `false` significava ao mesmo tempo "nada a
    /// fazer" e "morri" — ambiguidade que faz erro virar sucesso falso.
    fn esperar_sujo(&self, debounce: Duration) -> Espera {
        let Ok(mut sujo) = self.sujo.lock() else {
            return Espera::Encerrar;
        };
        while !*sujo {
            let Ok((novo, _)) = self.sino.wait_timeout(sujo, Duration::from_secs(60)) else {
                return Espera::Encerrar;
            };
            sujo = novo;
        }
        *sujo = false;
        drop(sujo);
        std::thread::sleep(debounce);
        Espera::Grave
    }
}

/// Sobe o worker de persistência. Uma thread por `TelemetryState` vivo (na
/// prática, uma por processo — o estado é gerenciado pelo Tauri).
/// Devolve `false` se o worker NÃO subiu. Quem chama tem de decidir o que fazer
/// — engolir aqui deixaria a telemetria marcando sujo para sempre sem nunca
/// gravar, que é o pior dos mundos: parece que funciona.
#[must_use]
fn iniciar_persistidor(
    inner: Arc<Mutex<Interno>>,
    persist: Arc<Persistidor>,
    debounce: Duration,
) -> bool {
    let r = std::thread::Builder::new()
        .name("telemetry-persist".to_string())
        .spawn(move || loop {
            match persist.esperar_sujo(debounce) {
                Espera::Grave => snapshot_e_gravar(&inner),
                Espera::Encerrar => {
                    // Mutex envenenado: a fila em memória não é mais confiável e
                    // este worker morre. Grita — senão a persistência morre em
                    // silêncio e o resto da sessão só ACHA que está gravando.
                    log::error!(
                        "[telemetry] worker de persistência encerrando: mutex envenenado.                          A fila NÃO será mais gravada nesta sessão."
                    );
                    return;
                }
            }
        });
    match r {
        Ok(_) => true,
        Err(e) => {
            log::error!(
                "[telemetry] worker de persistência NÃO subiu ({e}). A fila fica só em                  memória: eventos serão perdidos ao fechar. (#1238)"
            );
            false
        }
    }
}

struct Interno {
    consent: Consentimento,
    session_id: String,
    fila: VecDeque<EnvelopeCarimbado>,
    transporte_iniciado: bool,
}

/// Estado gerenciado da telemetria. `Default` restaura consent + fila do disco e
/// gera um session-id novo.
pub struct TelemetryState {
    inner: Arc<Mutex<Interno>>,
    ctx: Contexto,
    persist: Arc<Persistidor>,
}

/// Clone barato (dois `Arc` + contexto). Necessário para os comandos levarem o
/// estado para dentro de `spawn_blocking` — `State<'_, _>` não é `'static`.
impl Clone for TelemetryState {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
            ctx: self.ctx.clone(),
            persist: Arc::clone(&self.persist),
        }
    }
}

impl Default for TelemetryState {
    fn default() -> Self {
        let consent = carregar_consent();
        let ctx = Contexto::atual();
        let session_id = novo_session_id();
        let mut fila = carregar_fila();
        // #391: crashes registrados pelo panic hook em runs anteriores viram
        // envelopes agora (fora do unwind), respeitando o consent.
        drenar_crashes_pendentes(&mut fila, &consent, &ctx, &session_id);
        let inner = Arc::new(Mutex::new(Interno {
            consent,
            session_id,
            fila,
            transporte_iniciado: false,
        }));
        let persist = Arc::new(Persistidor::novo());
        // #1238: a partir daqui NINGUÉM grava a fila na thread do IPC — desde
        // que o worker exista. Se não subir, o log acima é o aviso; o flush do
        // `RunEvent::Exit` ainda salva o caminho de saída limpa.
        let _ = iniciar_persistidor(Arc::clone(&inner), Arc::clone(&persist), PERSIST_DEBOUNCE);
        Self {
            inner,
            ctx,
            persist,
        }
    }
}

#[cfg(test)]
impl TelemetryState {
    /// Estado de teste: não lê disco e NÃO sobe o worker de persistência — a
    /// coalescência é exercitada chamando o funil na mão.
    fn para_teste() -> Self {
        Self {
            inner: Arc::new(Mutex::new(Interno {
                consent: Consentimento::default(),
                session_id: "sess".into(),
                fila: VecDeque::new(),
                transporte_iniciado: false,
            })),
            ctx: Contexto::atual(),
            persist: Arc::new(Persistidor::novo()),
        }
    }
}

/// Status pro front (Settings/S3).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusDto {
    pub consent: Consentimento,
    pub session_id: String,
    pub queued: usize,
    /// #389: há consent gravado? `false` = 1º run (default ON) → front mostra o
    /// aviso de transparência até o usuário confirmar/interagir.
    pub configurado: bool,
}

impl TelemetryState {
    /// #1238: muta sob lock, grava DEPOIS de soltá-lo. A escrita é síncrona de
    /// propósito (ao contrário de `track`): é escolha do usuário, é rara, e o
    /// consent tem de estar no disco quando o comando volta. O que a corrige é
    /// o `spawn_blocking` no comando — sai da thread do IPC, não vira fogo-e-
    /// esquece.
    pub fn definir_consent(&self, consent: Consentimento) {
        let snapshot: Option<Vec<EnvelopeCarimbado>> = match self.inner.lock() {
            Ok(mut i) => {
                i.consent = consent;
                // Opt-out por categoria tambem vale para itens ainda nao enviados.
                // Nao deixa um envelope antigo atravessar a rede depois da escolha.
                i.fila.retain(|env| consent.permite(env.categoria));
                Some(i.fila.iter().cloned().collect())
            }
            Err(_) => None,
        };
        let Some(snap) = snapshot else { return };
        gravar_consent(&consent);
        gravar_fila(&snap);
    }

    /// Revoga tudo: consent OFF, apaga a fila (disco incluso) e reinicia o
    /// session-id efêmero.
    pub fn revogar(&self) {
        // #1238: apagar tem de ACONTECER (é revogação), então continua síncrono
        // — mas fora do lock e, pelo comando, fora da thread do IPC.
        let consent = {
            let Ok(mut i) = self.inner.lock() else { return };
            i.consent = Consentimento::nenhum();
            i.fila.clear();
            i.session_id = novo_session_id();
            i.consent
        };
        gravar_consent(&consent);
        gravar_fila(&[]);
    }

    /// Aplica a policy e, se aceito, enfileira. Retorna se foi aceito. O worker
    /// S1 drena de forma assincrona somente quando configurado externamente.
    pub fn track(&self, entrada: EnvelopeEntrada) -> bool {
        let Ok(mut i) = self.inner.lock() else {
            return false;
        };
        let mut amostrar = |cat: Categoria| rand::thread_rng().gen::<f64>() < taxa_amostragem(cat);
        let session = i.session_id.clone();
        let decisao = aplicar_policy(
            entrada,
            &i.consent,
            &self.ctx,
            &session,
            agora_unix(),
            &mut amostrar,
        );
        let aceito = match decisao {
            Decisao::Aceito(env) => {
                empurrar_bounded(&mut i.fila, *env, FILA_MAX);
                true
            }
            Decisao::Rejeitado(_motivo) => false,
        };
        // #1238 (AC1/AC3): solta o lock e só marca sujo. Nenhuma serialização,
        // nenhuma cifra, nenhum `fs::write` neste caminho — o worker coalesce.
        drop(i);
        if aceito {
            self.persist.marcar_sujo();
        }
        aceito
    }

    /// Grava a fila AGORA, fora do lock. Para o encerramento do app e para os
    /// testes — o caminho quente (`track`) nunca chama isto.
    pub fn flush_persistencia(&self) {
        snapshot_e_gravar(&self.inner);
    }

    pub fn status(&self) -> StatusDto {
        let i = self.inner.lock().expect("telemetry mutex");
        StatusDto {
            consent: i.consent,
            session_id: i.session_id.clone(),
            queued: i.fila.len(),
            configurado: consent_existe(),
        }
    }

    /// Inspetor DEV (#389): dump dos envelopes já na fila. Todos JÁ passaram pelo
    /// scrub da policy (sem PII, só enum/bucket/int/bool). Retorna vazio em
    /// release — defesa em profundidade além do gate `import.meta.env.DEV` no
    /// front, pra que um build de produção nunca exponha o conteúdo da fila.
    pub fn debug_dump(&self) -> Vec<EnvelopeCarimbado> {
        if !cfg!(debug_assertions) {
            return Vec::new();
        }
        self.inner
            .lock()
            .map(|i| i.fila.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// Inicia o worker de transporte com dependencias injetadas. Sem chamada
    /// explicita, nenhum thread nem acesso de rede existe. O worker nunca segura
    /// o mutex durante HTTP, drena em lotes e preserva a fila em qualquer erro.
    pub fn iniciar_transporte<E: Exporter>(
        &self,
        exporter: E,
        config: TransporteConfig,
    ) -> Result<(), TransporteErro> {
        config.validar()?;
        {
            let mut i = self.inner.lock().map_err(|_| TransporteErro::Rede)?;
            if i.transporte_iniciado {
                return Err(TransporteErro::Configuracao("worker-ja-iniciado"));
            }
            i.transporte_iniciado = true;
        }
        let inner = Arc::clone(&self.inner);
        let inner_worker = Arc::clone(&self.inner);
        let spawn = std::thread::Builder::new()
            .name("galaxie-telemetry".into())
            .spawn(move || {
                let mut tentativa = 0u32;
                loop {
                    match drenar_uma_vez(&inner_worker, &exporter, config.batch_max) {
                        Ok(ResultadoDreno::Enviado(_)) => {
                            tentativa = 0;
                            // Ha possivelmente mais lotes: continua sem esperar.
                        }
                        Ok(ResultadoDreno::Vazio) => {
                            tentativa = 0;
                            std::thread::sleep(config.poll_interval);
                        }
                        Err(_) => {
                            let jitter = rand::thread_rng().gen_range(0.5..=1.0);
                            let espera = backoff_exponencial(&config, tentativa, jitter);
                            tentativa = tentativa.saturating_add(1);
                            std::thread::sleep(espera);
                        }
                    }
                }
            });
        match spawn {
            Ok(_) => Ok(()),
            Err(_) => {
                if let Ok(mut i) = inner.lock() {
                    i.transporte_iniciado = false;
                }
                Err(TransporteErro::Configuracao("worker-thread"))
            }
        }
    }

    /// Config sem valores hardcoded. #387 follow-up: runtime env tem
    /// precedência (dev / CI / live-test do #428); senão cai no valor **embutido
    /// em compile-time** via `option_env!` — é assim que o binário shipado
    /// recebe endpoint/credencial (o `release.yml` injeta os secrets no build).
    /// Ausente nos dois → None → transporte desativado (fail-closed). Qualquer
    /// configuracao parcial falha fechado antes de iniciar a rede.
    ///
    /// #1055 (SEC9): o `GALAXIE_TELEMETRY_INGEST_TOKEN` embutido é
    /// **público-na-prática** — `option_env!` não ofusca; o valor sai extraível de
    /// todo binário distribuído. Por isso ele DEVE ser um token **write-only /
    /// ingest-only** do OpenObserve (escopo do stream de telemetria), NUNCA
    /// admin/read: extrair o token só permite *escrever* no stream (poluir), jamais
    /// ler dado de terceiro. Rotação por-release + revogação do antigo é ação do PO
    /// (tem as chaves) — runbook em `docs/reference/rotacao-segredos.md`. O trait
    /// `AuthProvider` acima é o seam pra plugar o installation-token (curta duração,
    /// emitido por endpoint) e ELIMINAR o embutido, sem mexer no dreno da fila.
    pub fn iniciar_transporte_configurado(&self) -> Result<bool, TransporteErro> {
        // Runtime > compile-time; string vazia conta como ausente.
        fn config_var(runtime: &str, baked: Option<&'static str>) -> Option<String> {
            std::env::var(runtime)
                .ok()
                .filter(|valor| !valor.is_empty())
                .or_else(|| baked.map(str::to_owned))
                .filter(|valor| !valor.is_empty())
        }
        let endpoint = config_var(
            "GALAXIE_TELEMETRY_OTLP_ENDPOINT",
            option_env!("GALAXIE_TELEMETRY_OTLP_ENDPOINT"),
        );
        let email = config_var(
            "GALAXIE_TELEMETRY_INGEST_EMAIL",
            option_env!("GALAXIE_TELEMETRY_INGEST_EMAIL"),
        );
        let token = config_var(
            "GALAXIE_TELEMETRY_INGEST_TOKEN",
            option_env!("GALAXIE_TELEMETRY_INGEST_TOKEN"),
        );
        let stream = config_var(
            "GALAXIE_TELEMETRY_STREAM_NAME",
            option_env!("GALAXIE_TELEMETRY_STREAM_NAME"),
        );
        match (endpoint, email, token, stream) {
            (None, None, None, None) => Ok(false),
            (Some(endpoint), Some(email), Some(token), Some(stream)) => {
                let config = TransporteConfig::nova(endpoint);
                let auth = OpenObserveAuthProvider::novo(&email, &token, &stream)?;
                let exporter = OtlpHttpExporter::novo(config.clone(), auth)?;
                self.iniciar_transporte(exporter, config)?;
                Ok(true)
            }
            _ => Err(TransporteErro::Configuracao("config-incompleta")),
        }
    }
}

// --- Testes -----------------------------------------------------------------

#[cfg(test)]
mod testes {
    use super::*;

    struct ExporterFake {
        falha: bool,
        batches: Arc<Mutex<Vec<Vec<EnvelopeCarimbado>>>>,
    }

    impl Exporter for ExporterFake {
        fn exportar(&self, batch: &[EnvelopeCarimbado]) -> Result<(), TransporteErro> {
            self.batches.lock().unwrap().push(batch.to_vec());
            if self.falha {
                Err(TransporteErro::Rede)
            } else {
                Ok(())
            }
        }
    }

    fn ctx() -> Contexto {
        Contexto {
            app_version: "9.9.9".into(),
            build_channel: "test".into(),
            os: "windows".into(),
            arch: "x86_64".into(),
        }
    }

    fn entrada(cat: Categoria, attrs: &[(&str, Valor)]) -> EnvelopeEntrada {
        EnvelopeEntrada {
            categoria: cat,
            evento: "module_opened".into(),
            atributos: attrs
                .iter()
                .map(|(k, v)| (k.to_string(), v.clone()))
                .collect(),
        }
    }

    fn envelope(ts: u64, categoria: Categoria) -> EnvelopeCarimbado {
        EnvelopeCarimbado {
            schema_version: SCHEMA_VERSION,
            app_version: "9.9.9".into(),
            build_channel: "test".into(),
            os: "windows".into(),
            arch: "x86_64".into(),
            session_id: "sess".into(),
            ts_unix: ts,
            categoria,
            evento: if categoria == Categoria::Crash {
                "app_crashed".into()
            } else {
                "module_opened".into()
            },
            atributos: BTreeMap::new(),
        }
    }

    fn interno_com(envelopes: Vec<EnvelopeCarimbado>) -> Arc<Mutex<Interno>> {
        Arc::new(Mutex::new(Interno {
            consent: Consentimento::default(),
            session_id: "sess".into(),
            fila: VecDeque::from(envelopes),
            transporte_iniciado: false,
        }))
    }

    #[test]
    fn sem_consentimento_rejeita() {
        let mut sim = |_: Categoria| true;
        let d = aplicar_policy(
            entrada(Categoria::Analytics, &[]),
            &Consentimento::nenhum(),
            &ctx(),
            "sess",
            100,
            &mut sim,
        );
        assert!(matches!(d, Decisao::Rejeitado("sem-consentimento")));
    }

    #[test]
    fn evento_fora_da_taxonomia_e_rejeitado_antes_da_fila() {
        let mut entrada = entrada(Categoria::Analytics, &[]);
        entrada.evento = "texto-livre-potencialmente-pii".into();
        let mut sim = |_: Categoria| true;
        let d = aplicar_policy(
            entrada,
            &Consentimento::default(),
            &ctx(),
            "sess",
            100,
            &mut sim,
        );
        assert!(matches!(d, Decisao::Rejeitado("evento-nao-permitido")));
    }

    #[test]
    fn denylist_descarta_chaves_de_pii() {
        let consent = Consentimento {
            analytics: true,
            ..Consentimento::nenhum()
        };
        let mut sim = |_: Categoria| true;
        let d = aplicar_policy(
            entrada(
                Categoria::Analytics,
                &[
                    ("modulo", Valor::Enum("navegador".into())),
                    ("email", Valor::Enum("a@b.com".into())), // PII → some
                    ("user_id", Valor::Enum("123".into())),   // PII → some
                    ("duracao", Valor::Bucket("100-500ms".into())),
                ],
            ),
            &consent,
            &ctx(),
            "sess",
            100,
            &mut sim,
        );
        let Decisao::Aceito(env) = d else {
            panic!("deveria aceitar");
        };
        assert!(env.atributos.contains_key("modulo"));
        assert!(env.atributos.contains_key("duracao"));
        assert!(
            !env.atributos.contains_key("email"),
            "email é PII, deve sumir"
        );
        assert!(
            !env.atributos.contains_key("user_id"),
            "user_id é PII, deve sumir"
        );
        assert_eq!(env.app_version, "9.9.9");
        assert_eq!(env.schema_version, SCHEMA_VERSION);
    }

    #[test]
    fn caps_limitam_chave_e_valor() {
        let consent = Consentimento {
            diagnostico: true,
            ..Consentimento::nenhum()
        };
        let mut sim = |_: Categoria| true;
        let chave_gigante = "a".repeat(MAX_CHAVE_LEN + 1);
        let valor_gigante = Valor::Enum("x".repeat(MAX_VALOR_LEN + 1));
        let d = aplicar_policy(
            entrada(
                Categoria::Diagnostico,
                &[
                    (chave_gigante.as_str(), Valor::Int(1)),
                    ("grande", valor_gigante),
                    ("ok", Valor::Int(7)),
                ],
            ),
            &consent,
            &ctx(),
            "sess",
            100,
            &mut sim,
        );
        let Decisao::Aceito(env) = d else {
            panic!("aceita")
        };
        assert_eq!(env.atributos.len(), 1);
        assert!(env.atributos.contains_key("ok"));
    }

    #[test]
    fn sampling_injetado_rejeita_quando_falso() {
        let consent = Consentimento {
            analytics: true,
            ..Consentimento::nenhum()
        };
        let mut nunca = |_: Categoria| false;
        let d = aplicar_policy(
            entrada(Categoria::Analytics, &[]),
            &consent,
            &ctx(),
            "sess",
            100,
            &mut nunca,
        );
        assert!(matches!(d, Decisao::Rejeitado("amostragem")));
    }

    #[test]
    fn fila_respeita_o_teto_drop_oldest() {
        let mut fila: VecDeque<EnvelopeCarimbado> = VecDeque::new();
        let base = EnvelopeCarimbado {
            schema_version: SCHEMA_VERSION,
            app_version: "9.9.9".into(),
            build_channel: "test".into(),
            os: "windows".into(),
            arch: "x86_64".into(),
            session_id: "s".into(),
            ts_unix: 0,
            categoria: Categoria::Analytics,
            evento: "e".into(),
            atributos: BTreeMap::new(),
        };
        for n in 0..(FILA_MAX + 10) {
            let mut e = base.clone();
            e.ts_unix = n as u64;
            empurrar_bounded(&mut fila, e, FILA_MAX);
        }
        assert_eq!(fila.len(), FILA_MAX);
        // O mais antigo (ts 0..9) caiu; o primeiro agora é ts 10.
        assert_eq!(fila.front().unwrap().ts_unix, 10);
        assert_eq!(fila.back().unwrap().ts_unix, (FILA_MAX + 9) as u64);
    }

    #[test]
    fn crash_respeita_consent_e_preserva_origem() {
        let mut sim = |_: Categoria| true;
        let entrada_crash = || EnvelopeEntrada {
            categoria: Categoria::Crash,
            evento: "app_crashed".into(),
            atributos: {
                let mut m = BTreeMap::new();
                m.insert("origem".into(), Valor::Enum("rust_panic".into()));
                m
            },
        };
        // Sem consent de crash → rejeita.
        let d = aplicar_policy(
            entrada_crash(),
            &Consentimento::nenhum(),
            &ctx(),
            "s",
            1,
            &mut sim,
        );
        assert!(matches!(d, Decisao::Rejeitado("sem-consentimento")));
        // Com consent de crash → aceita e preserva a origem.
        let consent = Consentimento {
            crash: true,
            ..Consentimento::nenhum()
        };
        let d = aplicar_policy(entrada_crash(), &consent, &ctx(), "s", 1, &mut sim);
        let Decisao::Aceito(env) = d else {
            panic!("aceita")
        };
        assert_eq!(env.categoria, Categoria::Crash);
        assert_eq!(env.evento, "app_crashed");
        assert_eq!(
            env.atributos.get("origem"),
            Some(&Valor::Enum("rust_panic".into()))
        );
    }

    #[test]
    fn default_consent_liga_tudo_e_nenhum_desliga() {
        // #388: 1º run / instalação nova cai no Default → tudo ON (opt-out).
        let d = Consentimento::default();
        assert!(
            d.crash && d.diagnostico && d.analytics,
            "default deve ser ON"
        );
        // "Revoke all" (#389) aplica `nenhum()` → tudo OFF.
        let n = Consentimento::nenhum();
        assert!(
            !n.crash && !n.diagnostico && !n.analytics,
            "nenhum deve ser OFF"
        );
    }

    #[test]
    fn json_ausente_cai_no_default_on() {
        // Consent gravado parcial/ausente não deve rebaixar pra OFF (#388): os
        // campos ausentes usam `verdadeiro` (ON), coerente com o Default.
        let c: Consentimento = serde_json::from_str("{}").expect("json vazio");
        assert!(c.crash && c.diagnostico && c.analytics);
        let so_analytics: Consentimento =
            serde_json::from_str(r#"{"analytics":false}"#).expect("json parcial");
        assert!(so_analytics.crash && so_analytics.diagnostico);
        assert!(!so_analytics.analytics);
    }

    #[test]
    fn chave_proibida_pega_variacoes() {
        assert!(chave_proibida("email"));
        assert!(chave_proibida("userEmail"));
        assert!(chave_proibida("UPN"));
        assert!(chave_proibida("tenant_id"));
        assert!(chave_proibida("file_path"));
        assert!(!chave_proibida("modulo"));
        assert!(!chave_proibida("duracao_bucket"));
        assert!(!chave_proibida("resultado"));
    }

    #[test]
    fn payload_otlp_logs_mapeia_evento_e_crash_sem_texto_livre_extra() {
        let payload = payload_otlp_logs(&[
            envelope(10, Categoria::Analytics),
            envelope(11, Categoria::Crash),
        ]);
        let registros = payload["resourceLogs"][0]["scopeLogs"][0]["logRecords"]
            .as_array()
            .unwrap();
        assert_eq!(registros.len(), 2);
        assert_eq!(registros[0]["body"]["stringValue"], "module_opened");
        assert_eq!(registros[0]["severityText"], "INFO");
        assert_eq!(registros[1]["body"]["stringValue"], "app_crashed");
        assert_eq!(registros[1]["severityText"], "ERROR");
        assert_eq!(registros[1]["timeUnixNano"], "11000000000");
    }

    #[test]
    fn dreno_mock_remove_somente_lote_confirmado() {
        let inner = interno_com(vec![
            envelope(1, Categoria::Analytics),
            envelope(2, Categoria::Diagnostico),
            envelope(3, Categoria::Crash),
        ]);
        let batches = Arc::new(Mutex::new(Vec::new()));
        let exporter = ExporterFake {
            falha: false,
            batches: Arc::clone(&batches),
        };
        let resultado = drenar_uma_vez(&inner, &exporter, 2).unwrap();
        assert_eq!(resultado, ResultadoDreno::Enviado(2));
        assert_eq!(batches.lock().unwrap()[0].len(), 2);
        let fila = &inner.lock().unwrap().fila;
        assert_eq!(fila.len(), 1);
        assert_eq!(fila.front().unwrap().ts_unix, 3);
    }

    #[test]
    fn falha_do_exporter_preserva_fila_para_retry() {
        let inner = interno_com(vec![envelope(1, Categoria::Analytics)]);
        let exporter = ExporterFake {
            falha: true,
            batches: Arc::new(Mutex::new(Vec::new())),
        };
        assert_eq!(
            drenar_uma_vez(&inner, &exporter, 50),
            Err(TransporteErro::Rede)
        );
        assert_eq!(inner.lock().unwrap().fila.len(), 1);
    }

    #[test]
    fn backoff_exponencial_tem_jitter_e_teto() {
        let mut config = TransporteConfig::nova("http://127.0.0.1:4318/v1/logs");
        config.backoff_inicial = Duration::from_secs(2);
        config.backoff_maximo = Duration::from_secs(30);
        assert_eq!(backoff_exponencial(&config, 0, 1.0), Duration::from_secs(2));
        assert_eq!(backoff_exponencial(&config, 2, 0.5), Duration::from_secs(4));
        assert_eq!(
            backoff_exponencial(&config, 20, 1.0),
            Duration::from_secs(30)
        );
    }

    #[test]
    fn config_recusa_http_nao_loopback_e_credencial_invalida() {
        let config = TransporteConfig::nova("http://example.com/v1/logs");
        assert_eq!(
            config.validar(),
            Err(TransporteErro::Configuracao("https-obrigatorio"))
        );
        assert_eq!(
            OpenObserveAuthProvider::novo("telemetry@galaxie.test", " ", "galaxie_toolbox").err(),
            Some(TransporteErro::Configuracao("token-vazio"))
        );
    }

    #[test]
    fn exporter_otlp_http_envia_json_e_auth_openobserve_ao_mock() {
        let servidor = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}/v1/logs", servidor.server_addr());
        let receptor = std::thread::spawn(move || {
            let mut request = servidor
                .recv_timeout(Duration::from_secs(3))
                .unwrap()
                .expect("request OTLP");
            assert_eq!(request.method(), &tiny_http::Method::Post);
            assert_eq!(request.url(), "/v1/logs");
            let auth = request
                .headers()
                .iter()
                .find(|h| h.field.equiv("Authorization"))
                .map(|h| h.value.as_str());
            let esperado = base64::engine::general_purpose::STANDARD
                .encode("telemetry@galaxie.test:segredo-do-mock");
            let esperado = format!("Basic {esperado}");
            assert_eq!(auth, Some(esperado.as_str()));
            let stream = request
                .headers()
                .iter()
                .find(|h| h.field.equiv("stream-name"))
                .map(|h| h.value.as_str());
            assert_eq!(stream, Some("galaxie_toolbox"));
            let mut body = String::new();
            request.as_reader().read_to_string(&mut body).unwrap();
            let json: serde_json::Value = serde_json::from_str(&body).unwrap();
            assert_eq!(
                json["resourceLogs"][0]["scopeLogs"][0]["logRecords"][0]["body"]["stringValue"],
                "module_opened"
            );
            request.respond(tiny_http::Response::empty(200)).unwrap();
        });

        let config = TransporteConfig::nova(endpoint);
        let auth = OpenObserveAuthProvider::novo(
            "telemetry@galaxie.test",
            "segredo-do-mock",
            "galaxie_toolbox",
        )
        .unwrap();
        let exporter = OtlpHttpExporter::novo(config, auth).unwrap();
        exporter
            .exportar(&[envelope(42, Categoria::Analytics)])
            .unwrap();
        receptor.join().unwrap();
    }

    #[test]
    #[ignore = "requer endpoint e credencial OpenObserve injetados no processo"]
    fn exporter_otlp_http_envia_para_openobserve_real() {
        let endpoint = std::env::var("GALAXIE_TELEMETRY_OTLP_ENDPOINT").unwrap();
        let email = std::env::var("GALAXIE_TELEMETRY_INGEST_EMAIL").unwrap();
        let token = std::env::var("GALAXIE_TELEMETRY_INGEST_TOKEN").unwrap();
        let stream = std::env::var("GALAXIE_TELEMETRY_STREAM_NAME").unwrap();

        let config = TransporteConfig::nova(endpoint);
        let auth = OpenObserveAuthProvider::novo(&email, &token, &stream).unwrap();
        let exporter = OtlpHttpExporter::novo(config, auth).unwrap();
        exporter
            .exportar(&[envelope(agora_unix(), Categoria::Analytics)])
            .unwrap();
    }

    // --- #1238: telemetry_track fora da thread do IPC ----------------------

    /// AC1 — "Dado um evento de telemetria, Quando `telemetry_track` roda,
    /// Então nenhuma escrita em disco acontece na thread do IPC."
    /// AC3 — "Dado N eventos em rajada, Então não há N escrituras completas."
    #[test]
    fn track_nao_persiste_e_rajada_coalesce_em_uma_escrita() {
        use std::sync::atomic::Ordering;
        let _guarda = TESTE_PERSIST.lock().unwrap_or_else(|e| e.into_inner());
        ESCRITAS_FILA.store(0, Ordering::Relaxed);
        *SONDA_INNER.lock().unwrap() = None;

        let estado = TelemetryState::para_teste();
        for _ in 0..50 {
            assert!(estado.track(entrada(Categoria::Crash, &[])));
        }

        // AC1: cinquenta eventos, zero escrita.
        assert_eq!(
            ESCRITAS_FILA.load(Ordering::Relaxed),
            0,
            "track gravou em disco no caminho do IPC"
        );
        assert_eq!(estado.inner.lock().unwrap().fila.len(), 50);
        assert!(
            *estado.persist.sujo.lock().unwrap(),
            "a rajada tem de deixar a fila marcada como suja"
        );

        // AC3: a rajada inteira vira UMA escrita quando o worker acorda.
        estado.flush_persistencia();
        assert_eq!(
            ESCRITAS_FILA.load(Ordering::Relaxed),
            1,
            "50 eventos deveriam coalescer em 1 escrita"
        );
    }

    /// AC2 — "Dado o Mutex da telemetria, Quando a fila é persistida, Então o
    /// lock não é mantido através da escrita." Sondado no instante da escrita.
    #[test]
    fn persistencia_nao_segura_o_mutex_durante_a_escrita() {
        use std::sync::atomic::Ordering;
        let _guarda = TESTE_PERSIST.lock().unwrap_or_else(|e| e.into_inner());
        ESCRITAS_FILA.store(0, Ordering::Relaxed);
        SONDA_LIVRE.store(false, Ordering::Relaxed);

        let estado = TelemetryState::para_teste();
        estado.track(entrada(Categoria::Crash, &[]));
        *SONDA_INNER.lock().unwrap() = Some(Arc::clone(&estado.inner));

        estado.flush_persistencia();

        assert!(
            SONDA_LIVRE.load(Ordering::Relaxed),
            "o Mutex estava OCUPADO durante a escrita — o lock atravessou a persistência"
        );
        *SONDA_INNER.lock().unwrap() = None;
    }

    /// O worker morre RUIDOSO, não em silêncio: mutex envenenado devolve
    /// `Encerrar`, distinto de "nada a fazer". Sem isto, a persistência morre e
    /// o resto da sessão só ACHA que está gravando (família #1057).
    #[test]
    fn mutex_envenenado_encerra_o_worker_em_vez_de_fingir_sucesso() {
        let p = Arc::new(Persistidor::novo());
        let clone = Arc::clone(&p);
        // envenena o mutex do `sujo`
        let _ = std::thread::spawn(move || {
            let _g = clone.sujo.lock().unwrap();
            panic!("envenena");
        })
        .join();
        assert!(p.sujo.is_poisoned());
        assert_eq!(
            p.esperar_sujo(Duration::from_millis(0)),
            Espera::Encerrar,
            "mutex envenenado tem de ENCERRAR o worker, não parecer 'nada a fazer'"
        );
    }

    /// AC3 (o mecanismo): N marcações de sujo colapsam em UM flush pendente.
    #[test]
    fn persistidor_coalesce_marcacoes() {
        let p = Persistidor::novo();
        for _ in 0..100 {
            p.marcar_sujo();
        }
        assert_eq!(p.esperar_sujo(Duration::from_millis(0)), Espera::Grave);
        assert!(
            !*p.sujo.lock().unwrap(),
            "as 100 marcações têm de virar um único flush pendente"
        );
    }

    /// `revogar` apaga de verdade: a escrita continua acontecendo (é revogação),
    /// só que fora do lock — e o comando a tira da thread do IPC.
    #[test]
    fn revogar_persiste_fila_vazia() {
        use std::sync::atomic::Ordering;
        let _guarda = TESTE_PERSIST.lock().unwrap_or_else(|e| e.into_inner());
        ESCRITAS_FILA.store(0, Ordering::Relaxed);
        *SONDA_INNER.lock().unwrap() = None;

        let estado = TelemetryState::para_teste();
        estado.track(entrada(Categoria::Crash, &[]));
        estado.revogar();

        assert!(estado.inner.lock().unwrap().fila.is_empty());
        assert_eq!(
            ESCRITAS_FILA.load(Ordering::Relaxed),
            1,
            "revogar tem de gravar (apagar) a fila"
        );
    }


    // ── #1301 (dogfood): os caminhos de falha do #1296 agora são AFIRMADOS ────
    //
    // O #1296 fechou 3 caminhos de morte silenciosa da persistência. A `lumen`
    // anotou que os ACs se apoiavam em "loga" — e o repo não tinha como afirmar
    // log em teste. Com a infra do #1301, deixam de ser promessa.

    use crate::teste_log::{
        assert_logou, capturar_logs, capturar_logs_globais, esperar_log_global, logou,
    };

    /// #1296 (1/3) — lock envenenado no funil de escrita **loga** em vez de
    /// voltar calado. Captura thread-local: o log acontece nesta thread.
    #[test]
    fn poisoned_no_funil_de_escrita_loga_em_vez_de_sair_calado() {
        let inner = interno_com(vec![]);

        // envenena de verdade (panic segurando o lock), não simula
        let clone = Arc::clone(&inner);
        let _ = std::thread::spawn(move || {
            let _g = clone.lock().unwrap();
            panic!("envenena o mutex da telemetria");
        })
        .join();
        assert!(inner.is_poisoned(), "o mutex precisa estar envenenado");

        let logs = capturar_logs(|| snapshot_e_gravar(&inner));

        assert_logou(&logs, log::Level::Error, "mutex envenenado");
        assert_logou(&logs, log::Level::Error, "#1238");
    }

    /// #1296 (1/3, par negativo) — o caminho FELIZ não pode logar erro. Sem
    /// este, "loga no erro" passaria mesmo se o código logasse sempre.
    #[test]
    fn funil_de_escrita_sadio_nao_loga_erro() {
        let inner = interno_com(vec![]);
        let logs = capturar_logs(|| snapshot_e_gravar(&inner));
        crate::teste_log::assert_nao_logou(&logs, log::Level::Error, "mutex envenenado");
    }

    /// #1296 (2/3) — o worker de persistência morre **RUIDOSO** quando o mutex
    /// do sino é envenenado. Captura GLOBAL: o log sai de uma thread que o
    /// código sob teste spawna, e captura thread-local não a alcança.
    #[test]
    fn worker_encerrando_por_mutex_envenenado_grita() {
        let logs = capturar_logs_globais(|| {
            let inner = interno_com(vec![]);
            let persist = Arc::new(Persistidor::novo());

            let clone = Arc::clone(&persist);
            let _ = std::thread::spawn(move || {
                let _g = clone.sujo.lock().unwrap();
                panic!("envenena o sino do persistidor");
            })
            .join();
            assert!(persist.sujo.is_poisoned());

            let subiu = iniciar_persistidor(inner, persist, Duration::from_millis(0));
            assert!(subiu, "a thread do worker precisa ter subido para o teste valer");

            // espera o worker acordar, ver o veneno e gritar (sem sleep chutado)
            esperar_log_global(
                log::Level::Error,
                "worker de persistência encerrando",
                Duration::from_secs(5),
            );
        });

        assert_logou(&logs, log::Level::Error, "worker de persistência encerrando");
        assert!(
            logou(&logs, log::Level::Error, "NÃO será mais gravada"),
            "a linha tem de dizer a CONSEQUÊNCIA, não só que morreu"
        );
    }

    /// #1296 (3/3) — o contrato de `iniciar_persistidor`: devolve se subiu, e o
    /// caminho de sucesso NÃO grita.
    ///
    /// **Limite honesto:** o ramo de falha (`Err` do `thread::spawn`) só ocorre
    /// com exaustão de recurso do SO e não é forçável de forma portável — não
    /// há teste dele aqui. O que este teste garante é o par: o retorno existe
    /// (`#[must_use]`, então ignorá-lo é warning) e o sucesso é silencioso, de
    /// modo que a linha de erro só pode vir da falha real.
    #[test]
    fn iniciar_persistidor_devolve_se_subiu_e_sucesso_e_silencioso() {
        let logs = capturar_logs_globais(|| {
            let inner = interno_com(vec![]);
            let persist = Arc::new(Persistidor::novo());
            let subiu = iniciar_persistidor(inner, persist, Duration::from_millis(0));
            assert!(subiu, "spawn normal tem de devolver true");
        });

        assert!(
            !logou(&logs, log::Level::Error, "NÃO subiu"),
            "worker que subiu não pode logar que não subiu"
        );
    }

}
