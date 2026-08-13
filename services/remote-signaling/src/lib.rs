#![deny(unsafe_code)]
#![deny(clippy::unwrap_used, clippy::expect_used)]

pub mod config;
pub mod protocol;
pub mod state;
pub mod v2;

use std::net::SocketAddr;

use anyhow::{Context, Result};
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        ConnectInfo, State,
    },
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use ed25519_dalek::SigningKey;
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tracing::{info, warn};
use uuid::Uuid;

use config::AppConfig;
use protocol::{ClientMessage, ErrorCode, ServerMessage, PROTOCOL_VERSION};
use state::{AppState, RedeemResult};

const MAX_FRAME_BYTES: usize = 64 * 1024;
const OUTBOUND_BUFFER: usize = 64;

pub fn state_from_config(config: &AppConfig) -> Result<AppState> {
    let key_bytes = BASE64
        .decode(config.signing_key_base64.as_bytes())
        .context("GALAXIE_REMOTE_SIGNING_KEY precisa ser base64")?;
    let key_array: [u8; 32] = key_bytes.try_into().map_err(|_| {
        anyhow::anyhow!("GALAXIE_REMOTE_SIGNING_KEY precisa decodificar para 32 bytes")
    })?;
    let opaque_bytes = BASE64
        .decode(config.opaque_setup_base64.as_bytes())
        .context("GALAXIE_REMOTE_OPAQUE_SETUP precisa ser base64")?;
    let opaque = galaxie_remote_net::opaque::ServerSecrets::deserialize(&opaque_bytes)
        .context("GALAXIE_REMOTE_OPAQUE_SETUP invalido")?;
    let snapshot = match std::fs::read(&config.unattended_state_file) {
        Ok(snapshot) => Some(snapshot),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error).context("falha ao ler estado unattended v2"),
    };
    AppState::new_with_opaque_snapshot(
        SigningKey::from_bytes(&key_array),
        config.turn_secret.as_bytes().to_vec(),
        config.turn_urls.clone(),
        config.turn_credential_ttl,
        config.code_ttl,
        config.max_code_ttl,
        config.rate_limit_messages,
        config.rate_limit_window,
        opaque,
        snapshot.as_deref(),
        Some(config.unattended_state_file.clone()),
    )
    .context("estado unattended v2 invalido")
}

pub fn app(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/v1/server-key", get(server_key))
        .route("/v1/ws", get(websocket_upgrade))
        .route("/v2/ws", get(v2::websocket_upgrade))
        .with_state(state)
}

async fn healthz() -> &'static str {
    "ok"
}

async fn server_key(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "algorithm": "Ed25519",
        "protocolVersion": PROTOCOL_VERSION,
        "publicKey": state.server_public_key_base64(),
    }))
}

async fn websocket_upgrade(
    ws: WebSocketUpgrade,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    let client_ip = forwarded_client_ip(&headers, peer.ip());
    if !state.allow_message(client_ip).await {
        return (StatusCode::TOO_MANY_REQUESTS, "rate limit exceeded").into_response();
    }
    ws.max_message_size(MAX_FRAME_BYTES)
        .max_frame_size(MAX_FRAME_BYTES)
        .on_upgrade(move |socket| handle_socket(socket, state, peer, client_ip))
}

async fn handle_socket(
    socket: WebSocket,
    state: AppState,
    peer: SocketAddr,
    client_ip: std::net::IpAddr,
) {
    let connection_id = Uuid::new_v4();
    let (mut websocket_tx, mut websocket_rx) = socket.split();
    let (outbound_tx, mut outbound_rx) = mpsc::channel::<ServerMessage>(OUTBOUND_BUFFER);
    let mut registered_device_id: Option<String> = None;

    loop {
        tokio::select! {
            outbound = outbound_rx.recv() => {
                let Some(outbound) = outbound else { break; };
                let encoded = match serde_json::to_string(&outbound) {
                    Ok(encoded) => encoded,
                    Err(error) => {
                        warn!(%error, "falha ao serializar frame de saida");
                        break;
                    }
                };
                if websocket_tx.send(Message::Text(encoded.into())).await.is_err() {
                    break;
                }
            }
            incoming = websocket_rx.next() => {
                let Some(incoming) = incoming else { break; };
                let incoming = match incoming {
                    Ok(incoming) => incoming,
                    Err(error) => {
                        warn!(%error, %peer, "erro de websocket");
                        break;
                    }
                };
                if !state.allow_message(client_ip).await {
                    let _ = outbound_tx.send(ServerMessage::error(
                        ErrorCode::RateLimited,
                        "limite de mensagens excedido",
                    )).await;
                    continue;
                }
                match incoming {
                    Message::Text(text) => {
                        if text.len() > MAX_FRAME_BYTES {
                            let _ = outbound_tx.send(ServerMessage::error(
                                ErrorCode::PayloadTooLarge,
                                "frame excede 64 KiB",
                            )).await;
                            continue;
                        }
                        let parsed = serde_json::from_str::<ClientMessage>(&text);
                        match parsed {
                            Ok(message) => {
                                process_message(
                                    message,
                                    &state,
                                    connection_id,
                                    &outbound_tx,
                                    &mut registered_device_id,
                                ).await;
                            }
                            Err(error) => {
                                let _ = outbound_tx.send(ServerMessage::error(
                                    ErrorCode::InvalidFrame,
                                    format!("frame JSON invalido: {error}"),
                                )).await;
                            }
                        }
                    }
                    Message::Binary(_) => {
                        let _ = outbound_tx.send(ServerMessage::error(
                            ErrorCode::InvalidFrame,
                            "frames binarios nao sao aceitos",
                        )).await;
                    }
                    Message::Close(_) => break,
                    Message::Ping(payload) => {
                        if websocket_tx.send(Message::Pong(payload)).await.is_err() {
                            break;
                        }
                    }
                    Message::Pong(_) => {}
                }
            }
        }
    }

    if let Some(device_id) = registered_device_id {
        state.unregister(&device_id, connection_id).await;
        info!(%device_id, %peer, "dispositivo desconectado");
    }
}

