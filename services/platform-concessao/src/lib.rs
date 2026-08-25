//! Modelo de concessão (capabilities) — o **2º eixo da autorização** (#1562, épico #1265).
//!
//! A autz por PAPEL pergunta "quem é?"; a concessão pergunta "o que foi CONCEDIDO?". Budget-holder
//! não é papel; acesso a Bridge/Astro é por concessão, não por nível de papel. Este crate é SÓ o
//! DOMÍNIO (puro, testável): os tipos + a resolução (união das concessões).
//!
//! ⚠️ **NENHUM consumidor hoje** (medição do @Altair no #1554): nada em `platform-*` consome
//! capacidade ainda. O 1º consumidor será o **gate de recurso** (Bridge/Astro), ligado pela fatia
//! de FIAÇÃO — separada deste card, com review do @Altair (muda "quem alcança o quê") e acordando a
//! guarda do #1538. Fechar isto significa "o domínio existe e está provado por teste", **não**
//! "capacidade aplicada em algum lugar".
//!
//! **3 regras POR CONSTRUÇÃO:**
//!  1. **União, nunca interseção** — concessão só SOMA; a resolução coleta num conjunto.
//!  2. **Sem concessão NEGATIVA** — não há variante "negar". Revogar é REMOVER a concessão, não
//!     adicionar um "não". O tipo não tem como expressar negação.
//!  3. **Default vazio** — ausência de concessão = negação; nunca "todas".

#![forbid(unsafe_code)]

use std::collections::BTreeSet;

use galaxie_platform_identity::{OrgId, UserId};

/// O que foi concedido. Enum FECHADO: um `match` exaustivo obriga a decidir a política de uma
/// capacidade nova. `BudgetHolder` é DEFERIDO (entra com o ledger) e nasce com regra própria — só
/// a `Usuario` nominal, nunca grupo, sem re-delegação —, que o tipo terá de IMPEDIR por construção.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Capacidade {
    /// Acesso ao Bridge.
    AcessoBridge,
    /// Acesso ao Astro IA.
    AcessoAstroIA,
}

impl Capacidade {
    /// Slug estável (log / serialização futura). `match` EXAUSTIVO — capacidade nova não compila
    /// até ganhar o seu braço aqui (a guarda que obriga a decidir, não a lembrar).
    #[must_use]
    pub fn slug(self) -> &'static str {
        match self {
            Capacidade::AcessoBridge => "acesso_bridge",
            Capacidade::AcessoAstroIA => "acesso_astro_ia",
        }
    }
}

/// A quem a concessão foi feita. Hoje só `Usuario` nominal; `GrupoAad` é DEFERIDO (entra com a
/// fatia de Graph/consent). Enum FECHADO: quando `GrupoAad` entrar, o `match` da resolução força
/// decidir "o usuário pertence a este grupo?" — não nasce um braço irresolvível agora.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Sujeito {
    /// Um usuário nominal.
    Usuario(UserId),
}

/// Uma concessão: `sujeito` ganha `capacidade` sobre a org `alvo`. NÃO há como expressar "negar"
/// (regra 2) — uma `Concessao` só CONCEDE; revogar é remover a linha, nunca adicionar um "não".
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Concessao {
    pub sujeito: Sujeito,
    pub capacidade: Capacidade,
    pub alvo: OrgId,
}

/// `true` se a `concessao` atinge o `usuario` na org `alvo`. O `match` sobre o sujeito é EXAUSTIVO:
/// quando `GrupoAad` entrar, obriga a decidir a pertinência (usuário ∈ grupo?) — a resolução das
/// capacidades efetivas passa a ser "diretas ∪ as de todo grupo do usuário", sem braço irresolvível.
fn concessao_atinge(concessao: &Concessao, usuario: &UserId, alvo: &OrgId) -> bool {
    if concessao.alvo != *alvo {
        return false; // concessão é POR org (regra do alvo) — não vaza pra outra
    }
    match &concessao.sujeito {
        Sujeito::Usuario(u) => u == usuario,
        // Futuro: Sujeito::GrupoAad(g) => usuario_pertence_a(usuario, g) — o `match` obriga a decidir.
    }
}

/// As capacidades EFETIVAS de um `usuario` na org `alvo`: a **UNIÃO** (nunca interseção) das
/// capacidades de todas as concessões que o atingem. Sem concessão que atinja ⇒ conjunto **VAZIO**
/// (regra 3: ausência = negação). `BTreeSet` dá a união (dedup) e ordem estável de propósito.
#[must_use]
pub fn capacidades_efetivas(
    concessoes: &[Concessao],
    usuario: &UserId,
    alvo: &OrgId,
) -> BTreeSet<Capacidade> {
    concessoes
        .iter()
        .filter(|c| concessao_atinge(c, usuario, alvo))
        .map(|c| c.capacidade)
        .collect()
}

