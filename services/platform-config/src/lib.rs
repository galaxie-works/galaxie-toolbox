//! Config do uso do app (prefs owner-scoped + allowlist) — #1471 (épico #1265).
//! Depende da fundação #1469 (`galaxie-platform-identity`).
//!
//! Duas guardas independentes (delta do @Altair):
//!  1. **Prefs owner-scoped** — o escopo vem da SESSÃO (fundação regra 5), nunca de um id
//!     no payload. Pref de outro usuário responde **404 (não 403 — não enumerar)**. Mesmo
//!     padrão do `/me` (#1473).
//!  2. **Allowlist explícita** do que a WEB pode configurar — NÃO "toda chave de pref". Se a
//!     plataforma pudesse gravar qualquer pref, viraria caminho de escalada (mexer em pref
//!     interna). Só as chaves de [`CHAVES_WEB`] são graváveis pela web; fora dela ⇒ recusa.
//!
//! Domínio PURO (como a fundação): a decisão é testável sem I/O. A borda HTTP e a
//! persistência das prefs são fatias seguintes que CHAMAM esta lógica.

#![forbid(unsafe_code)]

use galaxie_platform_identity::{Principal, Sessao, UserId};

/// Chaves de pref de USO DO APP que a plataforma web pode configurar — **allowlist
/// explícita** (regra 2 do delta). NÃO é "toda pref": é o conjunto seguro de expor à web.
/// Prefixo `app.` deixa claro que é uso do app (não pref interna/privilegiada). Crescer aqui
/// é uma decisão explícita — o default (fora da lista) é recusar.
pub const CHAVES_WEB: &[&str] = &[
    "app.tema",
    "app.idioma",
    "app.densidade",
    "app.notificacoes",
    "app.tela_inicial",
];

/// Erro de uma operação de pref. `NaoEncontrado` = 404 (pref de outro — não enumera);
/// `ChaveNaoPermitida` = a chave não está na allowlist da web (não é "toda pref");
/// `ValorInvalido` = o valor não cabe no tipo da chave (opção fora de `opcoes`, ou `Texto`
/// além do teto) — o gap que ficou aberto no #1471 (a allowlist gate a CHAVE, isto gate o
/// VALOR). Não enumera qual regra falhou por dentro (é do domínio, não da borda).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfigErro {
    NaoEncontrado,
    ChaveNaoPermitida,
    ValorInvalido,
}

/// Teto de tamanho (bytes UTF-8) do valor de uma pref [`Texto`] — sem ele, a config viraria
/// armazenamento arbitrário pago por nós (#1563 AC3). Conservador; sobe por decisão explícita.
pub const TETO_TEXTO_BYTES: usize = 4096;

/// `true` se `chave` está na allowlist da web ([`CHAVES_WEB`]) — a única coisa gravável pela
/// plataforma. Default-deny: qualquer chave fora da lista é recusada (AC2).
#[must_use]
pub fn chave_configuravel(chave: &str) -> bool {
    CHAVES_WEB.contains(&chave)
}

/// Um item de config já VALIDADO. A forma plana do fio (contrato §4.2) admite lixo —
/// `tipo:"bool"` com `valor:"escuro"`, ou opção fora de `opcoes`. Aqui essas combinações são
/// **impossíveis por construção**: os campos são privados e só os construtores (que validam)
/// criam um item. "Parsing como validação" (#1563 AC1): quem tem um `ConfigItem` tem a
/// garantia, não a promessa; o inverso — do fio pro domínio — passa pelos construtores, que
/// devolvem [`ConfigErro::ValorInvalido`] em vez de aceitar. Serializa pra forma plana em
/// [`ConfigItem::para_fio`]; o widget é escolha do FE (o `tipo` aqui é tipo de VALOR).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfigItem {
    Booleano(Booleano),
    Texto(Texto),
    Opcao(Opcao),
}

/// Pref booleana (ex.: `app.notificacoes`). Sem invariante além do tipo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Booleano {
    chave: String,
    valor: bool,
}

impl Booleano {
    #[must_use]
    pub fn novo(chave: impl Into<String>, valor: bool) -> Self {
        Self { chave: chave.into(), valor }
    }
    #[must_use]
    pub fn chave(&self) -> &str {
        &self.chave
    }
    #[must_use]
    pub fn valor(&self) -> bool {
        self.valor
    }
}

/// Pref de texto livre (ex.: um rótulo do usuário). Invariante: o valor não excede
/// [`TETO_TEXTO_BYTES`] — senão a config vira armazenamento arbitrário (#1563 AC3).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Texto {
    chave: String,
    valor: String,
}

impl Texto {
    /// `ValorInvalido` se `valor` passa do teto. Mede bytes UTF-8, não `char`s — o custo de
    /// armazenamento é em bytes.
    pub fn novo(chave: impl Into<String>, valor: impl Into<String>) -> Result<Self, ConfigErro> {
        let valor = valor.into();
        if valor.len() > TETO_TEXTO_BYTES {
            return Err(ConfigErro::ValorInvalido);
        }
        Ok(Self { chave: chave.into(), valor })
    }
    #[must_use]
    pub fn chave(&self) -> &str {
        &self.chave
    }
    #[must_use]
    pub fn valor(&self) -> &str {
        &self.valor
    }
}

