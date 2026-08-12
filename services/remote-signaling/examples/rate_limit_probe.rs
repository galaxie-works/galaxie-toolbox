use std::time::Duration;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use ed25519_dalek::SigningKey;
use futures_util::{SinkExt, StreamExt};
use galaxie_remote_signaling::protocol::{ClientMessage, ErrorCode, ServerMessage};
use tokio_tungstenite::{connect_async, tungstenite::Message};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let url = std::env::var("GALAXIE_REMOTE_PROBE_URL")
        .unwrap_or_else(|_| "wss://telemetry.thegalaxie.cloud/remote/v1/ws".to_owned());
    let suffix = uuid::Uuid::new_v4().simple().to_string();
    let (mut socket, _) = connect_async(&url).await?;
    send(
        &mut socket,
        ClientMessage::Register {
            device_id: format!("rate-probe-{}", &suffix[..12]),
            public_key: BASE64.encode(SigningKey::from_bytes(&rand::random()).verifying_key()),
        },
    )
    .await?;
    if !matches!(
        receive(&mut socket).await?,
        ServerMessage::Registered { .. }
    ) {
        return Err("registro do probe de rate-limit falhou".into());
    }

    for sent in 1_u16..=200 {
        send(&mut socket, ClientMessage::Heartbeat).await?;
        match receive(&mut socket).await? {
            ServerMessage::Pong { .. } => {}
            ServerMessage::Error {
                code: ErrorCode::RateLimited,
                ..
            } => {
                println!("rate_limit_ok active=yes messages_before_limit={sent}");
                return Ok(());
            }
            other => return Err(format!("resposta inesperada: {other:?}").into()),
        }
    }
    Err("rate-limit nao disparou em 200 mensagens".into())
}

async fn send<S>(
    socket: &mut tokio_tungstenite::WebSocketStream<S>,
    message: ClientMessage,
) -> Result<(), Box<dyn std::error::Error>>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    socket
        .send(Message::Text(serde_json::to_string(&message)?.into()))
        .await?;
    Ok(())
}

async fn receive<S>(
    socket: &mut tokio_tungstenite::WebSocketStream<S>,
) -> Result<ServerMessage, Box<dyn std::error::Error>>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let frame = tokio::time::timeout(Duration::from_secs(10), socket.next())
        .await?
        .ok_or_else(|| invalid_data("websocket encerrou"))??;
    let Message::Text(text) = frame else {
        return Err(invalid_data("frame nao textual").into());
    };
    Ok(serde_json::from_str(&text)?)
}

fn invalid_data(message: &str) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::InvalidData, message)
}
