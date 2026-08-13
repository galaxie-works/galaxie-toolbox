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
            turn_credential_ttl: Duration::from_secs(read_u64(
                "GALAXIE_REMOTE_TURN_TTL_SECONDS",
                3600,
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
