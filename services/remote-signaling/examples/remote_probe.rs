use std::time::Duration;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use ed25519_dalek::{Signature, SigningKey, Verifier, VerifyingKey};
use futures_util::{SinkExt, StreamExt};
use galaxie_remote_signaling::{
    protocol::{ClientMessage, ServerMessage, SignalKind},
    state::attestation_payload,
};
use tokio_tungstenite::{connect_async, tungstenite::Message};

type ProbeSocket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let url = std::env::var("GALAXIE_REMOTE_PROBE_URL")
        .unwrap_or_else(|_| "wss://telemetry.thegalaxie.cloud/remote/v1/ws".to_owned());
    let suffix = uuid::Uuid::new_v4().simple().to_string();
    let alpha_id = format!("probe-alpha-{}", &suffix[..12]);
    let bravo_id = format!("probe-bravo-{}", &suffix[..12]);
    let alpha_key = SigningKey::from_bytes(&rand::random());
    let bravo_key = SigningKey::from_bytes(&rand::random());

    let (mut alpha, _) = connect_async(&url).await?;
    let (mut bravo, _) = connect_async(&url).await?;
    alpha.send(Message::Text("{".into())).await?;
    if !matches!(
        receive(&mut alpha).await?,
        ServerMessage::Error {
            code: galaxie_remote_signaling::protocol::ErrorCode::InvalidFrame,
            ..
        }
    ) {
        return Err("frame malformado nao retornou invalid_frame".into());
    }
    send(
        &mut alpha,
        ClientMessage::Register {
            device_id: alpha_id.clone(),
            public_key: BASE64.encode(alpha_key.verifying_key().as_bytes()),
            nonce: None,
            timestamp: None,
            signature: None,
        },
    )
    .await?;
    let alpha_registration = receive(&mut alpha).await?;
    verify_registration(&alpha_registration)?;

    send(
        &mut bravo,
        ClientMessage::Register {
            device_id: bravo_id.clone(),
            public_key: BASE64.encode(bravo_key.verifying_key().as_bytes()),
            nonce: None,
            timestamp: None,
            signature: None,
        },
    )
    .await?;
    verify_registration(&receive(&mut bravo).await?)?;

    send(
        &mut alpha,
        ClientMessage::CreateAssistedSession {
            ttl_seconds: Some(60),
        },
    )
    .await?;
    let code = match receive(&mut alpha).await? {
        ServerMessage::AssistedSessionCode { code, .. } => code,
        other => return Err(format!("esperava assisted_session_code, recebeu {other:?}").into()),
    };
    send(&mut bravo, ClientMessage::RedeemAssistedSession { code }).await?;
    expect_pair(&receive(&mut alpha).await?, &bravo_id)?;
    expect_pair(&receive(&mut bravo).await?, &alpha_id)?;

    send(
        &mut alpha,
        ClientMessage::Signal {
            peer_id: bravo_id.clone(),
            kind: SignalKind::Offer,
            payload: "v=0\r\no=galaxie-probe 1 1 IN IP4 127.0.0.1".to_owned(),
        },
    )
    .await?;
    expect_signal(&receive(&mut bravo).await?, &alpha_id, SignalKind::Offer)?;

    send(
        &mut bravo,
        ClientMessage::Signal {
            peer_id: alpha_id.clone(),
            kind: SignalKind::Answer,
            payload: "v=0\r\no=galaxie-probe 2 2 IN IP4 127.0.0.1".to_owned(),
        },
    )
    .await?;
    expect_signal(&receive(&mut alpha).await?, &bravo_id, SignalKind::Answer)?;

    send(
        &mut alpha,
        ClientMessage::Signal {
            peer_id: bravo_id,
            kind: SignalKind::IceCandidate,
            payload: "candidate:1 1 UDP 2122260223 192.0.2.1 5000 typ host".to_owned(),
        },
    )
    .await?;
    expect_signal(
        &receive(&mut bravo).await?,
        &alpha_id,
        SignalKind::IceCandidate,
    )?;

    send(&mut alpha, ClientMessage::Heartbeat).await?;
    if !matches!(receive(&mut alpha).await?, ServerMessage::Pong { .. }) {
        return Err("heartbeat nao recebeu pong".into());
    }

    println!("probe_ok wss_tls=yes peers=2 malformed_frame=survived pin=verified attestation=verified code=single_use signaling=offer_answer_ice");
    tokio::time::sleep(Duration::from_millis(20)).await;
    Ok(())
}

async fn send(
    socket: &mut ProbeSocket,
    message: ClientMessage,
) -> Result<(), Box<dyn std::error::Error>> {
    socket
        .send(Message::Text(serde_json::to_string(&message)?.into()))
        .await?;
    Ok(())
}

async fn receive(socket: &mut ProbeSocket) -> Result<ServerMessage, Box<dyn std::error::Error>> {
    let frame = tokio::time::timeout(Duration::from_secs(10), socket.next())
        .await?
        .ok_or_else(|| invalid_data("websocket encerrou"))??;
    let Message::Text(text) = frame else {
        return Err(invalid_data("frame de resposta nao textual").into());
    };
    Ok(serde_json::from_str(&text)?)
}

fn verify_registration(message: &ServerMessage) -> Result<(), Box<dyn std::error::Error>> {
    let ServerMessage::Registered {
        attestation,
        ice_servers,
        ..
    } = message
    else {
        return Err(format!("esperava registered, recebeu {message:?}").into());
    };
    if ice_servers.is_empty() {
        return Err("servidor nao forneceu ICE servers".into());
    }
    let pin: serde_json::Value = serde_json::from_str(include_str!("../server-key-pin.json"))?;
    let expected_key = pin
        .get("publicKey")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| invalid_data("server-key-pin.json invalido"))?;
    if attestation.server_public_key != expected_key {
        return Err("chave do signaling diverge do pin versionado".into());
    }
    let server_key: [u8; 32] = decode_sized(&attestation.server_public_key, 32)?
        .try_into()
        .map_err(|_| invalid_data("server key invalida"))?;
    let peer_key: [u8; 32] = decode_sized(&attestation.peer_public_key, 32)?
        .try_into()
        .map_err(|_| invalid_data("peer key invalida"))?;
    let signature: [u8; 64] = decode_sized(&attestation.signature, 64)?
        .try_into()
        .map_err(|_| invalid_data("assinatura invalida"))?;
    VerifyingKey::from_bytes(&server_key)?.verify(
        &attestation_payload(
            &attestation.device_id,
            &peer_key,
            attestation.issued_at_unix_seconds,
        ),
        &Signature::from_bytes(&signature),
    )?;
    Ok(())
}

fn decode_sized(value: &str, size: usize) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let bytes = BASE64.decode(value)?;
    if bytes.len() != size {
        return Err(invalid_data("valor base64 tem tamanho inesperado").into());
    }
    Ok(bytes)
}

fn expect_pair(message: &ServerMessage, peer: &str) -> Result<(), Box<dyn std::error::Error>> {
    if matches!(message, ServerMessage::SessionPaired { peer_id } if peer_id == peer) {
        Ok(())
    } else {
        Err(format!("pareamento inesperado: {message:?}").into())
    }
}

fn expect_signal(
    message: &ServerMessage,
    peer: &str,
    expected_kind: SignalKind,
) -> Result<(), Box<dyn std::error::Error>> {
    if matches!(
        message,
        ServerMessage::Signal { peer_id, kind, .. }
            if peer_id == peer && *kind == expected_kind
    ) {
        Ok(())
    } else {
        Err(format!("signaling inesperado: {message:?}").into())
    }
}

fn invalid_data(message: &str) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::InvalidData, message)
}
