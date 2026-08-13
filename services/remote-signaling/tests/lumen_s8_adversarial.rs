use std::{net::SocketAddr, path::PathBuf, time::Duration};

use ed25519_dalek::SigningKey;
use futures_util::{SinkExt, StreamExt};
use galaxie_remote_net::{
    identity::DeviceIdentity,
    opaque::{ClientLoginFlow, ClientRegistrationFlow, ServerSecrets},
    protocol::{
        AuthBegin, AuthFinish, Capabilities, DeviceEnrollBegin, DeviceEnrollFinish,
        DeviceHeartbeat, DeviceRegister, Envelope, MessageType, SessionDecision, SessionRequest,
        SessionSignal, SignalKind,
    },
    MAX_MESSAGE_BYTES, PROTOCOL_VERSION,
};
use galaxie_remote_signaling::{app, state::AppState};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};
use tokio::{net::TcpListener, time::timeout};
use tokio_tungstenite::{connect_async, tungstenite::Message};

type TestError = Box<dyn std::error::Error>;
type TestSocket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

const PASSWORD: &[u8] = b"lumen-s8-password-never-persist";
const DEVICE_ID: &str = "device-lumen";
const OWNER_ID: &str = "owner-lumen";
const ORG_ID: &str = "org-lumen";

#[tokio::test]
async fn v2_protocol_boundary_fails_closed_for_invalid_type_version_id_and_oversize(
) -> Result<(), TestError> {
    let address = spawn_server(test_state(None, None, ServerSecrets::generate())?).await?;
    let (mut socket, _) = connect_async(format!("ws://{address}/v2/ws")).await?;

    for (case, frame) in [
        (
            "version",
            json!({"v":1,"id":"version","type":"request","method":"device.heartbeat","payload":{"deviceId":DEVICE_ID,"timestamp":1}}),
        ),
        (
            "unsafe-id",
            json!({"v":2,"id":"bad id","type":"request","method":"device.heartbeat","payload":{"deviceId":DEVICE_ID,"timestamp":1}}),
        ),
        (
            "event-input",
            json!({"v":2,"id":"event-input","type":"event","method":"device.heartbeat","payload":{"deviceId":DEVICE_ID,"timestamp":1}}),
        ),
        (
            "unknown-method",
            json!({"v":2,"id":"unknown-method","type":"request","method":"device.erase","payload":{}}),
        ),
    ] {
        socket.send(Message::Text(frame.to_string().into())).await?;
        let response: Envelope<Value> = receive(&mut socket).await?;
        assert_eq!(response.method, "error", "{case} was not rejected");
    }

    socket.send(Message::Binary(vec![0_u8; 8].into())).await?;
    let response: Envelope<Value> = receive(&mut socket).await?;
    assert_eq!(response.method, "error", "binary frame was not rejected");

    let oversized = "x".repeat(MAX_MESSAGE_BYTES + 1);
    socket.send(Message::Text(oversized.into())).await?;
    let outcome = timeout(Duration::from_secs(2), socket.next()).await;
    assert!(
        !matches!(outcome, Ok(Some(Ok(Message::Text(_))))),
        "oversized frame received a normal text response"
    );
    Ok(())
}

