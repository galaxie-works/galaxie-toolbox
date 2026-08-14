use std::{net::SocketAddr, time::Duration};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use ed25519_dalek::{Signature, SigningKey, Verifier, VerifyingKey};
use futures_util::{SinkExt, StreamExt};
use galaxie_remote_signaling::{
    app,
    protocol::{ClientMessage, ErrorCode, ServerMessage, SignalKind},
    state::{attestation_payload, AppState},
};
use tokio::net::TcpListener;
use tokio_tungstenite::{connect_async, tungstenite::Message};

type TestSocket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

#[tokio::test]
async fn dois_peers_pareiam_assinam_chave_e_trocam_sdp_ice(
) -> Result<(), Box<dyn std::error::Error>> {
    let (address, state) = spawn_server(120, Duration::from_secs(60)).await?;
    let (mut alpha, _) = connect_async(format!("ws://{address}/v1/ws")).await?;
    let (mut bravo, _) = connect_async(format!("ws://{address}/v1/ws")).await?;

    let alpha_key = SigningKey::from_bytes(&[11_u8; 32]);
    let bravo_key = SigningKey::from_bytes(&[22_u8; 32]);
    register(&mut alpha, "device-alpha", &alpha_key).await?;
    let alpha_registered = recv_server(&mut alpha).await?;
    let attestation = match alpha_registered {
        ServerMessage::Registered { attestation, .. } => attestation,
        other => return Err(format!("esperava registered, recebeu {other:?}").into()),
    };
    verify_attestation(&attestation)?;
    assert_eq!(
        attestation.server_public_key,
        state.server_public_key_base64()
    );

    register(&mut bravo, "device-bravo", &bravo_key).await?;
    assert!(matches!(
        recv_server(&mut bravo).await?,
        ServerMessage::Registered { .. }
    ));

    send_client(
        &mut alpha,
        &ClientMessage::CreateAssistedSession {
            ttl_seconds: Some(60),
        },
    )
    .await?;
    let code = match recv_server(&mut alpha).await? {
        ServerMessage::AssistedSessionCode { code, .. } => code,
        other => return Err(format!("esperava codigo, recebeu {other:?}").into()),
    };

    send_client(
        &mut bravo,
        &ClientMessage::RedeemAssistedSession { code: code.clone() },
    )
    .await?;
    assert!(matches!(
        recv_server(&mut alpha).await?,
        ServerMessage::SessionPaired { peer_id } if peer_id == "device-bravo"
    ));
    assert!(matches!(
        recv_server(&mut bravo).await?,
        ServerMessage::SessionPaired { peer_id } if peer_id == "device-alpha"
    ));

    send_client(
        &mut alpha,
        &ClientMessage::Signal {
            peer_id: "device-bravo".to_owned(),
            kind: SignalKind::Offer,
            payload: "v=0\r\no=galaxie 1 1 IN IP4 127.0.0.1".to_owned(),
        },
    )
    .await?;
    assert!(matches!(
        recv_server(&mut bravo).await?,
        ServerMessage::Signal { peer_id, kind: SignalKind::Offer, payload }
            if peer_id == "device-alpha" && payload.starts_with("v=0")
    ));

    send_client(
        &mut bravo,
        &ClientMessage::Signal {
            peer_id: "device-alpha".to_owned(),
            kind: SignalKind::IceCandidate,
            payload: "candidate:1 1 UDP 2122260223 192.0.2.1 5000 typ host".to_owned(),
        },
    )
    .await?;
    assert!(matches!(
        recv_server(&mut alpha).await?,
        ServerMessage::Signal { peer_id, kind: SignalKind::IceCandidate, .. }
            if peer_id == "device-bravo"
    ));

    let (mut charlie, _) = connect_async(format!("ws://{address}/v1/ws")).await?;
    register(
        &mut charlie,
        "device-charlie",
        &SigningKey::from_bytes(&[33_u8; 32]),
    )
    .await?;
    let _ = recv_server(&mut charlie).await?;
    send_client(&mut charlie, &ClientMessage::RedeemAssistedSession { code }).await?;
    assert!(matches!(
        recv_server(&mut charlie).await?,
        ServerMessage::Error {
            code: ErrorCode::InvalidCode,
            ..
        }
    ));

    Ok(())
}

#[tokio::test]
async fn frame_malformado_nao_derruba_conexao_e_rate_limit_responde(
) -> Result<(), Box<dyn std::error::Error>> {
    let (address, _) = spawn_server(3, Duration::from_secs(60)).await?;
    let (mut socket, _) = connect_async(format!("ws://{address}/v1/ws")).await?;

    socket.send(Message::Text("{".into())).await?;
    assert!(matches!(
        recv_server(&mut socket).await?,
        ServerMessage::Error {
            code: ErrorCode::InvalidFrame,
            ..
        }
    ));

    register(
        &mut socket,
        "device-rate",
        &SigningKey::from_bytes(&[44_u8; 32]),
    )
    .await?;
    assert!(matches!(
        recv_server(&mut socket).await?,
        ServerMessage::Registered { .. }
    ));

    send_client(&mut socket, &ClientMessage::Heartbeat).await?;
    assert!(matches!(
        recv_server(&mut socket).await?,
        ServerMessage::Error {
            code: ErrorCode::RateLimited,
            ..
        }
    ));

    Ok(())
}

