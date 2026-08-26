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

use std::collections::VecDeque;
use std::sync::Mutex;

use galaxie_platform_identity::auditoria::{Alvo, AlvoDono, Auditor, EventoAutz, ResultadoAutz};
use galaxie_platform_identity::{autorizar, Decisao, Operacao, OrgId, Sessao, UserId};

// `Auditor`/`EventoAutz`/`ResultadoAutz` foram para a FUNDAÇÃO (`platform-identity::auditoria`,
// #1571 caminho A do @Altair): back-office e admin-de-org emitem pelo MESMO sink. `EventoAutz`
// agora carrega `acao: &str` (do `acao_nome()` abaixo, nunca literal) + o `alvo` (OrgId).

/// Ações de back-office (staff operando SOBRE orgs de clientes). Enum FECHADO: a autz faz um
/// `match` EXAUSTIVO sem catch-all (doutrina #1000/#1456), então **acrescentar uma ação
/// obriga a decidir sua política** — não compila sem braço. Todas são staff-only.
///
/// As ops que agem SOBRE uma org carregam o **`OrgId`** — o **alvo** que a auditoria precisa nomear
/// (correção do @Altair na review do #1534: sem ele, o log de `SuspenderOrg`, a op mais destrutiva,
/// não diz QUEM foi suspensa). ⚠️ **`OrgId` sim, `Org` NUNCA:** um id opaco não é claim; o furo do
/// #1475 era o `Org` carregando `tenant_m365`/`dominios` dentro da autz. Se um dia a autz precisar do
/// `Org`, é sinal de que está querendo decidir por claim — o #1475 voltando. A DECISÃO aqui **não
/// consulta** o `OrgId` (o `match` o ignora com `_`); ele só nomeia o alvo no evento.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AcaoBackOffice {
    /// Lista as orgs da base (`GET /admin/orgs` do contrato §4.5). Leitura, sem alvo específico;
    /// staff-only e auditada como as demais — saber que o back-office existe já é a informação (inv. 1).
    ListarOrgs,
    /// Cria uma org na base (sem seed manual).
    ProvisionarOrg(OrgId),
    /// Verifica/marca o estado de uma org.
    VerificarOrg(OrgId),
    /// SUSPENDE uma org — a operação mais destrutiva do produto.
    SuspenderOrg(OrgId),
}

impl AcaoBackOffice {
    /// O alvo da ação (#1591): back-office é org-scoped ⇒ [`Alvo::Org`] com o id, ou
    /// [`Alvo::SemAlvo`] (`ListarOrgs` não tem alvo). É o que o [`Auditor`] nomeia no registro — o
    /// "contra quem" da operação, sem depender de o sink conhecer cada variante.
    #[must_use]
    pub fn alvo(&self) -> Alvo<'_> {
        match self {
            AcaoBackOffice::ListarOrgs => Alvo::SemAlvo,
            AcaoBackOffice::ProvisionarOrg(id)
            | AcaoBackOffice::VerificarOrg(id)
            | AcaoBackOffice::SuspenderOrg(id) => Alvo::Org(id),
        }
    }

    /// Nome ESTÁVEL e namespaced da ação, para a auditoria (#1571 cond. 1 do @Altair). `match`
    /// EXAUSTIVO sem `_`: ação nova não compila até ganhar seu nome aqui — o `&str` do fio é
    /// produzido pelo enum FECHADO, nunca por um literal de call site (typo não vira registro
    /// errado). Namespace `back_office.` não colide com `org_admin.` na mesma trilha.
    #[must_use]
    pub fn acao_nome(&self) -> &'static str {
        match self {
            AcaoBackOffice::ListarOrgs => "back_office.listar_orgs",
            AcaoBackOffice::ProvisionarOrg(_) => "back_office.provisionar_org",
            AcaoBackOffice::VerificarOrg(_) => "back_office.verificar_org",
            AcaoBackOffice::SuspenderOrg(_) => "back_office.suspender_org",
        }
    }
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
    // A DECISÃO é staff-only pra TODAS — o `OrgId` alvo é IGNORADO aqui de propósito (`_`): a autz
    // não decide por dado do chamador (senão seria o #1475). O alvo só vive pra nomear a auditoria.
    let op = match acao {
        AcaoBackOffice::ListarOrgs
        | AcaoBackOffice::ProvisionarOrg(_)
        | AcaoBackOffice::VerificarOrg(_)
        | AcaoBackOffice::SuspenderOrg(_) => Operacao::ProvisionarOrg,
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
        acao: acao.acao_nome(),
        alvo: acao.alvo(),
        resultado,
    });
    match decisao {
        Decisao::Permitido => Ok(()), // só `staff` (eh_staff) passa
        Decisao::Negado => Err(BackOfficeErro::Negado),
    }
}

