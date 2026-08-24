//! Ciclo de vida da sessão web — fatia 2 do #1469 (delta do @Altair, decidido com o FE).
//!
//! A sessão é um COOKIE `HttpOnly` que o SPA nunca lê (num SPA, token no corpo iria pro
//! `localStorage`, que qualquer XSS rouba). O CSPRNG que gera o [`SessaoId`] e o axum que
//! serve vivem na BORDA (fatia 3) — aqui é só a LÓGICA server-side: um armazém id→sessão
//! com invalidação e rotação, e a POLÍTICA do cookie. O crate segue puro (std): o id entra
//! PRONTO, injetado pelo caller, então a fundação não escolhe fonte de aleatoriedade.
//!
//! Regras que o @Altair sustentou (fatia 2):
//!  - Invalidar é FATO no servidor (logout/troca-senha apagam a sessão), não "apagar o
//!    cookie no cliente" — apagar cookie é sugestão; invalidar é fato.
//!  - Rotação no login (sessão nova ao autenticar) fecha *fixation*.
//!  - Mesma origem (PathPrefix) ⇒ `SameSite=Lax` basta e CORS deixa de existir.

use std::collections::HashMap;

use crate::{Sessao, UserId};

/// Id OPACO de uma sessão — o valor que viaja no cookie. Gerado por CSPRNG na borda
/// (fatia 3), NUNCA aqui. Trate como segredo: quem o tem, é a sessão.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SessaoId(pub String);

/// Armazém de sessões server-side. `invalidar` remove do SERVIDOR (fato), não do cliente.
/// Trait pra a borda plugar memória agora e persistência depois, sem tocar na lógica.
pub trait ArmazemSessao {
    /// Registra uma sessão sob um id (o login já rotacionou — ver [`Self::rotacionar`]).
    fn estabelecer(&mut self, id: SessaoId, sessao: Sessao);
    /// Valida um id vindo do cookie: devolve a sessão viva, ou `None` se não existe/foi morta.
    fn validar(&self, id: &SessaoId) -> Option<&Sessao>;
    /// Logout: mata ESTA sessão no servidor. `true` se existia.
    fn invalidar(&mut self, id: &SessaoId) -> bool;
    /// Troca de senha: mata TODAS as sessões do usuário (não só a atual). Devolve quantas.
    fn invalidar_do_usuario(&mut self, usuario: &UserId) -> usize;
    /// Rotação: a sessão do `velho` id passa a valer sob um id NOVO e o velho morre no mesmo
    /// ato (fecha fixation). `true` se o velho existia.
    fn rotacionar(&mut self, velho: &SessaoId, novo: SessaoId) -> bool;
}

/// Primeira impl: em memória (HashMap id→sessão). Persistência é fatia posterior — a trait
/// deixa trocar sem mexer em quem consome.
#[derive(Debug, Default)]
pub struct ArmazemMemoria {
    sessoes: HashMap<SessaoId, Sessao>,
}

impl ArmazemMemoria {
    pub fn novo() -> Self {
        Self::default()
    }

    pub fn quantidade(&self) -> usize {
        self.sessoes.len()
    }
}

impl ArmazemSessao for ArmazemMemoria {
    fn estabelecer(&mut self, id: SessaoId, sessao: Sessao) {
        self.sessoes.insert(id, sessao);
    }

    fn validar(&self, id: &SessaoId) -> Option<&Sessao> {
        self.sessoes.get(id)
    }

    fn invalidar(&mut self, id: &SessaoId) -> bool {
        self.sessoes.remove(id).is_some()
    }

    fn invalidar_do_usuario(&mut self, usuario: &UserId) -> usize {
        let antes = self.sessoes.len();
        self.sessoes
            .retain(|_, s| s.principal().usuario() != usuario);
        antes - self.sessoes.len()
    }

    fn rotacionar(&mut self, velho: &SessaoId, novo: SessaoId) -> bool {
        match self.sessoes.remove(velho) {
            Some(s) => {
                self.sessoes.insert(novo, s);
                true
            }
            None => false,
        }
    }
}

/// Nome do cookie de sessão da plataforma.
pub const NOME_COOKIE_SESSAO: &str = "gx_sess";

/// Valor do header `Set-Cookie` da sessão, com a política da fatia 2: `HttpOnly` (script
/// nunca lê — mata roubo por XSS) + `Secure` (só HTTPS) + `SameSite=Lax` (mesma origem via
/// PathPrefix; sem CORS) + `Path=/`. O SPA nunca vê o valor; ele só volta no próximo request.
pub fn montar_cookie_sessao(id: &SessaoId) -> String {
    format!("{NOME_COOKIE_SESSAO}={}; HttpOnly; Secure; SameSite=Lax; Path=/", id.0)
}

