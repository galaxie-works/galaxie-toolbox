//! Fundação de identidade/autorização da plataforma web — #1469 (épico #1265).
//!
//! Bedrock: os 7 cards da plataforma perguntam "quem pode?" e nada responde antes daqui.
//! Esta fatia 1 é a LÓGICA de domínio — principal + tenancy + papel + autorização
//! default-deny — sem I/O (persistência e borda HTTP são fatias seguintes que dependem
//! desta). Doutrina medida pelo @Altair no #1265; as três armadilhas que a fundação fecha:
//!
//!  (a) `MultiTenantMember.role` (M365, `api.ts:1657`) NÃO é autorização — se vazar, a
//!      topologia de tenants da Microsoft passa a decidir quem administra uma org Galaxie.
//!      Por isso o papel daqui é um tipo PRÓPRIO, sem ponte com o role do Graph.
//!  (b) Domínio de e-mail (`organizations.ts:107` `resolverOrgStatus`) NÃO é a raiz — senão
//!      quem controla o DNS/e-mail do domínio controla a org e a fatura. Domínio é um CLAIM
//!      associado à org, nunca a identidade dela.
//!  (c) Sessão web ≠ credencial de device (Remote autoriza MÁQUINAS via OPAQUE+PoP em
//!      `authority.rs`; a web autoriza HUMANOS). São tipos diferentes e não se fundem — uma
//!      `Sessao` web nunca vira credencial de device. Aqui isso é garantido no TIPO: este
//!      crate não conhece nenhuma operação de device, e não há conversão pra fora.
//!
//! Regras da fundação (todas exercidas por teste abaixo):
//!  1. Org é ENTIDADE com id próprio — domínio e tenant M365 são claims, nunca a identidade.
//!  2. Papel nasce mínimo: `Member` e `OrgAdmin` (acrescentar é barato, tirar não).
//!  3. TRÊS tipos de principal, não um com flags — e **staff não é papel dentro de org**
//!     (senão um `org_admin` o concederia e o back-office ficaria alcançável de dentro).
//!  4. Autorização default-deny no servidor, `match` de operação EXAUSTIVO sem catch-all.
//!  5. Escopo vem da SESSÃO, nunca do payload; omissão = vazio, não "todos".
//!  6. Org de outra pessoa não existe: `NaoEncontrada` (404), não `Negado` (403) — não
//!     enumerar orgs alheias.

#![forbid(unsafe_code)]

use std::collections::BTreeSet;

/// Ciclo de vida da sessão web (fatia 2): armazém server-side + política de cookie.
pub mod sessao;

/// Persistência do domínio (#1505 (a), @Altair): traits de armazém das entidades (`ArmazemOrg`, …)
/// no crate que POSSUI a entidade, com `Result` desde o dia um. Impl em memória; Postgres é fatia.
pub mod armazem;

/// Auditoria de decisões de autz (#1571, @Altair): o sink (`Auditor`) e o evento SEMÂNTICO
/// (`EventoAutz`) na FUNDAÇÃO, pra TODA função de autz (back-office, admin-org, e as próximas)
/// emitir pelo MESMO sink — "auditado" vira propriedade da autz, não de qual crate a chamou.
pub mod auditoria;

/// Id opaco de um humano. Newtype pra não confundir com `OrgId` nem com um id de device.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct UserId(pub String);

/// Id PRÓPRIO da org (regra 1). NÃO é o domínio do e-mail nem o `tenantId` do M365 —
/// esses são claims (ver [`Org`]). É o newtype que ancora toda autorização por org.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct OrgId(pub String);

/// Papel de autorização DENTRO de uma org (regra 2). Nasce mínimo. É um tipo próprio,
/// deliberadamente SEM `From`/ponte com o `role` do M365 (armadilha (a)).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Papel {
    Member,
    OrgAdmin,
}

