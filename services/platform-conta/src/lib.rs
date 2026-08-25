//! Conta/perfil (`/me`) da plataforma web — #1473 (épico #1265). Depende da fundação #1469.
//!
//! Delta do @Altair: **"a conta é sua e só sua."** Todo recurso é escopado ao PRINCIPAL DA
//! SESSÃO — nunca endereçável por um id vindo do cliente. `GET /me/...`, não
//! `GET /users/<id>/...`. Se um id chega na rota, ele é CONFERIDO contra a sessão; conta
//! alheia responde **404 (não 403 — não enumerar)**. O escopo vem da SESSÃO (fundação
//! regra 5), nunca do payload.
//!
//! Esta fatia é DOMÍNIO PURO (como a fundação): a decisão de escopo é testável com valores,
//! sem I/O. A borda HTTP (rotas `/me/*`) e a persistência são fatias seguintes que CHAMAM
//! esta lógica — elas trazem o "quem sou eu" da sessão pra cá e obedecem a decisão.

#![forbid(unsafe_code)]

use galaxie_platform_identity::armazem::ErroArmazem;
use galaxie_platform_identity::{Principal, Sessao, UserId};
use std::collections::HashMap;

/// Erro de resolução de um recurso de conta. `NaoEncontrado` é o **404** da regra 6 da
/// fundação: pedir a conta de outro não distingue "existe mas não pode" de "não existe" —
/// não enumerar contas alheias (AC2). Sem terceiro estado: ou é seu, ou não existe pra você.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContaErro {
    NaoEncontrado,
}

/// O `UserId` do humano dono da sessão. Todo principal da web é um humano — usuário final,
/// admin de org ou staff — e carrega o seu `UserId`. É **daqui, da SESSÃO**, que sai o
/// escopo de `/me`; nunca de um id/payload do chamador (fundação regra 5 / AC1, AC4).
#[must_use]
pub fn usuario_da_sessao(sessao: &Sessao) -> &UserId {
    match sessao.principal() {
        Principal::UsuarioFinal { usuario, .. }
        | Principal::AdminOrg { usuario, .. }
        | Principal::Staff { usuario } => usuario,
    }
}

/// Resolve o usuário-alvo de um recurso `/me`. `alvo_na_rota` é o id que EVENTUALMENTE veio
/// na rota (ex.: um cliente forjando `/users/<id>`); `None` = rota `/me` pura.
///
/// - `None` ⇒ o próprio usuário da sessão (AC1: `/me` = você).
/// - `Some(id)` com `id` **==** usuário da sessão ⇒ ok (é você mesmo, com id explícito).
/// - `Some(id)` com `id` **!=** usuário da sessão ⇒ **`NaoEncontrado` (404, AC2)** — conta
///   alheia NÃO vira 403 (não confirma existência).
///
/// O escopo NUNCA vem do payload (AC4): esta função só conhece a SESSÃO e um id de ROTA;
/// não há parâmetro por onde um payload amplie o escopo — a única fonte é a sessão.
#[must_use = "a decisão de escopo tem de ser respeitada — ignorá-la reabre o AC2 (dados alheios)"]
pub fn resolver_conta_propria<'a>(
    sessao: &'a Sessao,
    alvo_na_rota: Option<&UserId>,
) -> Result<&'a UserId, ContaErro> {
    let eu = usuario_da_sessao(sessao);
    match alvo_na_rota {
        None => Ok(eu),
        Some(id) if id == eu => Ok(eu),
        Some(_) => Err(ContaErro::NaoEncontrado),
    }
}

/// Autoriza revogar um dispositivo/sessão cujo dono é `dono_do_recurso`. Só o **próprio**
/// usuário da sessão pode (AC3); recurso de outro = `NaoEncontrado` (404, não vaza
/// existência). `dono_do_recurso` é resolvido PELO SERVIDOR a partir do recurso persistido,
/// nunca afirmado pelo chamador.
#[must_use = "a decisão de revogação tem de ser respeitada — ignorá-la revoga recurso alheio"]
pub fn pode_revogar_recurso_proprio(
    sessao: &Sessao,
    dono_do_recurso: &UserId,
) -> Result<(), ContaErro> {
    if usuario_da_sessao(sessao) == dono_do_recurso {
        Ok(())
    } else {
        Err(ContaErro::NaoEncontrado)
    }
}

/// O perfil do humano dono da conta — o corpo de `GET /me` (contrato §4.1: `{ nome, email,
/// idioma? }`). Domínio; a borda projeta no fio. `idioma` é opcional (o cliente cai no default se
/// ausente). NÃO carrega id de outro nem escopo: a conta é do humano da SESSÃO (delta do @Altair).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Perfil {
    pub nome: String,
    pub email: String,
    pub idioma: Option<String>,
}

