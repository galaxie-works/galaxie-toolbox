use std::collections::HashMap;

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};

use crate::protocol::Capabilities;

const DOMAIN: &[u8] = b"Galaxie.Remote.Net.v2/session-ticket\0";
// #1295: domínio SEPARADO do ticket de sessão (S8) — um ticket de matrícula NUNCA
// pode ser aceito como ticket de sessão (nem o inverso), mesmo assinado pela mesma
// chave do servidor. A troca de domínio garante que a assinatura não cruza os fluxos.
const ENROLL_DOMAIN: &[u8] = b"Galaxie.Remote.Net.v2/enroll-ticket\0";

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

    // #1437 — snapshot do anti-replay (#1295): caller de producao so em `authority.rs`
    // (feature `authority`), fora do build default. Sem uso em teste.
    #[cfg(feature = "authority")]
    pub(crate) fn consumed_tickets(&self) -> &HashMap<String, u64> {
        &self.consumed
    }

    #[cfg(feature = "authority")]
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
    .all(|value| is_safe_ticket_field(value))
}

fn is_safe_ticket_field(value: &str) -> bool {
    (1..=128).contains(&value.len())
        && value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':' | b'@')
        })
}

// ---------------------------------------------------------------------------
// #1295 — Ticket de MATRÍCULA (enrollment). Espelha o ticket de sessão (S8), mas:
//   * domínio de assinatura próprio (`ENROLL_DOMAIN`) — não cruza com sessão;
//   * carrega owner_id/org_id + as capabilities de POLÍTICA (decididas na cunhagem,
//     onde a identidade M365 é conhecida) — o `/v2/ws` só valida, nunca confia no wire;
//   * amarrado ao `device_id`, uso único (jti consumido) e TTL curto.
// A cunhagem (`issue_enrollment_ticket`) mora na superfície autenticada do app; o
// handler do signaling usa só o `EnrollmentTicketVerifier`.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnrollmentTicketClaims {
    pub jti: String,
    pub device_id: String,
    pub owner_id: String,
    pub org_id: String,
    pub capabilities: Capabilities,
    pub issued_at: u64,
    pub expires_at: u64,
}

