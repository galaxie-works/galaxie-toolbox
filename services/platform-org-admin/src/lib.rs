//! Admin da org (membros / domínios / settings / assinatura) — #1475 (épico #1265).
//! Camada de AUTORIZAÇÃO sobre a fundação #1469 (`galaxie-platform-identity`).
//!
//! ## Delta crítica (Altair): a armadilha do `role` do M365
//! `MultiTenantMember` traz `role: "owner"|"member"` do Graph — é topologia de tenant do
//! M365, **NÃO** autorização da Galaxie. Se ele virasse a fonte de `org_admin`, a Microsoft
//! passaria a decidir quem gere membros/domínios/**assinatura** de uma org. Aqui o
//! `org_admin` é papel da Galaxie (fundação #1469), e esta camada **nunca aceita um role de
//! Graph como entrada**: a assinatura de [`autorizar_acao_admin`] só conhece a `Sessao` — um
//! claim de M365 não tem por onde entrar (AC3, estrutural).
//!
//! ## Como autoriza
//! Toda ação admin-org exige `org_admin` da **própria** org, com a org no escopo da sessão.
//! Isso é exatamente o [`Operacao::GerirOrg`](galaxie_platform_identity::Operacao) da
//! fundação (default-deny, escopo da sessão). Antes disso, a org é RESOLVIDA: org alheia
//! responde 404 (não 403 — não enumerar), via [`resolver_org`].
//!
//! Domínio PURO (como a fundação): a decisão é testável sem I/O. A borda HTTP e a
//! persistência dos recursos são fatias seguintes que chamam esta lógica.

#![forbid(unsafe_code)]

use galaxie_platform_identity::{
    autorizar, resolver_org, Decisao, Operacao, Org, OrgId, ResolveErro, Sessao,
};

/// Ações administrativas de uma org. Enum FECHADO: [`autorizar_acao_admin`] faz um `match`
/// EXAUSTIVO sem catch-all (doutrina #1000/#1456), então **acrescentar uma ação obriga a
/// decidir sua política** — não compila sem braço. Hoje todas colapsam pro mesmo gate
/// (`org_admin` da própria org); o `match` mantém a porta fechada por construção pra uma
/// ação futura que precise de política diferente (ex.: assinatura só pelo dono).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AcaoAdminOrg {
    ListarMembros,
    ConvidarMembro,
    RemoverMembro,
    MudarPapelMembro,
    /// Leitura dos domínios da org (`GET /orgs/{org}/dominios`, contrato §4.3 v1.3). Autorizada
    /// IGUAL à escrita de domínio (mesma org, papel org_admin) — "não se gere o que não se vê".
    ListarDominios,
    ReivindicarDominio,
    VerificarDominio,
    EditarSettings,
    GerirAssinatura,
}

/// Resultado negativo de uma ação admin. Dois motivos DISTINTOS, na ordem que não vaza
/// existência: `NaoEncontrada` (404) vem ANTES de `Negado` (403) — pedir org alheia não
/// confirma que ela existe.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdminErro {
    /// Org alheia (ou inexistente) para o solicitante: **404** (AC2) — não enumera.
    NaoEncontrada,
    /// Org VISÍVEL (o principal é membro), mas **suspensa**: **403 `org_suspensa`** (#1544). Vem
    /// ANTES de `Negado` — a suspensão é a razão GOVERNANTE: um `Member` de org suspensa tentando
    /// ação de admin tem de ver "org suspensa", não "papel insuficiente" (mentira útil pra ninguém).
    /// Só chega a quem enxerga a org; pra não-membro a suspensão é invisível (cai em `NaoEncontrada`).
    Suspensa,
    /// Org visível e ativa, mas o principal não é `org_admin` dela: **negado** (AC1/AC3).
    Negado,
}

