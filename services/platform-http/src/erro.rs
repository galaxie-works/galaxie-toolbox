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
            // Org visível, mas suspensa (#1544): 403 com slug PRÓPRIO (a UI mostra "fale com o
            // admin", não "papel insuficiente"). Vem antes de `Negado` na autz — ver `autorizar_acao_admin`.
            AdminErro::Suspensa => CodigoErro::OrgSuspensa,
            AdminErro::Negado => CodigoErro::Negado,
            // Deixaria a org sem `OrgAdmin` (#1620): 409 com slug PRÓPRIO — a UI mostra "promove outro
            // admin antes", não "sem permissão" (distinto de `Negado` de propósito).
            AdminErro::UltimoAdmin => CodigoErro::UltimoAdmin,
        }
    }
}

impl CodigoDeErro for ConfigErro {
    fn codigo(&self) -> CodigoErro {
        match self {
            ConfigErro::NaoEncontrado => CodigoErro::NaoEncontrado,
            // Chave fora da allowlist: payload inválido (o cliente pediu o que não existe).
            ConfigErro::ChaveNaoPermitida => CodigoErro::PayloadInvalido,
            // Valor que não cabe no tipo da chave (bool não-literal, opção fora de `opcoes`,
            // texto além do teto) — o análogo-de-VALOR do `ChaveNaoPermitida`: cliente enviou
            // o que não vale ⇒ mesmo `PayloadInvalido`. #1563. @Alcor (dono da borda): status
            // escolhido por consistência com o irmão; ajuste se a tua política de borda diferir.
            ConfigErro::ValorInvalido => CodigoErro::PayloadInvalido,
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

/// Visibilidade da superfície onde uma falha de INFRA aconteceu — o parâmetro que decide o código
/// de uma indisponibilidade de armazém, para [`resposta_de_falha`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Visibilidade {
    /// Superfície cuja EXISTÊNCIA não é segredo (`/me`, `/orgs/{org}/…`): falha de infra ⇒ **500**.
    /// Dizer "o servidor falhou" não revela nada que o cliente já não saiba da rota.
    Visivel,
    /// Superfície OCULTA (`/admin/*`): falha de infra sai pelo **mesmo 404** de rota inexistente —
    /// um 500 aqui ensinaria que a rota existe (invariante 1). A FORMA impede o vazamento.
    Oculta,
}

/// Constrói a resposta de **falha de infra** (armazém indisponível), parametrizada pela
/// [`Visibilidade`] da superfície. **Único lugar** — a propriedade anti-oráculo não vem do enum,
/// vem de existir UM só construtor de resposta de erro; um segundo (`resposta_indisponivel`) seria
/// a costura por onde ela escapa (não passaria pelo teste que garante duas rejeições idênticas).
/// Com o parâmetro, um handler OCULTO não consegue emitir 500 por acidente — a regra depende do
/// valor em mãos, não de alguém lembrar (forma, não disciplina; correção do @Altair, #1536).
///
/// O 500 fica FORA do `CodigoErro` de propósito (indisponibilidade de infra não é erro de contrato
/// que o FE deva tipar), mas é montado AQUI, no mesmo módulo, não num construtor solto.
pub fn resposta_de_falha(visibilidade: Visibilidade) -> Response {
    match visibilidade {
        // Mesma origem que o 404 de rota inexistente — indistinguível no fio.
        Visibilidade::Oculta => resposta_de_erro(CodigoErro::NaoEncontrado),
        Visibilidade::Visivel => Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(r#"{"erro":"indisponivel"}"#))
            .expect("resposta 500 é sempre construível"),
    }
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

    // Falha de infra pelo ÚNICO construtor (correção @Altair #1536): OCULTA sai pelo MESMO 404 de
    // rota inexistente (delega a `resposta_de_erro(NaoEncontrado)` — indistinguível no fio);
    // VISÍVEL é 500. A forma impede um handler oculto de emitir 500 por acidente.
    #[test]
    fn falha_oculta_e_404_visivel_e_500() {
        let oculta = resposta_de_falha(Visibilidade::Oculta);
        assert_eq!(oculta.status(), StatusCode::NOT_FOUND, "oculta ⇒ mesmo 404 de rota inexistente");
        // Byte-a-byte igual ao 404 padrão: os dois saem de `resposta_de_erro(NaoEncontrado)`.
        assert_eq!(oculta.status(), resposta_de_erro(CodigoErro::NaoEncontrado).status());

        let visivel = resposta_de_falha(Visibilidade::Visivel);
        assert_eq!(visivel.status(), StatusCode::INTERNAL_SERVER_ERROR, "visível ⇒ 500");
        assert_eq!(visivel.headers().get(header::CONTENT_TYPE).unwrap(), "application/json");
    }
}