async fn process_message(
    message: ClientMessage,
    state: &AppState,
    connection_id: Uuid,
    outbound: &mpsc::Sender<ServerMessage>,
    registered_device_id: &mut Option<String>,
) {
    match message {
        ClientMessage::Register {
            device_id,
            public_key,
        } => {
            if !valid_device_id(&device_id) {
                send_error(outbound, ErrorCode::InvalidDeviceId, "device_id invalido").await;
                return;
            }
            let public_key = match decode_public_key(&public_key) {
                Some(public_key) => public_key,
                None => {
                    send_error(
                        outbound,
                        ErrorCode::InvalidPublicKey,
                        "public_key precisa ser Ed25519 base64 de 32 bytes",
                    )
                    .await;
                    return;
                }
            };
            let attestation = match state.attest_key(&device_id, public_key) {
                Ok(attestation) => attestation,
                Err(_) => {
                    send_error(
                        outbound,
                        ErrorCode::Internal,
                        "relogio do servidor invalido",
                    )
                    .await;
                    return;
                }
            };
            let ice_servers = match state.ice_servers(&device_id) {
                Ok(ice_servers) => ice_servers,
                Err(_) => {
                    send_error(
                        outbound,
                        ErrorCode::Internal,
                        "relogio do servidor invalido",
                    )
                    .await;
                    return;
                }
            };
            if let Some(previous_device_id) = registered_device_id.replace(device_id.clone()) {
                if previous_device_id != device_id {
                    state.unregister(&previous_device_id, connection_id).await;
                }
            }
            if let Some(previous) = state
                .register(
                    device_id.clone(),
                    public_key,
                    connection_id,
                    outbound.clone(),
                )
                .await
            {
                let _ = previous
                    .send(ServerMessage::error(
                        ErrorCode::DeviceReplaced,
                        "uma nova conexao registrou o mesmo device_id",
                    ))
                    .await;
            }
            let _ = outbound
                .send(ServerMessage::Registered {
                    protocol_version: PROTOCOL_VERSION,
                    device_id,
                    attestation,
                    ice_servers,
                })
                .await;
        }
        ClientMessage::Heartbeat => {
            let Some(device_id) = require_registration(registered_device_id, outbound).await else {
                return;
            };
            state.touch(device_id, connection_id).await;
            match unix_seconds() {
                Ok(unix_seconds) => {
                    let _ = outbound.send(ServerMessage::Pong { unix_seconds }).await;
                }
                Err(_) => {
                    send_error(
                        outbound,
                        ErrorCode::Internal,
                        "relogio do servidor invalido",
                    )
                    .await;
                }
            }
        }
        ClientMessage::Presence { device_id } => {
            if require_registration(registered_device_id, outbound)
                .await
                .is_none()
            {
                return;
            }
            let online = state.is_online(&device_id).await;
            let _ = outbound
                .send(ServerMessage::Presence { device_id, online })
                .await;
        }
        ClientMessage::CreateAssistedSession { ttl_seconds } => {
            let Some(device_id) = require_registration(registered_device_id, outbound).await else {
                return;
            };
            match state.create_code(device_id, ttl_seconds).await {
                Ok((code, expires_at_unix_seconds)) => {
                    let _ = outbound
                        .send(ServerMessage::AssistedSessionCode {
                            code,
                            expires_at_unix_seconds,
                        })
                        .await;
                }
                Err(_) => {
                    send_error(
                        outbound,
                        ErrorCode::Internal,
                        "relogio do servidor invalido",
                    )
                    .await;
                }
            }
        }
        ClientMessage::RedeemAssistedSession { code } => {
            let Some(device_id) = require_registration(registered_device_id, outbound).await else {
                return;
            };
            match state.redeem_code(&code).await {
                RedeemResult::Invalid => {
                    send_error(
                        outbound,
                        ErrorCode::InvalidCode,
                        "codigo invalido ou ja utilizado",
                    )
                    .await;
                }
                RedeemResult::Expired => {
                    send_error(outbound, ErrorCode::CodeExpired, "codigo expirado").await;
                }
                RedeemResult::Ready {
                    creator_device_id, ..
                } => {
                    if creator_device_id == device_id {
                        send_error(
                            outbound,
                            ErrorCode::InvalidCode,
                            "codigo pertence a este dispositivo",
                        )
                        .await;
                        return;
                    }
                    let Some(creator_outbound) = state.outbound_for(&creator_device_id).await
                    else {
                        send_error(
                            outbound,
                            ErrorCode::PeerOffline,
                            "dispositivo solicitante offline",
                        )
                        .await;
                        return;
                    };
                    state.pair(&creator_device_id, device_id).await;
                    let _ = creator_outbound
                        .send(ServerMessage::SessionPaired {
                            peer_id: device_id.to_owned(),
                        })
                        .await;
                    let _ = outbound
                        .send(ServerMessage::SessionPaired {
                            peer_id: creator_device_id,
                        })
                        .await;
                }
            }
        }
        ClientMessage::Signal {
            peer_id,
            kind,
            payload,
        } => {
            let Some(device_id) = require_registration(registered_device_id, outbound).await else {
                return;
            };
            if payload.len() > MAX_FRAME_BYTES / 2 {
                send_error(
                    outbound,
                    ErrorCode::PayloadTooLarge,
                    "payload de signaling excede 32 KiB",
                )
                .await;
                return;
            }
            if !state.is_paired(device_id, &peer_id).await {
                send_error(
                    outbound,
                    ErrorCode::NotPaired,
                    "peer nao esta pareado nesta sessao",
                )
                .await;
                return;
            }
            let Some(peer_outbound) = state.outbound_for(&peer_id).await else {
                send_error(outbound, ErrorCode::PeerOffline, "peer offline").await;
                return;
            };
            let _ = peer_outbound
                .send(ServerMessage::Signal {
                    peer_id: device_id.to_owned(),
                    kind,
                    payload,
                })
                .await;
        }
    }
}

