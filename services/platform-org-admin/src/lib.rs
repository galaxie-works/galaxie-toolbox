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

use galaxie_platform_identity::armazem::Membro;
use galaxie_platform_identity::auditoria::{Alvo, Auditor, EventoAutz, ResultadoAutz};
use galaxie_platform_identity::{
    autorizar, resolver_org, Decisao, Operacao, Org, OrgId, Papel, ResolveErro, Sessao, UserId,
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

impl AcaoAdminOrg {
    /// Nome ESTÁVEL e namespaced da ação, para a auditoria (#1571 cond. 1 do @Altair). `match`
    /// EXAUSTIVO sem `_`: ação nova não compila até ganhar seu nome aqui — o `&str` do fio é
    /// produzido pelo enum FECHADO, nunca por um literal de call site (typo não vira registro de
    /// auditoria errado). Namespace `org_admin.` não colide com `back_office.` na mesma trilha.
    #[must_use]
    pub fn acao_nome(&self) -> &'static str {
        match self {
            AcaoAdminOrg::ListarMembros => "org_admin.listar_membros",
            AcaoAdminOrg::ConvidarMembro => "org_admin.convidar_membro",
            AcaoAdminOrg::RemoverMembro => "org_admin.remover_membro",
            AcaoAdminOrg::MudarPapelMembro => "org_admin.mudar_papel_membro",
            AcaoAdminOrg::ListarDominios => "org_admin.listar_dominios",
            AcaoAdminOrg::ReivindicarDominio => "org_admin.reivindicar_dominio",
            AcaoAdminOrg::VerificarDominio => "org_admin.verificar_dominio",
            AcaoAdminOrg::EditarSettings => "org_admin.editar_settings",
            AcaoAdminOrg::GerirAssinatura => "org_admin.gerir_assinatura",
        }
    }

    /// Nome do evento da REGRA DE NEGÓCIO org-não-órfã (#1620), distinto do de acesso ([`acao_nome`](Self::acao_nome))
    /// pra um painel poder separar sondagem (recusa de acesso) de atrito normal (recusa da guarda) —
    /// ver [`auditar_guarda_orfa`]. `Some` só nas ações que MEXEM na contagem de admin
    /// (`Remover`/`MudarPapel`); as outras não têm regra a auditar ⇒ `None` (o `_` aqui é seguro: não
    /// produz nome, não há typo silencioso — ao contrário do `acao_nome`, que emite sempre).
    #[must_use]
    pub fn nome_guarda_orfa(&self) -> Option<&'static str> {
        match self {
            AcaoAdminOrg::RemoverMembro => Some("org_admin.remover_membro.guarda_orfa"),
            AcaoAdminOrg::MudarPapelMembro => Some("org_admin.mudar_papel_membro.guarda_orfa"),
            _ => None,
        }
    }
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
    /// A ação deixaria a org com ZERO `OrgAdmin` (remover/rebaixar o ÚLTIMO admin) — recusada por
    /// **construção** (#1620, fatia 1 do #1569). Distinto de `Negado`: o solicitante PODE ter papel
    /// (é admin), mas a org **não pode ficar órfã** — e o utilizador conserta isto sozinho
    /// (**promovendo outro admin antes**). Não é política (nenhum knob do PO torna "org sem dono"
    /// aceitável) — é invariante. Vale inclusive pra auto-remoção (o alvo é o próprio principal).
    UltimoAdmin,
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
/// **AUDITA nos DOIS ramos (#1571, simetria com `autorizar_back_office`):** toda decisão —
/// permitida E negada (incl. `NaoEncontrada`/`Suspensa`) — emite um [`EventoAutz`] pelo
/// `auditor`, obrigatório na assinatura. Como é a FUNÇÃO que emite (não o handler), superfície
/// nova nasce auditada — "auditado" vira propriedade da autz, não de quem a chamou. O negado é o
/// sinal (admin sem papel, org invisível/suspensa); só o sucesso perderia dez tentativas seguidas.
#[must_use = "a decisão de autorização admin tem de ser respeitada — ignorá-la reabre AC1/AC2/AC3"]
pub fn autorizar_acao_admin(
    sessao: &Sessao,
    acao: &AcaoAdminOrg,
    org_alvo: &Org,
    auditor: &dyn Auditor,
) -> Result<(), AdminErro> {
    let resultado = decidir_acao_admin(sessao, acao, org_alvo);
    // EMITE SEMPRE, antes de devolver — os dois ramos. O ator é o principal que tentou (id, nunca
    // claim); o alvo é o **id** da org (nunca o `Org`/claims). O nome vem do `acao_nome()` fechado.
    auditor.registrar(&EventoAutz {
        ator: sessao.principal().usuario(),
        acao: acao.acao_nome(),
        alvo: Alvo::Org(&org_alvo.id),
        resultado: if resultado.is_ok() { ResultadoAutz::Permitido } else { ResultadoAutz::Negado },
    });
    resultado
}