/// `true` se o `usuario` TEM a `capacidade` na org `alvo`. É o formato que um gate de recurso vai
/// chamar (na fatia de fiação): pergunta pontual, sem materializar o conjunto inteiro.
#[must_use]
pub fn tem_capacidade(
    concessoes: &[Concessao],
    usuario: &UserId,
    capacidade: Capacidade,
    alvo: &OrgId,
) -> bool {
    concessoes
        .iter()
        .any(|c| c.capacidade == capacidade && concessao_atinge(c, usuario, alvo))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(id: &str) -> UserId {
        UserId(id.into())
    }
    fn org(id: &str) -> OrgId {
        OrgId(id.into())
    }
    fn conceder(usuario: &str, capacidade: Capacidade, alvo: &str) -> Concessao {
        Concessao { sujeito: Sujeito::Usuario(u(usuario)), capacidade, alvo: org(alvo) }
    }

    // AC1 — resolução é a UNIÃO, nunca interseção. Duas concessões de capacidades DIFERENTES ao
    // mesmo usuário ⇒ AMBAS efetivas. Um mutante que interseção-asse devolveria vazio (as duas
    // capacidades nunca coincidem numa concessão só) — este teste o mata.
    #[test]
    fn ac1_resolucao_e_uniao_nunca_intersecao() {
        let concessoes = [
            conceder("u1", Capacidade::AcessoBridge, "acme"),
            conceder("u1", Capacidade::AcessoAstroIA, "acme"),
        ];
        let efetivas = capacidades_efetivas(&concessoes, &u("u1"), &org("acme"));
        assert!(efetivas.contains(&Capacidade::AcessoBridge));
        assert!(efetivas.contains(&Capacidade::AcessoAstroIA));
        assert_eq!(efetivas.len(), 2, "união das duas, não interseção (que daria vazio)");
    }

    // AC2 — "negar" NÃO é representável, e a prova operacional é a MONOTONICIDADE: acrescentar uma
    // concessão NUNCA remove uma capacidade já efetiva (não existe concessão que subtraia). Um
    // mutante que fizesse a resolução não-monotônica (removesse algo ao ver outra concessão) morre.
    #[test]
    fn ac2_negar_nao_e_representavel_uniao_e_monotona() {
        let so_bridge = [conceder("u1", Capacidade::AcessoBridge, "acme")];
        let bridge_e_astro = [
            conceder("u1", Capacidade::AcessoBridge, "acme"),
            conceder("u1", Capacidade::AcessoAstroIA, "acme"),
        ];
        let menos = capacidades_efetivas(&so_bridge, &u("u1"), &org("acme"));
        let mais = capacidades_efetivas(&bridge_e_astro, &u("u1"), &org("acme"));
        // Acrescentar a concessão de Astro NÃO tira o Bridge — o conjunto só cresce (⊆).
        assert!(menos.is_subset(&mais), "acrescentar concessão nunca remove capacidade (sem negativa)");
        assert!(mais.contains(&Capacidade::AcessoBridge), "o Bridge sobrevive ao acréscimo");
    }

    // AC3 — default VAZIO: sem concessão que atinja, capacidades efetivas = ∅ (ausência = negação).
    #[test]
    fn ac3_default_vazio() {
        let nenhuma: [Concessao; 0] = [];
        assert!(capacidades_efetivas(&nenhuma, &u("u1"), &org("acme")).is_empty());
        assert!(!tem_capacidade(&nenhuma, &u("u1"), Capacidade::AcessoBridge, &org("acme")));
    }

    // A concessão é POR org (alvo) e POR sujeito: não vaza pra outra org nem pra outro usuário.
    #[test]
    fn concessao_e_escopada_a_org_e_ao_sujeito() {
        let concessoes = [conceder("u1", Capacidade::AcessoBridge, "acme")];
        // outra org ⇒ não atinge
        assert!(capacidades_efetivas(&concessoes, &u("u1"), &org("globex")).is_empty(), "não vaza pra outra org");
        // outro usuário ⇒ não atinge
        assert!(capacidades_efetivas(&concessoes, &u("u2"), &org("acme")).is_empty(), "não vaza pra outro usuário");
        // o dono, na org certa ⇒ tem
        assert!(tem_capacidade(&concessoes, &u("u1"), Capacidade::AcessoBridge, &org("acme")));
    }

    // Concessões duplicadas (mesma capacidade 2×) colapsam — união é conjunto, não multiset.
    #[test]
    fn concessoes_duplicadas_colapsam() {
        let concessoes = [
            conceder("u1", Capacidade::AcessoBridge, "acme"),
            conceder("u1", Capacidade::AcessoBridge, "acme"),
        ];
        assert_eq!(capacidades_efetivas(&concessoes, &u("u1"), &org("acme")).len(), 1);
    }

    // O slug é exaustivo e estável (guarda de AC4: capacidade nova não compila sem braço).
    #[test]
    fn slug_estavel_por_capacidade() {
        assert_eq!(Capacidade::AcessoBridge.slug(), "acesso_bridge");
        assert_eq!(Capacidade::AcessoAstroIA.slug(), "acesso_astro_ia");
        assert_ne!(Capacidade::AcessoBridge.slug(), Capacidade::AcessoAstroIA.slug());
    }
}
