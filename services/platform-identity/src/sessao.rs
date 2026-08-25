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
    /// Registra uma sessão sob um id, com DOIS prazos (epoch em segundos): `expira_absoluto_unix`
    /// (o teto, #1504) e `expira_ocioso_unix` (a janela de inatividade, #1512). A borda computa
    /// ambos de `agora` (ver [`TTL_SESSAO_SEG`]/[`IDLE_TTL_SEG`]); o armazém não escolhe relógio (AC2).
    fn estabelecer(
        &mut self,
        id: SessaoId,
        sessao: Sessao,
        expira_absoluto_unix: u64,
        expira_ocioso_unix: u64,
    );
    /// Valida um id do cookie CONTRA `agora_unix` (injetado — sem relógio hardcodado, AC2), SEM
    /// renovar: devolve a sessão só se não foi morta E `agora` está dentro de AMBOS os prazos
    /// (absoluto E ocioso). Vencida por qualquer um recusa como se não existisse (#1504 AC1 / #1512 AC1).
    fn validar(&self, id: &SessaoId, agora_unix: u64) -> Option<&Sessao>;
    /// Acesso COM atividade (#1512): valida (como [`Self::validar`]) e, se viva, DESLIZA a janela
    /// de ociosidade para `novo_ocioso_unix` — mas **capada no prazo absoluto** (atividade NUNCA
    /// move o teto, #1512 AC2). Devolve a sessão renovada, ou `None` se vencida/inexistente.
    fn tocar(&mut self, id: &SessaoId, agora_unix: u64, novo_ocioso_unix: u64) -> Option<&Sessao>;
    /// Logout: mata ESTA sessão no servidor. `true` se existia.
    fn invalidar(&mut self, id: &SessaoId) -> bool;
    /// Troca de senha: mata TODAS as sessões do usuário (não só a atual). Devolve quantas.
    fn invalidar_do_usuario(&mut self, usuario: &UserId) -> usize;
    /// Rotação: a sessão do `velho` id passa a valer sob um id NOVO (e o velho morre no mesmo
    /// ato — fecha fixation), PRESERVANDO a expiração. `true` se o velho existia.
    fn rotacionar(&mut self, velho: &SessaoId, novo: SessaoId) -> bool;
}

/// Uma sessão viva no armazém + quando ela expira (#1504). A expiração é ABSOLUTA (epoch),
/// não relativa: o armazém não precisa de relógio, só compara com o `agora` que a borda passa.
#[derive(Debug)]
struct EntradaSessao {
    sessao: Sessao,
    /// Teto ABSOLUTO (#1504) — nunca se move; a atividade não o estende.
    expira_absoluto_unix: u64,
    /// Janela de ociosidade (#1512) — desliza com a atividade (`tocar`), mas capada no absoluto.
    expira_ocioso_unix: u64,
}

/// Primeira impl: em memória (HashMap id→entrada). Persistência é fatia posterior — a trait
/// deixa trocar sem mexer em quem consome.
#[derive(Debug, Default)]
pub struct ArmazemMemoria {
    sessoes: HashMap<SessaoId, EntradaSessao>,
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
    fn estabelecer(
        &mut self,
        id: SessaoId,
        sessao: Sessao,
        expira_absoluto_unix: u64,
        expira_ocioso_unix: u64,
    ) {
        self.sessoes.insert(
            id,
            EntradaSessao { sessao, expira_absoluto_unix, expira_ocioso_unix },
        );
    }

    fn validar(&self, id: &SessaoId, agora_unix: u64) -> Option<&Sessao> {
        // Expiração LAZY: a entrada vencida fica no mapa mas não valida (sweep é fatia de
        // persistência). Viva = dentro de AMBOS os prazos (`agora < absoluto` E `agora < ocioso`).
        self.sessoes
            .get(id)
            .filter(|e| agora_unix < e.expira_absoluto_unix && agora_unix < e.expira_ocioso_unix)
            .map(|e| &e.sessao)
    }

    fn tocar(&mut self, id: &SessaoId, agora_unix: u64, novo_ocioso_unix: u64) -> Option<&Sessao> {
        let e = self.sessoes.get_mut(id)?;
        // Mesma checagem de `validar` (os dois prazos) ANTES de renovar — sessão vencida não
        // ressuscita por atividade (AC1).
        if agora_unix >= e.expira_absoluto_unix || agora_unix >= e.expira_ocioso_unix {
            return None;
        }
        // Desliza a janela de ociosidade, CAPADA no absoluto: a atividade nunca move o teto
        // (#1512 AC2). O `min` é a garantia — mora aqui, não na borda.
        e.expira_ocioso_unix = novo_ocioso_unix.min(e.expira_absoluto_unix);
        Some(&e.sessao)
    }

    fn invalidar(&mut self, id: &SessaoId) -> bool {
        self.sessoes.remove(id).is_some()
    }

