//! Auditoria de decisões de autz (#1571, desenho do @Altair — caminho (A)).
//!
//! O `Auditor` e o `EventoAutz` moram na FUNDAÇÃO pra que TODA função de autz emita pelo MESMO
//! sink: back-office (`autorizar_back_office`), admin-de-org (`autorizar_acao_admin`) e as
//! superfícies futuras. Assim "auditado" é propriedade da autorização, não de alguém lembrar —
//! e uma trilha só (um esquema) responde "o que aconteceu com a org X?" sem unir dois formatos.
//!
//! 🔑 **`acao` é `&str` no fio, mas NUNCA um literal de call site.** Cada enum de ação é dono do
//! seu `acao_nome()` — `match` EXAUSTIVO sem `_`, com namespace (`back_office.*` / `org_admin.*`).
//! O mérito do `&str` é ser estável no fio, não ser livre: se um call site pudesse passar
//! literal, trocávamos conjunto fechado por aberto e um typo viraria registro silenciosamente
//! errado — e auditoria é onde erro silencioso não perdoa, ninguém relê o que já não está lá
//! (cond. 1 do @Altair).
//!
//! 🔑 **Domain-separation:** o evento carrega o `ator` (id, nunca claim), o nome da ação, o
//! **id** do alvo (`OrgId`, nunca `Org`/`tenant_m365`/`dominios`) e o resultado. Claim sensível
//! não se acumula em log de retenção longa e leitura ampla (regra do #1469/#1475).

use crate::{OrgId, UserId};

/// Resultado de uma decisão de autz, para a auditoria. **Permitido E Negado** são registrados:
/// auditoria que só grava sucesso perde exatamente o ataque — dez `Negado` seguidos é o sinal, e
/// ele some se só o sucesso for logado.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResultadoAutz {
    Permitido,
    Negado,
}

/// CONTRA QUEM a decisão foi — enum FECHADO (#1591). A auditoria tem de dizer o alvo, não só o
/// ator: a forma da sondagem é a DISTRIBUIÇÃO sobre alvos (`A` tentando 1 config = ruído; `A`
/// tentando a de 500 = enumeração), e com um alvo achatado a `None` as duas ficam idênticas na
/// trilha. Nasceu `Option<&OrgId>` (org-scoped, #1571), mas a config é user-scoped ⇒ o tipo tinha
/// de exprimir "usuário" também. **Enum, NÃO dois campos opcionais**: "org E usuário ao mesmo
/// tempo" e "nenhum onde devia haver" ficam não-representáveis, e um scope novo não compila sem
/// tratar o `match`. `OrgId`/`UserId` — o **id** opaco, nunca `Org`/claim (o furo do #1475).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Alvo<'a> {
    /// Ação sobre uma org (back-office, admin-org): o id da org alvejada.
    Org(&'a OrgId),
    /// Ação sobre a conta de um usuário (config): o id do usuário alvejado — o que o #1589 precisa
    /// pra distinguir sondagem de ruído.
    Usuario(&'a UserId),
    /// Ação sem alvo (ex.: `ListarOrgs`) — não é `None` de um alvo que existia, é a ausência dele.
    SemAlvo,
}

impl Alvo<'_> {
    /// A forma OWNED do alvo, pros sinks que enfileiram o evento (o buffer do #1546). Preserva a
    /// distinção org/usuário — colapsá-la de volta a um id só desfaria o #1591.
    #[must_use]
    pub fn para_dono(&self) -> AlvoDono {
        match self {
            Alvo::Org(o) => AlvoDono::Org((*o).clone()),
            Alvo::Usuario(u) => AlvoDono::Usuario((*u).clone()),
            Alvo::SemAlvo => AlvoDono::SemAlvo,
        }
    }
}

/// A forma POSSUÍDA do [`Alvo`] — o que um sink que retém o evento (buffer) guarda. Espelha o
/// enum emprestado; existe pra não achatar org/usuário ao persistir.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AlvoDono {
    Org(OrgId),
    Usuario(UserId),
    SemAlvo,
}

/// Evento SEMÂNTICO de uma decisão de autz, emprestado (o `ts`/id de correlação são carimbados
/// pela impl, request-scoped, onde o evento sai da caixa). Carrega só o que a decisão conhece.
pub struct EventoAutz<'a> {
    /// Quem tentou: o principal da sessão (id, nunca claim) — `staff`/`admin` num permitido,
    /// qualquer um num negado.
    pub ator: &'a UserId,
    /// O nome ESTÁVEL e namespaced da ação, vindo do `acao_nome()` do enum dono (nunca literal).
    pub acao: &'a str,
    /// CONTRA QUEM — org, usuário, ou sem-alvo (enum fechado, #1591). O evento diz o alvo, não só
    /// o ator; a distribuição sobre alvos é a forma da enumeração.
    pub alvo: Alvo<'a>,
    pub resultado: ResultadoAutz,
}

/// Sink de auditoria. A decisão de segurança não é ONDE escrever, é **QUEM escreve**: como a
/// FUNÇÃO de autz emite (não o handler), superfície nova nasce auditada sem ninguém combinar —
/// casa com a invariante 5 (toda autz passa pela função). A impl real leva o evento pra FORA do
/// processo (OpenObserve): a integridade vem de sair da caixa, não de assinar em processo.
pub trait Auditor {
    fn registrar(&self, evento: &EventoAutz);
}