#[tokio::test]
async fn registration_proof_replay_stale_and_connection_substitution_fail_closed(
) -> Result<(), TestError> {
    let address = spawn_server(test_state(None, None, ServerSecrets::generate())?).await?;
    let identity = DeviceIdentity::generate();
    let (mut original, _) = connect_async(format!("ws://{address}/v2/ws")).await?;
    enroll(&mut original, &identity).await?;

    let now = unix_seconds();
    register(&mut original, &identity, "nonce-original", now).await?;

    send_request(
        &mut original,
        "proof-replay",
        "device.register",
        &DeviceRegister {
            device_id: DEVICE_ID.into(),
            nonce: "nonce-original".into(),
            timestamp: now,
            signature: identity.sign_registration(DEVICE_ID, "nonce-original", now),
        },
    )
    .await?;
    expect_error(&mut original, "proof-replay").await?;

    let stale = now.saturating_sub(120);
    send_request(
        &mut original,
        "proof-stale",
        "device.register",
        &DeviceRegister {
            device_id: DEVICE_ID.into(),
            nonce: "nonce-stale".into(),
            timestamp: stale,
            signature: identity.sign_registration(DEVICE_ID, "nonce-stale", stale),
        },
    )
    .await?;
    expect_error(&mut original, "proof-stale").await?;

    let (mut replacement, _) = connect_async(format!("ws://{address}/v2/ws")).await?;
    register(
        &mut replacement,
        &identity,
        "nonce-replacement",
        unix_seconds(),
    )
    .await?;

    send_request(
        &mut original,
        "old-heartbeat",
        "device.heartbeat",
        &DeviceHeartbeat {
            device_id: DEVICE_ID.into(),
            timestamp: unix_seconds(),
        },
    )
    .await?;
    expect_error(&mut original, "old-heartbeat").await?;

    let heartbeat: Value = request(
        &mut replacement,
        "new-heartbeat",
        "device.heartbeat",
        &DeviceHeartbeat {
            device_id: DEVICE_ID.into(),
            timestamp: unix_seconds(),
        },
    )
    .await?;
    assert!(heartbeat.get("timestamp").and_then(Value::as_u64).is_some());

    let (mut controller, _) = connect_async(format!("ws://{address}/v2/ws")).await?;
    let (_, opaque_request) = ClientLoginFlow::start(PASSWORD)?;
    send_request(
        &mut controller,
        "old-nonce-auth",
        "unattended.auth.begin",
        &AuthBegin {
            device_id: DEVICE_ID.into(),
            controller_id: "controller-lumen".into(),
            owner_id: OWNER_ID.into(),
            org_id: ORG_ID.into(),
            device_nonce: "nonce-original".into(),
            controller_nonce: "controller-nonce".into(),
            requested_capabilities: screen_only(),
            opaque_request,
        },
    )
    .await?;
    expect_error(&mut controller, "old-nonce-auth").await?;
    Ok(())
}

#[tokio::test]
async fn opaque_wrong_password_and_auth_finish_binding_changes_never_issue_ticket(
) -> Result<(), TestError> {
    let address = spawn_server(test_state(None, None, ServerSecrets::generate())?).await?;
    let identity = DeviceIdentity::generate();
    let (mut worker, _) = connect_async(format!("ws://{address}/v2/ws")).await?;
    enroll(&mut worker, &identity).await?;
    register(&mut worker, &identity, "device-nonce", unix_seconds()).await?;
    let (mut controller, _) = connect_async(format!("ws://{address}/v2/ws")).await?;

    let (wrong_login, wrong_request) = ClientLoginFlow::start(b"wrong-password")?;
    let wrong_challenge = begin_auth(
        &mut controller,
        "wrong-begin",
        wrong_request,
        "controller-nonce",
        screen_only(),
    )
    .await?;
    assert!(
        wrong_login
            .finish(field(&wrong_challenge, "opaqueResponse")?)
            .is_err(),
        "wrong password completed OPAQUE"
    );
    send_request(
        &mut controller,
        "wrong-finish",
        "unattended.auth.finish",
        &AuthFinish {
            auth_id: field(&wrong_challenge, "authId")?.into(),
            opaque_finalization: "not-a-valid-finalization".into(),
            controller_nonce: "controller-nonce".into(),
            requested_capabilities: screen_only(),
        },
    )
    .await?;
    let wrong_response = expect_error(&mut controller, "wrong-finish").await?;
    assert!(!wrong_response.to_string().contains("wrong-password"));

    let (login, request_bytes) = ClientLoginFlow::start(PASSWORD)?;
    let challenge = begin_auth(
        &mut controller,
        "nonce-swap-begin",
        request_bytes,
        "controller-nonce",
        screen_only(),
    )
    .await?;
    let finish = login.finish(field(&challenge, "opaqueResponse")?)?;
    send_request(
        &mut controller,
        "nonce-swap-finish",
        "unattended.auth.finish",
        &AuthFinish {
            auth_id: field(&challenge, "authId")?.into(),
            opaque_finalization: finish.finalization,
            controller_nonce: "substituted-nonce".into(),
            requested_capabilities: screen_only(),
        },
    )
    .await?;
    expect_error(&mut controller, "nonce-swap-finish").await?;

    let (login, request_bytes) = ClientLoginFlow::start(PASSWORD)?;
    let challenge = begin_auth(
        &mut controller,
        "caps-swap-begin",
        request_bytes,
        "controller-nonce",
        screen_only(),
    )
    .await?;
    let finish = login.finish(field(&challenge, "opaqueResponse")?)?;
    send_request(
        &mut controller,
        "caps-swap-finish",
        "unattended.auth.finish",
        &AuthFinish {
            auth_id: field(&challenge, "authId")?.into(),
            opaque_finalization: finish.finalization,
            controller_nonce: "controller-nonce".into(),
            requested_capabilities: Capabilities {
                screen: true,
                input: true,
                ..Default::default()
            },
        },
    )
    .await?;
    expect_error(&mut controller, "caps-swap-finish").await?;
    Ok(())
}