/// Principal — TRÊS tipos, não um com flags (regra 3). O tipo (não uma flag) carrega a
/// fronteira de confiança; a mais dura é staff↔cliente. `Staff` é um VARIANTE à parte
/// justamente pra não existir um `Papel::Staff` que um `org_admin` pudesse conceder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Principal {
    /// Humano de uma org cliente, papel `Member`.
    UsuarioFinal { usuario: UserId, org: OrgId },
    /// Humano de uma org cliente, papel `OrgAdmin` (administra a PRÓPRIA org).
    AdminOrg { usuario: UserId, org: OrgId },
    /// Staff da Galaxie — concedido FORA DE BANDA, sem org cliente. Não é papel de org.
    Staff { usuario: UserId },
}

impl Principal {
    /// A org à qual o principal pertence, quando aplicável. Staff não pertence a org cliente.
    pub fn org(&self) -> Option<&OrgId> {
        match self {
            Principal::UsuarioFinal { org, .. } | Principal::AdminOrg { org, .. } => Some(org),
            Principal::Staff { .. } => None,
        }
    }

    /// O papel dentro da org, quando aplicável. Deriva do TIPO (não de uma flag) — e não
    /// existe papel que represente staff (regra 3).
    pub fn papel(&self) -> Option<Papel> {
        match self {
            Principal::UsuarioFinal { .. } => Some(Papel::Member),
            Principal::AdminOrg { .. } => Some(Papel::OrgAdmin),
            Principal::Staff { .. } => None,
        }
    }

    pub fn eh_staff(&self) -> bool {
        matches!(self, Principal::Staff { .. })
    }

    /// O usuário por trás do principal. Todo tipo carrega um `UserId` (inclusive staff) —
    /// é a âncora pra invalidar TODAS as sessões de um humano na troca de senha (fatia 2).
    pub fn usuario(&self) -> &UserId {
        match self {
            Principal::UsuarioFinal { usuario, .. }
            | Principal::AdminOrg { usuario, .. }
            | Principal::Staff { usuario } => usuario,
        }
    }
}

/// Ciclo de vida da org (#1544 / contrato §4.5). `Provisionada` = ativa; `Suspensa` = acesso
/// CORTADO (o PO decidiu "derruba o acesso"). Enum FECHADO: a autz faz `match` exaustivo, então
/// um estado novo OBRIGA a decidir sua política (não há default permissivo). O *enforcement*
/// (#1544, próxima fatia) é que LERÁ este estado — a autz de org consulta [`Org::esta_suspensa`]
/// antes do papel e devolve o negado de suspensão; **esta fatia entrega o tipo + o contrato, não o
/// enforcement** (nenhuma linha de produção lê `estado` ainda). A autz nunca lê claim
/// (`tenant_m365`/`dominios`) — ler `estado` é exatamente o que ela deve fazer, ler claim não.
///
/// Condição do @Altair (ratificada com o `estado`): **desconhecido no FE = neutro, nunca
/// permissivo** — mas isso é do lado do FE (forward-compat de string); aqui, no BE, o enum é
/// fechado e não existe "desconhecido".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EstadoOrg {
    /// Org ativa — o caminho normal.
    Provisionada,
    /// Org suspensa — ação org-scoped é NEGADA (`OrgSuspensa`, 403), lida do armazém a cada
    /// request (vale no ato, sem corrida de "matar sessões"). Sobrevivem: `/me`, `/me/orgs`,
    /// `DELETE /session` — senão o usuário não alcança a tela que explica a suspensão.
    Suspensa,
}

/// Org como ENTIDADE (regra 1): id próprio + claims associados (domínio, tenant M365) + o
/// ESTADO do ciclo de vida (#1544). Os claims MAPEIAM pra org, mas não SÃO a org — quem controla
/// o domínio não controla a entidade (armadilha (b)).
///
/// **`estado` é PRIVADO e só muda por TRANSIÇÃO** (condição 1 do @Altair): nasce `Provisionada`
/// em [`Org::nova`], vira `Suspensa` por [`Org::suspender`] e VOLTA por [`Org::reativar`] — não há
/// literal público nem setter, então ninguém forja "suspensa" (ou "não suspensa") por fora. As duas
/// transições existem porque "suspender" lê-se como REVERSÍVEL em qualquer produto (uma org suspensa
/// por falta de pagamento tem de poder voltar); a porta de mão única era uma lacuna (@Altair na review
/// do #1551). O PESO da reativação (staff comum? exige mais?) é decisão do PO — mora na AUTZ, não no
/// tipo. Leitura por [`Org::estado`]/[`Org::esta_suspensa`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Org {
    pub id: OrgId,
    /// Domínios reivindicados (claim). Presença aqui não concede papel a ninguém.
    pub dominios: BTreeSet<String>,
    /// `tenantId` do Microsoft 365, quando houver (claim associado, não a identidade).
    pub tenant_m365: Option<String>,
    /// Ciclo de vida — PRIVADO (só transição). Ver [`EstadoOrg`] e o doc do struct.
    estado: EstadoOrg,
}

