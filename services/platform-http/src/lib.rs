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

/// Config do DRENO de auditoria → OpenObserve (#1565 fatia B): endpoint + email + token ingest-only do
/// cofre (`_FILE`), stream fixo no código (AC4). Parcial aborta o boot; ausente desliga o dreno.
pub mod auditoria_config;
/// Serialização do trilho de auditoria em OTLP/HTTP logs (JSON) — o construtor de linha PARTILHADO
/// com o `AuditorLog` (uma forma só, um guard anti-injeção só) (#1565 fatia B).
pub(crate) mod auditoria_dreno;
pub mod erro;
/// Carga da config OAuth do AMBIENTE (#1695 fatia 5): `client_id`/`redirect_uri` por env +
/// `client_secret` do cofre via `_FILE` (nunca no código). Provedor só liga se completo; parcial
/// falha no boot (fail-closed).
pub mod oauth_config;
/// Cliente HTTP de saída da troca `code`→token (#1695 fatia C): reqwest disciplinado (rustls,
/// timeout, redirect DESLIGADO). A única chamada de SAÍDA do fluxo.
pub mod oauth_troca;
/// Contrato HTTP da configuração do Remote (#1683): teto e concessões da org, restrição do device no
/// `/me`. Guarda e não aplica (a ponte é o #1729).
pub mod remoto;
pub mod router;
pub mod sessao;
/// Binário de produção (fatia 1 do #1505): `serve(config)` sobe o axum sobre o [`router`]. Sem auth.
pub mod servidor;

pub use router::rotas;
pub use sessao::{Borda, ConfigProvedor, EstadoBorda, EstadoOAuth, SessaoAtual, SessaoOculta};
