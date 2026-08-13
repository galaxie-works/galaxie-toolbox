use std::collections::HashMap;

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};

use crate::protocol::Capabilities;

const DOMAIN: &[u8] = b"Galaxie.Remote.Net.v2/session-ticket\0";

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TicketClaims {
    pub jti: String,
    pub session_id: String,
    pub device_id: String,
    pub controller_id: String,
    pub owner_id: String,
    pub org_id: String,
    pub device_nonce: String,
    pub controller_nonce: String,
    pub capabilities: Capabilities,
    pub issued_at: u64,
    pub expires_at: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SignedTicket {
    claims: String,
    signature: String,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum TicketError {
    #[error("ticket encoding is invalid")]
    Encoding,
    #[error("ticket signature is invalid")]
    Signature,
    #[error("ticket binding is invalid")]
    Binding,
    #[error("ticket expired or has an invalid time window")]
    Expired,
    #[error("ticket was already consumed")]
    Replay,
}

pub fn issue_ticket(key: &SigningKey, claims: &TicketClaims) -> Result<String, TicketError> {
    validate_times(claims, claims.issued_at)?;
    let claims_bytes = serde_json::to_vec(claims).map_err(|_| TicketError::Encoding)?;
    let mut signed = Vec::with_capacity(DOMAIN.len() + claims_bytes.len());
    signed.extend_from_slice(DOMAIN);
    signed.extend_from_slice(&claims_bytes);
    let ticket = SignedTicket {
        claims: URL_SAFE_NO_PAD.encode(claims_bytes),
        signature: URL_SAFE_NO_PAD.encode(key.sign(&signed).to_bytes()),
    };
    let bytes = serde_json::to_vec(&ticket).map_err(|_| TicketError::Encoding)?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

pub struct TicketVerifier {
    key: VerifyingKey,
    consumed: HashMap<String, u64>,
}

pub struct ExpectedTicket<'a> {
    pub device_id: &'a str,
    pub controller_id: &'a str,
    pub owner_id: &'a str,
    pub org_id: &'a str,
    pub device_nonce: &'a str,
    pub controller_nonce: &'a str,
    pub capabilities: &'a Capabilities,
}

impl TicketVerifier {
    pub fn new(key: VerifyingKey) -> Self {
        Self {
            key,
            consumed: HashMap::new(),
        }
    }

    pub fn verify_and_consume(
        &mut self,
        encoded: &str,
        now: u64,
        expected: &ExpectedTicket<'_>,
    ) -> Result<TicketClaims, TicketError> {
        let claims = self.verify_and_consume_claims(encoded, now)?;
        if claims.device_id != expected.device_id
            || claims.controller_id != expected.controller_id
            || claims.owner_id != expected.owner_id
            || claims.org_id != expected.org_id
            || claims.device_nonce != expected.device_nonce
            || claims.controller_nonce != expected.controller_nonce
            || claims.capabilities != *expected.capabilities
        {
            return Err(TicketError::Binding);
        }
        Ok(claims)
    }

    pub fn verify_and_consume_claims(
        &mut self,
        encoded: &str,
        now: u64,
    ) -> Result<TicketClaims, TicketError> {
        self.consumed.retain(|_, expiry| *expiry >= now);
        let ticket_bytes = URL_SAFE_NO_PAD
            .decode(encoded)
            .map_err(|_| TicketError::Encoding)?;
        let ticket: SignedTicket =
            serde_json::from_slice(&ticket_bytes).map_err(|_| TicketError::Encoding)?;
        let claims_bytes = URL_SAFE_NO_PAD
            .decode(ticket.claims)
            .map_err(|_| TicketError::Encoding)?;
        let signature_bytes: [u8; 64] = URL_SAFE_NO_PAD
            .decode(ticket.signature)
            .map_err(|_| TicketError::Encoding)?
            .try_into()
            .map_err(|_| TicketError::Encoding)?;
        let mut signed = Vec::with_capacity(DOMAIN.len() + claims_bytes.len());
        signed.extend_from_slice(DOMAIN);
        signed.extend_from_slice(&claims_bytes);
        self.key
            .verify(&signed, &Signature::from_bytes(&signature_bytes))
            .map_err(|_| TicketError::Signature)?;
        let claims: TicketClaims =
            serde_json::from_slice(&claims_bytes).map_err(|_| TicketError::Encoding)?;
        validate_times(&claims, now)?;
        if self.consumed.contains_key(&claims.jti) {
            return Err(TicketError::Replay);
        }
        self.consumed.insert(claims.jti.clone(), claims.expires_at);
        Ok(claims)
    }

    pub(crate) fn consumed_tickets(&self) -> &HashMap<String, u64> {
        &self.consumed
    }

    pub(crate) fn restore_consumed_tickets(&mut self, consumed: HashMap<String, u64>) {
        self.consumed = consumed;
    }
}

fn validate_times(claims: &TicketClaims, now: u64) -> Result<(), TicketError> {
    const MAX_TTL_SECONDS: u64 = 120;
    if claims.jti.is_empty()
        || !claims_are_safe(claims)
        || claims.expires_at <= claims.issued_at
        || claims.expires_at - claims.issued_at > MAX_TTL_SECONDS
        || now < claims.issued_at
        || now >= claims.expires_at
    {
        return Err(TicketError::Expired);
    }
    Ok(())
}

fn claims_are_safe(claims: &TicketClaims) -> bool {
    [
        &claims.jti,
        &claims.session_id,
        &claims.device_id,
        &claims.controller_id,
        &claims.owner_id,
        &claims.org_id,
        &claims.device_nonce,
        &claims.controller_nonce,
    ]
    .into_iter()
    .all(|value| {
        (1..=128).contains(&value.len())
            && value.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':' | b'@')
            })
    })
}