/// Evento de auditoria OWNED — o que o buffer guarda. `EventoAutz` EMPRESTA; para enfileirar entre o
/// `registrar` síncrono e o dreno (fatia B), o buffer precisa de DONO. `Perda` é o transbordo TORNADO
/// VISÍVEL: quando o buffer enche, o que se perde vira ELE PRÓPRIO um evento (`auditoria_perdida:N`) —
/// ausência DECLARADA, nunca silêncio (regra do @Altair, a mesma do #1562: buraco no log de auditoria
/// que não se anuncia é a pior forma do padrão, porque o log existe pra ser a fonte quando tudo falhou).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EventoAuditado {
    /// Uma decisão de autz (o caso normal), com o mesmo conteúdo do [`EventoAutz`], agora possuído.
    /// `acao` é o nome estável (do `acao_nome()`, de QUALQUER crate de autz — o buffer é agnóstico
    /// à ação desde o #1571); `alvo` é o **id** da org, quando a ação tem alvo.
    Autz { ator: UserId, acao: String, alvo: AlvoDono, resultado: ResultadoAutz },
    /// `n` eventos foram PERDIDOS por transbordo do buffer antes deste dreno. Nunca silencioso.
    Perda { n: u64 },
}

/// `Auditor` de PRODUÇÃO com buffer local LIMITADO (#1546 (A), desenho do @Altair). `registrar` é
/// síncrono e **NUNCA** fala com a rede (a entrega é a fatia B, que DRENA), **nem bloqueia, nem cresce
/// sem teto** — as 4 políticas ingênuas de transbordo falham cada uma: descartar o antigo (atacante se
/// expulsa do log), descartar o novo (perde o evento do ataque), bloquear (trava a autz — proibido),
/// crescer (exaustão de memória vira o vetor). A saída exigida: buffer **LIMITADO** + o transbordo é
/// **ELE PRÓPRIO auditado** ([`EventoAuditado::Perda`]) no dreno.
///
/// ⚠️ Lembrete pra fatia B: o dreno NÃO pode fazer I/O de rede DENTRO do `registrar` — o buffer existe
/// justamente pra desacoplar; rede no caminho síncrono desfaz esta fatia inteira.
pub struct AuditorBuffer {
    estado: Mutex<EstadoBuffer>,
    capacidade: usize,
}

#[derive(Default)]
struct EstadoBuffer {
    eventos: VecDeque<EventoAuditado>,
    perdidos: u64,
}

impl AuditorBuffer {
    /// Novo buffer com teto `capacidade` (nº máximo de eventos retidos entre drenos). O chamador
    /// escolhe um teto real (0 é degenerado: tudo vira perda).
    #[must_use]
    pub fn novo(capacidade: usize) -> Self {
        AuditorBuffer { estado: Mutex::new(EstadoBuffer::default()), capacidade }
    }

    /// DRENA o buffer (chamado pela fatia B, que entrega à rede): devolve os eventos retidos e, se
    /// houve transbordo desde o último dreno, um [`EventoAuditado::Perda`] no fim — a lacuna sai
    /// NOMEADA. Zera o buffer e o contador de perdas. **NÃO faz I/O** (a rede é do chamador).
    #[must_use]
    pub fn drenar(&self) -> Vec<EventoAuditado> {
        let mut estado = self.estado.lock().expect("buffer de auditoria envenenado");
        let mut saida: Vec<EventoAuditado> = estado.eventos.drain(..).collect();
        if estado.perdidos > 0 {
            saida.push(EventoAuditado::Perda { n: estado.perdidos });
            estado.perdidos = 0;
        }
        saida
    }
}

