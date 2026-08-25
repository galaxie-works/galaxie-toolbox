//! Borda HTTP da plataforma — #1505 (costura vertical 3/3 do #1265).
//!
//! O Router axum que serve o contrato (#1503) sobre os crates de domínio `platform-*`. Aqui as
//! 6 condições do @Altair viram runtime. Construído em fatias; esta é o **núcleo de segurança**:
//!  - [`erro`] — o mapeamento erro→HTTP (condição 1: "404 idêntico no fio").
//!
//! Próximas fatias: extractor de sessão (condição 6, cookie→`tocar`→principal, passa o `agora`),
//! Router + handlers (condições 2/3/5), sink de auditoria de staff (condição 4), rotas OAuth.

#![forbid(unsafe_code)]

pub mod erro;