impl Org {
    /// Cria uma org ATIVA (`Provisionada`). Único construtor público — o `estado` não entra por
    /// aqui, nasce provisionada e só muda por [`Org::suspender`] (condição "só por transição").
    pub fn nova(id: OrgId, dominios: BTreeSet<String>, tenant_m365: Option<String>) -> Self {
        Org { id, dominios, tenant_m365, estado: EstadoOrg::Provisionada }
    }

    /// O estado do ciclo de vida (leitura). A autz de org chama isto — nunca um campo público.
    pub fn estado(&self) -> EstadoOrg {
        self.estado
    }

    /// `true` se a org está suspensa — o ponto de imposição (#1544). Açúcar sobre [`Org::estado`].
    pub fn esta_suspensa(&self) -> bool {
        matches!(self.estado, EstadoOrg::Suspensa)
    }

    /// TRANSIÇÃO: suspende a org (staff, via back-office). Idempotente. Único caminho para
    /// `Suspensa` — não há setter de `estado`, então "suspensa" nunca vem de um literal forjado.
    pub fn suspender(&mut self) {
        self.estado = EstadoOrg::Suspensa;
    }

    /// TRANSIÇÃO INVERSA: reativa a org (volta a `Provisionada`). Idempotente. Existe porque
    /// suspensão sem volta é armadilha — o staff que suspende por falta de pagamento tem de poder
    /// reativar ao regularizar. QUEM pode reativar e com que peso (staff comum vs algo a mais) é
    /// decisão do PO, e mora na AUTZ que chama isto — não no tipo. O tipo só garante que o caminho
    /// de volta EXISTE e passa por transição (nunca por literal).
    pub fn reativar(&mut self) {
        self.estado = EstadoOrg::Provisionada;
    }
}

/// Escopo que a SESSÃO carrega (regra 5). Omissão = VAZIO (não "todos"): uma sessão sem
/// orgs no escopo não autoriza nada por org. `Default` é o conjunto vazio de propósito.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Escopo {
    /// Orgs que a sessão pode tocar. Vazio = nenhuma (nunca "todas").
    orgs: BTreeSet<OrgId>,
}

impl Escopo {
    /// Escopo vazio explícito — o default seguro.
    pub fn vazio() -> Self {
        Escopo::default()
    }

    /// Constrói um escopo a partir das orgs resolvidas PELO SERVIDOR (não do payload).
    pub fn de_orgs(orgs: impl IntoIterator<Item = OrgId>) -> Self {
        Escopo {
            orgs: orgs.into_iter().collect(),
        }
    }

    pub fn contem(&self, org: &OrgId) -> bool {
        self.orgs.contains(org)
    }

    pub fn vazio_p(&self) -> bool {
        self.orgs.is_empty()
    }
}

/// Sessão web — carrega o principal e o escopo, ambos ESTABELECIDOS PELO SERVIDOR
/// (regra 5 / AC1). Não há construtor a partir de payload do cliente: o único caminho é
/// [`Sessao::estabelecer`], chamado depois de o servidor resolver a identidade. E é web:
/// nunca vale como credencial de device (armadilha (c) / AC6) — este crate não conhece
/// nenhuma operação de device, então uma `Sessao` não tem como autorizar acesso a máquina.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sessao {
    principal: Principal,
    escopo: Escopo,
}

