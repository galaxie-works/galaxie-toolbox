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

/// Evento SEMÂNTICO de uma decisão de autz, emprestado (o `ts`/id de correlação são carimbados
/// pela impl, request-scoped, onde o evento sai da caixa). Carrega só o que a decisão conhece.
pub struct EventoAutz<'a> {
    /// Quem tentou: o principal da sessão (id, nunca claim) — `staff`/`admin` num permitido,
    /// qualquer um num negado.
    pub ator: &'a UserId,
    /// O nome ESTÁVEL e namespaced da ação, vindo do `acao_nome()` do enum dono (nunca literal).
    pub acao: &'a str,
    /// O **id** da org alvo, quando a ação tem alvo (`None` p/ ações sem alvo, ex.: `ListarOrgs`).
    /// `OrgId` sim, `Org` NUNCA — id opaco não é claim (o furo do #1475 era o `Org` na autz).
    pub alvo: Option<&'a OrgId>,
    pub resultado: ResultadoAutz,
}

/// Sink de auditoria. A decisão de segurança não é ONDE escrever, é **QUEM escreve**: como a
/// FUNÇÃO de autz emite (não o handler), superfície nova nasce auditada sem ninguém combinar —
/// casa com a invariante 5 (toda autz passa pela função). A impl real leva o evento pra FORA do
/// processo (OpenObserve): a integridade vem de sair da caixa, não de assinar em processo.
pub trait Auditor {
    fn registrar(&self, evento: &EventoAutz);
}
