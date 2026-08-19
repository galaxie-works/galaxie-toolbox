#![deny(unsafe_code)]
#![deny(clippy::unwrap_used, clippy::expect_used)]

/// #1301: captura/asserção de eventos `tracing` em teste. Só em `cfg(test)` —
/// o subscriber de produção nunca disputa o global default com ele.
#[cfg(test)]
mod teste_tracing;
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
    let state = AppState::new_with_opaque_snapshot(
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
    .context("estado unattended v2 invalido")?;
    // #1049 passo 2: liga o enforce a partir da config de SERVIDOR. Logado no
    // boot de propósito — quem opera tem de ver em qual estado o servidor subiu,
    // sem adivinhar pelo comportamento.
    state.set_require_device_pop(config.require_device_pop);
    if config.require_device_pop {
        tracing::warn!("#1049 enforce de PoP LIGADO: Register sem prova de posse sera recusado");
    } else {
        tracing::info!("#1049 enforce de PoP desligado: Register sem PoP e aceito e contado");
    }
    Ok(state)
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
                                    client_ip,
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
    client_ip: std::net::IpAddr,
    outbound: &mpsc::Sender<ServerMessage>,
    registered_device_id: &mut Option<String>,
) {
    match message {
        ClientMessage::Register {
            device_id,
            public_key,
            nonce,
            timestamp,
            signature,
        } => {
            // #1049 T2 (adendo §6 do Altair): limitador DEDICADO do Register — cada
            // Register cunha credencial TURN de 30min, então a FREQUÊNCIA é o abuso.
            // Antes o Register dividia o balde genérico (`allow_message`, 120/60s); um
            // host emitia 120 credenciais/min. Agora um IP acima do teto é recusado
            // ANTES de atestar/cunhar/inserir. Reduz a exposição do T2 (o fecho é o
            // OPAQUE do v2, #1132); servidor puro, não espera a janela do cliente.
            if !state.allow_register(client_ip).await {
                send_error(
                    outbound,
                    ErrorCode::RateLimited,
                    "muitos registros deste IP; tente novamente em instantes",
                )
                .await;
                return;
            }
            if !valid_device_id(&device_id) {
                send_error(outbound, ErrorCode::InvalidDeviceId, "device_id invalido").await;
                return;
            }
            // O `public_key` vira [u8;32] logo abaixo (sombreamento); o
            // verificador da PoP quer o base64 original — guardo antes.
            let public_key_base64 = public_key.clone();
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
            // #1049 passo 2 — PROVA DE POSSE da chave.
            //
            // O buraco: `Register` aceitava qualquer (device_id, public_key) sem
            // provar posse do segredo, entao um atacante registrava o device_id
            // de outro com a PROPRIA chave e sequestrava o pareamento.
            //
            // Reusa o MESMO verificador do v2 (`v2.rs` device.register) —
            // `galaxie_remote_net::identity::verify_registration`, que ja checa
            // janela de clock e assinatura Ed25519 sobre (device_id, nonce, ts).
            // Escrever um segundo verificador aqui seria a forma mais fácil de
            // divergir do que o cliente assina em `remote_identity.rs`.
            //
            // Enforce atras de flag de SERVIDOR (default off): com a flag
            // desligada o Register sem PoP segue aceito e apenas CONTADO; com
            // ela ligada, recusado. A janela de virada e decisao do PO.
            let pop_valida = match (&nonce, timestamp, &signature) {
                (Some(nonce), Some(timestamp), Some(signature)) => match unix_seconds() {
                    Ok(agora) => galaxie_remote_net::identity::verify_registration(
                        &public_key_base64,
                        &device_id,
                        nonce,
                        timestamp,
                        agora,
                        signature,
                    )
                    .is_ok(),
                    Err(_) => false,
                },
                _ => false,
            };
            let exigir = state.require_device_pop();
            if let Ok(agora) = unix_seconds() {
                if let Some(dia_fechado) = state
                    .contar_register_pop(pop_valida, exigir && !pop_valida, agora)
                    .await
                {
                    // Resumo do dia FECHADO: e este numero que responde "quantos
                    // clientes velhos ainda existem?" antes de ligar o enforce.
                    tracing::info!(
                        dia_utc = dia_fechado.dia_utc,
                        com_pop = dia_fechado.com_pop,
                        sem_pop = dia_fechado.sem_pop,
                        recusados = dia_fechado.recusados,
                        "#1049 register_pop: resumo do dia"
                    );
                }
            }
            if exigir && !pop_valida {
                tracing::warn!(
                    device_id = %device_id,
                    "#1049 register recusado: PoP ausente ou invalida (enforce LIGADO)"
                );
                send_error(
                    outbound,
                    ErrorCode::InvalidPublicKey,
                    "registro exige prova de posse da chave do device",
                )
                .await;
                return;
            }

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
            // SEC13: se o IP está em backoff por falhas repetidas, recusa antes de
            // sequer consultar o código. Devolve o MESMO erro genérico do caso Invalid
            // para não revelar ao atacante que ele foi bloqueado.
            if !state.allow_redeem(client_ip).await {
                warn!(%client_ip, "redeem bloqueado por backoff");
                send_error(
                    outbound,
                    ErrorCode::InvalidCode,
                    "codigo invalido ou ja utilizado",
                )
                .await;
                return;
            }
            match state.redeem_code(&code).await {
                RedeemResult::Invalid => {
                    state.register_redeem_failure(client_ip).await;
                    warn!(%client_ip, "redeem invalido");
                    send_error(
                        outbound,
                        ErrorCode::InvalidCode,
                        "codigo invalido ou ja utilizado",
                    )
                    .await;
                }
                RedeemResult::Expired => {
                    state.register_redeem_failure(client_ip).await;
                    warn!(%client_ip, "redeem expirado");
                    send_error(outbound, ErrorCode::CodeExpired, "codigo expirado").await;
                }
                RedeemResult::Ready {
                    creator_device_id, ..
                } => {
                    // Código válido: zera o histórico de falhas do IP (não era scanning).
                    state.clear_redeem_failures(client_ip).await;
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
        ClientMessage::RenewIceServers => {
            // #1148: reemite credencial TURN fresca pro device JÁ registrado nesta
            // conexão — sem refazer pareamento. O cliente chama antes do TTL vencer
            // pra a sessão relayed não cair.
            let Some(device_id) = require_registration(registered_device_id, outbound).await else {
                return;
            };
            match state.ice_servers(device_id) {
                Ok(ice_servers) => {
                    let _ = outbound
                        .send(ServerMessage::IceServersRenewed { ice_servers })
                        .await;
                }
                Err(_) => {
                    send_error(
                        outbound,
                        ErrorCode::Internal,
                        "falha ao renovar credencial TURN",
                    )
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

    // ── #1049 passo 2: enforce da PoP no Register ─────────────────────────────
    //
    // O `altair` foi explícito: testar os DOIS estados, não só o caminho novo.
    // A flag existe justamente para NÃO derrubar cliente velho — um teste que só
    // provasse "flag ligada recusa" deixaria passar o defeito que machuca de
    // verdade: o enforce vazar pro default e derrubar quem ainda não atualizou.

    use galaxie_remote_net::identity::DeviceIdentity;

    fn estado_pop() -> AppState {
        AppState::new(
            ed25519_dalek::SigningKey::from_bytes(&[9_u8; 32]),
            b"turn-secret-de-teste".to_vec(),
            vec!["turn:localhost:3478".to_owned()],
            std::time::Duration::from_secs(60),
            std::time::Duration::from_secs(600),
            std::time::Duration::from_secs(600),
            1000,
            std::time::Duration::from_secs(60),
        )
    }

    /// Register com PoP VÁLIDA, assinada como o cliente Tauri assina
    /// (`remote_identity::sign_registration` → `(device_id, nonce, timestamp)`).
    fn register_com_pop(device_id: &str) -> ClientMessage {
        let identidade = DeviceIdentity::generate();
        let nonce = "nonce-de-teste-1049";
        let timestamp = unix_seconds().unwrap_or(0);
        let signature = identidade.sign_registration(device_id, nonce, timestamp);
        ClientMessage::Register {
            device_id: device_id.to_owned(),
            public_key: identidade.public_key_base64(),
            nonce: Some(nonce.to_owned()),
            timestamp: Some(timestamp),
            signature: Some(signature),
        }
    }

    fn register_sem_pop(device_id: &str) -> ClientMessage {
        let identidade = DeviceIdentity::generate();
        ClientMessage::Register {
            device_id: device_id.to_owned(),
            public_key: identidade.public_key_base64(),
            nonce: None,
            timestamp: None,
            signature: None,
        }
    }

    async fn processar(state: &AppState, msg: ClientMessage) -> Vec<ServerMessage> {
        let (tx, mut rx) = mpsc::channel(8);
        let mut registrado = None;
        process_message(
            msg,
            state,
            Uuid::new_v4(),
            std::net::IpAddr::V4(std::net::Ipv4Addr::new(203, 0, 113, 9)),
            &tx,
            &mut registrado,
        )
        .await;
        // NAO usar `rx.recv().await` ate fechar: `AppState::register` guarda um
        // CLONE deste `Sender` no mapa de devices, entao o canal nunca fecha e o
        // recv pendura para sempre. (Foi o que travou minha primeira rodada.)
        // `process_message` envia tudo antes de retornar — drenar sem esperar e
        // suficiente e nao pode pendurar.
        drop(tx);
        let mut saida = Vec::new();
        while let Ok(m) = rx.try_recv() {
            saida.push(m);
        }
        saida
    }

    fn tem_registered(saida: &[ServerMessage]) -> bool {
        saida
            .iter()
            .any(|m| matches!(m, ServerMessage::Registered { .. }))
    }

    /// Flag DESLIGADA (default) — cliente velho continua entrando. É este o teste
    /// que protege a migração; se ele quebrar, o enforce vazou pro default.
    #[tokio::test]
    async fn flag_desligada_aceita_register_sem_pop() {
        let state = estado_pop();
        assert!(!state.require_device_pop(), "o default TEM de ser desligado");

        let saida = processar(&state, register_sem_pop("device-sem-pop-01")).await;

        assert!(
            tem_registered(&saida),
            "com a flag desligada, Register sem PoP tem de ser aceito; saida={saida:?}"
        );
    }

    /// Flag LIGADA — o caminho novo: recusa sem PoP, e diz o motivo.
    #[tokio::test]
    async fn flag_ligada_recusa_register_sem_pop() {
        let state = estado_pop();
        state.set_require_device_pop(true);

        let saida = processar(&state, register_sem_pop("device-sem-pop-02")).await;

        assert!(
            !tem_registered(&saida),
            "com a flag ligada, Register sem PoP NAO pode registrar"
        );
        assert!(
            saida
                .iter()
                .any(|m| matches!(m, ServerMessage::Error { .. })),
            "a recusa tem de dizer o motivo ao cliente; saida={saida:?}"
        );
    }

    /// Flag LIGADA + PoP válida — quem já atualizou entra. Sem este teste,
    /// "ligar a flag" poderia significar "derrubar todo mundo" sem ninguém ver.
    #[tokio::test]
    async fn flag_ligada_aceita_register_com_pop_valida() {
        let state = estado_pop();
        state.set_require_device_pop(true);

        let saida = processar(&state, register_com_pop("device-com-pop-01")).await;

        assert!(
            tem_registered(&saida),
            "PoP valida TEM de passar com a flag ligada; saida={saida:?}"
        );
    }

    /// PoP assinada por OUTRA chave não vale — este é literalmente o sequestro
    /// que o card fecha: registrar o device_id alheio com a própria chave.
    #[tokio::test]
    async fn flag_ligada_recusa_pop_de_outra_chave() {
        let state = estado_pop();
        state.set_require_device_pop(true);

        let ClientMessage::Register {
            device_id,
            nonce,
            timestamp,
            signature,
            ..
        } = register_com_pop("device-vitima-01")
        else {
            panic!("register_com_pop deveria devolver Register");
        };
        // mesma PoP, chave pública do ATACANTE.
        let atacante = DeviceIdentity::generate();
        let forjado = ClientMessage::Register {
            device_id,
            public_key: atacante.public_key_base64(),
            nonce,
            timestamp,
            signature,
        };

        let saida = processar(&state, forjado).await;

        assert!(
            !tem_registered(&saida),
            "PoP assinada por outra chave NAO pode registrar — e o sequestro do #1049"
        );
    }

    /// A métrica que torna a flag acionável (requisito 2 do desenho): sem ela
    /// ninguém sabe quantos clientes velhos existem, e ninguém ousa ligar.
    #[tokio::test]
    async fn conta_register_com_e_sem_pop_no_dia() {
        let state = estado_pop();

        processar(&state, register_sem_pop("device-conta-01")).await;
        processar(&state, register_sem_pop("device-conta-02")).await;
        processar(&state, register_com_pop("device-conta-03")).await;

        let c = state.pop_contadores().await;
        assert_eq!(c.sem_pop, 2, "contagem de Register SEM PoP");
        assert_eq!(c.com_pop, 1, "contagem de Register COM PoP");
        assert_eq!(c.recusados, 0, "flag desligada nao recusa ninguem");
    }

    /// O balde vira no dia UTC e devolve o resumo do dia fechado — é o número que
    /// vai pro log e embasa a decisão da janela de enforce.
    #[tokio::test]
    async fn contador_vira_no_dia_utc_e_devolve_o_dia_fechado() {
        let state = estado_pop();
        let dia1 = 20_000_u64 * 86_400 + 10;
        let dia2 = 20_001_u64 * 86_400 + 10;

        assert!(state.contar_register_pop(false, false, dia1).await.is_none());
        assert!(state.contar_register_pop(false, false, dia1).await.is_none());

        let fechado = match state.contar_register_pop(true, false, dia2).await {
            Some(f) => f,
            None => panic!("virar o dia tem de devolver o resumo do dia anterior"),
        };
        assert_eq!(fechado.sem_pop, 2);
        assert_eq!(fechado.dia_utc, 20_000);
        assert_eq!(
            state.pop_contadores().await.com_pop,
            1,
            "dia novo comeca limpo"
        );
    }


    // ── #1301 (dogfood no signaling): a recusa por PoP LOGA ───────────────────
    //
    // O #1049 recusa `Register` sem prova de posse quando o enforce está ligado.
    // Até aqui isso era só comportamento; agora a LINHA DE LOG é afirmada — é
    // por ela que quem opera descobre, no dia da virada, quem está sendo cortado.

    // `#[test]` e nao `#[tokio::test]`: o runtime do tokio::test roda o corpo
    // numa thread dele, e `block_on` dentro dele e erro ("runtime within a
    // runtime"). Mais importante: a captura e THREAD-LOCAL, entao o log tem de
    // sair na MESMA thread onde o escopo foi aberto — o `current_thread`
    // garante isso.
    #[test]
    fn recusa_por_pop_loga_o_device_e_o_motivo() {
        use crate::teste_tracing::{assert_logou, assert_nao_logou, capturar_tracing};

        let state = estado_pop();
        state.set_require_device_pop(true);

        // `capturar_tracing` é síncrono; a recusa acontece dentro do await, então
        // capturamos o bloco inteiro executando-o aqui e guardando a saída.
        let mut saida = Vec::new();
        let logs = capturar_tracing(|| {
            saida = futures_lite_block_on(processar(&state, register_sem_pop("device-log-01")));
        });

        assert!(!tem_registered(&saida), "sem PoP e com enforce, nao registra");
        assert_logou(&logs, tracing::Level::WARN, "register recusado");
        assert_logou(&logs, tracing::Level::WARN, "device-log-01");
        assert_nao_logou(&logs, tracing::Level::ERROR, "panic");
    }

    /// Par negativo: com a flag DESLIGADA (default) ninguem e recusado, entao a
    /// linha de recusa NAO pode aparecer. Sem este, "loga ao recusar" passaria
    /// mesmo se o codigo logasse sempre.
    #[test]
    fn sem_enforce_nao_loga_recusa() {
        use crate::teste_tracing::{assert_nao_logou, capturar_tracing};

        let state = estado_pop();
        let mut saida = Vec::new();
        let logs = capturar_tracing(|| {
            saida = futures_lite_block_on(processar(&state, register_sem_pop("device-log-02")));
        });

        assert!(tem_registered(&saida), "com a flag off o registro passa");
        assert_nao_logou(&logs, tracing::Level::WARN, "register recusado");
    }

    /// Roda um future ate o fim numa thread current-thread, para que o log saia
    /// NA MESMA thread onde `capturar_tracing` abriu o escopo.
    fn futures_lite_block_on<T>(fut: impl std::future::Future<Output = T>) -> T {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime de teste")
            .block_on(fut)
    }

}