    fn invalidar_do_usuario(&mut self, usuario: &UserId) -> usize {
        let antes = self.sessoes.len();
        self.sessoes
            .retain(|_, e| e.sessao.principal().usuario() != usuario);
        antes - self.sessoes.len()
    }

    fn rotacionar(&mut self, velho: &SessaoId, novo: SessaoId) -> bool {
        match self.sessoes.remove(velho) {
            Some(e) => {
                self.sessoes.insert(novo, e);
                true
            }
            None => false,
        }
    }
}

/// TTL ABSOLUTO default de uma sessão web (#1504): 12 h — o teto que a atividade NÃO move.
/// **DEFAULT do dev, não decisão de produto** — pendente do PO (#1504). A borda computa
/// `expira_absoluto = agora + TTL`. Constante (sem UI); encurtar é barato.
pub const TTL_SESSAO_SEG: u64 = 12 * 60 * 60;

/// Prazo OCIOSO default (#1512): 30 min sem atividade ⇒ a sessão morre, mesmo dentro do
/// absoluto. Cada acesso (`tocar`) desliza a janela pra `agora + IDLE_TTL_SEG`, capada no
/// absoluto. **DEFAULT do dev, não decisão** — pendente do PO junto com o valor absoluto.
pub const IDLE_TTL_SEG: u64 = 30 * 60;

