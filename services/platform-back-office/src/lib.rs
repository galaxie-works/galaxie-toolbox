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

use galaxie_platform_identity::{autorizar, Decisao, Operacao, Sessao, UserId};

/// Resultado de uma decisão de autz, para a AUDITORIA (cond. 4 do @Altair). **Permitido E Negado**
/// são registrados: auditoria que só grava sucesso perde exatamente o ataque — dez `Negado`
/// seguidos é o sinal, e ele some se só o sucesso for logado.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResultadoAutz {
    Permitido,
    Negado,
}

/// Evento SEMÂNTICO de uma decisão de autz de back-office, para o [`Auditor`]. Carrega só o que a
/// decisão conhece; o `ts` e o id de correlação do request são carimbados pela IMPL (request-scoped,
/// onde o evento sai da caixa). 🔑 **NUNCA `tenant_m365` nem `dominios`** — claim sensível não se
/// acumula em log de retenção longa e leitura ampla (mesma regra da projeção sem claims do #1469);
/// o alvo, quando existir (provisionar/suspender), é o **id** da org, não seus claims.
pub struct EventoAutz<'a> {
    /// Quem tentou: `staff` num `Permitido`, qualquer principal num `Negado`.
    pub ator: &'a UserId,
    pub acao: &'a AcaoBackOffice,
    pub resultado: ResultadoAutz,
}

/// Sink de auditoria. A decisão de segurança não é ONDE escrever, é **QUEM escreve**: como
/// `autorizar_back_office` emite (não o handler), superfície nova nasce auditada sem ninguém
/// combinar — casa com a invariante 5 (toda autz passa pela função). A impl real leva o evento pra
/// FORA do processo (OpenObserve): a integridade vem de sair da caixa, não de assinar em processo
/// (quem tem o processo tem a chave junto).
pub trait Auditor {
    fn registrar(&self, evento: &EventoAutz);
}

