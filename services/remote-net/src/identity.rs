use base64::{Engine as _, engine::general_purpose::STANDARD};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand::rngs::OsRng;
use zeroize::{Zeroize, Zeroizing};

const DOMAIN: &[u8] = b"Galaxie.Remote.Net.v2/device-register\0";
const MAX_CLOCK_SKEW_SECONDS: u64 = 60;

pub struct DeviceIdentity(SigningKey);

impl DeviceIdentity {
    pub fn generate() -> Self {
        Self(SigningKey::generate(&mut OsRng))
    }

    pub fn public_key_base64(&self) -> String {
        STANDARD.encode(self.0.verifying_key().to_bytes())
    }

    pub fn secret_bytes(&self) -> Zeroizing<Vec<u8>> {
        Zeroizing::new(self.0.to_bytes().to_vec())
    }

    pub fn from_secret(mut bytes: Zeroizing<Vec<u8>>) -> Result<Self, IdentityError> {
        let key: [u8; 32] = bytes
            .as_slice()
            .try_into()
            .map_err(|_| IdentityError::Encoding)?;
        bytes.zeroize();
        Ok(Self(SigningKey::from_bytes(&key)))
    }

    pub fn sign_registration(&self, device_id: &str, nonce: &str, timestamp: u64) -> String {
        STANDARD.encode(
            self.0
                .sign(&registration_bytes(device_id, nonce, timestamp))
                .to_bytes(),
        )
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum IdentityError {
    #[error("device proof encoding is invalid")]
    Encoding,
    #[error("device proof timestamp is outside the accepted window")]
    Timestamp,
    #[error("device proof signature is invalid")]
    Signature,
}

pub fn verify_registration(
    public_key: &str,
    device_id: &str,
    nonce: &str,
    timestamp: u64,
    now: u64,
    signature: &str,
) -> Result<(), IdentityError> {
    if timestamp.abs_diff(now) > MAX_CLOCK_SKEW_SECONDS {
        return Err(IdentityError::Timestamp);
    }
    let key_bytes: [u8; 32] = STANDARD
        .decode(public_key)
        .map_err(|_| IdentityError::Encoding)?
        .try_into()
        .map_err(|_| IdentityError::Encoding)?;
    let signature_bytes: [u8; 64] = STANDARD
        .decode(signature)
        .map_err(|_| IdentityError::Encoding)?
        .try_into()
        .map_err(|_| IdentityError::Encoding)?;
    let key = VerifyingKey::from_bytes(&key_bytes).map_err(|_| IdentityError::Encoding)?;
    key.verify(
        &registration_bytes(device_id, nonce, timestamp),
        &Signature::from_bytes(&signature_bytes),
    )
    .map_err(|_| IdentityError::Signature)
}

fn registration_bytes(device_id: &str, nonce: &str, timestamp: u64) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(DOMAIN.len() + device_id.len() + nonce.len() + 24);
    bytes.extend_from_slice(DOMAIN);
    append_field(&mut bytes, device_id.as_bytes());
    append_field(&mut bytes, nonce.as_bytes());
    bytes.extend_from_slice(&timestamp.to_le_bytes());
    bytes
}

fn append_field(target: &mut Vec<u8>, field: &[u8]) {
    target.extend_from_slice(&(field.len() as u64).to_le_bytes());
    target.extend_from_slice(field);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_proves_key_possession() {
        let identity = DeviceIdentity::generate();
        let signature = identity.sign_registration("device-1", "nonce-1", 100);
        assert!(
            verify_registration(
                &identity.public_key_base64(),
                "device-1",
                "nonce-1",
                100,
                120,
                &signature,
            )
            .is_ok()
        );
        assert_eq!(
            verify_registration(
                &identity.public_key_base64(),
                "device-2",
                "nonce-1",
                100,
                120,
                &signature,
            ),
            Err(IdentityError::Signature)
        );
    }

    #[test]
    fn stale_proof_is_rejected() {
        let identity = DeviceIdentity::generate();
        let signature = identity.sign_registration("device-1", "nonce-1", 100);
        assert_eq!(
            verify_registration(
                &identity.public_key_base64(),
                "device-1",
                "nonce-1",
                100,
                200,
                &signature,
            ),
            Err(IdentityError::Timestamp)
        );
    }
}
