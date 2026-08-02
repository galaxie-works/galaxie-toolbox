//! Telemetria — TelemetryPolicy Rust-owned (#388, S2 do épico #380).
//!
//! O React/WebView manda só ENVELOPES tipados por IPC (categoria + evento +
//! atributos enum/bucket). Aqui carimbamos o contexto confiável (versão, canal,
//! OS coarse, session-id efêmero), aplicamos a POLICY (consentimento por
//! categoria + denylist de PII + caps + sampling) e enfileiramos localmente
//! (bounded, cifrada via DPAPI). **NADA vai pra rede antes do opt-in** e do
//! transporte real (chega junto do S1/#387). Default OFF.
//!
//! **Denylist de PII é LEI:** qualquer atributo cuja CHAVE case com a denylist é
//! descartado antes de enfileirar; e o VALOR é estruturalmente restrito a
//! enum/bucket/inteiro/bool (sem texto livre onde PII se esconderia).

use std::collections::{BTreeMap, VecDeque};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rand::Rng;
use serde::{Deserialize, Serialize};

const SCHEMA_VERSION: u32 = 1;
/// Teto da fila local (drop-oldest ao exceder) — evita crescer sem limite antes
/// do transporte drenar (S1).
const FILA_MAX: usize = 500;
/// Caps defensivos por envelope.
const MAX_ATRIBUTOS: usize = 32;
const MAX_CHAVE_LEN: usize = 64;
const MAX_VALOR_LEN: usize = 96;

// --- Categorias / consentimento --------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Categoria {
    Crash,
    Diagnostico,
    Analytics,
}

/// Consentimento por categoria. **Default: tudo OFF.** Precedência
/// admin>tenant>usuário é resolvida no front (S3) antes de chegar aqui.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Consentimento {
    #[serde(default)]
    pub crash: bool,
    #[serde(default)]
    pub diagnostico: bool,
    #[serde(default)]
    pub analytics: bool,
}

impl Consentimento {
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
    "email", "e-mail", "upn", "mail", "nome", "name", "empresa", "company",
    "token", "senha", "password", "secret", "assunto", "subject", "corpo",
    "body", "contato", "contact", "url", "uri", "path", "caminho", "arquivo",
    "file", "telefone", "phone", "cpf", "user", "usuario", "tenant", "account",
    "conta", "ip", "host", "endereco", "address",
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

/// Consent não é segredo (só booleans) → JSON puro (padrão do `estado.rs`).
fn carregar_consent() -> Consentimento {
    caminho_consent()
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
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

// --- Estado gerenciado (Tauri State) ---------------------------------------

struct Interno {
    consent: Consentimento,
    session_id: String,
    fila: VecDeque<EnvelopeCarimbado>,
}

/// Estado gerenciado da telemetria. `Default` restaura consent + fila do disco e
/// gera um session-id novo.
pub struct TelemetryState {
    inner: Mutex<Interno>,
    ctx: Contexto,
}

impl Default for TelemetryState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(Interno {
                consent: carregar_consent(),
                session_id: novo_session_id(),
                fila: carregar_fila(),
            }),
            ctx: Contexto::atual(),
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
}

impl TelemetryState {
    pub fn definir_consent(&self, consent: Consentimento) {
        if let Ok(mut i) = self.inner.lock() {
            i.consent = consent;
            gravar_consent(&consent);
        }
    }

    /// Revoga tudo: consent OFF, apaga a fila (disco incluso) e reinicia o
    /// session-id efêmero.
    pub fn revogar(&self) {
        if let Ok(mut i) = self.inner.lock() {
            i.consent = Consentimento::default();
            i.fila.clear();
            i.session_id = novo_session_id();
            gravar_consent(&i.consent);
            gravar_fila(&i.fila);
        }
    }

    /// Aplica a policy e, se aceito, enfileira. Retorna se foi aceito. Nunca
    /// entra em rede (o transporte real chega com o S1).
    pub fn track(&self, entrada: EnvelopeEntrada) -> bool {
        let Ok(mut i) = self.inner.lock() else {
            return false;
        };
        let mut amostrar = |cat: Categoria| {
            rand::thread_rng().gen::<f64>() < taxa_amostragem(cat)
        };
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
        }
    }
}

// --- Testes -----------------------------------------------------------------

#[cfg(test)]
mod testes {
    use super::*;

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
            atributos: attrs.iter().map(|(k, v)| (k.to_string(), v.clone())).collect(),
        }
    }

    #[test]
    fn sem_consentimento_rejeita() {
        let mut sim = |_: Categoria| true;
        let d = aplicar_policy(
            entrada(Categoria::Analytics, &[]),
            &Consentimento::default(), // tudo OFF
            &ctx(),
            "sess",
            100,
            &mut sim,
        );
        assert!(matches!(d, Decisao::Rejeitado("sem-consentimento")));
    }

    #[test]
    fn denylist_descarta_chaves_de_pii() {
        let consent = Consentimento { analytics: true, ..Default::default() };
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
        assert!(!env.atributos.contains_key("email"), "email é PII, deve sumir");
        assert!(!env.atributos.contains_key("user_id"), "user_id é PII, deve sumir");
        assert_eq!(env.app_version, "9.9.9");
        assert_eq!(env.schema_version, SCHEMA_VERSION);
    }

    #[test]
    fn caps_limitam_chave_e_valor() {
        let consent = Consentimento { diagnostico: true, ..Default::default() };
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
        let Decisao::Aceito(env) = d else { panic!("aceita") };
        assert_eq!(env.atributos.len(), 1);
        assert!(env.atributos.contains_key("ok"));
    }

    #[test]
    fn sampling_injetado_rejeita_quando_falso() {
        let consent = Consentimento { analytics: true, ..Default::default() };
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
}
