//! Borda HTTP da plataforma — #1505 (costura vertical 3/3 do #1265).
//!
//! O Router axum que serve o contrato (#1503) sobre os crates de domínio `platform-*`. Aqui as
//! 6 condições do @Altair viram runtime. Construído em fatias; esta é o **núcleo de segurança**:
//!  - [`erro`] — o mapeamento erro→HTTP (condição 1: "404 idêntico no fio").
//!
//!  - [`sessao`] — o extractor de sessão (condição 6: principal vem da sessão do servidor).
//!  - [`router`] — o Router + fallback anti-oráculo (condição 1 ponta a ponta) + 1ª rota autenticada.
//!
//! Próximas fatias: handlers de dados (condições 2/3/5), sink de auditoria de staff (condição 4),
//! rotas OAuth. O caminho com atividade (`tocar`/#1512) entra quando um handler mutar de fato.

#![forbid(unsafe_code)]

pub mod erro;
pub mod router;
pub mod sessao;

pub use router::rotas;
pub use sessao::{Borda, EstadoBorda, SessaoAtual};