impl Sessao {
    /// Único construtor: o servidor já resolveu `principal` e `escopo`. Nada aqui vem do
    /// payload do chamador. Escopo omitido deve ser [`Escopo::vazio`], nunca "todos".
    pub fn estabelecer(principal: Principal, escopo: Escopo) -> Self {
        Sessao { principal, escopo }
    }

    pub fn principal(&self) -> &Principal {
        &self.principal
    }

    pub fn escopo(&self) -> &Escopo {
        &self.escopo
    }
}

/// Operações web autorizáveis. Enum FECHADO de propósito: acrescentar uma operação OBRIGA
/// a decidir sua política em [`autorizar`] (o `match` é exaustivo, sem catch-all — regra 4),
/// então "operação nova sem política" não compila. Note que NÃO há operação de device aqui.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Operacao {
    /// Ver o próprio perfil/conta.
    VerProprioPerfil,
    /// Gerir membros/domínios/assinatura de uma org (papel de admin).
    GerirOrg { alvo: OrgId },
    /// Configurar o app de uma org (member basta).
    ConfigurarAppDaOrg { alvo: OrgId },
    /// Back-office: provisionar/suspender orgs (só staff — fora de banda).
    ProvisionarOrg,
}

/// Resultado de uma decisão de autorização. Sem terceiro estado: ou permite, ou nega.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decisao {
    Permitido,
    Negado,
}

/// Autoriza `op` para a `sessao`. **Default-deny + `match` EXAUSTIVO sem catch-all**
/// (regra 4, doutrina #1000/#1456): cada operação decide explicitamente; adicionar uma
/// variante em [`Operacao`] quebra a compilação até ganhar política aqui. O escopo vem
/// SEMPRE da sessão (regra 5), nunca de um payload da operação.
pub fn autorizar(sessao: &Sessao, op: &Operacao) -> Decisao {
    let principal = sessao.principal();
    match op {
        // Qualquer principal autenticado vê o próprio perfil.
        Operacao::VerProprioPerfil => Decisao::Permitido,

        // Gerir a org exige `OrgAdmin` E que a org-alvo esteja no escopo da sessão E seja
        // a org do principal. Três amarras: papel, escopo (sessão), pertencimento.
        Operacao::GerirOrg { alvo } => {
            let eh_admin_da_alvo = matches!(principal, Principal::AdminOrg { org, .. } if org == alvo);
            if eh_admin_da_alvo && sessao.escopo().contem(alvo) {
                Decisao::Permitido
            } else {
                Decisao::Negado
            }
        }

        // Configurar o app: member OU admin da PRÓPRIA org, com a org no escopo.
        Operacao::ConfigurarAppDaOrg { alvo } => {
            let membro_da_alvo = principal.org() == Some(alvo);
            if membro_da_alvo && sessao.escopo().contem(alvo) {
                Decisao::Permitido
            } else {
                Decisao::Negado
            }
        }

        // Back-office é SÓ staff (fora de banda). Nenhum papel de org alcança isto — é a
        // fronteira staff↔cliente no tipo (regra 3 / AC2).
        Operacao::ProvisionarOrg => {
            if principal.eh_staff() {
                Decisao::Permitido
            } else {
                Decisao::Negado
            }
        }
    }
}

/// Erro de resolução de org. `NaoEncontrada` é o 404 da regra 6: pedir a org de outra
/// pessoa não distingue "existe mas não pode" de "não existe" — não enumerar orgs alheias.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResolveErro {
    NaoEncontrada,
}