/// Pref de escolha fechada (ex.: `app.tema` ∈ {claro, escuro, sistema}). Invariante:
/// `valor ∈ opcoes` — a combinação "valor fora das opções" não é representável (#1563 AC1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Opcao {
    chave: String,
    valor: String,
    opcoes: Vec<String>,
}

impl Opcao {
    /// `ValorInvalido` se `valor` não está em `opcoes`. As opções são conteúdo do registro
    /// (dado do PO); o construtor não as inventa, só verifica a pertença.
    pub fn nova(
        chave: impl Into<String>,
        valor: impl Into<String>,
        opcoes: Vec<String>,
    ) -> Result<Self, ConfigErro> {
        let valor = valor.into();
        if !opcoes.iter().any(|o| o == &valor) {
            return Err(ConfigErro::ValorInvalido);
        }
        Ok(Self { chave: chave.into(), valor, opcoes })
    }
    #[must_use]
    pub fn chave(&self) -> &str {
        &self.chave
    }
    #[must_use]
    pub fn valor(&self) -> &str {
        &self.valor
    }
    #[must_use]
    pub fn opcoes(&self) -> &[String] {
        &self.opcoes
    }
}

/// O `UserId` do humano dono da sessão — é daqui que sai o escopo das prefs (regra 5),
/// nunca de um id/payload do cliente.
fn usuario_da_sessao(sessao: &Sessao) -> &UserId {
    match sessao.principal() {
        Principal::UsuarioFinal { usuario, .. }
        | Principal::AdminOrg { usuario, .. }
        | Principal::Staff { usuario } => usuario,
    }
}

/// Resolve o dono das prefs a LER/escrever. `alvo_na_rota` é um id que eventualmente veio na
/// rota; `None` = prefs da própria sessão.
///
/// - `None` ⇒ o próprio usuário (AC1).
/// - `Some(id)` == usuário da sessão ⇒ ok.
/// - `Some(id)` != usuário da sessão ⇒ **`NaoEncontrado` (404, AC1/AC3)** — pref de outro não
///   vira 403 (não confirma existência); um id/owner de payload não amplia o escopo.
#[must_use = "a decisão de escopo tem de ser respeitada — ignorá-la expõe pref alheia"]
pub fn resolver_pref_propria<'a>(
    sessao: &'a Sessao,
    alvo_na_rota: Option<&UserId>,
) -> Result<&'a UserId, ConfigErro> {
    let eu = usuario_da_sessao(sessao);
    match alvo_na_rota {
        None => Ok(eu),
        Some(id) if id == eu => Ok(eu),
        Some(_) => Err(ConfigErro::NaoEncontrado),
    }
}

/// Autoriza uma ESCRITA de pref: duas guardas, na ordem que não vaza. Devolve o dono (o
/// usuário da sessão) quando permitido.
///
/// 1. **Owner-scope** ([`resolver_pref_propria`]) — pref de outro ⇒ 404 ANTES de olhar a
///    chave (não revela a política de chaves pra um recurso alheio; AC1/AC3).
/// 2. **Allowlist** ([`chave_configuravel`]) — chave fora da lista ⇒ `ChaveNaoPermitida` (AC2).
#[must_use = "a decisão de escrita tem de ser respeitada — ignorá-la grava pref alheia ou fora da allowlist"]
pub fn autorizar_escrita_pref<'a>(
    sessao: &'a Sessao,
    alvo_na_rota: Option<&UserId>,
    chave: &str,
) -> Result<&'a UserId, ConfigErro> {
    let dono = resolver_pref_propria(sessao, alvo_na_rota)?; // 404 primeiro (AC1/AC3)
    if !chave_configuravel(chave) {
        return Err(ConfigErro::ChaveNaoPermitida); // AC2
    }
    Ok(dono)
}

#[cfg(test)]
mod tests {
    use super::*;
    use galaxie_platform_identity::{Escopo, OrgId, Principal, Sessao, UserId};

    fn sessao_de(user: &str) -> Sessao {
        Sessao::estabelecer(
            Principal::UsuarioFinal {
                usuario: UserId(user.into()),
                org: OrgId("orgA".into()),
            },
            Escopo::vazio(),
        )
    }

    // AC1 — ler/escrever pref sem id resolve pro próprio usuário; pref de OUTRO = 404.
    #[test]
    fn ac1_pref_owner_scoped_outro_e_404() {
        let s = sessao_de("A");
        assert_eq!(resolver_pref_propria(&s, None), Ok(&UserId("A".into())));
        assert_eq!(
            resolver_pref_propria(&s, Some(&UserId("B".into()))),
            Err(ConfigErro::NaoEncontrado)
        );
        // escrita numa chave permitida, mas pref de B ⇒ 404 (owner-scope ANTES da allowlist).
        assert_eq!(
            autorizar_escrita_pref(&s, Some(&UserId("B".into())), "app.tema"),
            Err(ConfigErro::NaoEncontrado)
        );
    }

