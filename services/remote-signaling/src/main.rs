#![deny(unsafe_code)]
#![deny(clippy::unwrap_used, clippy::expect_used)]

use anyhow::Result;
use galaxie_remote_signaling::{config::AppConfig, serve};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| {
                EnvFilter::new("galaxie_remote_signaling=info,tower_http=info")
            }),
        )
        .with_target(false)
        .compact()
        .init();

    serve(AppConfig::from_env()?).await
}
