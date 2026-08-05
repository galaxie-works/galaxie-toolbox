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
use std::sync::{Arc, Mutex};
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
    let dir = std::path::Path::new(&base).join("GALAXIE Toolbox");
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
    crate::auth::dpapi::decifrar(&cifrado)
        .and_then(|claro| serde_json::from_slice::<Vec<EnvelopeCarimbado>>(&claro).ok())
        .map(VecDeque::from)
        .unwrap_or_default()
}

fn gravar_fila(fila: &VecDeque<EnvelopeCarimbado>) {
    let Some(p) = caminho_fila() else { return };
    if fila.is_empty() {
        let _ = std::fs::remove_file(&p);
        return;
    }
    let itens: Vec<&EnvelopeCarimbado> = fila.iter().collect();
    match serde_json::to_vec(&itens) {
        Ok(claro) => match crate::auth::dpapi::cifrar(&claro) {
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
    if let Ok(mut i) = inner.lock() {
        for esperado in &batch {
            if i.fila.front() != Some(esperado) {
                break;
            }
            i.fila.pop_front();
            removidos += 1;
        }
        if removidos > 0 {
            persistir_fila_drenada(&i.fila);
        }
    }
    Ok(ResultadoDreno::Enviado(removidos))
}

fn persistir_fila_drenada(fila: &VecDeque<EnvelopeCarimbado>) {
    #[cfg(not(test))]
    gravar_fila(fila);
    #[cfg(test)]
    let _ = fila;
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
        gravar_fila(fila);
    }
}

// --- Estado gerenciado (Tauri State) ---------------------------------------

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
        Self {
            inner: Arc::new(Mutex::new(Interno {
                consent,
                session_id,
                fila,
                transporte_iniciado: false,
            })),
            ctx,
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
    pub fn definir_consent(&self, consent: Consentimento) {
        if let Ok(mut i) = self.inner.lock() {
            i.consent = consent;
            // Opt-out por categoria tambem vale para itens ainda nao enviados.
            // Nao deixa um envelope antigo atravessar a rede depois da escolha.
            i.fila.retain(|env| consent.permite(env.categoria));
            gravar_consent(&consent);
            gravar_fila(&i.fila);
        }
    }

    /// Revoga tudo: consent OFF, apaga a fila (disco incluso) e reinicia o
    /// session-id efêmero.
    pub fn revogar(&self) {
        if let Ok(mut i) = self.inner.lock() {
            i.consent = Consentimento::nenhum();
            i.fila.clear();
            i.session_id = novo_session_id();
            gravar_consent(&i.consent);
            gravar_fila(&i.fila);
        }
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
        match decisao {
            Decisao::Aceito(env) => {
                empurrar_bounded(&mut i.fila, *env, FILA_MAX);
                gravar_fila(&i.fila);
                true
            }
            Decisao::Rejeitado(_motivo) => false,
        }
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
}
