//! #1295 — "matrícula autorizada" para o `/v2/ws`.
//!
//! Testes de integração no serviço cobrindo CADA AC da US. Cada um exercita o
//! comportamento (não a forma do código) e FALHA no código anterior (owner/org/
//! capabilities vinham do payload; enroll sem ticket): o buraco de autorização.
//!
//! Contrato exercitado:
//!   * owner_id/org_id/capabilities SAEM do payload (agora no ticket assinado);
//!   * enroll.begin exige ticket válido (assinatura, TTL, uso único, binding ao device);
//!   * capabilities vêm da política do servidor (default-deny; screen+input);
//!   * teto por owner_id na cunhagem (erro tipado + audit);
//!   * device revogado → register recusa; caminho de revogação audita.

use std::{net::SocketAddr, time::Duration};

use ed25519_dalek::SigningKey;
use futures_util::SinkExt;
use futures_util::StreamExt;
use galaxie_remote_net::{
    authority::AuditAction,
    identity::DeviceIdentity,
    opaque::{ClientRegistrationFlow, ServerSecrets},
    protocol::{DeviceEnrollBegin, DeviceEnrollFinish, DeviceRegister, Envelope, MessageType},
    PROTOCOL_VERSION,
};
use galaxie_remote_signaling::{app, state::AppState};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio_tungstenite::{connect_async, tungstenite::Message};

type TestError = Box<dyn std::error::Error>;
type TestSocket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

const OWNER: &str = "owner-1295";
const ORG: &str = "org-1295";
const DEVICE: &str = "device-1295";
const PASSWORD: &[u8] = b"matricula-autorizada-1295";

// AC: enroll.begin com owner_id/org_id NO PAYLOAD (divergentes) → rejeitado. Os campos
// foram REMOVIDOS do wire (deny_unknown_fields), então um payload que ainda os traga é
// recusado — nada matricula. É o buraco original fechado.
#[tokio::test]
async fn owner_org_in_payload_is_rejected_and_nothing_enrolls() -> Result<(), TestError> {
    let (address, state) = spawn_server().await?;
    let (mut worker, _) = connect_async(format!("ws://{address}/v2/ws")).await?;
    let identity = DeviceIdentity::generate();
    let (_registration, opaque_request) = ClientRegistrationFlow::start(PASSWORD)?;
    // Um ticket VÁLIDO existe, mas o cliente tenta contrabandear owner/org divergentes.
    let enrollment_ticket = state.mint_enrollment_ticket(OWNER, ORG, DEVICE).await?;

    // Payload cru com ownerId/orgId (que NÃO existem mais no struct do wire).
    let smuggled = json!({
        "deviceId": DEVICE,
        "ownerId": "attacker-owner",
        "orgId": "attacker-org",
        "name": "rogue",
        "publicKey": identity.public_key_base64(),
        "opaqueRequest": opaque_request,
        "enrollmentTicket": enrollment_ticket,
    });
    send_raw(&mut worker, "smuggle", "device.enroll.begin", smuggled).await?;
    let response: Envelope<Value> = receive(&mut worker).await?;
    assert_eq!(response.method, "error", "campo de owner/org no wire foi aceito");

    // Nada foi matriculado — nem sob o owner do ticket, nem sob o do atacante.
    assert!(state.unattended().await.address_book(OWNER, ORG).is_empty());
    assert!(
        state
            .unattended()
            .await
            .address_book("attacker-owner", "attacker-org")
            .is_empty()
    );
    Ok(())
}

// AC: enroll.* sem ticket válido → rejeitado; nada matricula.
#[tokio::test]
async fn enroll_begin_without_valid_ticket_is_rejected() -> Result<(), TestError> {
    let (address, state) = spawn_server().await?;
    let (mut worker, _) = connect_async(format!("ws://{address}/v2/ws")).await?;
    let identity = DeviceIdentity::generate();
    let (_registration, opaque_request) = ClientRegistrationFlow::start(PASSWORD)?;

    let response: Envelope<Value> = request_envelope(
        &mut worker,
        "no-ticket",
        "device.enroll.begin",
        &DeviceEnrollBegin {
            device_id: DEVICE.into(),
            name: "rogue".into(),
            public_key: identity.public_key_base64(),
            opaque_request,
            enrollment_ticket: "not-a-real-ticket".into(),
        },
    )
    .await?;
    assert_eq!(response.method, "error", "enroll sem ticket válido foi aceito");
    assert!(state.unattended().await.address_book(OWNER, ORG).is_empty());
    // Rejeição auditada (Enroll, success=false).
    assert!(
        state
            .unattended()
            .await
            .audit()
            .iter()
            .any(|record| record.action == AuditAction::Enroll && !record.success)
    );
    Ok(())
}

