use std::{fmt, sync::Arc, time::Duration};

use futures_util::{SinkExt, StreamExt};
use rustls::{
    DigitallySignedStruct, RootCertStore, SignatureScheme,
    client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier},
    pki_types::{CertificateDer, ServerName, UnixTime},
};
use sha2::{Digest, Sha256};
use tokio::net::TcpStream;
use tokio_tungstenite::{
    Connector, MaybeTlsStream, WebSocketStream, connect_async_tls_with_config,
    tungstenite::{self, Message, protocol::WebSocketConfig},
};
use url::Url;

use crate::{MAX_MESSAGE_BYTES, protocol::Envelope};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

pub type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

#[derive(Clone, Copy, PartialEq, Eq)]
pub struct CertificatePin([u8; 32]);

impl CertificatePin {
    pub fn from_sha256_hex(value: &str) -> Result<Self, TransportError> {
        if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(TransportError::InvalidPin);
        }
        let mut pin = [0_u8; 32];
        for (index, output) in pin.iter_mut().enumerate() {
            let offset = index * 2;
            *output = u8::from_str_radix(&value[offset..offset + 2], 16)
                .map_err(|_| TransportError::InvalidPin)?;
        }
        Ok(Self(pin))
    }

    fn verifies(self, certificate: &CertificateDer<'_>) -> bool {
        let actual: [u8; 32] = Sha256::digest(certificate.as_ref()).into();
        constant_time_eq(&actual, &self.0)
    }
}

impl fmt::Debug for CertificatePin {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("CertificatePin([REDACTED])")
    }
}