async fn require_registration<'a>(
    registered_device_id: &'a Option<String>,
    outbound: &mpsc::Sender<ServerMessage>,
) -> Option<&'a str> {
    match registered_device_id.as_deref() {
        Some(device_id) => Some(device_id),
        None => {
            send_error(
                outbound,
                ErrorCode::NotRegistered,
                "registre o dispositivo antes desta operacao",
            )
            .await;
            None
        }
    }
}

async fn send_error(
    outbound: &mpsc::Sender<ServerMessage>,
    code: ErrorCode,
    message: impl Into<String>,
) {
    let _ = outbound.send(ServerMessage::error(code, message)).await;
}

fn valid_device_id(value: &str) -> bool {
    (8..=64).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn decode_public_key(value: &str) -> Option<[u8; 32]> {
    let decoded = BASE64.decode(value.as_bytes()).ok()?;
    decoded.try_into().ok()
}

fn forwarded_client_ip(headers: &HeaderMap, direct_ip: std::net::IpAddr) -> std::net::IpAddr {
    if !is_trusted_proxy_address(direct_ip) {
        return direct_ip;
    }
    headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(str::trim)
        .and_then(|value| value.parse().ok())
        .unwrap_or(direct_ip)
}

fn is_trusted_proxy_address(address: std::net::IpAddr) -> bool {
    match address {
        std::net::IpAddr::V4(address) => address.is_private() || address.is_loopback(),
        std::net::IpAddr::V6(address) => address.is_unique_local() || address.is_loopback(),
    }
}

fn unix_seconds() -> Result<u64, std::time::SystemTimeError> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
}

pub async fn serve(config: AppConfig) -> Result<()> {
    let state = state_from_config(&config)?;
    let listener = tokio::net::TcpListener::bind(config.bind)
        .await
        .with_context(|| format!("nao foi possivel escutar em {}", config.bind))?;
    info!(bind = %config.bind, "galaxie remote signaling iniciado");
    axum::serve(
        listener,
        app(state).into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await
    .context("servidor HTTP/WebSocket encerrou com erro")
}

async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(error) = tokio::signal::ctrl_c().await {
            warn!(%error, "falha ao instalar handler Ctrl+C");
        }
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(error) => warn!(%error, "falha ao instalar handler SIGTERM"),
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valida_device_id_sem_caracteres_ambiguos() {
        assert!(valid_device_id("device-01"));
        assert!(valid_device_id("WORKSTATION_123"));
        assert!(!valid_device_id("curto"));
        assert!(!valid_device_id("device com espaco"));
        assert!(!valid_device_id("device/../../etc"));
    }

    #[test]
    fn usa_x_forwarded_for_somente_atras_de_proxy_privado() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-forwarded-for",
            axum::http::HeaderValue::from_static("203.0.113.8, 172.16.0.1"),
        );
        let proxy = std::net::IpAddr::V4(std::net::Ipv4Addr::new(172, 16, 0, 1));
        let client = std::net::IpAddr::V4(std::net::Ipv4Addr::new(203, 0, 113, 8));
        let direct = std::net::IpAddr::V4(std::net::Ipv4Addr::new(198, 51, 100, 4));
        assert_eq!(forwarded_client_ip(&headers, proxy), client);
        assert_eq!(forwarded_client_ip(&headers, direct), direct);
    }
}