/// A CAPACIDADE ([`Operacao`]) que uma ação admin-org exige. `match` EXAUSTIVO sem catch-all:
/// **variante nova NÃO COMPILA** até ganhar um braço aqui — e escolher o braço É a decisão
/// "isto é instância do esqueleto ratificado, ou é capacidade nova?".
///
/// Hoje TODA ação mapeia pra `GerirOrg { org }` (a `Operacao` ratificada da fundação #1469) — é o
/// braço que o gate estreitado do @Altair (#1538) declara self-merge. Uma variante que precise de
/// OUTRA `Operacao` é autz estruturalmente nova: o teste `toda_acao_admin_mapeia_para_a_operacao_
/// ratificada` fica VERMELHO, e esse vermelho é o gatilho pra chamar o arquiteto ANTES de mergear.
/// A guarda é mecânica (compilador + teste), não julgamento humano.
fn operacao_de(acao: &AcaoAdminOrg, org: &OrgId) -> Operacao {
    match acao {
        AcaoAdminOrg::ListarMembros
        | AcaoAdminOrg::ConvidarMembro
        | AcaoAdminOrg::RemoverMembro
        | AcaoAdminOrg::MudarPapelMembro
        | AcaoAdminOrg::ListarDominios
        | AcaoAdminOrg::ReivindicarDominio
        | AcaoAdminOrg::VerificarDominio
        | AcaoAdminOrg::EditarSettings
        | AcaoAdminOrg::GerirAssinatura => Operacao::GerirOrg { alvo: org.clone() },
    }
}