/// Audita o desfecho da **REGRA DE NEGÓCIO** org-não-órfã sobre uma mutação de membro que a autz
/// base JÁ PERMITIU (#1620, Fork 1 do @Altair). Evento **SEPARADO** do de ACESSO
/// ([`autorizar_acao_admin`]): recusa de acesso = sinal de SONDAGEM (papel insuficiente, org
/// invisível); recusa da regra = ATRITO NORMAL (o admin tentou tirar o último admin) — um painel que
/// conte "negações" não pode somar os dois, então o nome da ação é distinto (`*.guarda_orfa`).
///
/// **Emite SEMPRE que a base permitiu, nos DOIS desfechos** (mutou / recusou-órfã), pra que a
/// AUSÊNCIA deste evento signifique EXATAMENTE "a base negou" — propriedade DERIVÁVEL, não
/// convencionada (senão a base emite `Permitido` e uma recusa da regra deixaria esse `Permitido`
/// solto, que se lê como "aconteceu"). `orfa_recusada` = o desfecho AUTORITATIVO do store
/// (`MutacaoMembro::Recusada`), não o palpite do snapshot — os dois podem divergir sob corrida, e é o
/// store que decide. Ações que não tocam a contagem de admin ([`AcaoAdminOrg::nome_guarda_orfa`] =
/// `None`) não emitem — não há regra de negócio a auditar.
pub fn auditar_guarda_orfa(
    sessao: &Sessao,
    acao: &AcaoAdminOrg,
    org_alvo_id: &OrgId,
    orfa_recusada: bool,
    auditor: &dyn Auditor,
) {
    let Some(nome) = acao.nome_guarda_orfa() else {
        return;
    };
    auditor.registrar(&EventoAutz {
        ator: sessao.principal().usuario(),
        acao: nome,
        alvo: Alvo::Org(org_alvo_id),
        resultado: if orfa_recusada { ResultadoAutz::Negado } else { ResultadoAutz::Permitido },
    });
}

/// ⚠️ **NÃO-AUTORITATIVA** (#1620, emenda do @Altair). Predicado PURO da invariante org-não-órfã: a
/// ação deixaria a org com ZERO `OrgAdmin`? Serve de **advisory/UX** (cinzar o botão "remover" antes
/// do clique) e de **enunciado testável** da política — mas **quem GARANTE a invariante é o store**
/// ([`ArmazemMembro::remover_preservando`]/[`mudar_papel_preservando`](galaxie_platform_identity::armazem::ArmazemMembro::mudar_papel_preservando)),
/// que decide-e-muta sob o MESMO lock. **NUNCA** use isto pra decidir uma mutação na borda: ler aqui
/// e mutar depois é o TOCTOU que o #1620 fecha (dois pedidos concorrentes furam esta checagem). É por
/// isso que a guarda do store é "redundante" com esta — e é a redundância que garante; apagá-la
/// reabre o race (o teste de concorrência do store ancora isto).
///
/// Conta os admins ATUAIS e simula o efeito sobre o `alvo`. Recusa (`UltimoAdmin`) se o `alvo` é o
/// ÚNICO admin e a ação o remove (`RemoverMembro`) ou o rebaixa (`MudarPapelMembro` p/ papel
/// não-admin). Vale pra auto-remoção. Tirar um NÃO-admin, ou mexer num admin quando há OUTROS, passa.
#[must_use = "advisory: o resultado orienta a UI, mas quem enforça é o store (_preservando)"]
pub fn decidir_nao_orfa(
    membros: &[Membro],
    alvo: &UserId,
    acao: &AcaoAdminOrg,
    novo_papel: Option<Papel>,
) -> Result<(), AdminErro> {
    let tira_admin = match acao {
        AcaoAdminOrg::RemoverMembro => true, // remove o alvo inteiro
        // rebaixar = novo papel NÃO é admin; promover/manter admin não reduz a contagem.
        AcaoAdminOrg::MudarPapelMembro => novo_papel != Some(Papel::OrgAdmin),
        _ => return Ok(()), // nenhuma outra ação mexe na contagem de admin
    };
    if !tira_admin {
        return Ok(());
    }
    // Só importa se o alvo É admin — tirar um não-admin nunca orfaniza.
    let alvo_e_admin = membros.iter().any(|m| &m.uid == alvo && m.papel == Papel::OrgAdmin);
    if !alvo_e_admin {
        return Ok(());
    }
    // Se o alvo é o ÚNICO admin, a ação deixaria a org com ZERO ⇒ recusa.
    let admins = membros.iter().filter(|m| m.papel == Papel::OrgAdmin).count();
    if admins <= 1 {
        return Err(AdminErro::UltimoAdmin);
    }
    Ok(())
}

