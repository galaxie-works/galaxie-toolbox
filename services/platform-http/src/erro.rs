//! Mapeamento erro→HTTP da borda — a **condição 1 do @Altair** ("404 idêntico no fio")
//! aterrissando (#1505). Cada erro de domínio vira um [`CodigoErro`] do contrato (#1503), e a
//! resposta é montada **só** a partir dele — então dois erros que mapeiam pro mesmo código
//! produzem uma resposta byte-a-byte igual. É isso que impede o oráculo: "existe mas não é
//! teu" e "não existe" têm de ser indistinguíveis (enum igual não basta — a RESPOSTA tem de ser).
//!
//! Regra-mãe (handoff do @Mizar, lição do #1475): o router **não reintroduz** distinção que os
//! crates apagaram. Onde o domínio já colapsou dois casos no mesmo erro, o fio devolve a mesma
//! resposta. Por isso o mapa é por **contexto**, não por nome de erro:
//!   - `BackOfficeErro::Negado` → **404** (back-office não se anuncia — invariante 1), enquanto
//!     `AdminErro::Negado` → **403** (o solicitante JÁ é da org, o recurso é visível).

use axum::body::Body;
use axum::http::{header, StatusCode};
use axum::response::Response;

use galaxie_platform_back_office::BackOfficeErro;
use galaxie_platform_conta::ContaErro;
use galaxie_platform_config::ConfigErro;
use galaxie_platform_org_admin::AdminErro;
use galaxie_platform_web::contrato::CodigoErro;

/// Trait LOCAL (orphan rule: não dá pra `impl From<ErroForeign> for CodigoErroForeign`) que leva
/// cada erro de domínio ao código do contrato. O mapa é a decisão de segurança — mora aqui.
pub trait CodigoDeErro {
    fn codigo(&self) -> CodigoErro;
}

impl CodigoDeErro for ContaErro {
    fn codigo(&self) -> CodigoErro {
        match self {
            ContaErro::NaoEncontrado => CodigoErro::NaoEncontrado,
        }
    }
}

impl CodigoDeErro for AdminErro {
    fn codigo(&self) -> CodigoErro {
        match self {
            // Org alheia/inexistente: 404 (não enumera). Recurso da própria org sem papel: 403.
            AdminErro::NaoEncontrada => CodigoErro::NaoEncontrado,
            AdminErro::Negado => CodigoErro::Negado,
        }
    }
}

impl CodigoDeErro for ConfigErro {
    fn codigo(&self) -> CodigoErro {
        match self {
            ConfigErro::NaoEncontrado => CodigoErro::NaoEncontrado,
            // Chave fora da allowlist: payload inválido (o cliente pediu o que não existe).
            ConfigErro::ChaveNaoPermitida => CodigoErro::PayloadInvalido,
        }
    }
}

impl CodigoDeErro for BackOfficeErro {
    fn codigo(&self) -> CodigoErro {
        match self {
            // NÃO 403 (decisão @Altair, #1474): um 403 ensinaria que o back-office existe. O
            // MESMO nome (`Negado`) que é 403 no admin-org é 404 aqui — invariante 1 por contexto.
            BackOfficeErro::Negado => CodigoErro::NaoEncontrado,
        }
    }
}

/// O corpo JSON de erro do contrato (§3): `{ "erro": "<slug>" }`. Função pura de `CodigoErro`
/// — é o que garante que respostas do mesmo código são idênticas (o slug do 404 NÃO vaza a razão).
pub fn corpo_erro(codigo: CodigoErro) -> String {
    format!("{{\"erro\":\"{}\"}}", codigo.slug())
}

/// Monta a resposta HTTP de um erro, **só** a partir do `CodigoErro` — mesma origem (status +
/// content-type + corpo) pra todo erro que mapeia no mesmo código. A borda constrói SEMPRE por
/// aqui; nunca formata um erro à mão (senão dois 404 poderiam divergir e virar oráculo).
pub fn resposta_de_erro(codigo: CodigoErro) -> Response {
    Response::builder()
        .status(StatusCode::from_u16(codigo.http()).expect("código HTTP do contrato é válido"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(corpo_erro(codigo)))
        .expect("resposta de erro é sempre construível")
}

#[cfg(test)]
mod tests {
    use super::*;

    // A condição 1 (AC2 do #1505): "não é teu" (BackOffice::Negado) e "não existe"
    // (Conta::NaoEncontrado) produzem a MESMA resposta — mesmo código, mesmo status, mesmo corpo.
    // Se um dia alguém mapear o back-office pra 403, ESTE teste morre.
    #[test]
    fn quatrocentos_e_quatro_e_identico_no_fio() {
        let a = ContaErro::NaoEncontrado.codigo();
        let b = BackOfficeErro::Negado.codigo();
        assert_eq!(a, b, "back-office negado e conta inexistente têm de colapsar no mesmo código");
        assert_eq!(a, CodigoErro::NaoEncontrado);
        assert_eq!(a.http(), 404);
        // A resposta é função pura do código ⇒ corpo e status idênticos por construção.
        assert_eq!(corpo_erro(a), corpo_erro(b));
        assert_eq!(corpo_erro(a), r#"{"erro":"nao_encontrado"}"#);
    }

    // O 403 SÓ aparece onde o recurso é visível (admin-org sobre a própria org). A ordem/contexto
    // é a segurança: cross-tenant já virou 404 no crate ANTES de chegar num Negado.
    #[test]
    fn admin_negado_e_403_backoffice_negado_e_404() {
        assert_eq!(AdminErro::Negado.codigo().http(), 403);
        assert_eq!(BackOfficeErro::Negado.codigo().http(), 404, "back-office não se anuncia");
        assert_ne!(AdminErro::Negado.codigo(), BackOfficeErro::Negado.codigo());
    }

    // Config: chave fora da allowlist é payload inválido (400), não 404.
    #[test]
    fn config_chave_nao_permitida_e_400() {
        assert_eq!(ConfigErro::ChaveNaoPermitida.codigo().http(), 400);
        assert_eq!(ConfigErro::NaoEncontrado.codigo().http(), 404);
    }

    // A resposta montada carrega o status do código e o content-type JSON.
    #[test]
    fn resposta_tem_status_e_content_type() {
        let r = resposta_de_erro(CodigoErro::NaoAutenticado);
        assert_eq!(r.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(r.headers().get(header::CONTENT_TYPE).unwrap(), "application/json");
    }
}