/// Autoriza uma `acao` admin sobre `org_alvo` para a `sessao`.
///
/// Ordem **visibilidade → suspensão → papel** (#1544, desenho do @Altair):
/// 1. **Visibilidade** ([`resolver_org`]): se o solicitante não vê a org (não é dela nem
///    staff) ⇒ `NaoEncontrada` (404, AC2), antes de qualquer 403. A suspensão é invisível a
///    não-membro — por isso vem depois da visibilidade (senão sondar suspensão viraria oráculo).
/// 2. **Suspensão** ([`Org::esta_suspensa`]): org visível mas suspensa ⇒ `Suspensa` (403
///    `org_suspensa`), ANTES do papel. A suspensão é a razão governante: um `Member` de org
///    suspensa vê "org suspensa", não "papel insuficiente".
/// 3. **Autorização** ([`autorizar`] da fundação): toda ação admin-org exige
///    `Operacao::GerirOrg` da própria org — `AdminOrg` no escopo (AC4). Um `Member` (mesmo
///    que o M365 o chame de "owner") ⇒ `Negado` (AC1/AC3).
///
/// **AC3 (corrigido no #1475):** NÃO é "estrutural por falta de parâmetro" — o claim do M365
/// (`Org.tenant_m365`) está DENTRO do `org_alvo: &Org`, alcançável aqui. A garantia é
/// COMPORTAMENTAL: esta função **nunca lê** `org_alvo.tenant_m365`; a única fonte de
/// autorização é a `Sessao` (o `Principal` da Galaxie). Provado por `ac3_claim_m365_nao_concede_admin`
/// (planta o claim + Member ⇒ `Negado`), que mata o mutante que leria o claim pra conceder.
#[must_use = "a decisão de autorização admin tem de ser respeitada — ignorá-la reabre AC1/AC2/AC3"]
pub fn autorizar_acao_admin(
    sessao: &Sessao,
    acao: &AcaoAdminOrg,
    org_alvo: &Org,
) -> Result<(), AdminErro> {
    // (1) VISIBILIDADE — 404 antes de tudo (regra 6 / AC2): org que o solicitante não vê "não
    // existe". A suspensão é INVISÍVEL para não-membro: sondar suspensão não pode virar oráculo de
    // existência, então a visibilidade vem ANTES da suspensão.
    resolver_org(sessao.principal(), org_alvo).map_err(|e| match e {
        ResolveErro::NaoEncontrada => AdminErro::NaoEncontrada,
    })?;

    // (2) SUSPENSÃO — a razão GOVERNANTE, ANTES do papel (#1544, desenho do @Altair). Lida do
    // `estado` da org (nunca de claim), por request. Um `Member` de org suspensa vê `Suspensa`, não
    // `Negado`: dizer "papel insuficiente" a quem a org está suspensa é mentira útil pra ninguém.
    if org_alvo.esta_suspensa() {
        return Err(AdminErro::Suspensa);
    }

    // (3) A CAPACIDADE que a ação exige. Extraído pra `operacao_de` — inspecionável sem passar
    // pela autorização inteira, e é onde a guarda do gate estreitado do @Altair mora (#1538).
    let op = operacao_de(acao, &org_alvo.id);

    match autorizar(sessao, &op) {
        Decisao::Permitido => Ok(()),
        Decisao::Negado => Err(AdminErro::Negado),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use galaxie_platform_identity::{Escopo, OrgId, Principal, Sessao, UserId};
    use std::collections::BTreeSet;

    fn org(id: &str) -> Org {
        Org::nova(OrgId(id.into()), BTreeSet::new(), None)
    }
    fn sessao_admin(user: &str, org_id: &str) -> Sessao {
        Sessao::estabelecer(
            Principal::AdminOrg { usuario: UserId(user.into()), org: OrgId(org_id.into()) },
            Escopo::de_orgs([OrgId(org_id.into())]),
        )
    }
    fn sessao_membro(user: &str, org_id: &str) -> Sessao {
        Sessao::estabelecer(
            Principal::UsuarioFinal { usuario: UserId(user.into()), org: OrgId(org_id.into()) },
            Escopo::de_orgs([OrgId(org_id.into())]),
        )
    }

    // AC1 — `member` (não admin) da própria org chama ação admin ⇒ negado (default-deny).
    #[test]
    fn ac1_member_nao_administra() {
        let s = sessao_membro("u1", "orgA");
        assert_eq!(
            autorizar_acao_admin(&s, &AcaoAdminOrg::RemoverMembro, &org("orgA")),
            Err(AdminErro::Negado)
        );
    }

    fn org_suspensa(id: &str) -> Org {
        let mut o = org(id);
        o.suspender();
        o
    }

    // #1544 — a suspensão CORTA o acesso: até um `AdminOrg` (papel de sobra) é negado numa org
    // suspensa. Sem a checagem, o admin passaria (a suspensão seria decorativa, o furo que o Altair
    // apontou no #1551 v1). Um mutante que remova o `if esta_suspensa` deixa o admin entrar → morre aqui.
    #[test]
    fn suspensa_corta_ate_o_admin() {
        let s = sessao_admin("u1", "orgA");
        assert_eq!(
            autorizar_acao_admin(&s, &AcaoAdminOrg::ListarMembros, &org_suspensa("orgA")),
            Err(AdminErro::Suspensa),
            "org suspensa nega mesmo quem tem papel de admin"
        );
    }

    // #1544 — a ORDEM é visibilidade→SUSPENSÃO→papel: um `Member` de org suspensa vê `Suspensa`,
    // NÃO `Negado`. A suspensão é a razão governante e vem antes do papel. Um mutante que cheque o
    // papel primeiro devolveria `Negado` ("papel insuficiente") — mentira útil pra ninguém. Morre aqui.
    #[test]
    fn suspensa_vem_antes_do_papel() {
        let s = sessao_membro("u1", "orgA");
        assert_eq!(
            autorizar_acao_admin(&s, &AcaoAdminOrg::RemoverMembro, &org_suspensa("orgA")),
            Err(AdminErro::Suspensa),
            "membro de org suspensa vê Suspensa, não Negado (suspensão governa o papel)"
        );
    }

    // #1544 — a suspensão é INVISÍVEL para não-membro: visibilidade vem ANTES da suspensão, senão
    // sondar "está suspensa?" viraria oráculo de existência. Um usuário de OUTRA org pedindo uma org
    // suspensa alheia recebe `NaoEncontrada` (404), idêntico a org inexistente — não `Suspensa`.
    #[test]
    fn suspensa_e_invisivel_para_nao_membro() {
        let forasteiro = sessao_membro("u1", "orgB"); // membro da orgB, não da orgA
        assert_eq!(
            autorizar_acao_admin(&forasteiro, &AcaoAdminOrg::ListarMembros, &org_suspensa("orgA")),
            Err(AdminErro::NaoEncontrada),
            "não-membro não descobre a suspensão da org alheia (visibilidade antes de suspensão)"
        );
    }

    // AC3 (correção do #1475 — o teste que FALTAVA; reprovação da @Lumen procedente): o
    // claim do M365 na `Org` (`tenant_m365: Some(...)`) NÃO concede admin. Um MEMBER da
    // própria org, MESMO com a org carregando um tenant M365, segue NEGADO —
    // `autorizar_acao_admin` nunca lê `org_alvo.tenant_m365`. Os fixtures antigos tinham
    // `tenant_m365: None` em todos, então o cenário "M365 presente" só existia no comentário;
    // um mutante lendo o claim pra conceder passaria com o CI verde. Este planta o claim e o mata.
    #[test]
    fn ac3_claim_m365_nao_concede_admin() {
        let org_com_m365 = Org::nova(
            OrgId("orgA".into()),
            BTreeSet::new(),
            Some("tenant-graph-do-cliente".into()),
        );
        let membro = sessao_membro("u1", "orgA");
        // TODAS as 8 ações, não só uma (medição da @Lumen no re-gate): testar uma célula
        // deixa fuga POR AÇÃO — um mutante escopado a `GerirAssinatura` (o dano máximo que o
        // @Altair nomeou: "a Microsoft passa a decidir quem gere a ASSINATURA") passaria com
        // uma ação só. O laço mata a fuga ampla E qualquer fuga por ação. Mesmo idiom do ac4.
        for acao in [
            AcaoAdminOrg::ListarMembros,
            AcaoAdminOrg::ConvidarMembro,
            AcaoAdminOrg::RemoverMembro,
            AcaoAdminOrg::MudarPapelMembro,
            AcaoAdminOrg::ReivindicarDominio,
            AcaoAdminOrg::VerificarDominio,
            AcaoAdminOrg::EditarSettings,
            AcaoAdminOrg::GerirAssinatura,
        ] {
            assert_eq!(
                autorizar_acao_admin(&membro, &acao, &org_com_m365),
                Err(AdminErro::Negado),
                "o tenant M365 na Org não pode conceder {acao:?} a um member (role do Graph ≠ autz)"
            );
        }
    }

    // AC2 — `org_admin` de A tenta gerir a org B ⇒ 404 (NaoEncontrada), não 403.
    #[test]
    fn ac2_org_alheia_e_404_nao_403() {
        let s = sessao_admin("u1", "orgA");
        assert_eq!(
            autorizar_acao_admin(&s, &AcaoAdminOrg::ListarMembros, &org("orgB")),
            Err(AdminErro::NaoEncontrada)
        );
    }

    // AC3 — o `role` do M365 NÃO concede. Modelamos o usuário que a Microsoft chamaria de
    // "owner", mas que na Galaxie é só `Member` (o `org_admin` não foi concedido no nosso
    // backend). A autorização lê o `Principal` (Member) — não há por onde um role de Graph
    // entrar — ⇒ negado. É a armadilha central do card.
    #[test]
    fn ac3_role_m365_owner_nao_vira_autorizacao() {
        // "seria owner no M365"; na Galaxie, Member:
        let quase_admin = sessao_membro("u1", "orgA");
        assert_eq!(
            autorizar_acao_admin(&quase_admin, &AcaoAdminOrg::GerirAssinatura, &org("orgA")),
            Err(AdminErro::Negado),
            "role 'owner' do M365 não pode virar autorização — só AdminOrg da Galaxie"
        );
    }

    // AC4 — `org_admin` Galaxie gere a PRÓPRIA org (com a org no escopo) ⇒ permitido, em
    // todas as ações admin.
    #[test]
    fn ac4_org_admin_gere_a_propria_org() {
        let s = sessao_admin("u1", "orgA");
        for acao in [
            AcaoAdminOrg::ListarMembros,
            AcaoAdminOrg::ConvidarMembro,
            AcaoAdminOrg::RemoverMembro,
            AcaoAdminOrg::MudarPapelMembro,
            AcaoAdminOrg::ReivindicarDominio,
            AcaoAdminOrg::VerificarDominio,
            AcaoAdminOrg::EditarSettings,
            AcaoAdminOrg::GerirAssinatura,
        ] {
            assert_eq!(
                autorizar_acao_admin(&s, &acao, &org("orgA")),
                Ok(()),
                "org_admin devia poder {acao:?} na própria org"
            );
        }
    }

    // Fronteira staff: staff VÊ qualquer org (resolver_org), mas NÃO é `org_admin` — o
    // back-office (provisionar/suspender) é ProvisionarOrg, não GerirOrg. Então staff não
    // gere membros de uma org cliente por aqui ⇒ negado (separação staff↔admin-de-org).
    #[test]
    fn staff_ve_a_org_mas_nao_e_org_admin() {
        let s = Sessao::estabelecer(
            Principal::Staff { usuario: UserId("s1".into()) },
            Escopo::vazio(),
        );
        assert_eq!(
            autorizar_acao_admin(&s, &AcaoAdminOrg::RemoverMembro, &org("orgA")),
            Err(AdminErro::Negado)
        );
    }

    // AC4/escopo — admin legítimo mas SEM a org no escopo da sessão ⇒ negado (escopo vem da
    // sessão, não do payload; regra 5 da fundação).
    #[test]
    fn admin_sem_org_no_escopo_e_negado() {
        let s = Sessao::estabelecer(
            Principal::AdminOrg { usuario: UserId("u1".into()), org: OrgId("orgA".into()) },
            Escopo::vazio(),
        );
        assert_eq!(
            autorizar_acao_admin(&s, &AcaoAdminOrg::EditarSettings, &org("orgA")),
            Err(AdminErro::Negado)
        );
    }

    // ⚠️ A GUARDA do gate estreitado do @Altair (#1538): toda ação admin-org mapeia pra a `Operacao`
    // RATIFICADA (`GerirOrg`). A LISTA É LITERAL DE PROPÓSITO — não um `for` sobre variantes
    // derivadas: o valor está em quem acrescentar uma variante ter de ADICIONÁ-LA aqui à mão, e
    // nesse momento perguntar-se se é mesmo instância do esqueleto ratificado. Se uma variante nova
    // sair de `GerirOrg`, este teste fica VERMELHO — o convite pra CHAMAR O ARQUITETO antes de
    // mergear. Tira a classificação "instância ou autz nova?" do julgamento e põe no compilador+teste.
    #[test]
    fn toda_acao_admin_mapeia_para_a_operacao_ratificada() {
        let alvo = OrgId("acme".into());
        for acao in [
            AcaoAdminOrg::ListarMembros,
            AcaoAdminOrg::ConvidarMembro,
            AcaoAdminOrg::RemoverMembro,
            AcaoAdminOrg::MudarPapelMembro,
            AcaoAdminOrg::ListarDominios,
            AcaoAdminOrg::ReivindicarDominio,
            AcaoAdminOrg::VerificarDominio,
            AcaoAdminOrg::EditarSettings,
            AcaoAdminOrg::GerirAssinatura,
        ] {
            assert_eq!(
                operacao_de(&acao, &alvo),
                Operacao::GerirOrg { alvo: alvo.clone() },
                "{acao:?} saiu da Operacao ratificada (GerirOrg) — é autz nova, CHAMA O ARQUITETO antes de mergear"
            );
        }
    }
}
