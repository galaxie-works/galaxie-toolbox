use std::net::SocketAddr;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        ConnectInfo, State,
    },
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use galaxie_remote_net::{
    authority::ControllerClaims,
    protocol::{
        decode_net_message, AuthBegin, AuthFinish, Capabilities, DeviceEnrollBegin,
        DeviceEnrollFinish, DeviceHeartbeat, DeviceRegister, Envelope, MessageType, SessionDecision,
        SessionRequest, SessionSignal,
    },
    MAX_MESSAGE_BYTES, PROTOCOL_VERSION,
};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::state::AppState;

// #1295: owner/org/capabilities vêm do GRANT do ticket (begin_enrollment), nunca do
// payload. name/public_key são descritivos/keying do device (sem valor de privilégio).
struct PendingEnrollment {
    owner_id: String,
    org_id: String,
    device_id: String,
    name: String,
    public_key: String,
    capabilities: Capabilities,
}

pub async fn websocket_upgrade(
    ws: WebSocketUpgrade,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    State(state): State<AppState>,
    _headers: HeaderMap,
) -> Response {
    if !state.allow_message(peer.ip()).await {
        return (StatusCode::TOO_MANY_REQUESTS, "rate limit exceeded").into_response();
    }
    ws.max_message_size(MAX_MESSAGE_BYTES)
        .max_frame_size(MAX_MESSAGE_BYTES)
        .on_upgrade(move |socket| handle_socket(socket, state, peer))
}

async fn handle_socket(socket: WebSocket, state: AppState, peer: SocketAddr) {
    let connection_id = Uuid::new_v4();
    let (outbound, mut outbound_rx) = mpsc::channel::<String>(32);
    let (mut sender, mut receiver) = socket.split();
    let mut pending_enrollment: Option<PendingEnrollment> = None;
    let mut registered_device: Option<(String, String)> = None;
    loop {
        tokio::select! {
            outbound_message = outbound_rx.recv() => {
                let Some(outbound_message) = outbound_message else { break };
                if sender.send(Message::Text(outbound_message.into())).await.is_err() { break; }
            }
            frame = receiver.next() => {
                let Some(Ok(frame)) = frame else { break };
                if !state.allow_message(peer.ip()).await {
                    let response = error_response("invalid", "rate_limited", "message rate exceeded");
                    if sender.send(Message::Text(response.into())).await.is_err() { break; }
                    continue;
                }
                match frame {
            Message::Text(text) => {
                let response = process(
                    text.as_bytes(),
                    &state,
                    &mut pending_enrollment,
                    &mut registered_device,
                    connection_id,
                    outbound.clone(),
                )
                .await;
                if sender.send(Message::Text(response.into())).await.is_err() {
                    break;
                }
            }
            Message::Ping(payload) => {
                if sender.send(Message::Pong(payload)).await.is_err() {
                    break;
                }
            }
            Message::Close(_) => break,
            Message::Binary(_) | Message::Pong(_) => {
                let response = error_response("invalid", "invalid_frame", "text frames only");
                if sender.send(Message::Text(response.into())).await.is_err() {
                    break;
                }
            }
                }
            }
        }
    }
    if let Some((device_id, _)) = registered_device {
        state
            .unregister_unattended_device(&device_id, connection_id)
            .await;
    }
    state.remove_controller_sessions(connection_id).await;
}