#[tokio::test]
async fn socket_lifecycle_persists_audit_without_secrets_and_replay_survives_restart(
) -> Result<(), TestError> {
    let setup = ServerSecrets::generate();
    let serialized_setup = setup.serialize().to_vec();
    let snapshot_path = snapshot_path();
    let state = test_state(Some(snapshot_path.clone()), None, setup)?;
    let address = spawn_server(state).await?;
    let identity = DeviceIdentity::generate();
    let (mut worker, _) = connect_async(format!("ws://{address}/v2/ws")).await?;
    let opaque_upload = enroll(&mut worker, &identity).await?;
    register(&mut worker, &identity, "device-nonce", unix_seconds()).await?;
    let (mut controller, _) = connect_async(format!("ws://{address}/v2/ws")).await?;
    let (ticket, session_id, finalization) = authenticate(&mut controller).await?;

    let _: Value = request(
        &mut controller,
        "session-request",
        "session.request",
        &SessionRequest {
            session_id: session_id.clone(),
            ticket: ticket.clone(),
        },
    )
    .await?;
    let requested: Envelope<SessionRequest> = receive(&mut worker).await?;
    assert_eq!(requested.method, "session.request");

    let _: Value = request(
        &mut worker,
        "accept",
        "session.accept",
        &SessionDecision {
            session_id: session_id.clone(),
            reason: None,
        },
    )
    .await?;
    let accepted: Envelope<SessionDecision> = receive(&mut controller).await?;
    assert_eq!(accepted.method, "session.accept");

    let worker_signal = SessionSignal {
        session_id: session_id.clone(),
        peer_id: "worker".into(),
        kind: SignalKind::Offer,
        payload: "offer-sdp".into(),
    };
    let _: Value = request(&mut worker, "offer", "session.signal", &worker_signal).await?;
    let offer: Envelope<SessionSignal> = receive(&mut controller).await?;
    assert_eq!(offer.payload, worker_signal);

    let controller_signal = SessionSignal {
        session_id: session_id.clone(),
        peer_id: "controller".into(),
        kind: SignalKind::Answer,
        payload: "answer-sdp".into(),
    };
    let _: Value = request(
        &mut controller,
        "answer",
        "session.signal",
        &controller_signal,
    )
    .await?;
    let answer: Envelope<SessionSignal> = receive(&mut worker).await?;
    assert_eq!(answer.payload, controller_signal);

    let _: Value = request(
        &mut controller,
        "end",
        "session.end",
        &SessionDecision {
            session_id: session_id.clone(),
            reason: Some("done".into()),
        },
    )
    .await?;
    let ended: Envelope<SessionDecision> = receive(&mut worker).await?;
    assert_eq!(ended.method, "session.end");

    send_request(
        &mut controller,
        "signal-after-end",
        "session.signal",
        &controller_signal,
    )
    .await?;
    expect_error(&mut controller, "signal-after-end").await?;

    let snapshot = tokio::fs::read(&snapshot_path).await?;
    let snapshot_text = String::from_utf8(snapshot.clone())?;
    for secret in [
        String::from_utf8_lossy(PASSWORD).into_owned(),
        opaque_upload,
        finalization,
        ticket.clone(),
        "offer-sdp".into(),
        "answer-sdp".into(),
    ] {
        assert!(
            !snapshot_text.contains(&secret),
            "secret leaked to snapshot"
        );
    }
    assert!(snapshot_text.contains("session_start"));
    assert!(snapshot_text.contains("session_end"));

    let restored_setup = ServerSecrets::deserialize(&serialized_setup)?;
    let restored_state = test_state(None, Some(&snapshot), restored_setup)?;
    let restored_address = spawn_server(restored_state).await?;
    let (mut restored_controller, _) =
        connect_async(format!("ws://{restored_address}/v2/ws")).await?;
    send_request(
        &mut restored_controller,
        "replay-after-restart",
        "session.request",
        &SessionRequest { session_id, ticket },
    )
    .await?;
    expect_error(&mut restored_controller, "replay-after-restart").await?;

    let _ = tokio::fs::remove_file(&snapshot_path).await;
    Ok(())
}

