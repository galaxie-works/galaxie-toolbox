//! **⚠️ DEV-ONLY — NÃO EXISTE NO ARTEFATO DE PRODUÇÃO.**
//!
//! Fatia 2 do #1505 (desenho do @Altair): serve o caminho PERMITIDO antes do OAuth, semeando uma
//! sessão comum + dados de dev, pro @Pollux fiar o e2e dos 200 sem esperar o login federado.
//!
//! É um `[[bin]]` SEPARADO de propósito (não uma flag): o binário de produção (`main.rs`) **não
//! contém** este código de semeadura. A garantia deixa de ser "a flag está desligada" e passa a ser
//! "o código não está no artefato" — verificável de fora (o gate de produção confere que a imagem
//! publicada não carrega o `dev-server`). As 3 condições do @Altair:
//!  1. a semeadura mora AQUI, no bin, nunca na lib (`pub` atrás de `#[cfg(feature)]` seria ligável);
//!  2. a sessão semeada é COMUM — `Principal` normal, escopo normal, os MESMOS prazos da real
//!     (`agora_de_producao`); se fosse mais poderosa, o e2e provaria o cenário errado;
//!  3. 🪦 **GATILHO DE MORTE: este bin é DELETADO no mesmo PR em que o OAuth (fatia 3) landar.**
//!     Não "quando der" — quando existir login de verdade, esta porta sintética some.

#![forbid(unsafe_code)]

use std::collections::BTreeSet;
use std::net::SocketAddr;
use std::sync::Arc;

use anyhow::Result;
use galaxie_platform_identity::auditoria::{Auditor, EventoAutz};
use galaxie_platform_identity::armazem::{
    ArmazemDominioMemoria, ArmazemMembroMemoria, ArmazemOrgMemoria, Dominio, EstadoDominio, Membro,
};
use galaxie_platform_identity::sessao::{ArmazemMemoria, NOME_COOKIE_SESSAO};
use galaxie_platform_conta::{ArmazemPerfilMemoria, Perfil};
use galaxie_platform_config::{ArmazemPrefMemoria, FormaDaChave};
use galaxie_platform_identity::{Escopo, Org, OrgId, Papel, Principal, Sessao, UserId};
use galaxie_platform_http::servidor::{agora_de_producao, servir, Config};
use galaxie_platform_http::Borda;
use galaxie_platform_web::emitir_sessao;

/// Auditor no-op: dev não precisa de auditoria real (o destino OpenObserve é fatia própria). A
/// auditoria de VERDADE roda no binário de produção; aqui só não pode faltar um `Auditor`.
struct AuditorDev;
impl Auditor for AuditorDev {
    fn registrar(&self, _e: &EventoAutz) {}
}

