//! Canal de sessão worker↔owner (S7, #690) — **passo 2 da §9: HANDSHAKE**.
//!
//! É o servidor do pipe `\\.\pipe\Galaxie.Remote.Worker.<sessionId>.<nonce>`
//! (§4.1). Este módulo é o **núcleo de decisão de autenticação** (§4.2/4.3): puro,
//! platform-agnostic e testável. O servidor de named pipe + DACL + a verificação
//! de Authenticode do owner + o `verify_and_consume` do ticket do S8 são o **I/O
//! do passo 2b** (entram quando o `remote-net` feature-gate do @Altair / PR #955
//! landar; o núcleo aqui recebe esses OUTCOMES já resolvidos).
//!
//! **Postura de parsing (design §5):** mensagens do NOSSO canal são **estritas**
//! (`deny_unknown_fields`), ao contrário da resposta do broker (tolerante).

use serde::{Deserialize, Serialize};

pub const CHANNEL_PROTOCOL_VERSION: u16 = 1;
pub const MAX_MESSAGE_BYTES: usize = 64 * 1024;
/// TTL do nonce de bootstrap (§4.2): coordenada de uso único, janela curta.
pub const NONCE_TTL_MS: u64 = 10_000;

/// Nome do pipe dedicado por sessão (§4.1). O worker cria; o broker relaya o nome
/// + nonce pro owner via `agent.ensure` (aditivo, §10 do Wagner).
#[must_use]
pub fn worker_pipe_name(session_id: u32, nonce: &str) -> String {
    format!(r"\\.\pipe\Galaxie.Remote.Worker.{session_id}.{nonce}")
}

// ───────────────────────── mensagens (estritas) ─────────────────────────

/// Primeira mensagem do owner (§4.2). `ticket` é o session ticket assinado do S8
/// (`remote-net`), **obrigatório no não-supervisionado** (§4.3).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Hello {
    pub owner_pid: u32,
    pub session_id: u32,
    pub nonce: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ticket: Option<String>,
}

/// Resposta do worker: reflete o nonce (anti-replay/erro de rota), como o broker.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HelloAck {
    pub nonce: String,
}

/// Evento de estado worker→owner (§4.4). `state`: `connecting|ready|ended|error`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionStateMsg {
    pub state: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ErroEnvelope {
    #[error("mensagem excede 64 KiB ({0} bytes)")]
    MuitoGrande(usize),
    #[error("json inválido no canal: {0}")]
    Json(String),
}

/// Desserializa uma mensagem do canal com o teto de 64 KiB + estritude
/// (`deny_unknown_fields` nas structs). Campo desconhecido ⇒ erro (fail-closed).
pub fn parse_mensagem<T: serde::de::DeserializeOwned>(raw: &[u8]) -> Result<T, ErroEnvelope> {
    if raw.len() > MAX_MESSAGE_BYTES {
        return Err(ErroEnvelope::MuitoGrande(raw.len()));
    }
    serde_json::from_slice(raw).map_err(|e| ErroEnvelope::Json(e.to_string()))
}

// ───────────────────────── decisão de autenticação (§4.2/4.3) ─────────────────────────

/// Modo da sessão — determina se o ticket é obrigatório (§4.3).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModoSessao {
    /// Usuário presente: autoridade = presença local; ticket opcional.
    Attended,
    /// Ninguém logado: autoridade = ticket assinado do S8; ticket **obrigatório**.
    Unattended,
}

/// O que o worker sabe ANTES de julgar o `hello`: o nonce que ele mesmo gerou +
/// quando, o relógio, a sessão alvo e o modo.
pub struct ContextoHandshake {
    pub nonce_emitido: String,
    pub emitido_em_ms: u64,
    pub agora_ms: u64,
    pub session_id_esperado: u32,
    pub modo: ModoSessao,
}

/// Presença local do owner — resolvida pelo I/O do passo 2b: `ProcessIdToSessionId`
/// do `owner_pid` + `WinVerifyTrust` do binário do owner. O núcleo só decide.
pub struct PresencaLocal {
    pub owner_session_id: u32,
    pub authenticode_ok: bool,
}

/// Resultado da verificação do ticket do S8 — resolvida pelo passo 2b
/// (`remote_net::ticket::verify_and_consume`). O núcleo só decide a autoridade.
pub enum ResultadoTicket {
    Ausente,
    Valido,
    Invalido(String),
}