fn test_state(
    state_file: Option<PathBuf>,
    snapshot: Option<&[u8]>,
    opaque: ServerSecrets,
) -> Result<AppState, TestError> {
    AppState::new_with_opaque_snapshot(
        SigningKey::from_bytes(&[19_u8; 32]),
        b"test-turn-secret".to_vec(),
        vec!["turn:127.0.0.1:3478?transport=udp".into()],
        Duration::from_secs(3600),
        Duration::from_secs(60),
        Duration::from_secs(60),
        10_000,
        Duration::from_secs(60),
        opaque,
        snapshot,
        state_file,
    )
    .map_err(Into::into)
}

async fn spawn_server(state: AppState) -> Result<SocketAddr, TestError> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    tokio::spawn(async move {
        let _ = axum::serve(
            listener,
            app(state).into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await;
    });
    Ok(address)
}

async fn enroll(socket: &mut TestSocket, identity: &DeviceIdentity) -> Result<String, TestError> {
    let (registration, opaque_request) = ClientRegistrationFlow::start(PASSWORD)?;
    let begin: Value = request(
        socket,
        "enroll-begin",
        "device.enroll.begin",
        &DeviceEnrollBegin {
            device_id: DEVICE_ID.into(),
            owner_id: OWNER_ID.into(),
            org_id: ORG_ID.into(),
            name: "Lumen workstation".into(),
            public_key: identity.public_key_base64(),
            opaque_request,
        },
    )
    .await?;
    let registration = registration.finish(field(&begin, "opaqueResponse")?)?;
    let upload = registration.upload.clone();
    let _: Value = request(
        socket,
        "enroll-finish",
        "device.enroll.finish",
        &DeviceEnrollFinish {
            device_id: DEVICE_ID.into(),
            opaque_upload: registration.upload,
            capabilities: Capabilities {
                screen: true,
                input: true,
                ..Default::default()
            },
        },
    )
    .await?;
    Ok(upload)
}

async fn register(
    socket: &mut TestSocket,
    identity: &DeviceIdentity,
    nonce: &str,
    timestamp: u64,
) -> Result<(), TestError> {
    let _: Value = request(
        socket,
        &format!("register-{nonce}"),
        "device.register",
        &DeviceRegister {
            device_id: DEVICE_ID.into(),
            nonce: nonce.into(),
            timestamp,
            signature: identity.sign_registration(DEVICE_ID, nonce, timestamp),
        },
    )
    .await?;
    Ok(())
}