pub fn issue_enrollment_ticket(
    key: &SigningKey,
    claims: &EnrollmentTicketClaims,
) -> Result<String, TicketError> {
    validate_enrollment_times(claims, claims.issued_at)?;
    let claims_bytes = serde_json::to_vec(claims).map_err(|_| TicketError::Encoding)?;
    let mut signed = Vec::with_capacity(ENROLL_DOMAIN.len() + claims_bytes.len());
    signed.extend_from_slice(ENROLL_DOMAIN);
    signed.extend_from_slice(&claims_bytes);
    let ticket = SignedTicket {
        claims: URL_SAFE_NO_PAD.encode(claims_bytes),
        signature: URL_SAFE_NO_PAD.encode(key.sign(&signed).to_bytes()),
    };
    let bytes = serde_json::to_vec(&ticket).map_err(|_| TicketError::Encoding)?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

pub struct EnrollmentTicketVerifier {
    key: VerifyingKey,
    consumed: HashMap<String, u64>,
}

impl EnrollmentTicketVerifier {
    pub fn new(key: VerifyingKey) -> Self {
        Self {
            key,
            consumed: HashMap::new(),
        }
    }

    /// Valida assinatura + tempo + binding ao `device_id` e CONSOME o jti (uso único).
    /// Fail-closed: qualquer divergência → erro tipado, nada é consumido de forma que
    /// permita reuso posterior de um ticket já aceito.
    pub fn verify_and_consume(
        &mut self,
        encoded: &str,
        expected_device_id: &str,
        now: u64,
    ) -> Result<EnrollmentTicketClaims, TicketError> {
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
        let mut signed = Vec::with_capacity(ENROLL_DOMAIN.len() + claims_bytes.len());
        signed.extend_from_slice(ENROLL_DOMAIN);
        signed.extend_from_slice(&claims_bytes);
        self.key
            .verify(&signed, &Signature::from_bytes(&signature_bytes))
            .map_err(|_| TicketError::Signature)?;
        let claims: EnrollmentTicketClaims =
            serde_json::from_slice(&claims_bytes).map_err(|_| TicketError::Encoding)?;
        validate_enrollment_times(&claims, now)?;
        if claims.device_id != expected_device_id {
            return Err(TicketError::Binding);
        }
        if self.consumed.contains_key(&claims.jti) {
            return Err(TicketError::Replay);
        }
        self.consumed.insert(claims.jti.clone(), claims.expires_at);
        Ok(claims)
    }

    #[cfg(any(feature = "authority", test))]
    pub(crate) fn consumed_tickets(&self) -> &HashMap<String, u64> {
        &self.consumed
    }

    #[cfg(feature = "authority")]
    pub(crate) fn restore_consumed_tickets(&mut self, consumed: HashMap<String, u64>) {
        self.consumed = consumed;
    }
}

/// #1295 — teto de validade de um ticket de MATRICULA.
///
/// O desenho do `altair` lista tres propriedades que impedem o ticket de virar
/// credencial portatil: uso unico, binding ao `device_id` e **TTL curto**. As
/// duas primeiras tinham guarda; esta nao tinha, e a `lumen` provou (M7: cunhagem
/// de 1 h + teto de 1 ano, suites verdes).
///
/// Sai de dentro da funcao para ser observavel: o invariante abaixo e o teste
/// do modulo dependem de poder LER o valor.
pub(crate) const MAX_ENROLLMENT_TTL_SECONDS: u64 = 120;

// Invariante em COMPILE-TIME: subir o teto quebra o build, nao um teste que
// alguem pode nao rodar. `assert!` em contexto const e avaliado pelo compilador.
const _: () = assert!(
    MAX_ENROLLMENT_TTL_SECONDS <= 120,
    "teto de TTL do ticket de matricula nao pode passar de 120s (#1295)"
);

fn validate_enrollment_times(claims: &EnrollmentTicketClaims, now: u64) -> Result<(), TicketError> {
    if claims.jti.is_empty()
        || !enrollment_claims_are_safe(claims)
        || claims.expires_at <= claims.issued_at
        || claims.expires_at - claims.issued_at > MAX_ENROLLMENT_TTL_SECONDS
        || now < claims.issued_at
        || now >= claims.expires_at
    {
        return Err(TicketError::Expired);
    }
    Ok(())
}

fn enrollment_claims_are_safe(claims: &EnrollmentTicketClaims) -> bool {
    [&claims.jti, &claims.device_id, &claims.owner_id, &claims.org_id]
        .into_iter()
        .all(|value| is_safe_ticket_field(value))
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

    // ---- #1295: enrollment ticket primitive ----

    /// Assina claims de matricula com a chave do servidor **sem** a validacao do
    /// emissor. Existe para exercitar o VERIFICADOR isoladamente: o unico caminho
    /// publico ate ele passa pelo `issue_enrollment_ticket`, que ja recusa TTL
    /// acima do teto — e um teste que so consegue construir entradas validas nao
    /// prova recusa nenhuma.
    fn assinar_enrollment_sem_validar(key: &SigningKey, claims: &EnrollmentTicketClaims) -> String {
        let claims_bytes = serde_json::to_vec(claims).unwrap();
        let mut signed = Vec::with_capacity(ENROLL_DOMAIN.len() + claims_bytes.len());
        signed.extend_from_slice(ENROLL_DOMAIN);
        signed.extend_from_slice(&claims_bytes);
        let ticket = SignedTicket {
            claims: URL_SAFE_NO_PAD.encode(claims_bytes),
            signature: URL_SAFE_NO_PAD.encode(key.sign(&signed).to_bytes()),
        };
        URL_SAFE_NO_PAD.encode(serde_json::to_vec(&ticket).unwrap())
    }

    fn enrollment_claims() -> EnrollmentTicketClaims {
        EnrollmentTicketClaims {
            jti: "enroll-jti-1".into(),
            device_id: "device-1".into(),
            owner_id: "owner-1".into(),
            org_id: "org-1".into(),
            capabilities: Capabilities {
                screen: true,
                input: true,
                ..Default::default()
            },
            issued_at: 100,
            expires_at: 160,
        }
    }

    #[test]
    fn enrollment_ticket_is_bound_to_device_and_single_use() {
        let key = SigningKey::generate(&mut OsRng);
        let claims = enrollment_claims();
        let ticket = issue_enrollment_ticket(&key, &claims).unwrap();
        let mut verifier = EnrollmentTicketVerifier::new(key.verifying_key());
        assert!(
            verifier
                .verify_and_consume(&ticket, "device-1", 120)
                .is_ok()
        );
        // Reuso do MESMO ticket → replay.
        assert_eq!(
            verifier.verify_and_consume(&ticket, "device-1", 120),
            Err(TicketError::Replay)
        );
    }

    #[test]
    fn enrollment_ticket_rejects_wrong_device_and_expiry() {
        let key = SigningKey::generate(&mut OsRng);
        let claims = enrollment_claims();
        let ticket = issue_enrollment_ticket(&key, &claims).unwrap();
        let mut verifier = EnrollmentTicketVerifier::new(key.verifying_key());
        // device_id divergente → binding, sem consumir.
        assert_eq!(
            verifier.verify_and_consume(&ticket, "device-2", 120),
            Err(TicketError::Binding)
        );
        // expirado (expires_at exclusivo).
        assert_eq!(
            verifier.verify_and_consume(&ticket, "device-1", claims.expires_at),
            Err(TicketError::Expired)
        );
    }

/// #1295 (2ª volta) — **TETO** de TTL do ticket de matrícula.
    ///
    /// A `lumen` mostrou que *expiração aplicada* ≠ *TTL limitado*: o M7 dela
    /// (cunhagem de 1 h + teto de 1 ano) deixou as duas suítes verdes. O ticket
    /// virava uma credencial de uma hora e **nada no repo reclamava**.
    ///
    /// Aqui o ticket é **assinado com a chave do servidor** — não é forjado por
    /// terceiro. É o cenário que interessa: quem cunha é o servidor, e mesmo
    /// assim o verificador precisa recusar TTL acima do teto. Sem isso, afrouxar
    /// a cunhagem basta para estender a credencial.
    #[test]
    fn enrollment_ticket_acima_do_teto_de_ttl_e_rejeitado() {
        let key = SigningKey::generate(&mut OsRng);
        let mut claims = enrollment_claims();
        claims.issued_at = 100;
        claims.expires_at = 100 + MAX_ENROLLMENT_TTL_SECONDS + 1; // 1s alem do teto

        // Achado desta volta: `issue_enrollment_ticket` TAMBEM recusa cunhar acima
        // do teto — ha duas camadas. Afirmo as duas: o emissor recusa, e o
        // verificador recusa por conta propria (assinando a mao com a chave do
        // servidor). Se um dia o emissor afrouxar, o verificador e a rede de baixo.
        assert_eq!(
            issue_enrollment_ticket(&key, &claims),
            Err(TicketError::Expired),
            "o emissor tem de recusar cunhar acima do teto",
        );
        let ticket = assinar_enrollment_sem_validar(&key, &claims);
        let mut verifier = EnrollmentTicketVerifier::new(key.verifying_key());

        assert_eq!(
            verifier.verify_and_consume(&ticket, "device-1", claims.issued_at + 1),
            Err(TicketError::Expired),
            "ticket assinado pelo SERVIDOR com TTL acima do teto foi aceito — \
             era o M7 da lumen (cunhagem longa passa despercebida)",
        );
        assert!(
            verifier.consumed_tickets().is_empty(),
            "ticket recusado NAO pode consumir o jti (senao vira DoS de matricula)",
        );
    }

    /// Par positivo: exatamente NO teto continua valendo. Sem ele, o teste acima
    /// passaria mesmo se o verificador recusasse qualquer TTL — e aí a matrícula
    /// legítima quebraria sem ninguém ver.
    #[test]
    fn enrollment_ticket_exatamente_no_teto_e_aceito() {
        let key = SigningKey::generate(&mut OsRng);
        let mut claims = enrollment_claims();
        claims.issued_at = 100;
        claims.expires_at = 100 + MAX_ENROLLMENT_TTL_SECONDS;

        let ticket = issue_enrollment_ticket(&key, &claims).unwrap();
        let mut verifier = EnrollmentTicketVerifier::new(key.verifying_key());

        assert!(
            verifier
                .verify_and_consume(&ticket, "device-1", claims.issued_at + 1)
                .is_ok(),
            "TTL no limite tem de passar — teto e limite, nao proibicao",
        );
    }

    // NOTA (#1295): aqui existia um teste `teto_de_ttl_de_matricula_permanece_curto`
    // que afirmava `MAX_ENROLLMENT_TTL_SECONDS <= 120`. O clippy o reprovou com
    // `assertions_on_constants` — e com razao: comparar duas constantes em runtime
    // nao prova nada que o `const _: () = assert!(...)` la em cima ja nao garanta
    // em COMPILE-TIME. Manter exigiria um `#[allow]` para calar um lint correto.
    // O guarda do teto e o const-assert; os testes abaixo guardam o COMPORTAMENTO.

    #[test]
    fn enrollment_ticket_with_wrong_signature_is_rejected() {
        // #1295 (revisão adversarial do Mizar): a assinatura do servidor é a base do
        // esquema inteiro. Um ticket BEM-FORMADO mas assinado por OUTRA chave (forjado)
        // tem que cair em `Signature` — senão qualquer um cunha a própria matrícula.
        let real_key = SigningKey::generate(&mut OsRng);
        let attacker_key = SigningKey::generate(&mut OsRng);
        let forged = issue_enrollment_ticket(&attacker_key, &enrollment_claims()).unwrap();
        let mut verifier = EnrollmentTicketVerifier::new(real_key.verifying_key());
        assert_eq!(
            verifier.verify_and_consume(&forged, "device-1", 120),
            Err(TicketError::Signature),
            "ticket forjado (assinado por chave que nao e a do servidor) foi aceito",
        );
    }

    #[test]
    fn session_and_enrollment_domains_do_not_cross() {
        // Um ticket de SESSÃO não pode ser aceito como ticket de MATRÍCULA (e vice-versa),
        // mesmo assinado pela mesma chave: o domínio de assinatura difere.
        let key = SigningKey::generate(&mut OsRng);
        let session_ticket = issue_ticket(&key, &claims()).unwrap();
        let mut enroll_verifier = EnrollmentTicketVerifier::new(key.verifying_key());
        assert!(matches!(
            enroll_verifier.verify_and_consume(&session_ticket, "device-1", 120),
            Err(TicketError::Signature) | Err(TicketError::Encoding)
        ));

        let enroll_ticket = issue_enrollment_ticket(&key, &enrollment_claims()).unwrap();
        let mut session_verifier = TicketVerifier::new(key.verifying_key());
        assert!(matches!(
            session_verifier.verify_and_consume_claims(&enroll_ticket, 120),
            Err(TicketError::Signature) | Err(TicketError::Encoding)
        ));
    }
}
