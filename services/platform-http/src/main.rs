//! Binário de PRODUÇÃO da borda web (fatia 1 do #1505). Serve o que existe na pre-prod, sem auth —
//! ver [`galaxie_platform_http::servidor`]. Padrão da casa: init de observabilidade + `serve(config)`.

#![forbid(unsafe_code)]

use anyhow::Result;
use galaxie_platform_http::servidor::{serve, Config};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("galaxie_platform_http=info")),
        )
        .with_target(false)
        .compact()
        .init();

    serve(Config::from_env()?).await
}