/// Armazém do perfil, indexado pelo `UserId` do dono. `Result` DESDE O DIA 1 (regra do @Altair, já
/// aplicada aos stores de org): quando o backing real entrar, muda UMA linha na trait, não a
/// assinatura + todo consumidor. `Ok(None)` = perfil não encontrado (a borda decide o HTTP); `Err`
/// = infra fora do ar (distinta de "não achei", como no resto da plataforma).
pub trait ArmazemPerfil {
    /// O perfil do `uid`, se houver. `Ok(None)` = não encontrado; `Err` = armazém indisponível.
    fn buscar(&self, uid: &UserId) -> Result<Option<Perfil>, ErroArmazem>;
}

/// Primeira impl: em memória. O perfil REAL nasce no callback OAuth (do `userinfo` do provedor —
/// fatia C); aqui a semeadura é do dev-server, pro FE fiar o e2e antes do login federado.
#[derive(Debug, Default)]
pub struct ArmazemPerfilMemoria {
    perfis: HashMap<String, Perfil>,
}

impl ArmazemPerfilMemoria {
    #[must_use]
    pub fn novo() -> Self {
        Self::default()
    }

    /// Semeia o perfil de um usuário (dev-server / testes). Em produção, o callback OAuth grava.
    pub fn inserir(&mut self, uid: UserId, perfil: Perfil) {
        self.perfis.insert(uid.0, perfil);
    }
}

impl ArmazemPerfil for ArmazemPerfilMemoria {
    fn buscar(&self, uid: &UserId) -> Result<Option<Perfil>, ErroArmazem> {
        Ok(self.perfis.get(&uid.0).cloned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use galaxie_platform_identity::{Escopo, OrgId, Principal, Sessao, UserId};

    /// Sessão de um usuário final (o escopo de org é irrelevante pro `/me`; a conta é do humano).
    fn sessao_de(user: &str) -> Sessao {
        Sessao::estabelecer(
            Principal::UsuarioFinal {
                usuario: UserId(user.into()),
                org: OrgId("orgA".into()),
            },
            Escopo::vazio(),
        )
    }

    // AC1 — `/me` (sem id) resolve pro próprio usuário da sessão; nada vem de fora.
    #[test]
    fn ac1_me_resolve_o_usuario_da_sessao() {
        let s = sessao_de("A");
        assert_eq!(usuario_da_sessao(&s), &UserId("A".into()));
        assert_eq!(resolver_conta_propria(&s, None), Ok(&UserId("A".into())));
    }

    // AC2 — id de OUTRA conta na rota ⇒ 404 (`NaoEncontrado`), nunca 403; o próprio id ok.
    #[test]
    fn ac2_conta_alheia_e_404_nao_403() {
        let s = sessao_de("A");
        assert_eq!(
            resolver_conta_propria(&s, Some(&UserId("B".into()))),
            Err(ContaErro::NaoEncontrado)
        );
        // o próprio id explícito resolve normalmente (é você mesmo, com id na rota)
        assert_eq!(
            resolver_conta_propria(&s, Some(&UserId("A".into()))),
            Ok(&UserId("A".into()))
        );
    }

    // AC3 — revogar só afeta recursos do PRÓPRIO usuário; dono diferente ⇒ 404.
    #[test]
    fn ac3_revoga_so_o_proprio() {
        let s = sessao_de("A");
        assert_eq!(pode_revogar_recurso_proprio(&s, &UserId("A".into())), Ok(()));
        assert_eq!(
            pode_revogar_recurso_proprio(&s, &UserId("B".into())),
            Err(ContaErro::NaoEncontrado)
        );
    }

    // AC4 — o escopo vem SÓ da sessão. Qualquer id forjado na rota (o vetor de ampliação)
    // que não seja o da sessão fecha em 404 — não há parâmetro por onde um payload amplie.
    #[test]
    fn ac4_id_forjado_nao_amplia_escopo_alem_da_sessao() {
        let s = sessao_de("A");
        for forjado in ["B", "admin", "0", ""] {
            assert_eq!(
                resolver_conta_propria(&s, Some(&UserId(forjado.into()))),
                Err(ContaErro::NaoEncontrado),
                "id de rota {forjado:?} não pode ampliar o escopo além da sessão"
            );
        }
    }

    // Staff também é humano com `UserId` e tem um `/me` próprio (a conta é dele) — e a conta
    // de outro staff continua sendo 404 (o scoping vale pra os três tipos de principal).
    #[test]
    fn staff_tem_me_proprio_e_nao_ve_conta_alheia() {
        let s = Sessao::estabelecer(
            Principal::Staff { usuario: UserId("s1".into()) },
            Escopo::vazio(),
        );
        assert_eq!(resolver_conta_propria(&s, None), Ok(&UserId("s1".into())));
        assert_eq!(
            resolver_conta_propria(&s, Some(&UserId("s2".into()))),
            Err(ContaErro::NaoEncontrado)
        );
    }
}