    // AC2 — chave FORA da allowlist ⇒ recusada (não é "toda pref"), mesmo na própria conta.
    #[test]
    fn ac2_chave_fora_da_allowlist_e_recusada() {
        let s = sessao_de("A");
        assert!(!chave_configuravel("app.interna_privilegiada"));
        assert_eq!(
            autorizar_escrita_pref(&s, None, "app.interna_privilegiada"),
            Err(ConfigErro::ChaveNaoPermitida)
        );
        assert_eq!(
            autorizar_escrita_pref(&s, None, "qualquer.coisa"),
            Err(ConfigErro::ChaveNaoPermitida)
        );
        // chave DA allowlist, própria conta ⇒ ok.
        assert_eq!(autorizar_escrita_pref(&s, None, "app.idioma"), Ok(&UserId("A".into())));
    }

    // AC3 — id/owner de payload não amplia o escopo: qualquer id != sessão ⇒ 404, mesmo com
    // chave permitida. A única fonte do escopo é a sessão.
    #[test]
    fn ac3_id_de_payload_nao_amplia() {
        let s = sessao_de("A");
        for forjado in ["B", "admin", ""] {
            assert_eq!(
                autorizar_escrita_pref(&s, Some(&UserId(forjado.into())), "app.tema"),
                Err(ConfigErro::NaoEncontrado),
                "id de rota {forjado:?} não pode ampliar o escopo além da sessão"
            );
        }
    }

    // A allowlist é exatamente o conjunto declarado (nem mais, nem menos) — pega uma chave
    // removida por engano ou uma adicionada sem querer.
    #[test]
    fn allowlist_e_exatamente_o_conjunto_web() {
        for k in CHAVES_WEB {
            assert!(chave_configuravel(k), "{k} devia ser configurável");
        }
        assert!(!chave_configuravel("app.")); // prefixo não basta
        assert!(!chave_configuravel("")); // vazio nunca
    }

    // AC1 — combinação ilegal NÃO CONSTRÓI: opção fora de `opcoes` ⇒ ValorInvalido.
    #[test]
    fn opcao_com_valor_fora_das_opcoes_nao_constroi() {
        let opcoes = vec!["claro".into(), "escuro".into(), "sistema".into()];
        assert_eq!(
            Opcao::nova("app.tema", "arco-iris", opcoes.clone()),
            Err(ConfigErro::ValorInvalido),
            "valor fora de opcoes tem de ser irrepresentável"
        );
        // valor dentro das opções ⇒ constrói e o item carrega a garantia.
        let ok = Opcao::nova("app.tema", "escuro", opcoes).expect("valor ∈ opcoes constrói");
        assert_eq!(ok.valor(), "escuro");
        assert!(ok.opcoes().contains(&"claro".to_string()));
    }

    // AC1 — o único caminho de construção é o construtor: opcoes vazia nunca aceita valor
    // (não há "opção default" implícita que vaze).
    #[test]
    fn opcao_sem_opcoes_recusa_qualquer_valor() {
        assert_eq!(Opcao::nova("app.tema", "escuro", vec![]), Err(ConfigErro::ValorInvalido));
    }

    // AC3 — Texto além do teto NÃO CONSTRÓI; no teto exato, constrói (fronteira medida em bytes).
    #[test]
    fn texto_alem_do_teto_nao_constroi() {
        let no_teto = "a".repeat(TETO_TEXTO_BYTES);
        assert!(Texto::novo("app.rotulo", no_teto).is_ok(), "no teto exato ainda cabe");

        let passou = "a".repeat(TETO_TEXTO_BYTES + 1);
        assert_eq!(
            Texto::novo("app.rotulo", passou),
            Err(ConfigErro::ValorInvalido),
            "1 byte além do teto tem de ser recusado"
        );
    }

    // O teto é em BYTES UTF-8, não em chars — um char multibyte no limite conta os bytes.
    #[test]
    fn teto_do_texto_conta_bytes_nao_chars() {
        // 'é' = 2 bytes em UTF-8; TETO/2 + 1 desses passa do teto em bytes mas não em chars.
        let s = "é".repeat(TETO_TEXTO_BYTES / 2 + 1);
        assert!(s.chars().count() <= TETO_TEXTO_BYTES, "em chars caberia");
        assert!(s.len() > TETO_TEXTO_BYTES, "em bytes não cabe");
        assert_eq!(Texto::novo("app.rotulo", s), Err(ConfigErro::ValorInvalido));
    }

    // Booleano não tem modo de falha — o construtor é infalível (sem invariante além do tipo).
    #[test]
    fn booleano_constroi_sempre() {
        let b = Booleano::novo("app.notificacoes", true);
        assert_eq!(b.chave(), "app.notificacoes");
        assert!(b.valor());
    }
}