async fn process(
    bytes: &[u8],
    state: &AppState,
    pending_enrollment: &mut Option<PendingEnrollment>,
    registered_device: &mut Option<(String, String)>,
    connection_id: Uuid,
    outbound: mpsc::Sender<String>,
) -> String {
    let envelope = match decode_net_message(bytes) {
        Ok(envelope) if envelope.message_type == MessageType::Request => envelope,
        Ok(envelope) => return error_response(&envelope.id, "invalid_type", "request required"),
        Err(error) => return error_response("invalid", "invalid_frame", &error.to_string()),
    };
    let id = envelope.id.clone();
    let now = match unix_seconds() {
        Ok(now) => now,
        Err(_) => return error_response(&id, "clock", "server clock is invalid"),
    };
    let result = match envelope.method.as_str() {
        "device.enroll.begin" => {
            // #1295: valida o ticket de matrícula; owner/org/capabilities saem do GRANT
            // (ticket assinado), nunca do payload. O ticket é uso único — consumido aqui,
            // por isso persistimos o estado após um Ok (anti-replay sobrevive a restart).
            let body = match payload::<DeviceEnrollBegin>(envelope.payload) {
                Ok(body) => body,
                Err(error) => return error_response(&id, "invalid_payload", &error),
            };
            let grant = state.unattended().await.begin_enrollment(
                &body.device_id,
                &body.enrollment_ticket,
                &body.opaque_request,
                now,
            );
            match grant {
                Ok(grant) => {
                    if state.persist_unattended().await.is_err() {
                        return error_response(&id, "persistence", "state persistence failed");
                    }
                    *pending_enrollment = Some(PendingEnrollment {
                        owner_id: grant.owner_id,
                        org_id: grant.org_id,
                        device_id: body.device_id,
                        name: body.name,
                        public_key: body.public_key,
                        capabilities: grant.capabilities,
                    });
                    Ok(json!({"opaqueResponse": grant.opaque_response}))
                }
                Err(error) => Err(error),
            }
        }
        "device.enroll.finish" => {
            let body = match payload::<DeviceEnrollFinish>(envelope.payload) {
                Ok(body) => body,
                Err(error) => return error_response(&id, "invalid_payload", &error),
            };
            let Some(pending) = pending_enrollment.take() else {
                return error_response(&id, "enrollment_required", "begin enrollment first");
            };
            if pending.device_id != body.device_id {
                return error_response(&id, "binding", "device changed during enrollment");
            }
            // #1295: capabilities e owner/org vêm do pending (derivado do ticket), não do wire.
            let result = state
                .unattended()
                .await
                .finish_enrollment(
                    &pending.owner_id,
                    &pending.org_id,
                    &pending.device_id,
                    &pending.name,
                    &pending.public_key,
                    pending.capabilities,
                    &body.opaque_upload,
                    now,
                )
                .map(|_| json!({"enrolled": true}));
            if result.is_ok() && state.persist_unattended().await.is_err() {
                return error_response(&id, "persistence", "state persistence failed");
            }
            result
        }
        "device.register" => {
            let body = match payload::<DeviceRegister>(envelope.payload) {
                Ok(body) => body,
                Err(error) => return error_response(&id, "invalid_payload", &error),
            };
            let result = state.unattended().await.register_device(
                &body.device_id,
                &body.nonce,
                body.timestamp,
                now,
                &body.signature,
            );
            if result.is_ok() {
                state
                    .register_unattended_device(
                        body.device_id.clone(),
                        body.nonce.clone(),
                        connection_id,
                        outbound.clone(),
                    )
                    .await;
                *registered_device = Some((body.device_id, body.nonce));
            }
            result.map(|_| json!({"registered": true}))
        }
        "device.heartbeat" => {
            let body = match payload::<DeviceHeartbeat>(envelope.payload) {
                Ok(body) => body,
                Err(error) => return error_response(&id, "invalid_payload", &error),
            };
            let current = match registered_device {
                Some((device_id, nonce)) if device_id == &body.device_id => {
                    state
                        .is_current_unattended_device(device_id, nonce, connection_id)
                        .await
                }
                _ => false,
            };
            if !current {
                Err(galaxie_remote_net::authority::AuthorityError::Unauthorized)
            } else {
                Ok(json!({"timestamp": now}))
            }
        }
        "unattended.auth.begin" => {
            let body = match payload::<AuthBegin>(envelope.payload) {
                Ok(body) => body,
                Err(error) => return error_response(&id, "invalid_payload", &error),
            };
            let device = match state.unattended_device(&body.device_id).await {
                Some(device) if device.nonce == body.device_nonce => device,
                _ => return error_response(&id, "offline", "device registration is unavailable"),
            };
            let _ = device;
            state
                .unattended()
                .await
                .begin_authentication(
                    ControllerClaims {
                        controller_id: body.controller_id,
                        owner_id: body.owner_id,
                        org_id: body.org_id,
                    },
                    &body.device_id,
                    &body.device_nonce,
                    &body.controller_nonce,
                    body.requested_capabilities,
                    &body.opaque_request,
                    now,
                )
                .map(|challenge| {
                    json!({
                        "authId": challenge.auth_id,
                        "opaqueResponse": challenge.opaque_response,
                    })
                })
        }
        "unattended.auth.finish" => {
            let body = match payload::<AuthFinish>(envelope.payload) {
                Ok(body) => body,
                Err(error) => return error_response(&id, "invalid_payload", &error),
            };
            state
                .unattended()
                .await
                .finish_authentication(
                    &body.auth_id,
                    &body.opaque_finalization,
                    &body.controller_nonce,
                    &body.requested_capabilities,
                    now,
                )
                .map(|issued| json!({"sessionId": issued.session_id, "ticket": issued.ticket}))
        }
        "session.request" => {
            let body = match payload::<SessionRequest>(envelope.payload) {
                Ok(body) => body,
                Err(error) => return error_response(&id, "invalid_payload", &error),
            };
            let claims = match state
                .unattended()
                .await
                .authorize_session_ticket(&body.ticket, now)
            {
                Ok(claims) => claims,
                Err(error) => return error_response(&id, "rejected", &error.to_string()),
            };
            if state.persist_unattended().await.is_err() {
                return error_response(&id, "persistence", "anti-replay persistence failed");
            }
            if body.session_id != claims.session_id {
                return error_response(&id, "binding", "session id does not match ticket");
            }
            let Some(device) = state.unattended_device(&claims.device_id).await else {
                return error_response(&id, "offline", "device is not connected");
            };
            if device.nonce != claims.device_nonce {
                return error_response(&id, "binding", "device registration changed");
            }
            if !state
                .start_unattended_session(
                    claims.session_id.clone(),
                    claims.device_id.clone(),
                    claims.controller_id.clone(),
                    connection_id,
                    outbound.clone(),
                )
                .await
            {
                return error_response(&id, "conflict", "session already exists");
            }
            let event = event_response("session.request", &body);
            if device.outbound.send(event).await.is_err() {
                state.end_unattended_session(&claims.session_id).await;
                return error_response(&id, "offline", "device disconnected");
            }
            Ok(json!({"requested": true}))
        }
        "session.accept" | "session.reject" | "session.revoke" | "session.end" => {
            let body = match payload::<SessionDecision>(envelope.payload) {
                Ok(body) => body,
                Err(error) => return error_response(&id, "invalid_payload", &error),
            };
            match relay_session_message(
                state,
                registered_device,
                connection_id,
                &envelope.method,
                &body.session_id,
                event_response(&envelope.method, &body),
            )
            .await
            {
                Ok(()) => {
                    if envelope.method == "session.end" || envelope.method == "session.revoke" {
                        if let Some(session) = state.unattended_session(&body.session_id).await {
                            state.unattended().await.record_session_end(
                                &session.controller_id,
                                &session.device_id,
                                &body.session_id,
                                now,
                            );
                        }
                        state.end_unattended_session(&body.session_id).await;
                        if state.persist_unattended().await.is_err() {
                            return error_response(&id, "persistence", "audit persistence failed");
                        }
                    }
                    Ok(json!({"relayed": true}))
                }
                Err(message) => return error_response(&id, "rejected", message),
            }
        }
        "session.signal" => {
            let body = match payload::<SessionSignal>(envelope.payload) {
                Ok(body) => body,
                Err(error) => return error_response(&id, "invalid_payload", &error),
            };
            match relay_session_message(
                state,
                registered_device,
                connection_id,
                &envelope.method,
                &body.session_id,
                event_response(&envelope.method, &body),
            )
            .await
            {
                Ok(()) => Ok(json!({"relayed": true})),
                Err(message) => return error_response(&id, "rejected", message),
            }
        }
        _ => return error_response(&id, "not_implemented", "method is reserved but unavailable"),
    };
    match result {
        Ok(payload) => success_response(&id, &envelope.method, payload),
        Err(error) => error_response(&id, "rejected", &error.to_string()),
    }
}