/// Ações de back-office (staff operando SOBRE orgs de clientes). Enum FECHADO: a autz faz um
/// `match` EXAUSTIVO sem catch-all (doutrina #1000/#1456), então **acrescentar uma ação
/// obriga a decidir sua política** — não compila sem braço. Todas são staff-only.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AcaoBackOffice {
    /// Lista as orgs da base (`GET /admin/orgs` do contrato §4.5). Leitura, mas staff-only e
    /// auditada como as demais — saber que o back-office existe já é a informação (invariante 1).
    ListarOrgs,
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
///
/// **AUDITA aqui, não no handler (cond. 4 do @Altair):** toda decisão — **permitida E negada** —
/// emite um [`EventoAutz`] pelo `auditor`. Como é a FUNÇÃO que emite (não o handler), superfície
/// nova nasce auditada sem ninguém lembrar — "auditado" vira propriedade da autz, casando com a
/// invariante 5. Auditar só o sucesso perderia o sinal de ataque (dez `Negado` seguidos).
#[must_use = "a decisão de back-office tem de ser respeitada — ignorá-la deixa cliente operar a base"]
pub fn autorizar_back_office(
    sessao: &Sessao,
    acao: &AcaoBackOffice,
    auditor: &dyn Auditor,
) -> Result<(), BackOfficeErro> {
    // `match` EXAUSTIVO: toda ação de back-office é staff-only. Ação nova não compila até
    // ganhar um braço aqui (default-deny por construção).
    let op = match acao {
        AcaoBackOffice::ListarOrgs
        | AcaoBackOffice::ProvisionarOrg
        | AcaoBackOffice::VerificarOrg
        | AcaoBackOffice::SuspenderOrg => Operacao::ProvisionarOrg,
    };
    let decisao = autorizar(sessao, &op);
    let resultado = match decisao {
        Decisao::Permitido => ResultadoAutz::Permitido,
        Decisao::Negado => ResultadoAutz::Negado,
    };
    // EMITE SEMPRE, antes de devolver — os dois ramos. O ator é o principal que tentou (staff no
    // permitido, qualquer um no negado); nunca um claim, só o id.
    auditor.registrar(&EventoAutz {
        ator: sessao.principal().usuario(),
        acao,
        resultado,
    });
    match decisao {
        Decisao::Permitido => Ok(()), // só `staff` (eh_staff) passa
        Decisao::Negado => Err(BackOfficeErro::Negado),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use galaxie_platform_identity::{Escopo, OrgId, Principal, Sessao, UserId};
    use std::cell::RefCell;

    /// Auditor no-op pros testes que só checam a DECISÃO (não a emissão).
    struct AuditorNulo;
    impl Auditor for AuditorNulo {
        fn registrar(&self, _evento: &EventoAutz) {}
    }

    /// Auditor que CAPTURA os eventos, pros testes da cond. 4 (emitiu? permitido e negado?).
    #[derive(Default)]
    struct AuditorEspiao {
        eventos: RefCell<Vec<(UserId, AcaoBackOffice, ResultadoAutz)>>,
    }
    impl Auditor for AuditorEspiao {
        fn registrar(&self, e: &EventoAutz) {
            self.eventos
                .borrow_mut()
                .push((e.ator.clone(), e.acao.clone(), e.resultado));
        }
    }

    /// Atalho pros testes de decisão: autoriza com um auditor nulo.
    fn autoriza(s: &Sessao, acao: &AcaoBackOffice) -> Result<(), BackOfficeErro> {
        autorizar_back_office(s, acao, &AuditorNulo)
    }

    const TODAS: [AcaoBackOffice; 4] = [
        AcaoBackOffice::ListarOrgs,
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
                autoriza(&sessao_membro("orgA"), acao),
                Err(BackOfficeErro::Negado)
            );
            assert_eq!(
                autoriza(&sessao_admin("orgA"), acao),
                Err(BackOfficeErro::Negado)
            );
        }
    }

    // AC2 — staff ⇒ permitido em todas as ações (incl. a mais destrutiva, suspender).
    #[test]
    fn ac2_staff_provisiona_verifica_suspende() {
        let s = sessao_staff();
        for acao in &TODAS {
            assert_eq!(autoriza(&s, acao), Ok(()));
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
            autoriza(&admin, &AcaoBackOffice::SuspenderOrg),
            Err(BackOfficeErro::Negado),
            "org_admin não pode suspender orgs — staff só fora de banda"
        );
    }

    // Fronteira positiva ↔ negativa lado a lado: a MESMA ação (suspender) separa staff de
    // org_admin — prova que o gate discrimina pelo TIPO do principal, não por "nega tudo".
    #[test]
    fn suspender_separa_staff_de_org_admin() {
        assert_eq!(autoriza(&sessao_staff(), &AcaoBackOffice::SuspenderOrg), Ok(()));
        assert_eq!(
            autoriza(&sessao_admin("orgA"), &AcaoBackOffice::SuspenderOrg),
            Err(BackOfficeErro::Negado)
        );
    }

    // Cond. 4 (@Altair): a autz EMITE evento em AMBOS os ramos — permitido E negado — e o negado
    // registra QUEM tentou (o não-staff). Auditar só o sucesso perderia o sinal (dez negados
    // seguidos). Mutante: emitir só no `Permitido` (ou só no `Negado`) faz `len()` cair pra 1.
    #[test]
    fn autz_emite_evento_em_permitido_e_negado() {
        let espiao = AuditorEspiao::default();
        assert!(autorizar_back_office(&sessao_staff(), &AcaoBackOffice::ListarOrgs, &espiao).is_ok());
        assert!(
            autorizar_back_office(&sessao_admin("orgA"), &AcaoBackOffice::SuspenderOrg, &espiao).is_err()
        );

        let ev = espiao.eventos.borrow();
        assert_eq!(ev.len(), 2, "toda decisão emite — não só o sucesso");
        assert_eq!(
            ev[0],
            (UserId("s1".into()), AcaoBackOffice::ListarOrgs, ResultadoAutz::Permitido)
        );
        assert_eq!(
            ev[1],
            (UserId("u1".into()), AcaoBackOffice::SuspenderOrg, ResultadoAutz::Negado),
            "o negado registra o ATOR que tentou (não-staff), não some"
        );
    }
}
