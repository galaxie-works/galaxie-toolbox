use std::{net::SocketAddr, time::Duration};

use ed25519_dalek::SigningKey;
use futures_util::{SinkExt, StreamExt};
use galaxie_remote_net::{
    identity::DeviceIdentity,
    opaque::{ClientLoginFlow, ClientRegistrationFlow, ServerSecrets},
    protocol::{
        AuthBegin, AuthFinish, Capabilities, DeviceEnrollBegin, DeviceEnrollFinish, DeviceRegister,
        Envelope, MessageType, SessionDecision, SessionRequest,
    },
    PROTOCOL_VERSION,
};
use galaxie_remote_signaling::{app, state::AppState};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use hmac::{Hmac, Mac};
use sha1::Sha1;

use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio_tungstenite::{connect_async, tungstenite::Message};

type TestSocket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

#[tokio::test]
async fn v2_enrolls_proves_key_and_issues_opaque_ticket() -> Result<(), Box<dyn std::error::Error>>
{
    let (address, state) = spawn_server().await?;
    let (mut worker, _) = connect_async(format!("ws://{address}/v2/ws")).await?;
    let identity = DeviceIdentity::generate();
    let (registration, opaque_request) = ClientRegistrationFlow::start(b"permanent-password")?;

    // #1295: o ticket é cunhado na superfície autenticada (aqui: direto no AppState);
    // o /v2/ws só o valida. owner/org NÃO vão no payload de enroll.
    let enrollment_ticket = state
        .mint_enrollment_ticket("owner-1", "org-1", "device-1")
        .await?;
    let enrollment: Value = request(
        &mut worker,
        "enroll-1",
        "device.enroll.begin",
        &DeviceEnrollBegin {
            device_id: "device-1".into(),
            name: "Workstation".into(),
            public_key: identity.public_key_base64(),
            opaque_request,
            enrollment_ticket,
        },
    )
    .await?;
    let opaque_response = field(&enrollment, "opaqueResponse")?;
    let registration = registration.finish(opaque_response)?;
    let _: Value = request(
        &mut worker,
        "enroll-2",
        "device.enroll.finish",
        &DeviceEnrollFinish {
            device_id: "device-1".into(),
            opaque_upload: registration.upload,
        },
    )
    .await?;

    let timestamp = unix_seconds();
    let signature = identity.sign_registration("device-1", "device-nonce", timestamp);
    let _: Value = request(
        &mut worker,
        "register-1",
        "device.register",
        &DeviceRegister {
            device_id: "device-1".into(),
            nonce: "device-nonce".into(),
            timestamp,
            signature,
        },
    )
    .await?;

    let (mut controller, _) = connect_async(format!("ws://{address}/v2/ws")).await?;
    let (login, opaque_request) = ClientLoginFlow::start(b"permanent-password")?;
    let challenge: Value = request(
        &mut controller,
        "auth-1",
        "unattended.auth.begin",
        &AuthBegin {
            device_id: "device-1".into(),
            controller_id: "controller-1".into(),
            owner_id: "owner-1".into(),
            org_id: "org-1".into(),
            device_nonce: "device-nonce".into(),
            controller_nonce: "controller-nonce".into(),
            requested_capabilities: Capabilities {
                screen: true,
                ..Default::default()
            },
            opaque_request,
        },
    )
    .await?;
    let auth_id = field(&challenge, "authId")?.to_owned();
    let login = login.finish(field(&challenge, "opaqueResponse")?)?;
    let ticket: Value = request(
        &mut controller,
        "auth-2",
        "unattended.auth.finish",
        &AuthFinish {
            auth_id,
            opaque_finalization: login.finalization,
            controller_nonce: "controller-nonce".into(),
            requested_capabilities: Capabilities {
                screen: true,
                ..Default::default()
            },
        },
    )
    .await?;
    let encoded_ticket = field(&ticket, "ticket")?.to_owned();
    let session_id = field(&ticket, "sessionId")?.to_owned();
    assert!(encoded_ticket.len() > 128);

    let requested: Value = request(
        &mut controller,
        "session-1",
        "session.request",
        &SessionRequest {
            session_id: session_id.clone(),
            ticket: encoded_ticket.clone(),
        },
    )
    .await?;
    assert_eq!(
        requested.get("requested").and_then(Value::as_bool),
        Some(true)
    );
    let event: Envelope<SessionRequest> = receive(&mut worker).await?;
    assert_eq!(event.message_type, MessageType::Event);
    assert_eq!(event.method, "session.request");
    assert_eq!(event.payload.session_id, session_id);

    send_request(
        &mut controller,
        "session-replay",
        "session.request",
        &SessionRequest {
            session_id: session_id.clone(),
            ticket: encoded_ticket,
        },
    )
    .await?;
    let replay: Envelope<Value> = receive(&mut controller).await?;
    assert_eq!(replay.method, "error");

    let accepted: Value = request(
        &mut worker,
        "accept-1",
        "session.accept",
        &SessionDecision {
            session_id: session_id.clone(),
            reason: None,
        },
    )
    .await?;
    assert_eq!(accepted.get("relayed").and_then(Value::as_bool), Some(true));
    let accepted_event: Envelope<SessionDecision> = receive(&mut controller).await?;
    assert_eq!(accepted_event.method, "session.accept");
    assert_eq!(accepted_event.payload.session_id, session_id);
    Ok(())
}