/// Nome do cookie de sessão da plataforma. O prefixo **`__Host-`** (achado do @Altair na
/// revisão da fatia 3) mata cookie-shadowing POR IMPOSIÇÃO DO NAVEGADOR: um cookie
/// `__Host-` só é aceito se for `Secure`, `Path=/` e SEM `Domain` — que é exatamente a
/// política abaixo. Assim um subdomínio não pode plantar um `gx_sess` que sombreie o nosso.
/// Barato só AGORA: renomear depois desloga toda sessão viva.
pub const NOME_COOKIE_SESSAO: &str = "__Host-gx_sess";

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

    // Relógio de teste (injetado — o armazém não tem relógio próprio, AC2).
    const AGORA: u64 = 1_000;
    const FUTURO: u64 = AGORA + 10_000; // expira bem além de AGORA ⇒ sessão fresca

    #[test]
    fn estabelecer_e_validar() {
        let mut a = ArmazemMemoria::novo();
        a.estabelecer(sid("s1"), sessao_de("u1", "orgA"), FUTURO, FUTURO);
        assert!(a.validar(&sid("s1"), AGORA).is_some());
        assert!(a.validar(&sid("naoexiste"), AGORA).is_none());
    }

    // Logout é FATO no servidor: depois de invalidar, o mesmo id do cookie não vale mais.
    #[test]
    fn invalidar_mata_a_sessao_no_servidor() {
        let mut a = ArmazemMemoria::novo();
        a.estabelecer(sid("s1"), sessao_de("u1", "orgA"), FUTURO, FUTURO);
        assert!(a.invalidar(&sid("s1")));
        assert!(a.validar(&sid("s1"), AGORA).is_none(), "sessão morta não valida");
        assert!(!a.invalidar(&sid("s1")), "invalidar de novo é no-op");
    }

    // Troca de senha mata TODAS as sessões do usuário (várias abas/dispositivos), não só
    // a atual — e não toca nas de outro usuário.
    #[test]
    fn troca_de_senha_invalida_todas_do_usuario() {
        let mut a = ArmazemMemoria::novo();
        a.estabelecer(sid("s1"), sessao_de("u1", "orgA"), FUTURO, FUTURO);
        a.estabelecer(sid("s2"), sessao_de("u1", "orgA"), FUTURO, FUTURO); // 2ª sessão do mesmo user
        a.estabelecer(sid("s3"), sessao_de("outro", "orgA"), FUTURO, FUTURO);
        let mortas = a.invalidar_do_usuario(&UserId("u1".into()));
        assert_eq!(mortas, 2);
        assert!(a.validar(&sid("s1"), AGORA).is_none());
        assert!(a.validar(&sid("s2"), AGORA).is_none());
        assert!(a.validar(&sid("s3"), AGORA).is_some(), "sessão de outro usuário fica");
    }

    // Rotação no login fecha fixation: o id velho (que um atacante poderia ter plantado)
    // morre no mesmo ato em que o novo nasce, carregando a MESMA sessão (e a expiração).
    #[test]
    fn rotacao_mata_o_velho_e_preserva_a_sessao() {
        let mut a = ArmazemMemoria::novo();
        a.estabelecer(sid("velho"), sessao_de("u1", "orgA"), FUTURO, FUTURO);
        let antes = a.validar(&sid("velho"), AGORA).cloned();
        assert!(a.rotacionar(&sid("velho"), sid("novo")));
        assert!(a.validar(&sid("velho"), AGORA).is_none(), "id velho morre (fixation)");
        assert_eq!(a.validar(&sid("novo"), AGORA).cloned(), antes, "sessão preservada no id novo");
        assert!(!a.rotacionar(&sid("velho"), sid("outro")), "rotacionar id morto é no-op");
    }

    // AC1/AC3 (#1504) — sessão além do TTL é RECUSADA como se não existisse. `estabelece` num
    // instante que expira em `expira`; `validar` DEPOIS de `expira` devolve None; ANTES, Some.
    #[test]
    fn ac1_sessao_vencida_recusa() {
        let mut a = ArmazemMemoria::novo();
        let expira = 5_000;
        a.estabelecer(sid("s1"), sessao_de("u1", "orgA"), expira, FUTURO);
        assert!(a.validar(&sid("s1"), expira - 1).is_some(), "1s antes do TTL: viva");
        assert!(a.validar(&sid("s1"), expira).is_none(), "no instante do TTL: já venceu");
        assert!(a.validar(&sid("s1"), expira + 3600).is_none(), "muito depois: recusa");
    }

    // AC2 — `validar` NÃO tem relógio hardcodado: o mesmo id dá vivo ou vencido só mudando o
    // `agora` injetado. (Se houvesse relógio interno, este teste não conseguiria os dois.)
    #[test]
    fn ac2_agora_e_injetado_nao_hardcodado() {
        let mut a = ArmazemMemoria::novo();
        a.estabelecer(sid("s1"), sessao_de("u1", "orgA"), 5_000, FUTURO);
        assert!(a.validar(&sid("s1"), 4_999).is_some());
        assert!(a.validar(&sid("s1"), 5_001).is_none());
    }

    // #1512 AC1 — sessão OCIOSA (sem atividade além do prazo ocioso) recusa, MESMO dentro do
    // absoluto. Absoluto longe (FUTURO), ocioso vence em 2_000.
    #[test]
    fn ocioso_ac1_sem_atividade_vence_dentro_do_absoluto() {
        let mut a = ArmazemMemoria::novo();
        a.estabelecer(sid("s1"), sessao_de("u1", "orgA"), FUTURO, 2_000);
        assert!(a.validar(&sid("s1"), 1_999).is_some(), "antes do ocioso: viva");
        assert!(a.validar(&sid("s1"), 2_000).is_none(), "ocioso vencido recusa, mesmo com absoluto longe");
    }

    // #1512 AC2 — `tocar` (atividade) DESLIZA o ocioso, mas o absoluto NÃO se move; e o novo
    // ocioso é CAPADO no absoluto (atividade perto do teto não estende além dele).
    #[test]
    fn ocioso_ac2_tocar_desliza_mas_nao_move_o_absoluto() {
        let mut a = ArmazemMemoria::novo();
        a.estabelecer(sid("s1"), sessao_de("u1", "orgA"), 10_000, 2_000);
        // Atividade em 1_500 (dentro do ocioso): desliza pra 1_500+3_000 = 4_500.
        assert!(a.tocar(&sid("s1"), 1_500, 1_500 + 3_000).is_some());
        assert!(a.validar(&sid("s1"), 4_499).is_some(), "ocioso renovado: viva em 4_499 (antes seria morta em 2_000)");
        assert!(a.validar(&sid("s1"), 4_500).is_none(), "novo ocioso vence em 4_500");
        // Atividade perto do teto: o novo ocioso é capado no absoluto (10_000), não além.
        assert!(a.tocar(&sid("s1"), 4_000, 4_000 + 9_999).is_some());
        assert!(a.validar(&sid("s1"), 9_999).is_some(), "capado no absoluto: vivo até 10_000");
        assert!(a.validar(&sid("s1"), 10_000).is_none(), "o ABSOLUTO não se moveu — teto inviolável");
    }

    // #1512 AC3 (repro) — sessão além do ABSOLUTO recusa mesmo com atividade: `tocar` não
    // ressuscita quem passou do teto.
    #[test]
    fn ocioso_ac3_atividade_nao_passa_do_absoluto() {
        let mut a = ArmazemMemoria::novo();
        a.estabelecer(sid("s1"), sessao_de("u1", "orgA"), 5_000, 5_000);
        assert!(a.tocar(&sid("s1"), 5_001, 5_001 + 3_000).is_none(), "além do absoluto: tocar recusa");
        assert!(a.validar(&sid("s1"), 5_001).is_none());
    }

    // A política do cookie: os 3 atributos que impedem roubo/cross-site (fatia 2).
    #[test]
    fn cookie_carrega_httponly_secure_samesite() {
        let c = montar_cookie_sessao(&sid("abc123"));
        assert!(c.starts_with("__Host-"), "prefixo __Host- mata shadowing (imposto pelo browser)");
        assert!(c.contains("__Host-gx_sess=abc123"));
        assert!(c.contains("HttpOnly"), "script nunca lê o valor");
        assert!(c.contains("Secure"), "só HTTPS (exigido pelo __Host-)");
        assert!(c.contains("SameSite=Lax"), "mesma origem, sem CORS");
        assert!(c.contains("Path=/"), "exigido pelo __Host-");
        assert!(!c.contains("Domain="), "__Host- proíbe Domain");
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