async fn relay_session_message(
    state: &AppState,
    registered_device: &Option<(String, String)>,
    connection_id: Uuid,
    _method: &str,
    session_id: &str,
    event: String,
) -> Result<(), &'static str> {
    let session = state
        .unattended_session(session_id)
        .await
        .ok_or("session was not found")?;
    if let Some((device_id, _)) = registered_device {
        let nonce = registered_device
            .as_ref()
            .map(|value| value.1.as_str())
            .unwrap_or("");
        if device_id != &session.device_id
            || !state
                .is_current_unattended_device(device_id, nonce, connection_id)
                .await
        {
            return Err("device is not bound to session");
        }
        session
            .controller_outbound
            .send(event)
            .await
            .map_err(|_| "controller disconnected")
    } else {
        if connection_id != session.controller_connection_id {
            return Err("controller is not bound to session");
        }
        let device = state
            .unattended_device(&session.device_id)
            .await
            .ok_or("device disconnected")?;
        device
            .outbound
            .send(event)
            .await
            .map_err(|_| "device disconnected")
    }
}

fn payload<T: DeserializeOwned>(value: Value) -> Result<T, String> {
    serde_json::from_value(value).map_err(|error| error.to_string())
}

fn success_response(id: &str, method: &str, payload: Value) -> String {
    serde_json::to_string(&Envelope {
        v: PROTOCOL_VERSION,
        id: id.to_owned(),
        message_type: MessageType::Response,
        method: method.to_owned(),
        payload,
    })
    .unwrap_or_else(|_| "{}".into())
}

fn error_response(id: &str, code: &str, message: &str) -> String {
    success_response(id, "error", json!({"code": code, "message": message}))
}

fn event_response<T: serde::Serialize>(method: &str, payload: &T) -> String {
    serde_json::to_string(&Envelope {
        v: PROTOCOL_VERSION,
        id: Uuid::new_v4().simple().to_string(),
        message_type: MessageType::Event,
        method: method.to_owned(),
        payload,
    })
    .unwrap_or_else(|_| "{}".into())
}

fn unix_seconds() -> Result<u64, std::time::SystemTimeError> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
}