/// A DECISÃO pura (sem auditoria), na ordem que não vaza: visibilidade (404) → suspensão (403) →
/// capacidade (403). Separada pra [`autorizar_acao_admin`] auditar AMBOS os ramos sem duplicar a
/// lógica. Privada: a auditoria é obrigatória, então ninguém chama a decisão sem emitir.
fn decidir_acao_admin(
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
    use galaxie_platform_identity::auditoria::AlvoDono;
    use galaxie_platform_identity::{Escopo, OrgId, Principal, Sessao, UserId};
    use std::cell::RefCell;
    use std::collections::BTreeSet;

    /// Auditor no-op pros testes de DECISÃO (a EMISSÃO é testada à parte, com o espião).
    struct AuditorNulo;
    impl Auditor for AuditorNulo {
        fn registrar(&self, _e: &EventoAutz) {}
    }
    /// Atalho: decide com auditor nulo — os testes de decisão não checam a emissão.
    fn autz(s: &Sessao, acao: &AcaoAdminOrg, org_alvo: &Org) -> Result<(), AdminErro> {
        autorizar_acao_admin(s, acao, org_alvo, &AuditorNulo)
    }

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
            autz(&s, &AcaoAdminOrg::RemoverMembro, &org("orgA")),
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
            autz(&s, &AcaoAdminOrg::ListarMembros, &org_suspensa("orgA")),
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
            autz(&s, &AcaoAdminOrg::RemoverMembro, &org_suspensa("orgA")),
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
            autz(&forasteiro, &AcaoAdminOrg::ListarMembros, &org_suspensa("orgA")),
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
                autz(&membro, &acao, &org_com_m365),
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
            autz(&s, &AcaoAdminOrg::ListarMembros, &org("orgB")),
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
            autz(&quase_admin, &AcaoAdminOrg::GerirAssinatura, &org("orgA")),
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
                autz(&s, &acao, &org("orgA")),
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
            autz(&s, &AcaoAdminOrg::RemoverMembro, &org("orgA")),
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
            autz(&s, &AcaoAdminOrg::EditarSettings, &org("orgA")),
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

    // ---- #1571: a autz EMITE auditoria nos DOIS ramos (simetria com o back-office) ----

    /// (ator, nome da ação, alvo, resultado) — o que o espião captura de cada `EventoAutz`.
    type EventoEspiado = (UserId, String, AlvoDono, ResultadoAutz);
    #[derive(Default)]
    struct AuditorEspiao {
        eventos: RefCell<Vec<EventoEspiado>>,
    }
    impl Auditor for AuditorEspiao {
        fn registrar(&self, e: &EventoAutz) {
            self.eventos
                .borrow_mut()
                .push((e.ator.clone(), e.acao.to_string(), e.alvo.para_dono(), e.resultado));
        }
    }

    // AC1+AC2 — permitido E negado emitem; o negado registra o ATOR e a ação tentada (a superfície
    // grande que estava CEGA). Mutante que emitisse só num ramo faz `len()` cair pra 1.
    #[test]
    fn autz_emite_evento_em_permitido_e_negado() {
        let espiao = AuditorEspiao::default();
        assert!(autorizar_acao_admin(
            &sessao_admin("u1", "orgA"),
            &AcaoAdminOrg::ListarMembros,
            &org("orgA"),
            &espiao
        )
        .is_ok());
        assert!(autorizar_acao_admin(
            &sessao_membro("u2", "orgA"),
            &AcaoAdminOrg::RemoverMembro,
            &org("orgA"),
            &espiao
        )
        .is_err());

        let ev = espiao.eventos.borrow();
        assert_eq!(ev.len(), 2, "toda decisão emite — não só o sucesso");
        assert_eq!(
            ev[0],
            (UserId("u1".into()), "org_admin.listar_membros".to_string(),
             AlvoDono::Org(OrgId("orgA".into())), ResultadoAutz::Permitido)
        );
        assert_eq!(
            ev[1],
            (UserId("u2".into()), "org_admin.remover_membro".to_string(),
             AlvoDono::Org(OrgId("orgA".into())), ResultadoAutz::Negado),
            "o negado registra ator+ação tentada — a superfície grande não some"
        );
    }

    // O ramo NaoEncontrada (org invisível ao solicitante) TAMBÉM audita (Negado): tentar admin numa
    // org que não se vê é sinal, e o alvo nomeia o que se tentou tocar.
    #[test]
    fn autz_audita_ate_org_invisivel() {
        let espiao = AuditorEspiao::default();
        let forasteiro = sessao_admin("x", "outra"); // admin de OUTRA org — orgA é invisível
        assert_eq!(
            autorizar_acao_admin(&forasteiro, &AcaoAdminOrg::ListarMembros, &org("orgA"), &espiao),
            Err(AdminErro::NaoEncontrada)
        );
        let ev = espiao.eventos.borrow();
        assert_eq!(ev.len(), 1);
        assert_eq!(ev[0].3, ResultadoAutz::Negado, "org invisível também vira evento negado auditado");
        assert_eq!(ev[0].2, AlvoDono::Org(OrgId("orgA".into())), "o alvo nomeia a org que ele tentou tocar");
    }

    // ── #1620: org não fica órfã (recusar o último OrgAdmin sair) ──────────────────────────────────
    fn membro(uid: &str, papel: Papel) -> Membro {
        Membro { uid: UserId(uid.into()), nome: uid.into(), email: format!("{uid}@x.com"), papel }
    }
    // `decidir_nao_orfa` é o predicado ADVISORY puro (não-autoritativo): sem sessão, sem auditor. O
    // ENFORÇO atómico é testado no store (`armazem::tests`); aqui só o enunciado da política.
    fn orfa(membros: &[Membro], alvo: &str, acao: &AcaoAdminOrg, novo_papel: Option<Papel>) -> Result<(), AdminErro> {
        decidir_nao_orfa(membros, &UserId(alvo.into()), acao, novo_papel)
    }

    /// **DoD (caso próprio):** o último admin a remover-se A SI MESMO é recusado (advisory).
    #[test]
    fn auto_remocao_do_ultimo_admin_e_recusada() {
        let membros = [membro("a1", Papel::OrgAdmin), membro("m2", Papel::Member)];
        assert_eq!(orfa(&membros, "a1", &AcaoAdminOrg::RemoverMembro, None), Err(AdminErro::UltimoAdmin));
    }

    /// **DoD (MUTANTE):** remover um admin quando há DOIS PASSA — senão a guarda é "recusa sempre" e
    /// ninguém nota. Mata o mutante que ignora a contagem.
    #[test]
    fn remover_admin_com_dois_admins_passa() {
        let membros = [membro("a1", Papel::OrgAdmin), membro("a2", Papel::OrgAdmin)];
        assert_eq!(orfa(&membros, "a2", &AcaoAdminOrg::RemoverMembro, None), Ok(()));
    }

    /// Rebaixar o ÚLTIMO admin (`MudarPapel` p/ `Member`) é recusado (deixaria zero admin).
    #[test]
    fn rebaixar_ultimo_admin_e_recusado() {
        let membros = [membro("a1", Papel::OrgAdmin), membro("m2", Papel::Member)];
        assert_eq!(
            orfa(&membros, "a1", &AcaoAdminOrg::MudarPapelMembro, Some(Papel::Member)),
            Err(AdminErro::UltimoAdmin)
        );
    }

    /// Promover um `Member` a admin NUNCA orfaniza (não reduz a contagem) — passa mesmo com 1 admin.
    #[test]
    fn promover_a_admin_passa() {
        let membros = [membro("a1", Papel::OrgAdmin), membro("m2", Papel::Member)];
        assert_eq!(orfa(&membros, "m2", &AcaoAdminOrg::MudarPapelMembro, Some(Papel::OrgAdmin)), Ok(()));
    }

    /// Remover/rebaixar um NÃO-admin nunca orfaniza, mesmo com 1 só admin.
    #[test]
    fn tirar_nao_admin_passa() {
        let membros = [membro("a1", Papel::OrgAdmin), membro("m2", Papel::Member)];
        assert_eq!(orfa(&membros, "m2", &AcaoAdminOrg::RemoverMembro, None), Ok(()));
    }

    // ── Fork 1 (@Altair): o evento de REGRA DE NEGÓCIO é SEPARADO do de acesso e emite nos DOIS
    // desfechos quando a base permitiu, pra que "ausência do 2º evento ⟺ base negou" seja derivável.
    #[test]
    fn guarda_orfa_emite_evento_separado_nos_dois_desfechos() {
        let espiao = AuditorEspiao::default();
        let s = sessao_admin("a1", "orgA");
        // recusada (store diria Recusada) ⇒ Negado, com nome de ação DISTINTO do de acesso.
        auditar_guarda_orfa(&s, &AcaoAdminOrg::RemoverMembro, &OrgId("orgA".into()), true, &espiao);
        // permitida (store diria Feita/NaoEraMembro) ⇒ Permitido.
        auditar_guarda_orfa(&s, &AcaoAdminOrg::MudarPapelMembro, &OrgId("orgA".into()), false, &espiao);
        // ação que não mexe na contagem ⇒ NÃO emite (sem regra de negócio a auditar).
        auditar_guarda_orfa(&s, &AcaoAdminOrg::ListarMembros, &OrgId("orgA".into()), false, &espiao);

        let ev = espiao.eventos.borrow();
        assert_eq!(ev.len(), 2, "só as ações que tocam a contagem emitem regra-de-negócio");
        assert_eq!(
            ev[0],
            (UserId("a1".into()), "org_admin.remover_membro.guarda_orfa".to_string(),
             AlvoDono::Org(OrgId("orgA".into())), ResultadoAutz::Negado),
            "recusa da guarda = evento próprio (.guarda_orfa), Negado — separável da recusa de acesso"
        );
        assert_eq!(ev[1].1, "org_admin.mudar_papel_membro.guarda_orfa");
        assert_eq!(ev[1].3, ResultadoAutz::Permitido, "base permitiu + guarda não recusou ⇒ Permitido");
    }

    // A base de acesso e a regra de negócio têm nomes de ação DISTINTOS — um painel os separa.
    #[test]
    fn nome_guarda_orfa_so_nas_mutacoes() {
        assert_eq!(AcaoAdminOrg::RemoverMembro.nome_guarda_orfa(), Some("org_admin.remover_membro.guarda_orfa"));
        assert_eq!(AcaoAdminOrg::MudarPapelMembro.nome_guarda_orfa(), Some("org_admin.mudar_papel_membro.guarda_orfa"));
        assert_ne!(AcaoAdminOrg::RemoverMembro.nome_guarda_orfa(), Some(AcaoAdminOrg::RemoverMembro.acao_nome()));
        assert_eq!(AcaoAdminOrg::ListarMembros.nome_guarda_orfa(), None);
        assert_eq!(AcaoAdminOrg::EditarSettings.nome_guarda_orfa(), None);
    }
}
