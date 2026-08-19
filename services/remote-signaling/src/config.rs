use std::{env, fs, net::SocketAddr, path::PathBuf, str::FromStr, time::Duration};

use anyhow::{bail, Context, Result};

const DEFAULT_BIND: &str = "0.0.0.0:8787";
const DEFAULT_TURN_URLS: &str = "stun:telemetry.thegalaxie.cloud:3478,turn:telemetry.thegalaxie.cloud:3478?transport=udp,turn:telemetry.thegalaxie.cloud:3478?transport=tcp";

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub bind: SocketAddr,
    pub signing_key_base64: String,
    pub turn_secret: String,
    pub turn_urls: Vec<String>,
    pub code_ttl: Duration,
    pub max_code_ttl: Duration,
    pub turn_credential_ttl: Duration,
    pub rate_limit_messages: usize,
    pub rate_limit_window: Duration,
    pub opaque_setup_base64: String,
    pub unattended_state_file: PathBuf,
    /// #1049 passo 2 — exigir PoP no `Register` do v1.
    ///
    /// Default **false**: ligar é decisão de produto do PO (o dia em que cliente
    /// velho para de conectar), e o desenho do `altair` pede que virar o enforce
    /// **não exija release nova**. Como env var, virar = mudar o compose +
    /// restart do container; sem build, sem esteira.
    pub require_device_pop: bool,
}

impl AppConfig {
    pub fn from_env() -> Result<Self> {
        let bind_raw = env::var("GALAXIE_REMOTE_BIND").unwrap_or_else(|_| DEFAULT_BIND.to_owned());
        let bind = SocketAddr::from_str(&bind_raw)
            .with_context(|| format!("GALAXIE_REMOTE_BIND invalido: {bind_raw}"))?;

        let signing_key_base64 = read_secret(
            "GALAXIE_REMOTE_SIGNING_KEY",
            "GALAXIE_REMOTE_SIGNING_KEY_FILE",
        )?;
        let turn_secret = read_secret(
            "GALAXIE_REMOTE_TURN_SECRET",
            "GALAXIE_REMOTE_TURN_SECRET_FILE",
        )?;
        let opaque_setup_base64 = read_secret(
            "GALAXIE_REMOTE_OPAQUE_SETUP",
            "GALAXIE_REMOTE_OPAQUE_SETUP_FILE",
        )?;

        let turn_urls = env::var("GALAXIE_REMOTE_TURN_URLS")
            .unwrap_or_else(|_| DEFAULT_TURN_URLS.to_owned())
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        if turn_urls.is_empty() {
            bail!("GALAXIE_REMOTE_TURN_URLS precisa conter ao menos uma URL");
        }

        Ok(Self {
            bind,
            signing_key_base64,
            turn_secret,
            turn_urls,
            code_ttl: Duration::from_secs(read_u64("GALAXIE_REMOTE_CODE_TTL_SECONDS", 600)?),
            max_code_ttl: Duration::from_secs(read_u64(
                "GALAXIE_REMOTE_MAX_CODE_TTL_SECONDS",
                900,
            )?),
            // #1050 (SEC10): TTL da credencial TURN reduzido de 3600s → 1800s pra
            // encurtar a janela em que uma credencial capturada é válida (a AC pede
            // "próximo do tempo real de uma sessão", não 1h fixa). Tunável pelo env
            // `GALAXIE_REMOTE_TURN_TTL_SECONDS`.
            //
            // ⚠️ ATENÇÃO (#1148): o cliente NÃO renova a credencial. `ice_servers`
            // chega uma única vez no `Registered` e não há ICE restart em lugar
            // nenhum — verificado no `feat`: zero `restartIce`/`iceRestart` em TS ou
            // Rust, e `conectar()` resolve uma Promise que ninguém repete. Logo uma
            // sessão RELAYED morre ao atingir este TTL, sem recuperação. Baixar este
            // valor ANTECIPA essa morte; não a causa. A correção é a renovação
            // (#1148) — enquanto ela não existir, este número é o teto real de uma
            // sessão via relay.
            turn_credential_ttl: Duration::from_secs(read_u64(
                "GALAXIE_REMOTE_TURN_TTL_SECONDS",
                1800,
            )?),
            rate_limit_messages: read_usize("GALAXIE_REMOTE_RATE_LIMIT_MESSAGES", 120)?,
            rate_limit_window: Duration::from_secs(read_u64(
                "GALAXIE_REMOTE_RATE_LIMIT_WINDOW_SECONDS",
                60,
            )?),
            opaque_setup_base64,
            unattended_state_file: env::var("GALAXIE_REMOTE_UNATTENDED_STATE_FILE")
                .map(PathBuf::from)
                .unwrap_or_else(|_| PathBuf::from("/var/lib/galaxie-remote/unattended-v2.json")),
            // #1049 passo 2: default DESLIGADO. A janela de enforce é decisão do PO.
            require_device_pop: read_bool("GALAXIE_REMOTE_REQUIRE_POP", false)?,
        })
    }
}

fn read_secret(value_name: &str, file_name: &str) -> Result<String> {
    if let Ok(path) = env::var(file_name) {
        let path = PathBuf::from(path);
        let value = fs::read_to_string(&path)
            .with_context(|| format!("nao foi possivel ler o secret file {}", path.display()))?;
        let value = value.trim().to_owned();
        if value.is_empty() {
            bail!("secret file {} esta vazio", path.display());
        }
        return Ok(value);
    }

    let value = env::var(value_name).with_context(|| {
        format!("defina {value_name} ou {file_name}; o servidor falha fechado sem o segredo")
    })?;
    let value = value.trim().to_owned();
    if value.is_empty() {
        bail!("{value_name} nao pode estar vazio");
    }
    Ok(value)
}

/// Flag booleana de servidor. Aceita as grafias que aparecem em compose/env de
/// verdade; **qualquer outra coisa é erro**, nunca "false" silencioso — ligar o
/// enforce por engano derruba cliente, e não ligar por typo dá falsa sensação de
/// proteção. Os dois lados são caros, então o valor inválido para o boot.
fn read_bool(name: &str, default: bool) -> Result<bool> {
    match env::var(name) {
        Err(_) => Ok(default),
        Ok(raw) => match raw.trim().to_ascii_lowercase().as_str() {
            "1" | "true" | "yes" | "on" => Ok(true),
            "0" | "false" | "no" | "off" => Ok(false),
            other => bail!(
                "{name} invalido: {other:?}. Use 1/true/yes/on ou 0/false/no/off"
            ),
        },
    }
}

fn read_u64(name: &str, default: u64) -> Result<u64> {
    match env::var(name) {
        Ok(value) => value
            .parse::<u64>()
            .with_context(|| format!("{name} precisa ser um inteiro positivo")),
        Err(_) => Ok(default),
    }
}

fn read_usize(name: &str, default: usize) -> Result<usize> {
    match env::var(name) {
        Ok(value) => value
            .parse::<usize>()
            .with_context(|| format!("{name} precisa ser um inteiro positivo")),
        Err(_) => Ok(default),
    }
}
