//! Back-office Galaxie (provisionar / verificar / suspender orgs) — #1474 (épico #1265).
//! Camada de AUTORIZAÇÃO **STAFF-ONLY** sobre a fundação #1469 (`galaxie-platform-identity`).
//!
//! ## Delta crítica (Altair): o principal é de OUTRO tipo
//! Staff **não é papel dentro de org cliente** — se fosse, um `org_admin` o concederia e o
//! back-office ficaria alcançável de dentro de uma conta cliente. Staff é o 3º tipo de
//! `Principal` da fundação, concedido **fora de banda**. Provisionar/verificar/**suspender**
//! (a mais destrutiva) são as ops mais privilegiadas do produto: default-deny estrito.
//!
//! ## Lição do #1475 aplicada ao DESENHO (não só ao teste)
//! O #1475 vazou porque a autz recebia um `Org` que carregava um claim (`tenant_m365`)
//! alcançável dentro da função. Aqui a autz **recebe só a `Sessao`** — o `Principal` que o
//! servidor estabeleceu. Nenhum `Org` (nem seus claims), nenhum payload entra: **não há por
//! onde um claim/payload escalar a staff (AC3), por construção**. Staff é determinado pelo
//! TIPO do principal (`eh_staff`), nunca por um dado que o chamador traga.
//!
//! Domínio PURO: a decisão é testável sem I/O. A borda HTTP e a auditoria persistida das ops
//! são fatias seguintes que CHAMAM esta lógica.

#![forbid(unsafe_code)]

use galaxie_platform_identity::{autorizar, Decisao, Operacao, Sessao};

/// Ações de back-office (staff operando SOBRE orgs de clientes). Enum FECHADO: a autz faz um
/// `match` EXAUSTIVO sem catch-all (doutrina #1000/#1456), então **acrescentar uma ação
/// obriga a decidir sua política** — não compila sem braço. As três são staff-only.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AcaoBackOffice {
    /// Cria uma org na base (sem seed manual).
    ProvisionarOrg,
    /// Verifica/marca o estado de uma org.
    VerificarOrg,
    /// SUSPENDE uma org — a operação mais destrutiva do produto.
    SuspenderOrg,
}

/// Resultado negativo do back-office. Sem terceiro estado: staff passa, o resto é negado.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackOfficeErro {
    /// O principal não é `staff` (fora de banda) — negado. `org_admin`/`member` caem aqui.
    Negado,
}

/// Autoriza uma ação de back-office. **Staff-only:** reusa `Operacao::ProvisionarOrg` da
/// fundação, cuja política é `principal.eh_staff()`. Um `org_admin`/`member` — mesmo o mais
/// elevado, mesmo com qualquer claim na sua org — é `Negado` (staff não é concedível de
/// dentro de uma org; AC1/AC3). Só a `Sessao` entra: nenhum `Org`/claim/payload (AC3 por
/// construção).
#[must_use = "a decisão de back-office tem de ser respeitada — ignorá-la deixa cliente operar a base"]
pub fn autorizar_back_office(sessao: &Sessao, acao: &AcaoBackOffice) -> Result<(), BackOfficeErro> {
    // `match` EXAUSTIVO: toda ação de back-office é staff-only. Ação nova não compila até
    // ganhar um braço aqui (default-deny por construção).
    let op = match acao {
        AcaoBackOffice::ProvisionarOrg
        | AcaoBackOffice::VerificarOrg
        | AcaoBackOffice::SuspenderOrg => Operacao::ProvisionarOrg,
    };
    match autorizar(sessao, &op) {
        Decisao::Permitido => Ok(()), // só `staff` (eh_staff) passa
        Decisao::Negado => Err(BackOfficeErro::Negado),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use galaxie_platform_identity::{Escopo, OrgId, Principal, Sessao, UserId};

    const TODAS: [AcaoBackOffice; 3] = [
        AcaoBackOffice::ProvisionarOrg,
        AcaoBackOffice::VerificarOrg,
        AcaoBackOffice::SuspenderOrg,
    ];

    fn sessao_staff() -> Sessao {
        Sessao::estabelecer(Principal::Staff { usuario: UserId("s1".into()) }, Escopo::vazio())
    }
    fn sessao_admin(org: &str) -> Sessao {
        Sessao::estabelecer(
            Principal::AdminOrg { usuario: UserId("u1".into()), org: OrgId(org.into()) },
            // escopo POPULADO com a própria org — o principal-cliente mais elevado possível.
            Escopo::de_orgs([OrgId(org.into())]),
        )
    }
    fn sessao_membro(org: &str) -> Sessao {
        Sessao::estabelecer(
            Principal::UsuarioFinal { usuario: UserId("u2".into()), org: OrgId(org.into()) },
            Escopo::de_orgs([OrgId(org.into())]),
        )
    }

    // AC1 — `member` E `org_admin` (não staff) ⇒ negado em TODAS as ações de back-office.
    #[test]
    fn ac1_nao_staff_e_negado() {
        for acao in &TODAS {
            assert_eq!(
                autorizar_back_office(&sessao_membro("orgA"), acao),
                Err(BackOfficeErro::Negado)
            );
            assert_eq!(
                autorizar_back_office(&sessao_admin("orgA"), acao),
                Err(BackOfficeErro::Negado)
            );
        }
    }

    // AC2 — staff ⇒ permitido em todas as ações (incl. a mais destrutiva, suspender).
    #[test]
    fn ac2_staff_provisiona_verifica_suspende() {
        let s = sessao_staff();
        for acao in &TODAS {
            assert_eq!(autorizar_back_office(&s, acao), Ok(()));
        }
    }

    // AC3 — o principal-cliente MAIS ELEVADO (org_admin da própria org, escopo populado) NÃO
    // cruza a fronteira staff, nem pra SUSPENDER (a op mais destrutiva). E não há por onde um
    // claim/payload escalar: a assinatura só aceita a `Sessao` — nenhum `Org`/claim entra.
    // (Lição do #1475: o dado perigoso — aqui, a tentação "admin ≈ staff" — está PLANTADO no
    // fixture, não só no comentário.)
    #[test]
    fn ac3_org_admin_nao_escala_a_staff_nem_pra_suspender() {
        let admin = sessao_admin("orgA");
        assert!(!admin.principal().eh_staff()); // é admin de org, e NUNCA staff
        assert_eq!(
            autorizar_back_office(&admin, &AcaoBackOffice::SuspenderOrg),
            Err(BackOfficeErro::Negado),
            "org_admin não pode suspender orgs — staff só fora de banda"
        );
    }

    // Fronteira positiva ↔ negativa lado a lado: a MESMA ação (suspender) separa staff de
    // org_admin — prova que o gate discrimina pelo TIPO do principal, não por "nega tudo".
    #[test]
    fn suspender_separa_staff_de_org_admin() {
        assert_eq!(autorizar_back_office(&sessao_staff(), &AcaoBackOffice::SuspenderOrg), Ok(()));
        assert_eq!(
            autorizar_back_office(&sessao_admin("orgA"), &AcaoBackOffice::SuspenderOrg),
            Err(BackOfficeErro::Negado)
        );
    }
}
