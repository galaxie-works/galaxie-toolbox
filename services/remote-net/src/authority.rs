use std::collections::HashMap;

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use ed25519_dalek::{SigningKey, VerifyingKey};
use rand::{RngCore, rngs::OsRng};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::{
    identity::{IdentityError, verify_registration},
    opaque::{
        OpaqueError, ServerLoginFlow, ServerSecrets, server_registration_finish,
        server_registration_start,
    },
    protocol::Capabilities,
    ticket::{
        EnrollmentTicketClaims, EnrollmentTicketVerifier, ExpectedTicket, TicketClaims, TicketError,
        TicketVerifier, issue_enrollment_ticket, issue_ticket,
    },
};

const AUTH_TTL_SECONDS: u64 = 60;
const TICKET_TTL_SECONDS: u64 = 60;
// #1295: TTL curto do ticket de matrícula (uso único; a janela só precisa cobrir o
// round-trip begin→finish do OPAQUE, não uma sessão de trabalho).
const ENROLL_TICKET_TTL_SECONDS: u64 = 60;

// #1295 — a metade que faltava do invariante da `lumen`:
//     ENROLL_TICKET_TTL_SECONDS <= MAX_ENROLLMENT_TTL_SECONDS <= 120
//
// O M7 dela afrouxou os DOIS de uma vez (cunhagem 1 h + teto 1 ano) e nada
// reclamou. Em compile-time, afrouxar a cunhagem sozinha ja quebra o build; e o
// teto tem o proprio `const _` em `ticket.rs`. Para esticar a credencial agora e
// preciso editar dois numeros em dois arquivos, e os dois gritam.
const _: () = assert!(
    ENROLL_TICKET_TTL_SECONDS <= crate::ticket::MAX_ENROLLMENT_TTL_SECONDS,
    "TTL de cunhagem do ticket de matricula nao pode passar do teto de validacao (#1295)"
);
// #1295: teto (cap) DEFAULT de devices por owner_id, aplicado na cunhagem (onde a
// identidade M365 é conhecida) e reforçado no finish. `set_enrollment_cap` permite ao
// operador do servidor ajustar a política; não é alcançável pelo wire. INTERPRETAÇÃO:
// a US não fixa um número — 50 é um default conservador a ratificar pelo Altair/PO.
const DEFAULT_MAX_DEVICES_PER_OWNER: usize = 50;