/// Resolve uma org-alvo PARA um solicitante. Só devolve a org se o solicitante pertence a
/// ela (ou é staff). Qualquer outra coisa é `NaoEncontrada` (404), nunca um 403 que
/// confirmaria a existência (regra 6 / AC4).
pub fn resolver_org(solicitante: &Principal, alvo: &Org) -> Result<Org, ResolveErro> {
    let pode_ver = solicitante.eh_staff() || solicitante.org() == Some(&alvo.id);
    if pode_ver {
        Ok(alvo.clone())
    } else {
        Err(ResolveErro::NaoEncontrada)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn org(id: &str) -> Org {
        Org::nova(OrgId(id.into()), BTreeSet::new(), None)
    }

    fn admin(user: &str, org_id: &str) -> Principal {
        Principal::AdminOrg { usuario: UserId(user.into()), org: OrgId(org_id.into()) }
    }
    fn membro(user: &str, org_id: &str) -> Principal {
        Principal::UsuarioFinal { usuario: UserId(user.into()), org: OrgId(org_id.into()) }
    }
    fn staff(user: &str) -> Principal {
        Principal::Staff { usuario: UserId(user.into()) }
    }

    // #1544 — o `estado` da org nasce Provisionada e SÓ muda por transição.
    #[test]
    fn org_nasce_provisionada() {
        let o = org("acme");
        assert_eq!(o.estado(), EstadoOrg::Provisionada);
        assert!(!o.esta_suspensa(), "org nova não está suspensa");
    }

    #[test]
    fn suspender_e_a_unica_porta_para_suspensa() {
        let mut o = org("acme");
        o.suspender();
        assert_eq!(o.estado(), EstadoOrg::Suspensa);
        assert!(o.esta_suspensa());
        // Idempotente: suspender de novo continua suspensa (não entra em estado inválido).
        o.suspender();
        assert!(o.esta_suspensa());
        // GARANTIA DE ENCAPSULAMENTO (condição 1 do @Altair): não há setter nem literal público
        // de `estado` — o único caminho para `Suspensa` é `suspender()`. Se um campo público ou
        // um `Org { .., estado }` externo existisse, esta linha de comentário não bastaria: a
        // prova é o `estado` ser privado (o compilador recusa o literal fora do crate).
    }

    // #1544 (review do @Altair): suspender NÃO é porta de mão única — `reativar` volta pra
    // Provisionada. Sem isto, uma org suspensa por falta de pagamento nunca mais reativa.
    #[test]
    fn reativar_desfaz_a_suspensao() {
        let mut o = org("acme");
        o.suspender();
        assert!(o.esta_suspensa());
        o.reativar();
        assert_eq!(o.estado(), EstadoOrg::Provisionada, "reativar volta pra Provisionada");
        assert!(!o.esta_suspensa());
        // Round-trip completo e idempotente: dá pra suspender de novo depois de reativar.
        o.suspender();
        assert!(o.esta_suspensa(), "o ciclo suspender→reativar→suspender é livre");
        o.reativar();
        o.reativar();
        assert!(!o.esta_suspensa(), "reativar é idempotente");
    }

    // AC1 — a sessão carrega o que o SERVIDOR estabeleceu (principal + escopo); não há
    // construtor a partir de payload. Aqui: o escopo lido é exatamente o injetado, e o
    // principal também — nada é "descoberto" de outro lugar.
    #[test]
    fn ac1_sessao_carrega_o_que_o_servidor_estabeleceu() {
        let p = admin("u1", "orgA");
        let s = Sessao::estabelecer(p.clone(), Escopo::de_orgs([OrgId("orgA".into())]));
        assert_eq!(s.principal(), &p);
        assert!(s.escopo().contem(&OrgId("orgA".into())));
    }

    // AC2 — `org_admin` NÃO concede staff: não existe `Papel::Staff`, e o tipo `Staff` é
    // inalcançável a partir de um principal de org. Prova estrutural: nenhum papel de org
    // é staff, e provisionar (staff-only) é negado ao org_admin.
    #[test]
    fn ac2_org_admin_nao_alcanca_staff() {
        let a = admin("u1", "orgA");
        assert_ne!(a.papel(), None); // é papel de org...
        assert!(!a.eh_staff()); // ...e NUNCA staff
        let s = Sessao::estabelecer(a, Escopo::de_orgs([OrgId("orgA".into())]));
        assert_eq!(autorizar(&s, &Operacao::ProvisionarOrg), Decisao::Negado);
    }

    // AC3 — default-deny + match exaustivo. Um member tentando gerir a org é negado; a
    // exaustividade em si é garantida pelo compilador (sem catch-all em `autorizar`).
    #[test]
    fn ac3_default_deny_member_nao_gere_org() {
        let s = Sessao::estabelecer(membro("u1", "orgA"), Escopo::de_orgs([OrgId("orgA".into())]));
        assert_eq!(
            autorizar(&s, &Operacao::GerirOrg { alvo: OrgId("orgA".into()) }),
            Decisao::Negado
        );
    }

    // AC4 — org de outro é 404, não 403. Um admin de orgA pedindo orgB recebe NaoEncontrada.
    #[test]
    fn ac4_org_alheia_e_404_nao_403() {
        let a = admin("u1", "orgA");
        assert_eq!(resolver_org(&a, &org("orgB")), Err(ResolveErro::NaoEncontrada));
        // a própria org resolve normalmente
        assert!(resolver_org(&a, &org("orgA")).is_ok());
        // staff vê qualquer org (fora de banda)
        assert!(resolver_org(&staff("s1"), &org("orgB")).is_ok());
    }

    // AC5 — escopo omitido = VAZIO, nunca "todos". Admin legítimo, mas SEM a org no escopo
    // da sessão → gerir a própria org é negado (o escopo vem da sessão, não do payload).
    #[test]
    fn ac5_escopo_omitido_e_vazio_nao_todos() {
        assert!(Escopo::vazio().vazio_p());
        let s = Sessao::estabelecer(admin("u1", "orgA"), Escopo::vazio());
        assert_eq!(
            autorizar(&s, &Operacao::GerirOrg { alvo: OrgId("orgA".into()) }),
            Decisao::Negado,
            "sem a org no escopo, nem o admin legítimo passa"
        );
    }

    // AC6 — sessão web ≠ credencial de device. Garantia estrutural: o principal MAIS
    // poderoso da web (staff) autoriza operações web, mas NÃO existe operação de device
    // neste crate — `Operacao` não tem variante de máquina, então uma `Sessao` não tem por
    // onde virar acesso a device. Este teste fixa a fronteira: staff faz back-office, e é só.
    #[test]
    fn ac6_sessao_web_nao_e_credencial_de_device() {
        let s = Sessao::estabelecer(staff("s1"), Escopo::vazio());
        assert_eq!(autorizar(&s, &Operacao::ProvisionarOrg), Decisao::Permitido);
        // Toda a superfície autorizável é web (perfil/org/app/back-office). Não há device.
        // A ausência é o ponto: nenhuma `Operacao` concede máquina, logo nenhuma `Sessao`.
    }

    // Doutrina (a): papel da fundação é tipo PRÓPRIO — sem ponte com o role do M365.
    // Fixa que `Papel` só tem member/org_admin (nasce mínimo, regra 2).
    #[test]
    fn papel_nasce_minimo_e_proprio() {
        for p in [Papel::Member, Papel::OrgAdmin] {
            match p {
                Papel::Member | Papel::OrgAdmin => {}
            }
        }
        assert_ne!(Papel::Member, Papel::OrgAdmin);
    }

    // Positivo: o caminho feliz de cada operação, pra provar que default-deny não é
    // "nega tudo". Admin gere a própria org (com escopo); member configura o app; staff
    // provisiona; qualquer um vê o próprio perfil.
    #[test]
    fn caminhos_felizes() {
        let esc = Escopo::de_orgs([OrgId("orgA".into())]);
        let admin_s = Sessao::estabelecer(admin("u1", "orgA"), esc.clone());
        let membro_s = Sessao::estabelecer(membro("u2", "orgA"), esc);
        let staff_s = Sessao::estabelecer(staff("s1"), Escopo::vazio());

        assert_eq!(autorizar(&admin_s, &Operacao::GerirOrg { alvo: OrgId("orgA".into()) }), Decisao::Permitido);
        assert_eq!(autorizar(&membro_s, &Operacao::ConfigurarAppDaOrg { alvo: OrgId("orgA".into()) }), Decisao::Permitido);
        assert_eq!(autorizar(&staff_s, &Operacao::ProvisionarOrg), Decisao::Permitido);
        assert_eq!(autorizar(&membro_s, &Operacao::VerProprioPerfil), Decisao::Permitido);
    }
}