/// Cookie de EXPURGO no logout (`Max-Age=0` apaga no cliente). É o COMPLEMENTO de
/// [`ArmazemSessao::invalidar`], nunca o substituto: apagar o cookie sem invalidar no
/// servidor deixaria a sessão viva pra quem tivesse copiado o valor.
pub fn montar_cookie_expurgo() -> String {
    format!("{NOME_COOKIE_SESSAO}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Escopo, OrgId, Principal};

    fn sessao_de(user: &str, org_id: &str) -> Sessao {
        let p = Principal::AdminOrg {
            usuario: UserId(user.into()),
            org: OrgId(org_id.into()),
        };
        Sessao::estabelecer(p, Escopo::de_orgs([OrgId(org_id.into())]))
    }
    fn sid(s: &str) -> SessaoId {
        SessaoId(s.into())
    }

    #[test]
    fn estabelecer_e_validar() {
        let mut a = ArmazemMemoria::novo();
        a.estabelecer(sid("s1"), sessao_de("u1", "orgA"));
        assert!(a.validar(&sid("s1")).is_some());
        assert!(a.validar(&sid("naoexiste")).is_none());
    }

    // Logout é FATO no servidor: depois de invalidar, o mesmo id do cookie não vale mais.
    #[test]
    fn invalidar_mata_a_sessao_no_servidor() {
        let mut a = ArmazemMemoria::novo();
        a.estabelecer(sid("s1"), sessao_de("u1", "orgA"));
        assert!(a.invalidar(&sid("s1")));
        assert!(a.validar(&sid("s1")).is_none(), "sessão morta não valida");
        assert!(!a.invalidar(&sid("s1")), "invalidar de novo é no-op");
    }

    // Troca de senha mata TODAS as sessões do usuário (várias abas/dispositivos), não só
    // a atual — e não toca nas de outro usuário.
    #[test]
    fn troca_de_senha_invalida_todas_do_usuario() {
        let mut a = ArmazemMemoria::novo();
        a.estabelecer(sid("s1"), sessao_de("u1", "orgA"));
        a.estabelecer(sid("s2"), sessao_de("u1", "orgA")); // 2ª sessão do mesmo user
        a.estabelecer(sid("s3"), sessao_de("outro", "orgA"));
        let mortas = a.invalidar_do_usuario(&UserId("u1".into()));
        assert_eq!(mortas, 2);
        assert!(a.validar(&sid("s1")).is_none());
        assert!(a.validar(&sid("s2")).is_none());
        assert!(a.validar(&sid("s3")).is_some(), "sessão de outro usuário fica");
    }

    // Rotação no login fecha fixation: o id velho (que um atacante poderia ter plantado)
    // morre no mesmo ato em que o novo nasce, carregando a MESMA sessão.
    #[test]
    fn rotacao_mata_o_velho_e_preserva_a_sessao() {
        let mut a = ArmazemMemoria::novo();
        a.estabelecer(sid("velho"), sessao_de("u1", "orgA"));
        let antes = a.validar(&sid("velho")).cloned();
        assert!(a.rotacionar(&sid("velho"), sid("novo")));
        assert!(a.validar(&sid("velho")).is_none(), "id velho morre (fixation)");
        assert_eq!(a.validar(&sid("novo")).cloned(), antes, "sessão preservada no id novo");
        assert!(!a.rotacionar(&sid("velho"), sid("outro")), "rotacionar id morto é no-op");
    }

    // A política do cookie: os 3 atributos que impedem roubo/cross-site (fatia 2).
    #[test]
    fn cookie_carrega_httponly_secure_samesite() {
        let c = montar_cookie_sessao(&sid("abc123"));
        assert!(c.contains("gx_sess=abc123"));
        assert!(c.contains("HttpOnly"), "script nunca lê o valor");
        assert!(c.contains("Secure"), "só HTTPS");
        assert!(c.contains("SameSite=Lax"), "mesma origem, sem CORS");
        assert!(c.contains("Path=/"));
    }

    // Expurgo apaga no cliente (Max-Age=0) — complemento de `invalidar`, não substituto.
    #[test]
    fn cookie_expurgo_apaga_no_cliente() {
        let c = montar_cookie_expurgo();
        assert!(c.contains("gx_sess=;") || c.contains("gx_sess= "));
        assert!(c.contains("Max-Age=0"));
        assert!(c.contains("HttpOnly"));
    }
}