// AC: capabilities no payload → ignoradas; a matrícula recebe a política do servidor.
// (1) `capabilities` foi removido do wire — um finish que ainda o traga é recusado.
// (2) o device matriculado tem exatamente screen+input (política), nada mais.
#[tokio::test]
async fn capabilities_are_server_policy_not_client_chosen() -> Result<(), TestError> {
    let (address, state) = spawn_server().await?;
    let (mut worker, _) = connect_async(format!("ws://{address}/v2/ws")).await?;
    let identity = DeviceIdentity::generate();

    // Matrícula legítima (sem capabilities no wire).
    enroll(&mut worker, &state, &identity).await?;

    // O device recebeu a política do servidor: screen+input, resto negado.
    let book = state.unattended().await.address_book(OWNER, ORG);
    assert_eq!(book.len(), 1);
    let caps = book[0].capabilities;
    assert!(caps.screen && caps.input, "política mínima não concedida");
    assert!(
        !caps.file_transfer && !caps.clipboard && !caps.audio,
        "matrícula concedeu capability além da política"
    );

    // Um finish com `capabilities` cru no payload é recusado (deny_unknown_fields).
    let (mut other, _) = connect_async(format!("ws://{address}/v2/ws")).await?;
    let other_identity = DeviceIdentity::generate();
    let ticket = state.mint_enrollment_ticket(OWNER, ORG, "device-b").await?;
    let (registration, opaque_request) = ClientRegistrationFlow::start(PASSWORD)?;
    let begin: Value = request(
        &mut other,
        "b-begin",
        "device.enroll.begin",
        &DeviceEnrollBegin {
            device_id: "device-b".into(),
            name: "b".into(),
            public_key: other_identity.public_key_base64(),
            opaque_request,
            enrollment_ticket: ticket,
        },
    )
    .await?;
    let registration = registration.finish(field(&begin, "opaqueResponse")?)?;
    let smuggled = json!({
        "deviceId": "device-b",
        "opaqueUpload": registration.upload,
        "capabilities": {"screen": true, "input": true, "fileTransfer": true},
    });
    send_raw(&mut other, "b-finish", "device.enroll.finish", smuggled).await?;
    let response: Envelope<Value> = receive(&mut other).await?;
    assert_eq!(
        response.method, "error",
        "capabilities no wire do finish foi aceito"
    );
    Ok(())
}

// AC: ticket reutilizado → rejeitado; e ticket de OUTRO device_id → rejeitado.
#[tokio::test]
async fn reused_and_wrong_device_ticket_are_rejected() -> Result<(), TestError> {
    let (address, state) = spawn_server().await?;
    let (mut worker, _) = connect_async(format!("ws://{address}/v2/ws")).await?;
    let identity = DeviceIdentity::generate();

    // Ticket amarrado a DEVICE, apresentado para "outro-device" → binding/rejeição.
    let ticket = state.mint_enrollment_ticket(OWNER, ORG, DEVICE).await?;
    let (_registration, opaque_request) = ClientRegistrationFlow::start(PASSWORD)?;
    let wrong: Envelope<Value> = request_envelope(
        &mut worker,
        "wrong-device",
        "device.enroll.begin",
        &DeviceEnrollBegin {
            device_id: "outro-device".into(),
            name: "x".into(),
            public_key: identity.public_key_base64(),
            opaque_request,
            enrollment_ticket: ticket.clone(),
        },
    )
    .await?;
    assert_eq!(wrong.method, "error", "ticket aceito para device errado");

    // Uso legítimo consome o ticket…
    let (_registration, opaque_request) = ClientRegistrationFlow::start(PASSWORD)?;
    let begin: Value = request(
        &mut worker,
        "first-use",
        "device.enroll.begin",
        &DeviceEnrollBegin {
            device_id: DEVICE.into(),
            name: "x".into(),
            public_key: identity.public_key_base64(),
            opaque_request,
            enrollment_ticket: ticket.clone(),
        },
    )
    .await?;
    let _ = field(&begin, "opaqueResponse")?;

    // …reuso do MESMO ticket (nova conexão) → rejeitado.
    let (mut replay, _) = connect_async(format!("ws://{address}/v2/ws")).await?;
    let (_registration, opaque_request) = ClientRegistrationFlow::start(PASSWORD)?;
    let reused: Envelope<Value> = request_envelope(
        &mut replay,
        "reuse",
        "device.enroll.begin",
        &DeviceEnrollBegin {
            device_id: DEVICE.into(),
            name: "x".into(),
            public_key: identity.public_key_base64(),
            opaque_request,
            enrollment_ticket: ticket,
        },
    )
    .await?;
    assert_eq!(reused.method, "error", "ticket reutilizado foi aceito");
    Ok(())
}

// AC: owner_id no teto → nova matrícula (cunhagem) recusada com erro tipado + audit.
#[tokio::test]
async fn owner_cap_refuses_new_enrollment_with_audit() -> Result<(), TestError> {
    let (address, state) = spawn_server().await?;
    state.set_enrollment_cap(1).await;
    let (mut worker, _) = connect_async(format!("ws://{address}/v2/ws")).await?;
    let identity = DeviceIdentity::generate();
    enroll(&mut worker, &state, &identity).await?;

    // owner já tem 1 device; cunhar outro sob o mesmo owner é recusado no teto.
    let denied = state.mint_enrollment_ticket(OWNER, ORG, "device-extra").await;
    assert!(denied.is_err(), "cunhagem acima do teto foi permitida");
    assert!(
        state
            .unattended()
            .await
            .audit()
            .iter()
            .any(|record| record.action == AuditAction::Enroll
                && !record.success
                && record.device_id == "device-extra")
    );
    Ok(())
}