impl Auditor for AuditorBuffer {
    fn registrar(&self, evento: &EventoAutz) {
        let mut estado = self.estado.lock().expect("buffer de auditoria envenenado");
        if estado.eventos.len() >= self.capacidade {
            // Transbordo: NÃO bloqueia, NÃO descarta o registro já retido, NÃO cresce. Conta a perda
            // — que sai NOMEADA no próximo dreno. O caminho de autz segue: a auditoria nunca o trava.
            estado.perdidos += 1;
            return;
        }
        estado.eventos.push_back(EventoAuditado::Autz {
            ator: evento.ator.clone(),
            acao: evento.acao.to_string(),
            alvo: evento.alvo.para_dono(),
            resultado: evento.resultado,
        });
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
        eventos: RefCell<Vec<(UserId, String, ResultadoAutz)>>,
    }
    impl Auditor for AuditorEspiao {
        fn registrar(&self, e: &EventoAutz) {
            self.eventos
                .borrow_mut()
                .push((e.ator.clone(), e.acao.to_string(), e.resultado));
        }
    }

    /// Atalho pros testes de decisão: autoriza com um auditor nulo.
    fn autoriza(s: &Sessao, acao: &AcaoBackOffice) -> Result<(), BackOfficeErro> {
        autorizar_back_office(s, acao, &AuditorNulo)
    }

    // Fn (não `const`): as variantes com `OrgId(String)` não são const-construíveis.
    fn todas() -> [AcaoBackOffice; 4] {
        let alvo = OrgId("orgA".into());
        [
            AcaoBackOffice::ListarOrgs,
            AcaoBackOffice::ProvisionarOrg(alvo.clone()),
            AcaoBackOffice::VerificarOrg(alvo.clone()),
            AcaoBackOffice::SuspenderOrg(alvo),
        ]
    }

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
        for acao in &todas() {
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
        for acao in &todas() {
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
            autoriza(&admin, &AcaoBackOffice::SuspenderOrg(OrgId("orgA".into()))),
            Err(BackOfficeErro::Negado),
            "org_admin não pode suspender orgs — staff só fora de banda"
        );
    }

    // Fronteira positiva ↔ negativa lado a lado: a MESMA ação (suspender) separa staff de
    // org_admin — prova que o gate discrimina pelo TIPO do principal, não por "nega tudo".
    #[test]
    fn suspender_separa_staff_de_org_admin() {
        assert_eq!(autoriza(&sessao_staff(), &AcaoBackOffice::SuspenderOrg(OrgId("orgA".into()))), Ok(()));
        assert_eq!(
            autoriza(&sessao_admin("orgA"), &AcaoBackOffice::SuspenderOrg(OrgId("orgA".into()))),
            Err(BackOfficeErro::Negado)
        );
    }

    // O alvo nomeia a org das ops destrutivas (correção @Altair #1534): sem isto o log de
    // `SuspenderOrg` não diz QUEM. `ListarOrgs` não tem alvo.
    #[test]
    fn alvo_nomeia_a_org_das_ops_sobre_org() {
        assert_eq!(AcaoBackOffice::ListarOrgs.alvo(), Alvo::SemAlvo);
        assert_eq!(
            AcaoBackOffice::SuspenderOrg(OrgId("acme".into())).alvo(),
            Alvo::Org(&OrgId("acme".into())),
            "a op mais destrutiva nomeia a org suspensa no registro"
        );
        assert_eq!(
            AcaoBackOffice::ProvisionarOrg(OrgId("globex".into())).alvo(),
            Alvo::Org(&OrgId("globex".into()))
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
            autorizar_back_office(&sessao_admin("orgA"), &AcaoBackOffice::SuspenderOrg(OrgId("orgA".into())), &espiao).is_err()
        );

        let ev = espiao.eventos.borrow();
        assert_eq!(ev.len(), 2, "toda decisão emite — não só o sucesso");
        assert_eq!(
            ev[0],
            (UserId("s1".into()), "back_office.listar_orgs".to_string(), ResultadoAutz::Permitido)
        );
        assert_eq!(
            ev[1],
            (UserId("u1".into()), "back_office.suspender_org".to_string(), ResultadoAutz::Negado),
            "o negado registra o ATOR que tentou (não-staff), não some"
        );
    }

    // ---- #1546 (A): AuditorBuffer (buffer local limitado + transbordo auditado) ----