/// De onde a sessão tira autoridade sobre capabilities (§4.3).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FonteAutoridade {
    /// Ticket assinado do S8 — capabilities derivam do `TicketClaims` (passo 2b).
    Ticket,
    /// Presença local provada (nonce+PID+Authenticode) — só no attended.
    PresencaLocal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Autoridade {
    pub fonte: FonteAutoridade,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum RejeicaoHandshake {
    #[error("nonce não confere (fail-closed)")]
    NonceInvalido,
    #[error("nonce expirado (janela de {NONCE_TTL_MS} ms)")]
    NonceExpirado,
    #[error("owner em sessão errada: esperava {esperada}, PID está na {veio}")]
    SessaoErrada { esperada: u32, veio: u32 },
    #[error("Authenticode do owner inválido")]
    AuthenticodeInvalido,
    #[error("ticket: {0}")]
    Ticket(String),
}

/// A decisão de handshake (§4.2/4.3), pura. Ordem = presença ANTES do ticket, e
/// tudo **fail-closed**:
/// 1. nonce refletido bate; 2. nonce não expirou; 3. o PID do owner está na sessão
/// alvo (a verdade é o PID→sessão, não o `hello.session_id`); 4. Authenticode OK;
/// 5. ticket → **Valido** ⇒ autoridade do ticket (serve unattended); **Invalido**
/// ⇒ recusa; **Ausente** ⇒ só passa no attended (autoridade da presença), no
/// unattended é recusado (ticket é obrigatório).
pub fn validar_hello(
    hello: &Hello,
    ctx: &ContextoHandshake,
    presenca: &PresencaLocal,
    ticket: &ResultadoTicket,
) -> Result<Autoridade, RejeicaoHandshake> {
    if hello.nonce != ctx.nonce_emitido {
        return Err(RejeicaoHandshake::NonceInvalido);
    }
    if ctx.agora_ms.saturating_sub(ctx.emitido_em_ms) > NONCE_TTL_MS {
        return Err(RejeicaoHandshake::NonceExpirado);
    }
    if presenca.owner_session_id != ctx.session_id_esperado {
        return Err(RejeicaoHandshake::SessaoErrada {
            esperada: ctx.session_id_esperado,
            veio: presenca.owner_session_id,
        });
    }
    if !presenca.authenticode_ok {
        return Err(RejeicaoHandshake::AuthenticodeInvalido);
    }
    match (ctx.modo, ticket) {
        (_, ResultadoTicket::Valido) => Ok(Autoridade {
            fonte: FonteAutoridade::Ticket,
        }),
        (_, ResultadoTicket::Invalido(m)) => Err(RejeicaoHandshake::Ticket(m.clone())),
        (ModoSessao::Attended, ResultadoTicket::Ausente) => Ok(Autoridade {
            fonte: FonteAutoridade::PresencaLocal,
        }),
        (ModoSessao::Unattended, ResultadoTicket::Ausente) => Err(RejeicaoHandshake::Ticket(
            "modo não-supervisionado exige ticket assinado do S8".to_owned(),
        )),
    }
}

// ───────────────────────── testes adversariais ─────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(modo: ModoSessao) -> ContextoHandshake {
        ContextoHandshake {
            nonce_emitido: "nonce-bom".into(),
            emitido_em_ms: 1_000,
            agora_ms: 1_500, // 500 ms depois, dentro do TTL
            session_id_esperado: 2,
            modo,
        }
    }
    fn presenca_ok() -> PresencaLocal {
        PresencaLocal {
            owner_session_id: 2,
            authenticode_ok: true,
        }
    }
    fn hello(nonce: &str, ticket: Option<&str>) -> Hello {
        Hello {
            owner_pid: 4242,
            session_id: 2,
            nonce: nonce.into(),
            ticket: ticket.map(str::to_owned),
        }
    }

    #[test]
    fn attended_com_presenca_e_sem_ticket_passa_pela_presenca() {
        let a = validar_hello(
            &hello("nonce-bom", None),
            &ctx(ModoSessao::Attended),
            &presenca_ok(),
            &ResultadoTicket::Ausente,
        )
        .unwrap();
        assert_eq!(a.fonte, FonteAutoridade::PresencaLocal);
    }

    #[test]
    fn unattended_sem_ticket_e_recusado() {
        let e = validar_hello(
            &hello("nonce-bom", None),
            &ctx(ModoSessao::Unattended),
            &presenca_ok(),
            &ResultadoTicket::Ausente,
        )
        .unwrap_err();
        assert!(matches!(e, RejeicaoHandshake::Ticket(_)));
    }

    #[test]
    fn unattended_com_ticket_valido_usa_autoridade_do_ticket() {
        let a = validar_hello(
            &hello("nonce-bom", Some("tk")),
            &ctx(ModoSessao::Unattended),
            &presenca_ok(),
            &ResultadoTicket::Valido,
        )
        .unwrap();
        assert_eq!(a.fonte, FonteAutoridade::Ticket);
    }

    #[test]
    fn ticket_invalido_e_fail_closed_ate_no_attended() {
        let e = validar_hello(
            &hello("nonce-bom", Some("tk-ruim")),
            &ctx(ModoSessao::Attended),
            &presenca_ok(),
            &ResultadoTicket::Invalido("assinatura".into()),
        )
        .unwrap_err();
        assert!(matches!(e, RejeicaoHandshake::Ticket(_)));
    }

    #[test]
    fn nonce_errado_recusa() {
        let e = validar_hello(
            &hello("nonce-forjado", None),
            &ctx(ModoSessao::Attended),
            &presenca_ok(),
            &ResultadoTicket::Ausente,
        )
        .unwrap_err();
        assert_eq!(e, RejeicaoHandshake::NonceInvalido);
    }

    #[test]
    fn nonce_expirado_recusa() {
        let mut c = ctx(ModoSessao::Attended);
        c.agora_ms = c.emitido_em_ms + NONCE_TTL_MS + 1;
        let e = validar_hello(&hello("nonce-bom", None), &c, &presenca_ok(), &ResultadoTicket::Ausente)
            .unwrap_err();
        assert_eq!(e, RejeicaoHandshake::NonceExpirado);
    }

    #[test]
    fn owner_em_outra_sessao_recusa() {
        let presenca = PresencaLocal {
            owner_session_id: 7, // ≠ 2 esperado
            authenticode_ok: true,
        };
        let e = validar_hello(&hello("nonce-bom", None), &ctx(ModoSessao::Attended), &presenca, &ResultadoTicket::Ausente)
            .unwrap_err();
        assert!(matches!(e, RejeicaoHandshake::SessaoErrada { esperada: 2, veio: 7 }));
    }

    #[test]
    fn authenticode_falso_recusa() {
        let presenca = PresencaLocal {
            owner_session_id: 2,
            authenticode_ok: false,
        };
        let e = validar_hello(&hello("nonce-bom", None), &ctx(ModoSessao::Attended), &presenca, &ResultadoTicket::Ausente)
            .unwrap_err();
        assert_eq!(e, RejeicaoHandshake::AuthenticodeInvalido);
    }

    #[test]
    fn campo_desconhecido_no_hello_e_rejeitado() {
        // deny_unknown_fields: um `hello` com campo a mais não desserializa.
        let raw = br#"{"ownerPid":1,"sessionId":2,"nonce":"x","extra":true}"#;
        let r: Result<Hello, _> = parse_mensagem(raw);
        assert!(matches!(r, Err(ErroEnvelope::Json(_))));
    }

    #[test]
    fn mensagem_acima_de_64kib_e_rejeitada() {
        let raw = vec![b'x'; MAX_MESSAGE_BYTES + 1];
        let r: Result<Hello, _> = parse_mensagem(&raw);
        assert_eq!(r.unwrap_err(), ErroEnvelope::MuitoGrande(MAX_MESSAGE_BYTES + 1));
    }

    #[test]
    fn hello_round_trip_sem_ticket_omite_o_campo() {
        let h = hello("n", None);
        let j = serde_json::to_string(&h).unwrap();
        assert!(!j.contains("ticket"), "ticket None deve ser omitido: {j}");
        let de: Hello = serde_json::from_str(&j).unwrap();
        assert_eq!(de, h);
    }

    #[test]
    fn pipe_name_por_sessao() {
        assert_eq!(
            worker_pipe_name(3, "abcd"),
            r"\\.\pipe\Galaxie.Remote.Worker.3.abcd"
        );
    }
}