async fn begin_auth(
    socket: &mut TestSocket,
    id: &str,
    opaque_request: String,
    controller_nonce: &str,
    capabilities: Capabilities,
) -> Result<Value, TestError> {
    request(
        socket,
        id,
        "unattended.auth.begin",
        &AuthBegin {
            device_id: DEVICE_ID.into(),
            controller_id: "controller-lumen".into(),
            owner_id: OWNER_ID.into(),
            org_id: ORG_ID.into(),
            device_nonce: "device-nonce".into(),
            controller_nonce: controller_nonce.into(),
            requested_capabilities: capabilities,
            opaque_request,
        },
    )
    .await
}

async fn authenticate(socket: &mut TestSocket) -> Result<(String, String, String), TestError> {
    let (login, opaque_request) = ClientLoginFlow::start(PASSWORD)?;
    let challenge = begin_auth(
        socket,
        "auth-begin",
        opaque_request,
        "controller-nonce",
        screen_only(),
    )
    .await?;
    let finish = login.finish(field(&challenge, "opaqueResponse")?)?;
    let finalization = finish.finalization.clone();
    let issued: Value = request(
        socket,
        "auth-finish",
        "unattended.auth.finish",
        &AuthFinish {
            auth_id: field(&challenge, "authId")?.into(),
            opaque_finalization: finish.finalization,
            controller_nonce: "controller-nonce".into(),
            requested_capabilities: screen_only(),
        },
    )
    .await?;
    Ok((
        field(&issued, "ticket")?.into(),
        field(&issued, "sessionId")?.into(),
        finalization,
    ))
}

fn screen_only() -> Capabilities {
    Capabilities {
        screen: true,
        ..Default::default()
    }
}

async fn request<T: Serialize, R: DeserializeOwned>(
    socket: &mut TestSocket,
    id: &str,
    method: &str,
    payload: &T,
) -> Result<R, TestError> {
    send_request(socket, id, method, payload).await?;
    let response: Envelope<R> = receive(socket).await?;
    if response.id != id || response.method != method {
        return Err(format!("unexpected response {} {}", response.id, response.method).into());
    }
    Ok(response.payload)
}

async fn send_request<T: Serialize>(
    socket: &mut TestSocket,
    id: &str,
    method: &str,
    payload: &T,
) -> Result<(), TestError> {
    socket
        .send(Message::Text(
            serde_json::to_string(&Envelope {
                v: PROTOCOL_VERSION,
                id: id.into(),
                message_type: MessageType::Request,
                method: method.into(),
                payload,
            })?
            .into(),
        ))
        .await?;
    Ok(())
}

async fn expect_error(socket: &mut TestSocket, id: &str) -> Result<Value, TestError> {
    let response: Envelope<Value> = receive(socket).await?;
    assert_eq!(response.id, id);
    assert_eq!(response.method, "error");
    Ok(response.payload)
}

async fn receive<T: DeserializeOwned>(socket: &mut TestSocket) -> Result<T, TestError> {
    let frame = timeout(Duration::from_secs(3), socket.next())
        .await
        .map_err(|_| "socket response timed out")?
        .ok_or("socket closed")??;
    let Message::Text(text) = frame else {
        return Err("response was not text".into());
    };
    Ok(serde_json::from_str(&text)?)
}

fn field<'a>(value: &'a Value, name: &str) -> Result<&'a str, TestError> {
    value
        .get(name)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("missing {name}").into())
}

fn unix_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs())
}

fn snapshot_path() -> PathBuf {
    std::env::temp_dir().join(format!(
        "galaxie-lumen-s8-{}-{}.json",
        std::process::id(),
        unix_seconds()
    ))
}