#[tokio::test]
async fn codigo_expira() -> Result<(), Box<dyn std::error::Error>> {
    let (address, _) = spawn_server(120, Duration::from_millis(40)).await?;
    let (mut alpha, _) = connect_async(format!("ws://{address}/v1/ws")).await?;
    let (mut bravo, _) = connect_async(format!("ws://{address}/v1/ws")).await?;
    register(
        &mut alpha,
        "device-expire-a",
        &SigningKey::from_bytes(&[55_u8; 32]),
    )
    .await?;
    let _ = recv_server(&mut alpha).await?;
    register(
        &mut bravo,
        "device-expire-b",
        &SigningKey::from_bytes(&[66_u8; 32]),
    )
    .await?;
    let _ = recv_server(&mut bravo).await?;
    send_client(
        &mut alpha,
        &ClientMessage::CreateAssistedSession { ttl_seconds: None },
    )
    .await?;
    let code = match recv_server(&mut alpha).await? {
        ServerMessage::AssistedSessionCode { code, .. } => code,
        other => return Err(format!("esperava codigo, recebeu {other:?}").into()),
    };
    tokio::time::sleep(Duration::from_millis(60)).await;
    send_client(&mut bravo, &ClientMessage::RedeemAssistedSession { code }).await?;
    assert!(matches!(
        recv_server(&mut bravo).await?,
        ServerMessage::Error {
            code: ErrorCode::CodeExpired,
            ..
        }
    ));
    Ok(())
}

async fn spawn_server(
    rate_limit: usize,
    code_ttl: Duration,
) -> Result<(SocketAddr, AppState), Box<dyn std::error::Error>> {
    let state = AppState::new(
        SigningKey::from_bytes(&[7_u8; 32]),
        b"test-turn-secret".to_vec(),
        vec!["turn:127.0.0.1:3478?transport=udp".to_owned()],
        Duration::from_secs(3600),
        code_ttl,
        code_ttl.max(Duration::from_secs(30)),
        rate_limit,
        Duration::from_secs(60),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let test_state = state.clone();
    tokio::spawn(async move {
        let result = axum::serve(
            listener,
            app(test_state).into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await;
        if let Err(error) = result {
            eprintln!("test server error: {error}");
        }
    });
    Ok((address, state))
}

async fn register(
    socket: &mut TestSocket,
    device_id: &str,
    key: &SigningKey,
) -> Result<(), Box<dyn std::error::Error>> {
    send_client(
        socket,
        &ClientMessage::Register {
            device_id: device_id.to_owned(),
            public_key: BASE64.encode(key.verifying_key().as_bytes()),
        },
    )
    .await
}

async fn send_client(
    socket: &mut TestSocket,
    message: &ClientMessage,
) -> Result<(), Box<dyn std::error::Error>> {
    socket
        .send(Message::Text(serde_json::to_string(message)?.into()))
        .await?;
    Ok(())
}

async fn recv_server(socket: &mut TestSocket) -> Result<ServerMessage, Box<dyn std::error::Error>> {
    let Some(frame) = socket.next().await else {
        return Err("websocket encerrou sem resposta".into());
    };
    let frame = frame?;
    let Message::Text(text) = frame else {
        return Err("resposta nao textual".into());
    };
    Ok(serde_json::from_str(&text)?)
}

fn verify_attestation(
    attestation: &galaxie_remote_signaling::protocol::KeyAttestation,
) -> Result<(), Box<dyn std::error::Error>> {
    let server_key: [u8; 32] = BASE64
        .decode(&attestation.server_public_key)?
        .try_into()
        .map_err(|_| invalid_data("server key precisa ter 32 bytes"))?;
    let peer_key: [u8; 32] = BASE64
        .decode(&attestation.peer_public_key)?
        .try_into()
        .map_err(|_| invalid_data("peer key precisa ter 32 bytes"))?;
    let signature: [u8; 64] = BASE64
        .decode(&attestation.signature)?
        .try_into()
        .map_err(|_| invalid_data("assinatura precisa ter 64 bytes"))?;
    let verifying_key = VerifyingKey::from_bytes(&server_key)?;
    let signature = Signature::from_bytes(&signature);
    verifying_key.verify(
        &attestation_payload(
            &attestation.device_id,
            &peer_key,
            attestation.issued_at_unix_seconds,
        ),
        &signature,
    )?;
    Ok(())
}

fn invalid_data(message: &str) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::InvalidData, message)
}