// AC: device com revoked=true → register recusa; caminho interno de revogação audita.
#[tokio::test]
async fn revoked_device_is_refused_and_revocation_audits() -> Result<(), TestError> {
    let (address, state) = spawn_server().await?;
    let (mut worker, _) = connect_async(format!("ws://{address}/v2/ws")).await?;
    let identity = DeviceIdentity::generate();
    enroll(&mut worker, &state, &identity).await?;

    // Register funciona ANTES da revogação.
    let now = unix_seconds();
    let ok: Value = request(
        &mut worker,
        "reg-ok",
        "device.register",
        &DeviceRegister {
            device_id: DEVICE.into(),
            nonce: "nonce-ok".into(),
            timestamp: now,
            signature: identity.sign_registration(DEVICE, "nonce-ok", now),
        },
    )
    .await?;
    assert_eq!(ok.get("registered").and_then(Value::as_bool), Some(true));

    // Caminho interno de revogação (com audit).
    let revoked_now = unix_seconds();
    state
        .unattended()
        .await
        .revoke_device("admin-1295", OWNER, ORG, DEVICE, revoked_now)?;
    assert!(
        state
            .unattended()
            .await
            .audit()
            .iter()
            .any(|record| record.action == AuditAction::Revoke && record.success)
    );

    // Register APÓS a revogação é recusado.
    let after = unix_seconds();
    let refused: Envelope<Value> = request_envelope(
        &mut worker,
        "reg-after-revoke",
        "device.register",
        &DeviceRegister {
            device_id: DEVICE.into(),
            nonce: "nonce-after".into(),
            timestamp: after,
            signature: identity.sign_registration(DEVICE, "nonce-after", after),
        },
    )
    .await?;
    assert_eq!(refused.method, "error", "register de device revogado passou");
    Ok(())
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

async fn enroll(
    socket: &mut TestSocket,
    state: &AppState,
    identity: &DeviceIdentity,
) -> Result<(), TestError> {
    let enrollment_ticket = state.mint_enrollment_ticket(OWNER, ORG, DEVICE).await?;
    let (registration, opaque_request) = ClientRegistrationFlow::start(PASSWORD)?;
    let begin: Value = request(
        socket,
        "enroll-begin",
        "device.enroll.begin",
        &DeviceEnrollBegin {
            device_id: DEVICE.into(),
            name: "workstation".into(),
            public_key: identity.public_key_base64(),
            opaque_request,
            enrollment_ticket,
        },
    )
    .await?;
    let registration = registration.finish(field(&begin, "opaqueResponse")?)?;
    let _: Value = request(
        socket,
        "enroll-finish",
        "device.enroll.finish",
        &DeviceEnrollFinish {
            device_id: DEVICE.into(),
            opaque_upload: registration.upload,
        },
    )
    .await?;
    Ok(())
}

async fn spawn_server() -> Result<(SocketAddr, AppState), TestError> {
    let state = AppState::new_with_opaque(
        SigningKey::from_bytes(&[9_u8; 32]),
        b"test-turn-secret".to_vec(),
        vec!["turn:127.0.0.1:3478?transport=udp".to_owned()],
        Duration::from_secs(3600),
        Duration::from_secs(60),
        Duration::from_secs(60),
        200,
        Duration::from_secs(60),
        ServerSecrets::generate(),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let served = state.clone();
    tokio::spawn(async move {
        let _ = axum::serve(
            listener,
            app(served).into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await;
    });
    Ok((address, state))
}

async fn request<T: Serialize, R: DeserializeOwned>(
    socket: &mut TestSocket,
    id: &str,
    method: &str,
    payload: &T,
) -> Result<R, TestError> {
    let response: Envelope<R> = request_envelope(socket, id, method, payload).await?;
    Ok(response.payload)
}

async fn request_envelope<T: Serialize, R: DeserializeOwned>(
    socket: &mut TestSocket,
    id: &str,
    method: &str,
    payload: &T,
) -> Result<Envelope<R>, TestError> {
    let envelope = Envelope {
        v: PROTOCOL_VERSION,
        id: id.to_owned(),
        message_type: MessageType::Request,
        method: method.to_owned(),
        payload,
    };
    socket
        .send(Message::Text(serde_json::to_string(&envelope)?.into()))
        .await?;
    receive(socket).await
}

async fn send_raw(
    socket: &mut TestSocket,
    id: &str,
    method: &str,
    payload: Value,
) -> Result<(), TestError> {
    let envelope = json!({
        "v": PROTOCOL_VERSION,
        "id": id,
        "type": "request",
        "method": method,
        "payload": payload,
    });
    socket
        .send(Message::Text(envelope.to_string().into()))
        .await?;
    Ok(())
}

async fn receive<T: DeserializeOwned>(socket: &mut TestSocket) -> Result<T, TestError> {
    let frame = socket.next().await.ok_or("socket closed")??;
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