struct DeviceRecord {
    pub device_id: String,
    pub owner_id: String,
    pub org_id: String,
    pub name: String,
    pub public_key: String,
    pub capabilities: Capabilities,
    password_file: Zeroizing<Vec<u8>>,
    revoked: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AddressBookDevice {
    pub device_id: String,
    pub owner_id: String,
    pub org_id: String,
    pub name: String,
    pub capabilities: Capabilities,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ControllerClaims {
    pub controller_id: String,
    pub owner_id: String,
    pub org_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AuditAction {
    Enroll,
    Register,
    AuthBegin,
    AuthSuccess,
    AuthFailure,
    SessionStart,
    SessionEnd,
    Revoke,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuditRecord {
    pub action: AuditAction,
    pub actor_id: String,
    pub device_id: String,
    pub session_id: Option<String>,
    pub timestamp: u64,
    pub success: bool,
}

pub struct AuthChallenge {
    pub auth_id: String,
    pub opaque_response: String,
}

pub struct IssuedSession {
    pub session_id: String,
    pub ticket: String,
}

struct PendingAuth {
    flow: ServerLoginFlow,
    controller: ControllerClaims,
    device_id: String,
    device_nonce: String,
    controller_nonce: String,
    capabilities: Capabilities,
    expires_at: u64,
}

#[derive(Debug, thiserror::Error)]
pub enum AuthorityError {
    #[error("identifier or display name is invalid")]
    InvalidInput,
    #[error("device already exists")]
    AlreadyExists,
    #[error("device was not found or is revoked")]
    DeviceUnavailable,
    #[error("controller is not authorized for the device owner/org")]
    Unauthorized,
    #[error("requested capabilities exceed device policy")]
    Capabilities,
    #[error("owner has reached the enrollment device cap")]
    EnrollmentCap,
    #[error("authentication challenge is invalid or expired")]
    AuthExpired,
    #[error("registration proof was already used")]
    RegistrationReplay,
    #[error(transparent)]
    Opaque(#[from] OpaqueError),
    #[error(transparent)]
    Identity(#[from] IdentityError),
    #[error(transparent)]
    Ticket(#[from] TicketError),
}

pub struct UnattendedAuthority {
    opaque: ServerSecrets,
    ticket_key: SigningKey,
    ticket_replay: TicketVerifier,
    // #1295: anti-replay do ticket de MATRÍCULA, separado do de sessão.
    enrollment_ticket_replay: EnrollmentTicketVerifier,
    enrollment_cap: usize,
    devices: HashMap<String, DeviceRecord>,
    pending_auth: HashMap<String, PendingAuth>,
    registration_replay: HashMap<String, u64>,
    audit: Vec<AuditRecord>,
}

/// #1295: resultado de `begin_enrollment` — owner/org/capabilities DERIVADOS do ticket
/// assinado pelo servidor, nunca do payload do cliente. O handler do `/v2/ws` guarda
/// isto e usa no finish; o cliente jamais escolhe esses campos.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnrollmentGrant {
    pub owner_id: String,
    pub org_id: String,
    pub capabilities: Capabilities,
    pub opaque_response: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AuthoritySnapshot {
    version: u16,
    devices: Vec<DeviceSnapshot>,
    audit: Vec<AuditRecord>,
    #[serde(default)]
    consumed_tickets: HashMap<String, u64>,
    // #1295: uso único do ticket de matrícula sobrevive a restart. `default` mantém
    // snapshots antigos legíveis (versão 1 inalterada, mesmo padrão de `consumed_tickets`).
    #[serde(default)]
    consumed_enrollment_tickets: HashMap<String, u64>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeviceSnapshot {
    device_id: String,
    owner_id: String,
    org_id: String,
    name: String,
    public_key: String,
    capabilities: Capabilities,
    password_file: String,
    revoked: bool,
}

impl UnattendedAuthority {
    pub fn new(opaque: ServerSecrets, ticket_key: SigningKey) -> Self {
        let ticket_replay = TicketVerifier::new(ticket_key.verifying_key());
        let enrollment_ticket_replay = EnrollmentTicketVerifier::new(ticket_key.verifying_key());
        Self {
            opaque,
            ticket_key,
            ticket_replay,
            enrollment_ticket_replay,
            enrollment_cap: DEFAULT_MAX_DEVICES_PER_OWNER,
            devices: HashMap::new(),
            pending_auth: HashMap::new(),
            registration_replay: HashMap::new(),
            audit: Vec::new(),
        }
    }

    pub fn ticket_verifying_key(&self) -> VerifyingKey {
        self.ticket_key.verifying_key()
    }

    /// #1295: política do operador — teto de devices por owner_id. Não alcançável pelo
    /// wire; ajustada na inicialização do servidor / superfície administrativa.
    pub fn set_enrollment_cap(&mut self, cap: usize) {
        self.enrollment_cap = cap;
    }

    pub fn snapshot_json(&self) -> Result<Vec<u8>, AuthorityError> {
        let snapshot = AuthoritySnapshot {
            version: 1,
            devices: self
                .devices
                .values()
                .map(|device| DeviceSnapshot {
                    device_id: device.device_id.clone(),
                    owner_id: device.owner_id.clone(),
                    org_id: device.org_id.clone(),
                    name: device.name.clone(),
                    public_key: device.public_key.clone(),
                    capabilities: device.capabilities,
                    password_file: URL_SAFE_NO_PAD.encode(device.password_file.as_slice()),
                    revoked: device.revoked,
                })
                .collect(),
            audit: self.audit.clone(),
            consumed_tickets: self.ticket_replay.consumed_tickets().clone(),
            consumed_enrollment_tickets: self
                .enrollment_ticket_replay
                .consumed_tickets()
                .clone(),
        };
        serde_json::to_vec(&snapshot).map_err(|_| AuthorityError::InvalidInput)
    }

    pub fn restore_snapshot_json(&mut self, bytes: &[u8]) -> Result<(), AuthorityError> {
        let snapshot: AuthoritySnapshot =
            serde_json::from_slice(bytes).map_err(|_| AuthorityError::InvalidInput)?;
        if snapshot.version != 1 {
            return Err(AuthorityError::InvalidInput);
        }
        let mut devices = HashMap::new();
        for device in snapshot.devices {
            validate_id(&device.device_id)?;
            validate_id(&device.owner_id)?;
            validate_id(&device.org_id)?;
            validate_name(&device.name)?;
            let password_file = URL_SAFE_NO_PAD
                .decode(device.password_file)
                .map_err(|_| AuthorityError::InvalidInput)?;
            if devices.contains_key(&device.device_id) {
                return Err(AuthorityError::InvalidInput);
            }
            devices.insert(
                device.device_id.clone(),
                DeviceRecord {
                    device_id: device.device_id,
                    owner_id: device.owner_id,
                    org_id: device.org_id,
                    name: device.name,
                    public_key: device.public_key,
                    capabilities: device.capabilities,
                    password_file: Zeroizing::new(password_file),
                    revoked: device.revoked,
                },
            );
        }
        self.devices = devices;
        self.audit = snapshot.audit;
        self.ticket_replay
            .restore_consumed_tickets(snapshot.consumed_tickets);
        self.enrollment_ticket_replay
            .restore_consumed_tickets(snapshot.consumed_enrollment_tickets);
        self.pending_auth.clear();
        Ok(())
    }

    /// #1295 — CUNHAGEM do ticket de matrícula. Chamada SOMENTE pela superfície
    /// autenticada do app (identidade M365 verificada, humano presente), NUNCA pelo
    /// `/v2/ws`. Aplica o teto por owner ANTES de emitir e fixa as capabilities de
    /// política (default-deny). owner/org NÃO vêm de nenhum payload de cliente — quem
    /// chama já provou a identidade.
    ///
    /// FLAG (interpretação): este método não PODE, sozinho, verificar o M365 — a
    /// ancoragem é o contrato do chamador (superfície autenticada). É o ponto que o
    /// Altair/Mizar precisam confirmar na revisão adversarial.
    pub fn mint_enrollment_ticket(
        &mut self,
        owner_id: &str,
        org_id: &str,
        device_id: &str,
        now: u64,
    ) -> Result<String, AuthorityError> {
        validate_id(owner_id)?;
        validate_id(org_id)?;
        validate_id(device_id)?;
        if self.devices.contains_key(device_id) {
            self.record_enroll_denied(owner_id, device_id, now);
            return Err(AuthorityError::AlreadyExists);
        }
        if self.count_owner_devices(owner_id) >= self.enrollment_cap {
            self.record_enroll_denied(owner_id, device_id, now);
            return Err(AuthorityError::EnrollmentCap);
        }
        let claims = EnrollmentTicketClaims {
            jti: random_id(),
            device_id: device_id.to_owned(),
            owner_id: owner_id.to_owned(),
            org_id: org_id.to_owned(),
            capabilities: enrollment_policy_capabilities(),
            issued_at: now,
            expires_at: now + ENROLL_TICKET_TTL_SECONDS,
        };
        issue_enrollment_ticket(&self.ticket_key, &claims).map_err(Into::into)
    }

    /// #1295 — `/v2/ws` device.enroll.begin. Exige um ticket VÁLIDO (assinatura, TTL,
    /// uso único, binding ao device_id). owner/org/capabilities saem do ticket assinado,
    /// não do payload. Fail-closed: sem ticket válido, nada começa; o ticket é CONSUMIDO
    /// aqui (uso único), então o chamador deve persistir o estado após um Ok.
    pub fn begin_enrollment(
        &mut self,
        device_id: &str,
        enrollment_ticket: &str,
        opaque_request: &str,
        now: u64,
    ) -> Result<EnrollmentGrant, AuthorityError> {
        validate_id(device_id)?;
        if self.devices.contains_key(device_id) {
            return Err(AuthorityError::AlreadyExists);
        }
        let claims = match self
            .enrollment_ticket_replay
            .verify_and_consume(enrollment_ticket, device_id, now)
        {
            Ok(claims) => claims,
            Err(error) => {
                self.record_enroll_denied(device_id, device_id, now);
                return Err(error.into());
            }
        };
        let opaque_response = server_registration_start(
            &self.opaque,
            account_id(&claims.owner_id, &claims.org_id, device_id).as_bytes(),
            opaque_request,
        )?;
        Ok(EnrollmentGrant {
            owner_id: claims.owner_id,
            org_id: claims.org_id,
            capabilities: claims.capabilities,
            opaque_response,
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub fn finish_enrollment(
        &mut self,
        owner_id: &str,
        org_id: &str,
        device_id: &str,
        name: &str,
        public_key: &str,
        capabilities: Capabilities,
        opaque_upload: &str,
        now: u64,
    ) -> Result<(), AuthorityError> {
        validate_id(owner_id)?;
        validate_id(org_id)?;
        validate_id(device_id)?;
        validate_name(name)?;
        if self.devices.contains_key(device_id) {
            return Err(AuthorityError::AlreadyExists);
        }
        // #1295 defesa-em-profundidade: reforça o teto no ponto onde o device é de fato
        // inserido (não só na cunhagem), caso vários tickets tenham sido cunhados abaixo
        // do teto e só agora sejam finalizados.
        if self.count_owner_devices(owner_id) >= self.enrollment_cap {
            self.record_enroll_denied(owner_id, device_id, now);
            return Err(AuthorityError::EnrollmentCap);
        }
        let password_file = server_registration_finish(opaque_upload)?;
        self.devices.insert(
            device_id.to_owned(),
            DeviceRecord {
                device_id: device_id.to_owned(),
                owner_id: owner_id.to_owned(),
                org_id: org_id.to_owned(),
                name: name.to_owned(),
                public_key: public_key.to_owned(),
                capabilities,
                password_file: Zeroizing::new(password_file),
                revoked: false,
            },
        );
        self.audit.push(AuditRecord {
            action: AuditAction::Enroll,
            actor_id: owner_id.to_owned(),
            device_id: device_id.to_owned(),
            session_id: None,
            timestamp: now,
            success: true,
        });
        Ok(())
    }

    pub fn register_device(
        &mut self,
        device_id: &str,
        nonce: &str,
        timestamp: u64,
        now: u64,
        signature: &str,
    ) -> Result<(), AuthorityError> {
        validate_id(nonce)?;
        self.registration_replay
            .retain(|_, expires_at| *expires_at >= now);
        let replay_key = format!("{device_id}:{nonce}");
        if self.registration_replay.contains_key(&replay_key) {
            return Err(AuthorityError::RegistrationReplay);
        }
        let device = self
            .devices
            .get(device_id)
            .filter(|device| !device.revoked)
            .ok_or(AuthorityError::DeviceUnavailable)?;
        verify_registration(
            &device.public_key,
            device_id,
            nonce,
            timestamp,
            now,
            signature,
        )?;
        self.registration_replay
            .insert(replay_key, timestamp.saturating_add(60));
        self.audit.push(AuditRecord {
            action: AuditAction::Register,
            actor_id: device_id.to_owned(),
            device_id: device_id.to_owned(),
            session_id: None,
            timestamp: now,
            success: true,
        });
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn begin_authentication(
        &mut self,
        controller: ControllerClaims,
        device_id: &str,
        device_nonce: &str,
        controller_nonce: &str,
        requested_capabilities: Capabilities,
        opaque_request: &str,
        now: u64,
    ) -> Result<AuthChallenge, AuthorityError> {
        validate_controller(&controller)?;
        validate_id(device_nonce)?;
        validate_id(controller_nonce)?;
        let device = self
            .devices
            .get(device_id)
            .filter(|device| !device.revoked)
            .ok_or(AuthorityError::DeviceUnavailable)?;
        if device.owner_id != controller.owner_id || device.org_id != controller.org_id {
            return Err(AuthorityError::Unauthorized);
        }
        if !capabilities_allowed(&requested_capabilities, &device.capabilities) {
            return Err(AuthorityError::Capabilities);
        }
        let account = account_id(&device.owner_id, &device.org_id, device_id);
        let (flow, opaque_response) = ServerLoginFlow::start(
            &self.opaque,
            account.as_bytes(),
            &device.password_file,
            opaque_request,
        )?;
        let auth_id = random_id();
        self.pending_auth.insert(
            auth_id.clone(),
            PendingAuth {
                flow,
                controller: controller.clone(),
                device_id: device_id.to_owned(),
                device_nonce: device_nonce.to_owned(),
                controller_nonce: controller_nonce.to_owned(),
                capabilities: requested_capabilities,
                expires_at: now + AUTH_TTL_SECONDS,
            },
        );
        self.audit.push(AuditRecord {
            action: AuditAction::AuthBegin,
            actor_id: controller.controller_id,
            device_id: device_id.to_owned(),
            session_id: None,
            timestamp: now,
            success: true,
        });
        Ok(AuthChallenge {
            auth_id,
            opaque_response,
        })
    }

    pub fn finish_authentication(
        &mut self,
        auth_id: &str,
        opaque_finalization: &str,
        controller_nonce: &str,
        requested_capabilities: &Capabilities,
        now: u64,
    ) -> Result<IssuedSession, AuthorityError> {
        let Some(pending) = self.pending_auth.remove(auth_id) else {
            return Err(AuthorityError::AuthExpired);
        };
        if now > pending.expires_at {
            self.record_auth_failure(
                pending.controller.controller_id.clone(),
                pending.device_id.clone(),
                now,
            );
            return Err(AuthorityError::AuthExpired);
        }
        if pending.controller_nonce != controller_nonce
            || pending.capabilities != *requested_capabilities
        {
            self.record_auth_failure(pending.controller.controller_id, pending.device_id, now);
            return Err(AuthorityError::Unauthorized);
        }
        let failure_actor = pending.controller.controller_id.clone();
        let failure_device = pending.device_id.clone();
        let _session_key: Zeroizing<Vec<u8>> = match pending.flow.finish(opaque_finalization) {
            Ok(key) => key,
            Err(error) => {
                self.record_auth_failure(failure_actor, failure_device, now);
                return Err(error.into());
            }
        };
        let session_id = random_id();
        let claims = TicketClaims {
            jti: random_id(),
            session_id: session_id.clone(),
            device_id: pending.device_id.clone(),
            controller_id: pending.controller.controller_id.clone(),
            owner_id: pending.controller.owner_id.clone(),
            org_id: pending.controller.org_id.clone(),
            device_nonce: pending.device_nonce,
            controller_nonce: pending.controller_nonce,
            capabilities: pending.capabilities,
            issued_at: now,
            expires_at: now + TICKET_TTL_SECONDS,
        };
        let ticket = issue_ticket(&self.ticket_key, &claims)?;
        self.audit.push(AuditRecord {
            action: AuditAction::AuthSuccess,
            actor_id: pending.controller.controller_id,
            device_id: pending.device_id,
            session_id: Some(session_id.clone()),
            timestamp: now,
            success: true,
        });
        Ok(IssuedSession { session_id, ticket })
    }

    pub fn authorize_session(
        &mut self,
        ticket: &str,
        now: u64,
        expected: &ExpectedTicket<'_>,
    ) -> Result<TicketClaims, AuthorityError> {
        self.ticket_replay
            .verify_and_consume(ticket, now, expected)
            .map_err(Into::into)
    }

    pub fn authorize_session_ticket(
        &mut self,
        ticket: &str,
        now: u64,
    ) -> Result<TicketClaims, AuthorityError> {
        let claims = self.ticket_replay.verify_and_consume_claims(ticket, now)?;
        let device = self
            .devices
            .get(&claims.device_id)
            .filter(|device| !device.revoked)
            .ok_or(AuthorityError::DeviceUnavailable)?;
        if device.owner_id != claims.owner_id || device.org_id != claims.org_id {
            return Err(AuthorityError::Unauthorized);
        }
        if !capabilities_allowed(&claims.capabilities, &device.capabilities) {
            return Err(AuthorityError::Capabilities);
        }
        self.audit.push(AuditRecord {
            action: AuditAction::SessionStart,
            actor_id: claims.controller_id.clone(),
            device_id: claims.device_id.clone(),
            session_id: Some(claims.session_id.clone()),
            timestamp: now,
            success: true,
        });
        Ok(claims)
    }

    pub fn record_session_end(
        &mut self,
        actor_id: &str,
        device_id: &str,
        session_id: &str,
        now: u64,
    ) {
        self.audit.push(AuditRecord {
            action: AuditAction::SessionEnd,
            actor_id: actor_id.to_owned(),
            device_id: device_id.to_owned(),
            session_id: Some(session_id.to_owned()),
            timestamp: now,
            success: true,
        });
    }

    pub fn address_book(&self, owner_id: &str, org_id: &str) -> Vec<AddressBookDevice> {
        self.devices
            .values()
            .filter(|device| {
                !device.revoked && device.owner_id == owner_id && device.org_id == org_id
            })
            .map(|device| AddressBookDevice {
                device_id: device.device_id.clone(),
                owner_id: device.owner_id.clone(),
                org_id: device.org_id.clone(),
                name: device.name.clone(),
                capabilities: device.capabilities,
            })
            .collect()
    }

    pub fn revoke_device(
        &mut self,
        actor_id: &str,
        owner_id: &str,
        org_id: &str,
        device_id: &str,
        now: u64,
    ) -> Result<(), AuthorityError> {
        let device = self
            .devices
            .get_mut(device_id)
            .filter(|device| !device.revoked)
            .ok_or(AuthorityError::DeviceUnavailable)?;
        if device.owner_id != owner_id || device.org_id != org_id {
            return Err(AuthorityError::Unauthorized);
        }
        device.revoked = true;
        self.pending_auth
            .retain(|_, pending| pending.device_id != device_id);
        self.audit.push(AuditRecord {
            action: AuditAction::Revoke,
            actor_id: actor_id.to_owned(),
            device_id: device_id.to_owned(),
            session_id: None,
            timestamp: now,
            success: true,
        });
        Ok(())
    }

    pub fn audit(&self) -> &[AuditRecord] {
        &self.audit
    }

    fn record_auth_failure(&mut self, actor_id: String, device_id: String, now: u64) {
        self.audit.push(AuditRecord {
            action: AuditAction::AuthFailure,
            actor_id,
            device_id,
            session_id: None,
            timestamp: now,
            success: false,
        });
    }

    /// #1295: matrícula NEGADA (teto, ticket inválido/reutilizado, device já existe).
    /// Reusa `AuditAction::Enroll` com `success = false` — audit existente, sem novo
    /// vocabulário (a US pede "registro no audit existente").
    fn record_enroll_denied(&mut self, actor_id: &str, device_id: &str, now: u64) {
        self.audit.push(AuditRecord {
            action: AuditAction::Enroll,
            actor_id: actor_id.to_owned(),
            device_id: device_id.to_owned(),
            session_id: None,
            timestamp: now,
            success: false,
        });
    }

    /// #1295: devices NÃO revogados de um owner, para o teto.
    fn count_owner_devices(&self, owner_id: &str) -> usize {
        self.devices
            .values()
            .filter(|device| !device.revoked && device.owner_id == owner_id)
            .count()
    }
}

/// #1295 — capabilities de POLÍTICA atribuídas na matrícula. Default-deny: o teto de
/// privilégio do device é o mínimo funcional para acesso não-supervisionado
/// (screen + input). Capabilities adicionais (file_transfer/clipboard/audio) NUNCA são
/// concedidas por matrícula — ficam negadas até uma decisão de política explícita.
///
/// FLAG (interpretação): a US pede "conjunto mínimo documentado" sem fixar os bits;
/// screen+input é o mínimo que ainda permite controlar o device. A ratificar.
fn enrollment_policy_capabilities() -> Capabilities {
    Capabilities {
        screen: true,
        input: true,
        file_transfer: false,
        clipboard: false,
        audio: false,
    }
}

fn account_id(owner_id: &str, org_id: &str, device_id: &str) -> String {
    format!("{owner_id}/{org_id}/{device_id}")
}

fn random_id() -> String {
    let mut bytes = [0_u8; 24];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn validate_controller(controller: &ControllerClaims) -> Result<(), AuthorityError> {
    validate_id(&controller.controller_id)?;
    validate_id(&controller.owner_id)?;
    validate_id(&controller.org_id)
}

fn validate_id(value: &str) -> Result<(), AuthorityError> {
    if (1..=128).contains(&value.len())
        && value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':' | b'@')
        })
    {
        Ok(())
    } else {
        Err(AuthorityError::InvalidInput)
    }
}

fn validate_name(value: &str) -> Result<(), AuthorityError> {
    if (1..=128).contains(&value.len()) && !value.chars().any(char::is_control) {
        Ok(())
    } else {
        Err(AuthorityError::InvalidInput)
    }
}

fn capabilities_allowed(requested: &Capabilities, allowed: &Capabilities) -> bool {
    (!requested.screen || allowed.screen)
        && (!requested.input || allowed.input)
        && (!requested.file_transfer || allowed.file_transfer)
        && (!requested.clipboard || allowed.clipboard)
        && (!requested.audio || allowed.audio)
}

#[cfg(test)]
mod tests {
    use ed25519_dalek::SigningKey;
    use rand::rngs::OsRng;

    use super::*;
    use crate::{
        identity::DeviceIdentity,
        opaque::{ClientLoginFlow, ClientRegistrationFlow, ServerSecrets},
        ticket::ExpectedTicket,
    };

    fn controller() -> ControllerClaims {
        ControllerClaims {
            controller_id: "controller-1".into(),
            owner_id: "owner-1".into(),
            org_id: "org-1".into(),
        }
    }

    fn enroll(authority: &mut UnattendedAuthority, identity: &DeviceIdentity, password: &[u8]) {
        enroll_device(authority, identity, password, "owner-1", "device-1");
    }

    // #1295: matrícula agora exige um ticket cunhado onde a identidade é conhecida.
    fn enroll_device(
        authority: &mut UnattendedAuthority,
        identity: &DeviceIdentity,
        password: &[u8],
        owner_id: &str,
        device_id: &str,
    ) {
        let ticket = authority
            .mint_enrollment_ticket(owner_id, "org-1", device_id, 100)
            .unwrap();
        let (flow, request) = ClientRegistrationFlow::start(password).unwrap();
        let grant = authority
            .begin_enrollment(device_id, &ticket, &request, 100)
            .unwrap();
        // owner/org/capabilities do GRANT (ticket), nunca escolhidos pelo teste-cliente.
        assert_eq!(grant.owner_id, owner_id);
        let finish = flow.finish(&grant.opaque_response).unwrap();
        authority
            .finish_enrollment(
                &grant.owner_id,
                &grant.org_id,
                device_id,
                "Workstation",
                &identity.public_key_base64(),
                grant.capabilities,
                &finish.upload,
                100,
            )
            .unwrap();
    }

    #[test]
    fn enrollment_capabilities_come_from_server_policy() {
        // AC: capabilities NUNCA vêm do cliente — a matrícula recebe a política do servidor.
        let mut authority =
            UnattendedAuthority::new(ServerSecrets::generate(), SigningKey::generate(&mut OsRng));
        let ticket = authority
            .mint_enrollment_ticket("owner-1", "org-1", "device-1", 100)
            .unwrap();
        let (_flow, request) = ClientRegistrationFlow::start(b"password").unwrap();
        let grant = authority
            .begin_enrollment("device-1", &ticket, &request, 100)
            .unwrap();
        assert_eq!(grant.capabilities, enrollment_policy_capabilities());
        assert!(grant.capabilities.screen && grant.capabilities.input);
        assert!(
            !grant.capabilities.file_transfer
                && !grant.capabilities.clipboard
                && !grant.capabilities.audio
        );
    }

    #[test]
    fn enroll_begin_without_valid_ticket_is_rejected_and_audited() {
        // AC: enroll.begin sem ticket válido → rejeitado (nada matricula) + audit.
        let mut authority =
            UnattendedAuthority::new(ServerSecrets::generate(), SigningKey::generate(&mut OsRng));
        let (_flow, request) = ClientRegistrationFlow::start(b"password").unwrap();
        assert!(matches!(
            authority.begin_enrollment("device-1", "not-a-ticket", &request, 100),
            Err(AuthorityError::Ticket(_))
        ));
        assert!(authority.address_book("owner-1", "org-1").is_empty());
        assert!(
            authority
                .audit()
                .iter()
                .any(|record| record.action == AuditAction::Enroll && !record.success)
        );
    }

    #[test]
    fn enroll_ticket_is_single_use_and_device_bound() {
        // AC: ticket reutilizado ou de outro device_id → rejeitado.
        let mut authority =
            UnattendedAuthority::new(ServerSecrets::generate(), SigningKey::generate(&mut OsRng));
        let ticket = authority
            .mint_enrollment_ticket("owner-1", "org-1", "device-1", 100)
            .unwrap();
        // device_id divergente do ticket → binding.
        let (_flow, request) = ClientRegistrationFlow::start(b"password").unwrap();
        assert!(matches!(
            authority.begin_enrollment("device-2", &ticket, &request, 100),
            Err(AuthorityError::Ticket(TicketError::Binding))
        ));
        // primeiro uso legítimo consome o ticket.
        let (_flow, request) = ClientRegistrationFlow::start(b"password").unwrap();
        authority
            .begin_enrollment("device-1", &ticket, &request, 100)
            .unwrap();
        // segundo uso do MESMO ticket → replay.
        let (_flow, request) = ClientRegistrationFlow::start(b"password").unwrap();
        assert!(matches!(
            authority.begin_enrollment("device-1", &ticket, &request, 100),
            Err(AuthorityError::Ticket(TicketError::Replay))
        ));
    }

    #[test]
    fn owner_device_cap_refuses_new_enrollment_with_audit() {
        // AC: owner no teto → nova matrícula recusada (erro tipado) + audit.
        let identity = DeviceIdentity::generate();
        let mut authority =
            UnattendedAuthority::new(ServerSecrets::generate(), SigningKey::generate(&mut OsRng));
        authority.set_enrollment_cap(1);
        enroll_device(&mut authority, &identity, b"password", "owner-1", "device-1");
        // owner-1 já tem 1 device; cunhar outro é recusado no teto.
        assert!(matches!(
            authority.mint_enrollment_ticket("owner-1", "org-1", "device-2", 100),
            Err(AuthorityError::EnrollmentCap)
        ));
        assert!(
            authority
                .audit()
                .iter()
                .any(|record| record.action == AuditAction::Enroll
                    && !record.success
                    && record.device_id == "device-2")
        );
        // outro owner NÃO é afetado pelo teto do owner-1.
        assert!(
            authority
                .mint_enrollment_ticket("owner-2", "org-1", "device-9", 100)
                .is_ok()
        );
    }

    #[test]
    fn enrollment_auth_ticket_and_replay_are_end_to_end() {
        let identity = DeviceIdentity::generate();
        let mut authority =
            UnattendedAuthority::new(ServerSecrets::generate(), SigningKey::generate(&mut OsRng));
        enroll(&mut authority, &identity, b"permanent-password");
        let proof = identity.sign_registration("device-1", "device-nonce", 110);
        authority
            .register_device("device-1", "device-nonce", 110, 110, &proof)
            .unwrap();

        let (login, request) = ClientLoginFlow::start(b"permanent-password").unwrap();
        let challenge = authority
            .begin_authentication(
                controller(),
                "device-1",
                "device-nonce",
                "controller-nonce",
                Capabilities {
                    screen: true,
                    ..Default::default()
                },
                &request,
                120,
            )
            .unwrap();
        let finish = login.finish(&challenge.opaque_response).unwrap();
        let ticket = authority
            .finish_authentication(
                &challenge.auth_id,
                &finish.finalization,
                "controller-nonce",
                &Capabilities {
                    screen: true,
                    ..Default::default()
                },
                121,
            )
            .unwrap();
        let requested = Capabilities {
            screen: true,
            ..Default::default()
        };
        let expected = ExpectedTicket {
            device_id: "device-1",
            controller_id: "controller-1",
            owner_id: "owner-1",
            org_id: "org-1",
            device_nonce: "device-nonce",
            controller_nonce: "controller-nonce",
            capabilities: &requested,
        };
        assert!(
            authority
                .authorize_session(&ticket.ticket, 122, &expected)
                .is_ok()
        );
        assert!(matches!(
            authority.authorize_session(&ticket.ticket, 122, &expected),
            Err(AuthorityError::Ticket(TicketError::Replay))
        ));
        assert_eq!(authority.address_book("owner-1", "org-1").len(), 1);
        assert!(authority.address_book("other", "org-1").is_empty());
        assert!(authority.audit().iter().all(|record| record.success));
    }

    #[test]
    fn authorization_policy_and_revocation_fail_closed() {
        let identity = DeviceIdentity::generate();
        let mut authority =
            UnattendedAuthority::new(ServerSecrets::generate(), SigningKey::generate(&mut OsRng));
        enroll(&mut authority, &identity, b"password");
        let (_, request) = ClientLoginFlow::start(b"password").unwrap();
        let mut outsider = controller();
        outsider.org_id = "other-org".into();
        assert!(matches!(
            authority.begin_authentication(
                outsider,
                "device-1",
                "device-nonce",
                "controller-nonce",
                Capabilities::default(),
                &request,
                120
            ),
            Err(AuthorityError::Unauthorized)
        ));
        let (_, request) = ClientLoginFlow::start(b"password").unwrap();
        assert!(matches!(
            authority.begin_authentication(
                controller(),
                "device-1",
                "device-nonce",
                "controller-nonce",
                Capabilities {
                    file_transfer: true,
                    ..Default::default()
                },
                &request,
                120
            ),
            Err(AuthorityError::Capabilities)
        ));
        authority
            .revoke_device("owner-1", "owner-1", "org-1", "device-1", 130)
            .unwrap();
        let proof = identity.sign_registration("device-1", "nonce", 131);
        assert!(matches!(
            authority.register_device("device-1", "nonce", 131, 131, &proof),
            Err(AuthorityError::DeviceUnavailable)
        ));
    }

    #[test]
    fn expired_auth_challenge_is_consumed_once() {
        let identity = DeviceIdentity::generate();
        let mut authority =
            UnattendedAuthority::new(ServerSecrets::generate(), SigningKey::generate(&mut OsRng));
        enroll(&mut authority, &identity, b"password");
        let (login, request) = ClientLoginFlow::start(b"password").unwrap();
        let challenge = authority
            .begin_authentication(
                controller(),
                "device-1",
                "device-nonce",
                "controller-nonce",
                Capabilities::default(),
                &request,
                100,
            )
            .unwrap();
        let finish = login.finish(&challenge.opaque_response).unwrap();
        assert!(matches!(
            authority.finish_authentication(
                &challenge.auth_id,
                &finish.finalization,
                "controller-nonce",
                &Capabilities::default(),
                161,
            ),
            Err(AuthorityError::AuthExpired)
        ));
        assert!(matches!(
            authority.finish_authentication(
                &challenge.auth_id,
                &finish.finalization,
                "controller-nonce",
                &Capabilities::default(),
                161,
            ),
            Err(AuthorityError::AuthExpired)
        ));
    }

    #[test]
    fn address_book_and_opaque_record_survive_restart_without_plaintext_password() {
        let identity = DeviceIdentity::generate();
        let setup = ServerSecrets::generate();
        let serialized_setup = setup.serialize();
        let ticket_key = SigningKey::generate(&mut OsRng);
        let mut authority = UnattendedAuthority::new(setup, ticket_key.clone());
        enroll(&mut authority, &identity, b"never-persist-this-password");
        let snapshot = authority.snapshot_json().unwrap();
        assert!(!String::from_utf8_lossy(&snapshot).contains("never-persist-this-password"));

        let mut restored = UnattendedAuthority::new(
            ServerSecrets::deserialize(&serialized_setup).unwrap(),
            ticket_key,
        );
        restored.restore_snapshot_json(&snapshot).unwrap();
        assert_eq!(restored.address_book("owner-1", "org-1").len(), 1);
        let (login, request) = ClientLoginFlow::start(b"never-persist-this-password").unwrap();
        let challenge = restored
            .begin_authentication(
                controller(),
                "device-1",
                "device-nonce",
                "controller-nonce",
                Capabilities::default(),
                &request,
                120,
            )
            .unwrap();
        let finish = login.finish(&challenge.opaque_response).unwrap();
        assert!(
            restored
                .finish_authentication(
                    &challenge.auth_id,
                    &finish.finalization,
                    "controller-nonce",
                    &Capabilities::default(),
                    121,
                )
                .is_ok()
        );
    }

    #[test]
    fn consumed_ticket_remains_consumed_after_restart() {
        let identity = DeviceIdentity::generate();
        let setup = ServerSecrets::generate();
        let serialized_setup = setup.serialize();
        let ticket_key = SigningKey::generate(&mut OsRng);
        let mut authority = UnattendedAuthority::new(setup, ticket_key.clone());
        enroll(&mut authority, &identity, b"password");
        let proof = identity.sign_registration("device-1", "device-nonce", 110);
        authority
            .register_device("device-1", "device-nonce", 110, 110, &proof)
            .unwrap();
        let (login, request) = ClientLoginFlow::start(b"password").unwrap();
        let challenge = authority
            .begin_authentication(
                controller(),
                "device-1",
                "device-nonce",
                "controller-nonce",
                Capabilities::default(),
                &request,
                120,
            )
            .unwrap();
        let finish = login.finish(&challenge.opaque_response).unwrap();
        let issued = authority
            .finish_authentication(
                &challenge.auth_id,
                &finish.finalization,
                "controller-nonce",
                &Capabilities::default(),
                121,
            )
            .unwrap();
        authority
            .authorize_session_ticket(&issued.ticket, 122)
            .unwrap();
        let snapshot = authority.snapshot_json().unwrap();

        let mut restored = UnattendedAuthority::new(
            ServerSecrets::deserialize(&serialized_setup).unwrap(),
            ticket_key,
        );
        restored.restore_snapshot_json(&snapshot).unwrap();
        assert!(matches!(
            restored.authorize_session_ticket(&issued.ticket, 123),
            Err(AuthorityError::Ticket(TicketError::Replay))
        ));
    }
}