#[tokio::test]
async fn v2_rejects_unknown_methods_and_binary_frames() -> Result<(), Box<dyn std::error::Error>> {
    let (address, _state) = spawn_server().await?;
    let (mut socket, _) = connect_async(format!("ws://{address}/v2/ws")).await?;
    socket
        .send(Message::Text(
            json!({"v":2,"id":"x","type":"request","method":"device.erase","payload":{}})
                .to_string()
                .into(),
        ))
        .await?;
    let error: Envelope<Value> = receive(&mut socket).await?;
    assert_eq!(error.method, "error");
    socket.send(Message::Binary(vec![1, 2, 3].into())).await?;
    let error: Envelope<Value> = receive(&mut socket).await?;
    assert_eq!(error.method, "error");
    Ok(())
}

async fn spawn_server() -> Result<(SocketAddr, AppState), Box<dyn std::error::Error>> {
    let state = AppState::new_with_opaque(
        SigningKey::from_bytes(&[7_u8; 32]),
        b"test-turn-secret".to_vec(),
        vec!["turn:127.0.0.1:3478?transport=udp".to_owned()],
        Duration::from_secs(3600),
        Duration::from_secs(60),
        Duration::from_secs(60),
        120,
        Duration::from_secs(60),
        ServerSecrets::generate(),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    // #1295: devolve o AppState (superfície de cunhagem) para o teste cunhar tickets;
    // clonável (Arc), então o servidor roda com uma cópia.
    let served = state.clone();
    tokio::spawn(async move {
        if let Err(error) = axum::serve(
            listener,
            app(served).into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        {
            eprintln!("test server error: {error}");
        }
    });
    Ok((address, state))
}

async fn request<T: Serialize, R: DeserializeOwned>(
    socket: &mut TestSocket,
    id: &str,
    method: &str,
    payload: &T,
) -> Result<R, Box<dyn std::error::Error>> {
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
) -> Result<(), Box<dyn std::error::Error>> {
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
    Ok(())
}

async fn receive<T: DeserializeOwned>(
    socket: &mut TestSocket,
) -> Result<T, Box<dyn std::error::Error>> {
    let frame = socket.next().await.ok_or("socket closed")??;
    let Message::Text(text) = frame else {
        return Err("response was not text".into());
    };
    Ok(serde_json::from_str(&text)?)
}

fn field<'a>(value: &'a Value, name: &str) -> Result<&'a str, Box<dyn std::error::Error>> {
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

// ── #1133: o register do v2 entrega `ice_servers` com credencial efêmera ─────
//
// Antes, o `device.register` do v2 respondia `{"registered": true}` e nada mais:
// o device do caminho S8 (não-supervisionado) ficava sem STUN/TURN, enquanto o
// v1 já entregava a credencial no `Registered`.
//
// O AC do card é explícito quanto ao COMO: a credencial tem de sair do **mesmo**
// esquema `use-auth-secret` do v1, **sem duplicar segredo**. Por isso este teste
// não se contenta com "não-vazio" — ele **recalcula o HMAC** e exige igualdade.
// Um segundo esquema, ainda que funcionasse contra o coturn, ficaria vermelho.
#[tokio::test]
async fn v2_register_entrega_ice_servers_com_credencial_do_mesmo_esquema_do_v1(
) -> Result<(), Box<dyn std::error::Error>> {
    let (address, state) = spawn_server().await?;
    let (mut worker, _) = connect_async(format!("ws://{address}/v2/ws")).await?;
    let identity = DeviceIdentity::generate();
    let (registration, opaque_request) = ClientRegistrationFlow::start(b"permanent-password")?;

    let enrollment_ticket = state
        .mint_enrollment_ticket("owner-ice", "org-ice", "device-ice")
        .await?;
    let enrollment: Value = request(
        &mut worker,
        "enroll-ice-1",
        "device.enroll.begin",
        &DeviceEnrollBegin {
            device_id: "device-ice".into(),
            name: "Workstation ICE".into(),
            public_key: identity.public_key_base64(),
            opaque_request,
            enrollment_ticket,
        },
    )
    .await?;
    let opaque_response = field(&enrollment, "opaqueResponse")?;
    let registration = registration.finish(opaque_response)?;
    let _: Value = request(
        &mut worker,
        "enroll-ice-2",
        "device.enroll.finish",
        &DeviceEnrollFinish {
            device_id: "device-ice".into(),
            opaque_upload: registration.upload,
        },
    )
    .await?;

    let timestamp = unix_seconds();
    let signature = identity.sign_registration("device-ice", "nonce-ice", timestamp);
    let resposta: Value = request(
        &mut worker,
        "register-ice",
        "device.register",
        &DeviceRegister {
            device_id: "device-ice".into(),
            nonce: "nonce-ice".into(),
            timestamp,
            signature,
        },
    )
    .await?;

    assert_eq!(
        resposta.get("registered").and_then(Value::as_bool),
        Some(true),
        "o register continua registrando: {resposta}"
    );

    let ice = resposta
        .get("ice_servers")
        .and_then(Value::as_array)
        .ok_or("a resposta do register v2 nao trouxe ice_servers")?;
    assert!(
        !ice.is_empty(),
        "com turn_secret configurado, ice_servers tem de vir NAO-VAZIO (DoD do #1133): {resposta}"
    );

    let servidor = &ice[0];
    let username = servidor
        .get("username")
        .and_then(Value::as_str)
        .ok_or("ice_server sem username")?;
    let credential = servidor
        .get("credential")
        .and_then(Value::as_str)
        .ok_or("ice_server sem credential")?;
    assert!(
        servidor
            .get("urls")
            .and_then(Value::as_array)
            .is_some_and(|u| !u.is_empty()),
        "ice_server sem urls: {servidor}"
    );

    // `use-auth-secret` do coturn: username = "{expires_at}:{device_id}".
    let (expires_at, dono) = username
        .split_once(':')
        .ok_or("username fora do formato use-auth-secret")?;
    assert_eq!(dono, "device-ice", "a credencial e do device que registrou");
    let expires_at: u64 = expires_at.parse()?;
    assert!(
        expires_at > unix_seconds(),
        "credencial efemera tem de expirar no FUTURO (expires_at={expires_at})"
    );

    // O ponto do AC: MESMO esquema, sem segundo segredo. Recalculo o HMAC com o
    // segredo que o servidor de teste recebeu e exijo igualdade.
    let mut mac = <Hmac<Sha1> as Mac>::new_from_slice(b"test-turn-secret")?;
    mac.update(username.as_bytes());
    let esperado = BASE64.encode(mac.finalize().into_bytes());
    assert_eq!(
        credential, esperado,
        "a credencial do v2 tem de ser o MESMO HMAC use-auth-secret do v1 — um \
         segundo esquema significaria segredo duplicado (AC do #1133)"
    );

    // E o segredo em si nunca pode atravessar o fio.
    let bruto = serde_json::to_string(&resposta)?;
    assert!(
        !bruto.contains("test-turn-secret"),
        "o turn_secret VAZOU na resposta do register: {bruto}"
    );

    Ok(())
}