    #[test]
    fn buffer_retem_e_drena_na_ordem() {
        let buf = AuditorBuffer::novo(10);
        let ator = UserId("s1".into());
        let acao = AcaoBackOffice::ListarOrgs;
        buf.registrar(&EventoAutz { ator: &ator, acao: acao.acao_nome(), alvo: acao.alvo(), resultado: ResultadoAutz::Permitido });
        buf.registrar(&EventoAutz { ator: &ator, acao: acao.acao_nome(), alvo: acao.alvo(), resultado: ResultadoAutz::Negado });
        let drenado = buf.drenar();
        assert_eq!(drenado.len(), 2);
        assert!(matches!(&drenado[0], EventoAuditado::Autz { resultado: ResultadoAutz::Permitido, .. }));
        assert!(matches!(&drenado[1], EventoAuditado::Autz { resultado: ResultadoAutz::Negado, .. }));
        assert!(buf.drenar().is_empty(), "2º dreno vazio — o 1º esvaziou");
    }

    // Exigência do @Altair: transbordo é ELE PRÓPRIO evento auditado (nunca silêncio). Teto 2, 5
    // registros ⇒ 2 retidos + `Perda { n: 3 }`. Um mutante que descartasse silenciosamente (sem
    // contar) faria a Perda sumir — este teste o mata.
    #[test]
    fn transbordo_vira_evento_de_perda_nomeada() {
        let buf = AuditorBuffer::novo(2);
        let ator = UserId("s1".into());
        let acao = AcaoBackOffice::ListarOrgs;
        for _ in 0..5 {
            buf.registrar(&EventoAutz { ator: &ator, acao: acao.acao_nome(), alvo: acao.alvo(), resultado: ResultadoAutz::Negado });
        }
        let drenado = buf.drenar();
        assert_eq!(drenado.len(), 3, "2 retidos (teto) + 1 Perda");
        assert_eq!(drenado[2], EventoAuditado::Perda { n: 3 }, "os 3 perdidos saem NOMEADOS");
        let autz = drenado.iter().filter(|e| matches!(e, EventoAuditado::Autz { .. })).count();
        assert_eq!(autz, 2, "buffer LIMITADO ao teto — não cresceu (sem exaustão)");
    }

    #[test]
    fn sem_transbordo_sem_perda_espuria() {
        let buf = AuditorBuffer::novo(10);
        let ator = UserId("s1".into());
        let acao = AcaoBackOffice::ListarOrgs;
        buf.registrar(&EventoAutz { ator: &ator, acao: acao.acao_nome(), alvo: acao.alvo(), resultado: ResultadoAutz::Permitido });
        let drenado = buf.drenar();
        assert_eq!(drenado.len(), 1);
        assert!(drenado.iter().all(|e| matches!(e, EventoAuditado::Autz { .. })), "nenhuma Perda que não houve");
    }

    // O dreno ZERA o contador: uma perda não reaparece no dreno seguinte (senão inflaria pra sempre).
    #[test]
    fn dreno_zera_o_contador_de_perdas() {
        let buf = AuditorBuffer::novo(1);
        let ator = UserId("s1".into());
        let acao = AcaoBackOffice::ListarOrgs;
        for _ in 0..3 {
            buf.registrar(&EventoAutz { ator: &ator, acao: acao.acao_nome(), alvo: acao.alvo(), resultado: ResultadoAutz::Negado });
        }
        let d1 = buf.drenar();
        assert!(d1.iter().any(|e| matches!(e, EventoAuditado::Perda { n: 2 })), "1 retido, 2 perdidos");
        assert!(buf.drenar().is_empty(), "a Perda não reaparece no dreno seguinte");
    }

    // Muitos registros num teto pequeno COMPLETAM (registrar nunca bloqueia) e o buffer fica no teto
    // (nunca cresce): as duas garantias de segurança do síncrono, juntas.
    #[test]
    fn registrar_sob_carga_nao_bloqueia_nem_cresce() {
        let buf = AuditorBuffer::novo(4);
        let ator = UserId("s1".into());
        let acao = AcaoBackOffice::ListarOrgs;
        for _ in 0..10_000 {
            buf.registrar(&EventoAutz { ator: &ator, acao: acao.acao_nome(), alvo: acao.alvo(), resultado: ResultadoAutz::Permitido });
        }
        let drenado = buf.drenar();
        let autz = drenado.iter().filter(|e| matches!(e, EventoAuditado::Autz { .. })).count();
        assert_eq!(autz, 4, "buffer preso no teto sob 10k registros");
        assert_eq!(drenado.last(), Some(&EventoAuditado::Perda { n: 9_996 }), "as 9996 perdas, nomeadas");
    }
}