const ORG_DEV: &str = "dev-org";
/// 2ª org, SUSPENSA, pro composto do #1544 (pedido da @Íris): provar `403 org_suspensa` + a faixa
/// do FE contra a borda REAL. Vem com a PRÓPRIA sessão de admin — `resolver_org` dá visibilidade por
/// `principal.org == alvo` (não por escopo), então uma org suspensa sem dono que a veja daria 404
/// (invisível), NÃO o 403 do composto.
const ORG_DEV_SUSPENSA: &str = "dev-org-suspensa";

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt().with_target(false).compact().init();

    // (1) Sessão COMUM: admin da org de dev, escopo populado com a própria org, prazos NORMAIS
    // (agora_de_producao — o MESMO relógio da prod). Nada de staff, nada de escopo global.
    let mut armazem = ArmazemMemoria::novo();
    let sessao = Sessao::estabelecer(
        Principal::AdminOrg {
            usuario: UserId("dev-user".into()),
            org: OrgId(ORG_DEV.into()),
        },
        Escopo::de_orgs([OrgId(ORG_DEV.into())]),
    );
    let (id, _set_cookie) = emitir_sessao(&mut armazem, sessao, agora_de_producao());

    // (1b) 2ª sessão: admin da org SUSPENSA (composto do #1544, @Íris). MESMO armazém, prazos NORMAIS
    // (mesmo relógio). Espelha `borda_admin_org(true)` do router: um `AdminOrg` cujo PRINCIPAL É a org
    // suspensa — só assim `resolver_org` a vê (visibilidade→suspensão→papel) e a suspensão governa ⇒ 403.
    let sessao_susp = Sessao::estabelecer(
        Principal::AdminOrg {
            usuario: UserId("dev-admin-susp".into()),
            org: OrgId(ORG_DEV_SUSPENSA.into()),
        },
        Escopo::de_orgs([OrgId(ORG_DEV_SUSPENSA.into())]),
    );
    let (id_susp, _sc2) = emitir_sessao(&mut armazem, sessao_susp, agora_de_producao());

    // (2) Dados de dev pros 200: uma org, um membro, um domínio verificado + um pendente.
    let mut orgs = ArmazemOrgMemoria::novo();
    orgs.inserir(Org::nova(
        OrgId(ORG_DEV.into()),
        BTreeSet::from([format!("{ORG_DEV}.com")]),
        None,
    ));
    // A 2ª org, SUSPENSA (composto do #1544): domínio próprio pra não colidir com o da `ORG_DEV`.
    let mut org_susp = Org::nova(
        OrgId(ORG_DEV_SUSPENSA.into()),
        BTreeSet::from([format!("{ORG_DEV_SUSPENSA}.com")]),
        None,
    );
    org_susp.suspender();
    orgs.inserir(org_susp);
    let mut membros = ArmazemMembroMemoria::novo();
    membros.inserir(
        OrgId(ORG_DEV.into()),
        Membro {
            uid: UserId("dev-user".into()),
            nome: "Dev User".into(),
            email: "dev@dev-org.com".into(),
            papel: Papel::OrgAdmin,
        },
    );
    membros.inserir(
        OrgId(ORG_DEV.into()),
        Membro {
            uid: UserId("membro-2".into()),
            nome: "Segundo Membro".into(),
            email: "m2@dev-org.com".into(),
            papel: Papel::Member,
        },
    );
    // O admin da org SUSPENSA — membro pra que a rota seja real; a suspensão governa antes do papel.
    membros.inserir(
        OrgId(ORG_DEV_SUSPENSA.into()),
        Membro {
            uid: UserId("dev-admin-susp".into()),
            nome: "Admin (Org Suspensa)".into(),
            email: "admin@dev-org-suspensa.com".into(),
            papel: Papel::OrgAdmin,
        },
    );
    let mut dominios = ArmazemDominioMemoria::novo();
    dominios.inserir(OrgId(ORG_DEV.into()), Dominio { dominio: format!("{ORG_DEV}.com"), estado: EstadoDominio::Verificado });
    dominios.inserir(OrgId(ORG_DEV.into()), Dominio { dominio: format!("{ORG_DEV}.io"), estado: EstadoDominio::Pendente });

    // Perfil do dev-user pro `GET /me` (fatia #1489 do @Castor): em prod, o callback OAuth grava.
    let mut perfis = ArmazemPerfilMemoria::novo();
    perfis.inserir(
        UserId("dev-user".into()),
        Perfil { nome: "Dev User".into(), email: "dev@dev-org.com".into(), idioma: Some("pt-BR".into()) },
    );

    // Prefs de config do dev-user pro `GET /me/config` (#1505/#1563, e2e do @Castor #1491): em prod,
    // a escrita grava. Duas chaves allowlisted, uma `Opcao` e uma `Booleano`, pra provar os dois tipos.
    let mut prefs = ArmazemPrefMemoria::novo();
    prefs.semear(
        UserId("dev-user".into()),
        vec![
            (
                "app.tema".into(),
                "escuro".into(),
                FormaDaChave::Opcao { opcoes: vec!["claro".into(), "escuro".into(), "sistema".into()] },
            ),
            ("app.notificacoes".into(), "true".into(), FormaDaChave::Booleano),
        ],
    );

    let borda = Borda::nova(
        armazem,
        agora_de_producao,
        Arc::new(AuditorDev),
        Arc::new(orgs),
        Arc::new(membros),
        Arc::new(dominios),
        Arc::new(perfis),
        Arc::new(prefs),
    );

    // Imprime o cookie pronto pro dev/@Pollux injetar. `__Host-` exige `Secure`; em http://localhost
    // via proxy do Vite os navegadores tratam como origem confiável (confirmar cedo — aviso do @Altair).
    let cookie = format!("{NOME_COOKIE_SESSAO}={}", id.0);
    eprintln!("──────────────────────────────────────────────────────────────");
    eprintln!("  DEV-SERVER (⚠️ não-prod). Sessão semeada: admin de '{ORG_DEV}'.");
    eprintln!("  Cookie pro caminho PERMITIDO (injeta no request/browser):");
    eprintln!("    {cookie}");
    eprintln!("  Ex.: curl -H 'Cookie: {cookie}' http://localhost:8080/api/v1/orgs/{ORG_DEV}/membros");
    let cookie_susp = format!("{NOME_COOKIE_SESSAO}={}", id_susp.0);
    eprintln!("  ─");
    eprintln!("  Cookie pro composto ORG SUSPENSA (#1544 — admin de '{ORG_DEV_SUSPENSA}'):");
    eprintln!("    {cookie_susp}");
    eprintln!("  Ex.: curl -H 'Cookie: {cookie_susp}' http://localhost:8080/api/v1/orgs/{ORG_DEV_SUSPENSA}/membros  # ⇒ 403 org_suspensa");
    eprintln!("──────────────────────────────────────────────────────────────");

    // ⚠️ Escuta SÓ em `127.0.0.1` (achado do @Altair, #1540): este bin cunha uma sessão válida e
    // IMPRIME o cookie — em `0.0.0.0` qualquer um no mesmo segmento de rede alcançaria as rotas. O
    // `127.0.0.1` é hardcoded, NÃO `from_env`: expor tem de ser um ato deliberado e visível, nunca
    // o default herdado da produção. A porta segue configurável (o Pollux precisa saber qual é).
    let addr = SocketAddr::from(([127, 0, 0, 1], Config::from_env()?.porta));
    servir(borda, addr).await
}