#[cfg(test)]
mod tests {
    use ed25519_dalek::SigningKey;
    use rand::rngs::OsRng;

    use super::*;

    fn claims() -> TicketClaims {
        TicketClaims {
            jti: "ticket-1".into(),
            session_id: "session-1".into(),
            device_id: "device-1".into(),
            controller_id: "controller-1".into(),
            owner_id: "owner-1".into(),
            org_id: "org-1".into(),
            device_nonce: "device-nonce".into(),
            controller_nonce: "controller-nonce".into(),
            capabilities: Capabilities {
                screen: true,
                ..Default::default()
            },
            issued_at: 100,
            expires_at: 160,
        }
    }

    fn expected<'a>(claims: &'a TicketClaims) -> ExpectedTicket<'a> {
        ExpectedTicket {
            device_id: &claims.device_id,
            controller_id: &claims.controller_id,
            owner_id: &claims.owner_id,
            org_id: &claims.org_id,
            device_nonce: &claims.device_nonce,
            controller_nonce: &claims.controller_nonce,
            capabilities: &claims.capabilities,
        }
    }

    #[test]
    fn ticket_is_bound_and_single_use() {
        let key = SigningKey::generate(&mut OsRng);
        let claims = claims();
        let ticket = issue_ticket(&key, &claims).unwrap();
        let mut verifier = TicketVerifier::new(key.verifying_key());
        assert!(
            verifier
                .verify_and_consume(&ticket, 120, &expected(&claims))
                .is_ok()
        );
        assert_eq!(
            verifier.verify_and_consume(&ticket, 120, &expected(&claims)),
            Err(TicketError::Replay)
        );
    }

    #[test]
    fn wrong_device_fails_closed() {
        let key = SigningKey::generate(&mut OsRng);
        let claims = claims();
        let ticket = issue_ticket(&key, &claims).unwrap();
        let mut verifier = TicketVerifier::new(key.verifying_key());
        let mut wrong = claims.clone();
        wrong.device_id = "other".into();
        assert_eq!(
            verifier.verify_and_consume(&ticket, 120, &expected(&wrong)),
            Err(TicketError::Binding)
        );
    }

    #[test]
    fn every_authorization_claim_is_bound() {
        let key = SigningKey::generate(&mut OsRng);
        let original = claims();
        let ticket = issue_ticket(&key, &original).unwrap();
        let variants = [
            ("controller", {
                let mut value = original.clone();
                value.controller_id = "other".into();
                value
            }),
            ("owner", {
                let mut value = original.clone();
                value.owner_id = "other".into();
                value
            }),
            ("org", {
                let mut value = original.clone();
                value.org_id = "other".into();
                value
            }),
            ("controller nonce", {
                let mut value = original.clone();
                value.controller_nonce = "other".into();
                value
            }),
            ("capabilities", {
                let mut value = original.clone();
                value.capabilities.input = true;
                value
            }),
        ];
        for (field, wrong) in variants {
            let mut verifier = TicketVerifier::new(key.verifying_key());
            assert_eq!(
                verifier.verify_and_consume(&ticket, 120, &expected(&wrong)),
                Err(TicketError::Binding),
                "accepted changed {field}"
            );
        }
    }

    #[test]
    fn expiry_is_exclusive_and_claims_reject_controls() {
        let key = SigningKey::generate(&mut OsRng);
        let original = claims();
        let ticket = issue_ticket(&key, &original).unwrap();
        let mut verifier = TicketVerifier::new(key.verifying_key());
        assert_eq!(
            verifier.verify_and_consume(&ticket, original.expires_at, &expected(&original)),
            Err(TicketError::Expired)
        );
        let mut invalid = original;
        invalid.session_id = "session\0bad".into();
        assert_eq!(issue_ticket(&key, &invalid), Err(TicketError::Expired));
    }
}