#[derive(Debug, thiserror::Error)]
pub enum TransportError {
    #[error("remote endpoint must be an absolute wss:// URL without credentials or fragment")]
    InvalidEndpoint,
    #[error("certificate pin must contain exactly 64 hexadecimal characters")]
    InvalidPin,
    #[error(
        "TLS certificate chain is valid but the leaf certificate does not match the configured pin"
    )]
    PinMismatch,
    #[error("WSS connection timed out")]
    ConnectTimeout,
    #[error("WSS transport failed: {0}")]
    WebSocket(#[from] Box<tungstenite::Error>),
    #[error("only UTF-8 text frames up to 64 KiB are accepted")]
    InvalidFrame,
    #[error("protocol payload could not be encoded: {0}")]
    Encoding(#[from] serde_json::Error),
}

pub struct PinnedWssClient {
    endpoint: Url,
    tls: Arc<rustls::ClientConfig>,
}

impl PinnedWssClient {
    pub fn new(endpoint: &str, pin: CertificatePin) -> Result<Self, TransportError> {
        let endpoint = validate_endpoint(endpoint)?;
        let mut roots = RootCertStore::empty();
        roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let verifier = rustls::client::WebPkiServerVerifier::builder_with_provider(
            Arc::new(roots),
            provider.clone(),
        )
        .build()
        .map_err(|_| TransportError::InvalidEndpoint)?;
        let verifier = Arc::new(PinnedServerVerifier {
            web_pki: verifier,
            pin,
        });
        let tls = rustls::ClientConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .map_err(|_| TransportError::InvalidEndpoint)?
            .dangerous()
            .with_custom_certificate_verifier(verifier)
            .with_no_client_auth();
        Ok(Self {
            endpoint,
            tls: Arc::new(tls),
        })
    }

    pub async fn connect(&self) -> Result<PinnedSocket, TransportError> {
        let config = WebSocketConfig::default()
            .max_message_size(Some(MAX_MESSAGE_BYTES))
            .max_frame_size(Some(MAX_MESSAGE_BYTES));
        let connect = connect_async_tls_with_config(
            self.endpoint.as_str(),
            Some(config),
            true,
            Some(Connector::Rustls(self.tls.clone())),
        );
        let (socket, _) = tokio::time::timeout(CONNECT_TIMEOUT, connect)
            .await
            .map_err(|_| TransportError::ConnectTimeout)?
            .map_err(Box::new)?;
        Ok(PinnedSocket { socket })
    }
}

pub struct PinnedSocket {
    socket: Socket,
}

impl PinnedSocket {
    pub async fn send<T: serde::Serialize>(
        &mut self,
        envelope: &Envelope<T>,
    ) -> Result<(), TransportError> {
        let encoded = serde_json::to_vec(envelope)?;
        if encoded.is_empty() || encoded.len() > MAX_MESSAGE_BYTES {
            return Err(TransportError::InvalidFrame);
        }
        let encoded = String::from_utf8(encoded).map_err(|_| TransportError::InvalidFrame)?;
        self.socket
            .send(Message::Text(encoded.into()))
            .await
            .map_err(Box::new)?;
        Ok(())
    }

    pub async fn receive<T>(&mut self) -> Result<Option<Envelope<T>>, TransportError>
    where
        T: for<'de> serde::Deserialize<'de>,
    {
        loop {
            let Some(frame) = self.socket.next().await else {
                return Ok(None);
            };
            match frame.map_err(Box::new)? {
                Message::Text(text) if !text.is_empty() && text.len() <= MAX_MESSAGE_BYTES => {
                    return serde_json::from_slice(text.as_bytes())
                        .map(Some)
                        .map_err(TransportError::Encoding);
                }
                Message::Ping(payload) => self
                    .socket
                    .send(Message::Pong(payload))
                    .await
                    .map_err(Box::new)?,
                Message::Pong(_) => {}
                Message::Close(_) => return Ok(None),
                Message::Text(_) | Message::Binary(_) | Message::Frame(_) => {
                    return Err(TransportError::InvalidFrame);
                }
            }
        }
    }

    pub async fn close(mut self) -> Result<(), TransportError> {
        self.socket.close(None).await.map_err(Box::new)?;
        Ok(())
    }
}

fn validate_endpoint(value: &str) -> Result<Url, TransportError> {
    let endpoint = Url::parse(value).map_err(|_| TransportError::InvalidEndpoint)?;
    if endpoint.scheme() != "wss"
        || endpoint.host_str().is_none()
        || !endpoint.username().is_empty()
        || endpoint.password().is_some()
        || endpoint.fragment().is_some()
    {
        return Err(TransportError::InvalidEndpoint);
    }
    Ok(endpoint)
}

fn constant_time_eq(left: &[u8; 32], right: &[u8; 32]) -> bool {
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

#[derive(Debug)]
struct PinnedServerVerifier {
    web_pki: Arc<rustls::client::WebPkiServerVerifier>,
    pin: CertificatePin,
}

impl ServerCertVerifier for PinnedServerVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        ocsp_response: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let verified = self.web_pki.verify_server_cert(
            end_entity,
            intermediates,
            server_name,
            ocsp_response,
            now,
        )?;
        if !self.pin.verifies(end_entity) {
            return Err(rustls::Error::General(
                TransportError::PinMismatch.to_string(),
            ));
        }
        Ok(verified)
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        certificate: &CertificateDer<'_>,
        signed: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.web_pki
            .verify_tls12_signature(message, certificate, signed)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        certificate: &CertificateDer<'_>,
        signed: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.web_pki
            .verify_tls13_signature(message, certificate, signed)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.web_pki.supported_verify_schemes()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_strict_wss_endpoint() {
        assert!(validate_endpoint("wss://remote.example/v2/ws").is_ok());
        for invalid in [
            "ws://remote.example/v2/ws",
            "https://remote.example/v2/ws",
            "wss://user:secret@remote.example/v2/ws",
            "wss://remote.example/v2/ws#fragment",
            "/relative",
        ] {
            assert!(validate_endpoint(invalid).is_err(), "accepted {invalid}");
        }
    }

    #[test]
    fn certificate_pin_is_exact_and_redacted() {
        let pin = CertificatePin::from_sha256_hex(
            "951e8037ed380537916c42576d1cd0c4c0efb148e1a5c67b7df5512672e048db",
        )
        .unwrap();
        assert_eq!(format!("{pin:?}"), "CertificatePin([REDACTED])");
        assert!(CertificatePin::from_sha256_hex("951e").is_err());
        assert!(
            CertificatePin::from_sha256_hex(
                "z51e8037ed380537916c42576d1cd0c4c0efb148e1a5c67b7df5512672e048db"
            )
            .is_err()
        );
    }

    #[test]
    fn pin_comparison_rejects_any_different_certificate() {
        let bytes = b"test certificate DER";
        let digest: [u8; 32] = Sha256::digest(bytes).into();
        let pin = CertificatePin(digest);
        let certificate = CertificateDer::from(bytes.as_slice());
        assert!(pin.verifies(&certificate));
        assert!(!CertificatePin([7; 32]).verifies(&certificate));
    }

    #[test]
    fn matching_pin_cannot_replace_web_pki_validation() {
        let invalid_der = b"not a valid X.509 certificate";
        let pin = CertificatePin(Sha256::digest(invalid_der).into());
        let certificate = CertificateDer::from(invalid_der.as_slice());
        assert!(
            pin.verifies(&certificate),
            "test precondition: pin must match"
        );

        let mut roots = RootCertStore::empty();
        roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let web_pki =
            rustls::client::WebPkiServerVerifier::builder_with_provider(Arc::new(roots), provider)
                .build()
                .unwrap();
        let verifier = PinnedServerVerifier { web_pki, pin };
        let server_name = ServerName::try_from("remote.example").unwrap();

        assert!(
            verifier
                .verify_server_cert(
                    &certificate,
                    &[],
                    &server_name,
                    &[],
                    UnixTime::since_unix_epoch(Duration::from_secs(1_700_000_000)),
                )
                .is_err(),
            "matching leaf pin bypassed invalid PKI"
        );
    }
}
