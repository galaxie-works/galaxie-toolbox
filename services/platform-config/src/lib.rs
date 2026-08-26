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

use galaxie_platform_identity::armazem::ErroArmazem;
use galaxie_platform_identity::auditoria::{Alvo, Auditor, EventoAutz, ResultadoAutz};
use galaxie_platform_identity::{Principal, Sessao, UserId};
use std::sync::Mutex;

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
/// devolvem [`ConfigErro::ValorInvalido`] em vez de aceitar. A serialização pra forma plana
/// do fio é da BORDA (padrão "DTO na borda"): ela lê via os acessores (`.chave()/.valor()/
/// .opcoes()`) e monta o DTO. O `tipo` aqui é tipo de VALOR; o widget é escolha do FE.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfigItem {
    Booleano(Booleano),
    Texto(Texto),
    Opcao(Opcao),
}

impl ConfigItem {
    /// A chave desta pref — delega pra variante (todas a carregam).
    #[must_use]
    pub fn chave(&self) -> &str {
        match self {
            ConfigItem::Booleano(b) => b.chave(),
            ConfigItem::Texto(t) => t.chave(),
            ConfigItem::Opcao(o) => o.chave(),
        }
    }

    /// O valor serializado pra forma plana do store — a MESMA string que [`item_da_forma`]
    /// re-parseia. `Booleano` vira exatamente `"true"`/`"false"` (o único par que o parser
    /// aceita de volta): guardar→ler→domínio é round-trip, não aproximação.
    #[must_use]
    pub fn valor_bruto(&self) -> String {
        match self {
            ConfigItem::Booleano(b) => b.valor().to_string(),
            ConfigItem::Texto(t) => t.valor().to_string(),
            ConfigItem::Opcao(o) => o.valor().to_string(),
        }
    }

    /// A forma desta pref — pra o store guardar a tupla `(chave, valor, forma)` que a leitura
    /// devolve. As opções saem do próprio item (que nasceu validado contra elas), não de um
    /// palpite.
    #[must_use]
    pub fn forma(&self) -> FormaDaChave {
        match self {
            ConfigItem::Booleano(_) => FormaDaChave::Booleano,
            ConfigItem::Texto(_) => FormaDaChave::Texto,
            ConfigItem::Opcao(o) => FormaDaChave::Opcao { opcoes: o.opcoes().to_vec() },
        }
    }
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

/// O que o registro sabe sobre o TIPO de uma chave — se é booleana, texto, ou escolha (e,
/// pra escolha, quais valores). O CONTEÚDO (as opções, os rótulos pt/en) é dado do PO que
/// popula isto; o domínio não o inventa, recebe. `tipo` é tipo de VALOR, não widget.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FormaDaChave {
    Booleano,
    Texto,
    Opcao { opcoes: Vec<String> },
}

/// Constrói um [`ConfigItem`] VALIDADO a partir do valor BRUTO (a string como veio do store)
/// e da forma da chave. É o ponto único onde a forma plana vira domínio — a validação mora
/// nos construtores, então valor que não cabe no tipo ⇒ [`ConfigErro::ValorInvalido`], nunca
/// um item ilegal. Um `Booleano` só aceita exatamente `"true"`/`"false"` (não "1"/"sim"/""):
/// tolerância no parsing de bool é onde config vira lixo silencioso.
pub fn item_da_forma(
    chave: impl Into<String>,
    valor_bruto: &str,
    forma: &FormaDaChave,
) -> Result<ConfigItem, ConfigErro> {
    match forma {
        FormaDaChave::Booleano => {
            let valor = match valor_bruto {
                "true" => true,
                "false" => false,
                _ => return Err(ConfigErro::ValorInvalido),
            };
            Ok(ConfigItem::Booleano(Booleano::novo(chave, valor)))
        }
        FormaDaChave::Texto => Ok(ConfigItem::Texto(Texto::novo(chave, valor_bruto)?)),
        FormaDaChave::Opcao { opcoes } => {
            Ok(ConfigItem::Opcao(Opcao::nova(chave, valor_bruto, opcoes.clone())?))
        }
    }
}

/// Monta a lista de configs do PRÓPRIO usuário (leitura do `/me/config`, AC2). Owner-scope
/// primeiro (via [`resolver_pref_propria`]): pedir a config de outro ⇒ `NaoEncontrado` (404,
/// não enumera) ANTES de montar item nenhum. Só chaves da allowlist ([`chave_configuravel`])
/// saem pra web — uma pref interna que porventura esteja no store é ignorada (default-deny),
/// não vira erro. `prefs_brutas` = o que o store devolveu (a I/O é da borda; o domínio recebe
/// os pares `(chave, valor_bruto, forma)` já lidos). A org suspensa NÃO entra aqui: config é
/// pref do USUÁRIO, não recurso de org — a survive-list é propriedade da rota (borda), e este
/// domínio, por não ter gate de org, não pode violá-la.
/// ⚠️ **`alvo_na_rota: Some(_)` TORNA ESTA CHAMADA CROSS-USER — leia antes.** Hoje só o
/// `/me/config` chama isto, e passa `None`. Uma rota que aponte a config de OUTRO utilizador
/// (`/users/{id}/config`) passa `Some(alvo)`, e aí duas coisas passam a valer:
///
///  - **#1589 (FEITO):** o ramo NEGADO já emite auditoria pelo funil desta crate — a sondagem
///    deixa rasto sem a rota nova fazer nada.
///  - **#1591:** o alvo do evento tem de exprimir o **UTILIZADOR** alvejado. Enquanto não
///    exprimir, a trilha regista QUEM sondou e não CONTRA QUEM: `A` a tentar 1 e `A` a tentar
///    500 ficam idênticos, e a forma da sondagem é justamente a distribuição sobre alvos.
///    **Trilha que não diz contra quem é pior que trilha vazia, porque parece cobertura.**
///
/// 🔑 O aviso vive **aqui** e não no call site do `/me/config` (achado do Codex na #1592): uma
/// rota cross-user seria um **handler novo**, logo o handler antigo ficaria intacto e ninguém
/// leria o aviso lá. **Esta função, essa, toda implementação tem de a chamar.**
pub fn configs_do_usuario(
    sessao: &Sessao,
    alvo_na_rota: Option<&UserId>,
    prefs_brutas: impl IntoIterator<Item = (String, String, FormaDaChave)>,
    auditor: &dyn Auditor,
) -> Result<Vec<ConfigItem>, ConfigErro> {
    // Owner-scope (AC2 do #1563) + AUDITA o NEGADO (#1589): pedir a config de OUTRO ⇒ 404, e isso
    // é SONDAGEM — emite pelo funil (só o negado; a leitura BEM-SUCEDIDA não emite, AC2 do #1589:
    // rotina é ruído, trilha cheia é a que ninguém lê). Emite via [`Negado`] (o mesmo mecanismo por
    // construção do #1583). É LATENTE hoje — a borda passa `None` ⇒ resolve pro próprio e o negado
    // é inalcançável —, mas a rota cross-user futura (`/users/{id}/config`) herda a auditoria por
    // construção (AC3): ela injeta o alvo e o funil já emite, sem a rota lembrar.
    if let Err(e) = decidir_dono(sessao, alvo_na_rota) {
        let eu = usuario_da_sessao(sessao);
        // O alvejado é o usuário da ROTA (a config sondada), não o ator — é a distinção que o #1591
        // preserva; `None` (sem rota) resolve pro próprio.
        let alvo_uid = alvo_na_rota.unwrap_or(eu);
        return Err(Negado::emitir(auditor, ACAO_LER_PREF, eu, alvo_uid, e).erro());
    }
    let mut itens = Vec::new();
    for (chave, valor_bruto, forma) in prefs_brutas {
        if !chave_configuravel(&chave) {
            continue; // fora da allowlist não sai pra web (default-deny, não erro)
        }
        itens.push(item_da_forma(chave, &valor_bruto, &forma)?);
    }
    Ok(itens)
}

/// Uma linha do store: `(chave, valor_bruto, forma)`. Alias pra não repetir a tupla (e não
/// tropeçar no `type-complexity` do clippy quando ela aninha em `Mutex<HashMap<…>>`).
type PrefBruta = (String, String, FormaDaChave);

/// Store das prefs do usuário — a I/O da leitura do `/me/config`. O domínio define a forma
/// (o que a borda tem de devolver pro [`configs_do_usuario`] consumir); a impl real (Postgres)
/// mora fora, no mesmo padrão do `ArmazemPerfil` (#1473) e do `ArmazemSessao`. `Err`
/// ([`ErroArmazem`]) distingue armazém-fora-do-ar de "sem prefs" (`Ok(vazio)`) — não confla
/// infra com estado (a lição do armazém de estado do OAuth): queda de infra não pode virar
/// "usuário sem config" em silêncio.
pub trait ArmazemPref {
    /// As prefs cruas do `uid`: `(chave, valor_bruto, forma)`. `Ok(vazio)` = sem prefs.
    fn prefs_do_usuario(
        &self,
        uid: &UserId,
    ) -> Result<Vec<PrefBruta>, ErroArmazem>;

    /// Persiste uma pref do `uid` (upsert por chave). Recebe um [`ConfigItem`] JÁ VALIDADO —
    /// não `(chave, valor)` crus: "gravar pref inválida" não é representável (a validação mora
    /// nos construtores, e só se chega a um `ConfigItem` por eles). A AUTORIZAÇÃO (owner-scope e allowlist,
    /// #1585) é da borda ANTES daqui; este método é só a I/O da escrita — não
    /// re-decide, do mesmo jeito que `remover` do `ArmazemMembro` não re-autoriza. `Err`
    /// ([`ErroArmazem`]) = armazém-fora-do-ar, não "pref rejeitada".
    fn definir_pref(&self, uid: &UserId, item: &ConfigItem) -> Result<(), ErroArmazem>;
}

/// Primeira impl: em memória. As prefs REAIS nascerão da persistência (fatia adiante); aqui a
/// semeadura é do dev-server, pro FE fiar o e2e do `/me/config` antes da persistência real —
/// mesmo papel do `ArmazemPerfilMemoria`. `Mutex` = mutabilidade INTERIOR: `definir_pref`
/// escreve por `&self` (a borda segura o armazém num `Arc` compartilhado), como o
/// `ArmazemMembroMemoria` (#1475). Não é `Clone` (`Mutex` não é; ninguém clona o armazém).
#[derive(Debug, Default)]
pub struct ArmazemPrefMemoria {
    por_usuario: Mutex<std::collections::HashMap<UserId, Vec<PrefBruta>>>,
}

impl ArmazemPrefMemoria {
    #[must_use]
    pub fn novo() -> Self {
        Self::default()
    }

    /// Semeia as prefs de um usuário (dev-server/testes). Sobrescreve o que houver.
    pub fn semear(&mut self, uid: UserId, prefs: Vec<PrefBruta>) {
        // `&mut self` ⇒ `get_mut` sem lock (não há contenção na semeadura).
        self.por_usuario.get_mut().expect("mutex de prefs envenenado").insert(uid, prefs);
    }
}

impl ArmazemPref for ArmazemPrefMemoria {
    fn prefs_do_usuario(
        &self,
        uid: &UserId,
    ) -> Result<Vec<PrefBruta>, ErroArmazem> {
        // Em memória não há modo de falha de I/O — `Ok(vazio)` pra quem não foi semeado, nunca
        // `Err` (o `Err` existe pro dia da persistência real, não pra fingir infra aqui).
        let mapa = self.por_usuario.lock().expect("mutex de prefs envenenado");
        Ok(mapa.get(uid).cloned().unwrap_or_default())
    }

    fn definir_pref(&self, uid: &UserId, item: &ConfigItem) -> Result<(), ErroArmazem> {
        let mut mapa = self.por_usuario.lock().expect("mutex de prefs envenenado");
        let prefs = mapa.entry(uid.clone()).or_default();
        let tupla = (item.chave().to_string(), item.valor_bruto(), item.forma());
        // Upsert: uma pref por chave (a segunda escrita da mesma chave SUBSTITUI, não duplica —
        // senão a leitura veria duas linhas da mesma chave).
        match prefs.iter_mut().find(|(chave, _, _)| chave == item.chave()) {
            Some(slot) => *slot = tupla,
            None => prefs.push(tupla),
        }
        Ok(())
    }
}

/// O que o SERVIDOR sabe da forma de cada chave — a fonte da forma no caminho de ESCRITA
/// (o PATCH). Vive no servidor, não no cliente: se o cliente mandasse o tipo, forjaria
/// `Opcao→Texto` e furaria a checagem de opções (#1563). `None` = chave que o servidor não
/// conhece ⇒ não escrevível. O CONTEÚDO (quais opções) é dado do PO que semeia isto; o
/// domínio recebe, não inventa — mesmo princípio do `FormaDaChave`.
pub trait RegistroFormas {
    /// A forma da `chave`, ou `None` se o servidor não a registra.
    fn forma_da_chave(&self, chave: &str) -> Option<FormaDaChave>;
}

/// Primeira impl: em memória, semeada (dev-server/borda). A forma real virá da config do
/// servidor; aqui o conteúdo é injetado pelo mesmo caminho das prefs semeadas.
#[derive(Debug, Default)]
pub struct RegistroFormasMemoria {
    por_chave: std::collections::HashMap<String, FormaDaChave>,
}

impl RegistroFormasMemoria {
    #[must_use]
    pub fn novo() -> Self {
        Self::default()
    }

    /// Semeia a forma de uma chave (dev-server/PO/testes). Sobrescreve o que houver.
    pub fn semear(&mut self, chave: impl Into<String>, forma: FormaDaChave) {
        self.por_chave.insert(chave.into(), forma);
    }
}

impl RegistroFormas for RegistroFormasMemoria {
    fn forma_da_chave(&self, chave: &str) -> Option<FormaDaChave> {
        self.por_chave.get(chave).cloned()
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

/// Nomes ESTÁVEIS das ações de config pra auditoria (#1583, cond.1 do @Altair: o nome vem de UM
/// lugar — a função dona —, nunca de um literal de call site que um typo corromperia). Namespace
/// `config.` (não colide com `back_office.`/`org_admin.` na trilha; doutrina do #1571).
const ACAO_LER_PREF: &str = "config.ler_pref";
const ACAO_ESCREVER_PREF: &str = "config.escrever_pref";

/// Desfecho POSITIVO de uma autz de config. **Auditoria por CONSTRUÇÃO (#1583 §1+§2 do @Altair):**
/// o único caminho de criação (`emitir`, privado) audita — não há como "decidir sem auditar",
/// quem autoriza sem emitir não produz o valor. Carrega o dono resolvido (o chamador precisa dele
/// pra saber de QUEM é a pref). Mesmo truque do `Escopo`/`ConfigItem`: estado ilegal (aqui,
/// "autorizado sem rastro") **não-representável**, não vigilância.
#[derive(Debug)]
#[must_use = "o dono autorizado tem de ser usado — a decisão já foi auditada"]
pub struct Autorizado<'a>(&'a UserId);

impl<'a> Autorizado<'a> {
    fn emitir(auditor: &dyn Auditor, acao: &'static str, ator: &UserId, dono: &'a UserId) -> Self {
        auditor.registrar(&EventoAutz {
            ator,
            acao,
            // Config é user-scoped: o alvo é o USUÁRIO dono das prefs (#1591 AC1), não uma org.
            alvo: Alvo::Usuario(dono),
            resultado: ResultadoAutz::Permitido,
        });
        Autorizado(dono)
    }
    #[must_use]
    pub fn dono(&self) -> &UserId {
        self.0
    }
}

/// Desfecho NEGATIVO. Como o positivo, só a emissão o constrói — e **carrega o `ConfigErro`**
/// (§2 do @Altair): achatar a razão mataria o `match` do chamador (404 de pref alheia ≠
/// `ChaveNaoPermitida`), que é o anti-oráculo. O negado é o ramo que MAIS importa — escrever pref
/// alheia ou chave fora da lista é sondagem, e é o que HOJE não deixava rastro.
#[derive(Debug)]
#[must_use = "a recusa auditada tem de virar resposta — ignorá-la deixa passar o negado"]
pub struct Negado(ConfigErro);

impl Negado {
    /// `alvo_uid` = o usuário cuja config foi alvejada (#1591 AC1): sondar a de OUTRO carrega o id
    /// DELE (é o que distingue enumeração de ruído); recusa na própria (chave/valor) carrega o
    /// próprio id. NUNCA `SemAlvo` aqui — config sempre tem um dono alvejado.
    fn emitir(
        auditor: &dyn Auditor,
        acao: &'static str,
        ator: &UserId,
        alvo_uid: &UserId,
        erro: ConfigErro,
    ) -> Self {
        auditor.registrar(&EventoAutz {
            ator,
            acao,
            alvo: Alvo::Usuario(alvo_uid),
            resultado: ResultadoAutz::Negado,
        });
        Negado(erro)
    }
    #[must_use]
    pub fn erro(&self) -> ConfigErro {
        self.0.clone()
    }
}

/// A DECISÃO de owner-scope (SEM emissão): pref de outro ⇒ `NaoEncontrado`. Privada — as funções
/// públicas emitem; ninguém decide sem auditar. Separada pra a composição (escrita usa owner-scope)
/// não emitir DUAS vezes por decisão, como o `decidir_acao_admin` do #1571.
fn decidir_dono<'a>(
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

/// A DECISÃO de escrita (SEM emissão): owner-scope ANTES da allowlist (não vaza política de chave
/// pra recurso alheio; AC1/AC3 → AC2). Privada.
fn decidir_escrita<'a>(
    sessao: &'a Sessao,
    alvo_na_rota: Option<&UserId>,
    chave: &str,
) -> Result<&'a UserId, ConfigErro> {
    let dono = decidir_dono(sessao, alvo_na_rota)?; // 404 primeiro (AC1/AC3)
    if !chave_configuravel(chave) {
        return Err(ConfigErro::ChaveNaoPermitida); // AC2
    }
    Ok(dono)
}

/// Resolve o dono das prefs a LER, **auditando os 2 ramos** (#1583). `alvo_na_rota` a `None` =
/// própria sessão; `Some(id)` != sessão ⇒ `NaoEncontrado` (404) — e o negado, sinal de sondagem
/// de pref alheia, agora deixa rastro. Devolve [`Autorizado`]/[`Negado`], não `Result<&UserId,_>`:
/// o desfecho SÓ existe se foi emitido.
pub fn resolver_pref_propria<'a>(
    sessao: &'a Sessao,
    alvo_na_rota: Option<&UserId>,
    auditor: &dyn Auditor,
) -> Result<Autorizado<'a>, Negado> {
    let ator = usuario_da_sessao(sessao);
    match decidir_dono(sessao, alvo_na_rota) {
        Ok(dono) => Ok(Autorizado::emitir(auditor, ACAO_LER_PREF, ator, dono)),
        Err(e) => Err(Negado::emitir(auditor, ACAO_LER_PREF, ator, alvo_na_rota.unwrap_or(ator), e)),
    }
}

/// Autoriza uma ESCRITA de pref, **auditando os 2 ramos**: owner-scope (404) → allowlist
/// (`ChaveNaoPermitida`). Escrever pref alheia ou chave fora da lista é sondagem e agora é
/// auditado. Devolve [`Autorizado`]/[`Negado`] (auditoria por construção).
pub fn autorizar_escrita_pref<'a>(
    sessao: &'a Sessao,
    alvo_na_rota: Option<&UserId>,
    chave: &str,
    auditor: &dyn Auditor,
) -> Result<Autorizado<'a>, Negado> {
    let ator = usuario_da_sessao(sessao);
    match decidir_escrita(sessao, alvo_na_rota, chave) {
        Ok(dono) => Ok(Autorizado::emitir(auditor, ACAO_ESCREVER_PREF, ator, dono)),
        Err(e) => {
            Err(Negado::emitir(auditor, ACAO_ESCREVER_PREF, ator, alvo_na_rota.unwrap_or(ator), e))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use galaxie_platform_identity::auditoria::AlvoDono;
    use galaxie_platform_identity::{Escopo, OrgId, Principal, Sessao, UserId};
    use std::cell::RefCell;

    /// Auditor no-op pros testes de DECISÃO (a EMISSÃO é testada à parte, com o espião).
    struct AuditorNulo;
    impl Auditor for AuditorNulo {
        fn registrar(&self, _e: &EventoAutz) {}
    }
    /// Reduz o desfecho `Autorizado`/`Negado` ao (dono | erro) pros asserts de decisão — a
    /// emissão em si é coberta pelos testes de auditoria abaixo.
    fn resolvido(r: Result<Autorizado<'_>, Negado>) -> Result<UserId, ConfigErro> {
        r.map(|a| a.dono().clone()).map_err(|n| n.erro())
    }

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
        assert_eq!(resolvido(resolver_pref_propria(&s, None, &AuditorNulo)), Ok(UserId("A".into())));
        assert_eq!(
            resolvido(resolver_pref_propria(&s, Some(&UserId("B".into())), &AuditorNulo)),
            Err(ConfigErro::NaoEncontrado)
        );
        // escrita numa chave permitida, mas pref de B ⇒ 404 (owner-scope ANTES da allowlist).
        assert_eq!(
            resolvido(autorizar_escrita_pref(&s, Some(&UserId("B".into())), "app.tema", &AuditorNulo)),
            Err(ConfigErro::NaoEncontrado)
        );
    }

    // AC2 — chave FORA da allowlist ⇒ recusada (não é "toda pref"), mesmo na própria conta.
    #[test]
    fn ac2_chave_fora_da_allowlist_e_recusada() {
        let s = sessao_de("A");
        assert!(!chave_configuravel("app.interna_privilegiada"));
        assert_eq!(
            resolvido(autorizar_escrita_pref(&s, None, "app.interna_privilegiada", &AuditorNulo)),
            Err(ConfigErro::ChaveNaoPermitida)
        );
        assert_eq!(
            resolvido(autorizar_escrita_pref(&s, None, "qualquer.coisa", &AuditorNulo)),
            Err(ConfigErro::ChaveNaoPermitida)
        );
        // chave DA allowlist, própria conta ⇒ ok.
        assert_eq!(resolvido(autorizar_escrita_pref(&s, None, "app.idioma", &AuditorNulo)), Ok(UserId("A".into())));
    }

    // AC3 — id/owner de payload não amplia o escopo: qualquer id != sessão ⇒ 404, mesmo com
    // chave permitida. A única fonte do escopo é a sessão.
    #[test]
    fn ac3_id_de_payload_nao_amplia() {
        let s = sessao_de("A");
        for forjado in ["B", "admin", ""] {
            assert_eq!(
                resolvido(autorizar_escrita_pref(&s, Some(&UserId(forjado.into())), "app.tema", &AuditorNulo)),
                Err(ConfigErro::NaoEncontrado),
                "id de rota {forjado:?} não pode ampliar o escopo além da sessão"
            );
        }
    }

    // A allowlist é fronteira de segurança: TRAVA o conjunto por afirmação positiva, não só
    // o mecanismo. Acrescentar/remover chave em CHAVES_WEB QUEBRA aqui de propósito — uma pref
    // de segurança entrando por engano falha, não passa em silêncio (achado da Lúmen no #1471;
    // o `for k in CHAVES_WEB` anterior era tautológico: `chave_configuravel(k)` É
    // `CHAVES_WEB.contains(k)` e `k` vinha da própria lista).
    #[test]
    fn allowlist_trava_o_conjunto_nao_so_o_mecanismo() {
        assert_eq!(
            CHAVES_WEB,
            &["app.tema", "app.idioma", "app.densidade", "app.notificacoes", "app.tela_inicial"],
            "mudou a allowlist da web: isto é fronteira de segurança — atualize aqui de propósito"
        );
    }

    #[test]
    fn chave_configuravel_rejeita_prefixo_e_vazio() {
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

    // item_da_forma — bool é ESTRITO: só "true"/"false". "1"/"sim"/"" ⇒ ValorInvalido
    // (tolerância no parsing de bool é onde config vira lixo silencioso).
    #[test]
    fn item_bool_so_aceita_true_ou_false_literais() {
        assert_eq!(
            item_da_forma("app.notificacoes", "true", &FormaDaChave::Booleano),
            Ok(ConfigItem::Booleano(Booleano::novo("app.notificacoes", true)))
        );
        assert_eq!(
            item_da_forma("app.notificacoes", "false", &FormaDaChave::Booleano),
            Ok(ConfigItem::Booleano(Booleano::novo("app.notificacoes", false)))
        );
        for lixo in ["1", "0", "sim", "True", "", "verdadeiro"] {
            assert_eq!(
                item_da_forma("app.notificacoes", lixo, &FormaDaChave::Booleano),
                Err(ConfigErro::ValorInvalido),
                "bool não pode aceitar {lixo:?}"
            );
        }
    }

    // item_da_forma — Opcao propaga o invariante valor∈opcoes; Texto propaga o teto.
    #[test]
    fn item_da_forma_propaga_validacao_do_tipo() {
        let forma = FormaDaChave::Opcao { opcoes: vec!["claro".into(), "escuro".into()] };
        assert!(item_da_forma("app.tema", "escuro", &forma).is_ok());
        assert_eq!(
            item_da_forma("app.tema", "arco-iris", &forma),
            Err(ConfigErro::ValorInvalido)
        );
        let grande = "a".repeat(TETO_TEXTO_BYTES + 1);
        assert_eq!(
            item_da_forma("app.rotulo", &grande, &FormaDaChave::Texto),
            Err(ConfigErro::ValorInvalido)
        );
    }

    // AC2 — configs_do_usuario: pedir a config de OUTRO ⇒ 404, antes de montar item nenhum.
    #[test]
    fn configs_do_usuario_de_outro_e_404() {
        let s = sessao_de("A");
        let prefs = vec![("app.tema".to_string(), "escuro".to_string(),
            FormaDaChave::Opcao { opcoes: vec!["escuro".into()] })];
        assert_eq!(
            configs_do_usuario(&s, Some(&UserId("B".into())), prefs, &AuditorNulo),
            Err(ConfigErro::NaoEncontrado),
            "config de outro usuário não vira lista — vira 404"
        );
    }

    // configs_do_usuario — só as chaves da allowlist saem; uma pref interna no store é
    // IGNORADA (default-deny), não vira erro nem vaza pra web.
    #[test]
    fn configs_do_usuario_filtra_pela_allowlist() {
        let s = sessao_de("A");
        let prefs = vec![
            ("app.notificacoes".to_string(), "true".to_string(), FormaDaChave::Booleano),
            ("interna.privilegiada".to_string(), "x".to_string(), FormaDaChave::Texto),
            ("app.tema".to_string(), "escuro".to_string(),
                FormaDaChave::Opcao { opcoes: vec!["claro".into(), "escuro".into()] }),
        ];
        let itens = configs_do_usuario(&s, None, prefs, &AuditorNulo).expect("própria conta monta a lista");
        assert_eq!(itens.len(), 2, "só as 2 chaves web saem; a interna foi ignorada");
        assert!(itens.iter().all(|i| match i {
            ConfigItem::Booleano(b) => chave_configuravel(b.chave()),
            ConfigItem::Texto(t) => chave_configuravel(t.chave()),
            ConfigItem::Opcao(o) => chave_configuravel(o.chave()),
        }));
    }

    // configs_do_usuario — valor corrompido no store (fora do tipo) surface como ValorInvalido,
    // não passa em silêncio. (parsing como validação também na leitura.)
    #[test]
    fn configs_do_usuario_recusa_valor_corrompido_no_store() {
        let s = sessao_de("A");
        let prefs = vec![("app.tema".to_string(), "invalido".to_string(),
            FormaDaChave::Opcao { opcoes: vec!["claro".into(), "escuro".into()] })];
        assert_eq!(configs_do_usuario(&s, None, prefs, &AuditorNulo), Err(ConfigErro::ValorInvalido));
    }

    // ArmazemPrefMemoria — semeado devolve as prefs; usuário não-semeado devolve VAZIO (não Err:
    // "sem prefs" ≠ "armazém fora do ar").
    #[test]
    fn armazem_pref_memoria_semeado_e_vazio() {
        let mut arm = ArmazemPrefMemoria::novo();
        arm.semear(
            UserId("A".into()),
            vec![("app.tema".into(), "escuro".into(),
                FormaDaChave::Opcao { opcoes: vec!["claro".into(), "escuro".into()] })],
        );
        assert_eq!(arm.prefs_do_usuario(&UserId("A".into())).unwrap().len(), 1);
        assert_eq!(
            arm.prefs_do_usuario(&UserId("B".into())),
            Ok(vec![]),
            "usuário não-semeado = vazio, não erro"
        );
    }

    // Fluxo completo store→domínio: a borda lê pelo ArmazemPref e passa pro configs_do_usuario,
    // que aplica owner-scope + allowlist + validação. Prova que o trait casa com a operação.
    #[test]
    fn fluxo_armazem_ate_configs_do_usuario() {
        let mut arm = ArmazemPrefMemoria::novo();
        arm.semear(
            UserId("A".into()),
            vec![
                ("app.notificacoes".into(), "true".into(), FormaDaChave::Booleano),
                ("app.tema".into(), "escuro".into(),
                    FormaDaChave::Opcao { opcoes: vec!["claro".into(), "escuro".into()] }),
            ],
        );
        let s = sessao_de("A");
        let brutas = arm.prefs_do_usuario(&UserId("A".into())).unwrap();
        let itens = configs_do_usuario(&s, None, brutas, &AuditorNulo).expect("própria conta monta a lista");
        assert_eq!(itens.len(), 2);
    }

    // ---- #1593: escrita (definir_pref) + registro de formas ----

    // Round-trip guardar→ler→domínio: um ConfigItem validado, gravado e relido pelo trait, volta a
    // ser o MESMO item via item_da_forma. Prova de uma vez os acessores (chave/valor_bruto/forma) E
    // o store. Mutante em qualquer acessor (Booleano→"1", forma trocada, chave errada) quebra a
    // igualdade — inclusive o par exato "true"/"false" que o parser de bool exige de volta.
    #[test]
    fn definir_pref_faz_round_trip_por_tipo() {
        let arm = ArmazemPrefMemoria::novo();
        let a = UserId("A".into());
        let itens = vec![
            ConfigItem::Booleano(Booleano::novo("app.notificacoes", false)),
            ConfigItem::Texto(Texto::novo("app.rotulo", "oi").unwrap()),
            ConfigItem::Opcao(
                Opcao::nova("app.tema", "escuro", vec!["claro".into(), "escuro".into()]).unwrap(),
            ),
        ];
        for it in &itens {
            arm.definir_pref(&a, it).unwrap();
        }
        let brutas = arm.prefs_do_usuario(&a).unwrap();
        assert_eq!(brutas.len(), 3);
        for it in &itens {
            let (chave, valor, forma) =
                brutas.iter().find(|(c, _, _)| c == it.chave()).expect("chave gravada");
            assert_eq!(&item_da_forma(chave.clone(), valor, forma).unwrap(), it, "round-trip preserva o item");
        }
    }

    // Upsert: gravar a MESMA chave de novo SUBSTITUI o valor, não anexa uma segunda linha — senão a
    // leitura veria a chave duas vezes. Mutante que só faz `push` cai no len==1 e no valor novo.
    #[test]
    fn definir_pref_upsert_substitui_nao_duplica() {
        let arm = ArmazemPrefMemoria::novo();
        let a = UserId("A".into());
        arm.definir_pref(&a, &ConfigItem::Booleano(Booleano::novo("app.notificacoes", true))).unwrap();
        arm.definir_pref(&a, &ConfigItem::Booleano(Booleano::novo("app.notificacoes", false))).unwrap();
        let brutas = arm.prefs_do_usuario(&a).unwrap();
        assert_eq!(brutas.len(), 1, "mesma chave = uma linha");
        assert_eq!(brutas[0].1, "false", "vence a última escrita");
    }

    // definir_pref é por-usuário: a pref de A não vaza pra B (a chave da HashMap é o UserId).
    #[test]
    fn definir_pref_isola_por_usuario() {
        let arm = ArmazemPrefMemoria::novo();
        arm.definir_pref(&UserId("A".into()), &ConfigItem::Texto(Texto::novo("app.rotulo", "de-A").unwrap()))
            .unwrap();
        assert_eq!(arm.prefs_do_usuario(&UserId("B".into())).unwrap(), vec![], "B não vê a pref de A");
    }

    // RegistroFormas: chave semeada devolve a forma (server-side, o cliente não a manda); chave
    // desconhecida devolve None ⇒ a borda recusa. Mutante que devolvesse sempre Some/None cai num ramo.
    #[test]
    fn registro_formas_devolve_seeded_e_none_pra_desconhecida() {
        let mut reg = RegistroFormasMemoria::novo();
        let tema = FormaDaChave::Opcao { opcoes: vec!["claro".into(), "escuro".into()] };
        reg.semear("app.tema", tema.clone());
        assert_eq!(reg.forma_da_chave("app.tema"), Some(tema));
        assert_eq!(reg.forma_da_chave("seguranca.exigir_2fa"), None, "não registrada = não escrevível");
    }

    // ---- #1583 §1+§2: auditoria de autz por construção ----

    #[derive(Default)]
    struct AuditorEspiao {
        eventos: RefCell<Vec<(String, ResultadoAutz)>>,
    }
    impl Auditor for AuditorEspiao {
        fn registrar(&self, e: &EventoAutz) {
            self.eventos.borrow_mut().push((e.acao.to_string(), e.resultado));
        }
    }

    // A autz de config AUDITA os 2 ramos — e o NEGADO (sondagem: pref alheia, chave fora da lista)
    // é o que MAIS importa e HOJE não deixava rastro. Mutante que emitisse só num ramo cai a `len`.
    #[test]
    fn autz_de_config_audita_permitido_e_negado() {
        let s = sessao_de("A");
        let espiao = AuditorEspiao::default();
        assert!(autorizar_escrita_pref(&s, None, "app.idioma", &espiao).is_ok()); // permitido
        assert!(autorizar_escrita_pref(&s, Some(&UserId("B".into())), "app.tema", &espiao).is_err()); // pref alheia
        assert!(autorizar_escrita_pref(&s, None, "seguranca.exigir_2fa", &espiao).is_err()); // chave fora
        assert!(resolver_pref_propria(&s, Some(&UserId("B".into())), &espiao).is_err()); // leitura alheia

        let ev = espiao.eventos.borrow();
        assert_eq!(ev.len(), 4, "toda decisão emite — o negado (sondagem) não some");
        assert_eq!(ev[0], ("config.escrever_pref".to_string(), ResultadoAutz::Permitido));
        assert_eq!(ev[1], ("config.escrever_pref".to_string(), ResultadoAutz::Negado));
        assert_eq!(ev[2], ("config.escrever_pref".to_string(), ResultadoAutz::Negado));
        assert_eq!(ev[3], ("config.ler_pref".to_string(), ResultadoAutz::Negado));
    }

    // ---- #1591: o evento diz CONTRA QUEM (user-scoped) ----

    /// Espião que captura o ALVO (owned, via `para_dono`) além do resultado.
    #[derive(Default)]
    struct AuditorAlvo {
        alvos: RefCell<Vec<(AlvoDono, ResultadoAutz)>>,
    }
    impl Auditor for AuditorAlvo {
        fn registrar(&self, e: &EventoAutz) {
            self.alvos.borrow_mut().push((e.alvo.para_dono(), e.resultado));
        }
    }

    // AC1 — a autz user-scoped nomeia o UserId ALVEJADO, não `None`/`SemAlvo`: sondar a config de B
    // nomeia B (a distribuição sobre alvos é a forma da enumeração); a própria nomeia o próprio.
    // Mutante que volte o alvo a `SemAlvo`, ao ATOR, ou que perca o id do alvo, morre aqui.
    #[test]
    fn autz_user_scoped_nomeia_o_uid_alvejado() {
        let s = sessao_de("A");
        let espiao = AuditorAlvo::default();
        assert!(resolver_pref_propria(&s, None, &espiao).is_ok()); // própria (sucesso)
        assert!(resolver_pref_propria(&s, Some(&UserId("B".into())), &espiao).is_err()); // sonda B
        assert!(autorizar_escrita_pref(&s, Some(&UserId("B".into())), "app.tema", &espiao).is_err()); // escrita alheia

        let ev = espiao.alvos.borrow();
        assert_eq!(
            ev[0],
            (AlvoDono::Usuario(UserId("A".into())), ResultadoAutz::Permitido),
            "própria config nomeia o próprio, não SemAlvo"
        );
        assert_eq!(
            ev[1],
            (AlvoDono::Usuario(UserId("B".into())), ResultadoAutz::Negado),
            "sondar a config de B nomeia B — o sinal de enumeração"
        );
        assert_eq!(ev[2], (AlvoDono::Usuario(UserId("B".into())), ResultadoAutz::Negado));
    }

    // §2 do @Altair: o `Negado` CARREGA o `ConfigErro` certo (404 de pref alheia ≠ ChaveNaoPermitida)
    // — o anti-oráculo depende do `match` do chamador; um Negado opaco o mataria.
    #[test]
    fn negado_carrega_a_razao_certa() {
        let s = sessao_de("A");
        let alheia = autorizar_escrita_pref(&s, Some(&UserId("B".into())), "app.tema", &AuditorNulo)
            .unwrap_err();
        assert_eq!(alheia.erro(), ConfigErro::NaoEncontrado);
        let chave = autorizar_escrita_pref(&s, None, "x.y", &AuditorNulo).unwrap_err();
        assert_eq!(chave.erro(), ConfigErro::ChaveNaoPermitida);
    }

    // #1589: o READ-path (configs_do_usuario) audita SÓ o ramo NEGADO — ler config de OUTRO
    // (sondagem) emite; ler a PRÓPRIA (sucesso) NÃO emite (ruído). Latente hoje (borda passa None),
    // mas a rota cross-user futura herda por construção. Mutante que emite no sucesso OU não emite
    // no negado é apanhado pelo count.
    #[test]
    fn read_path_audita_so_o_negado() {
        let s = sessao_de("A");
        let espiao = AuditorEspiao::default();

        // sucesso (própria config) → NÃO emite (AC2: rotina é ruído)
        let ok = configs_do_usuario(&s, None, Vec::new(), &espiao);
        assert!(ok.is_ok());
        assert_eq!(espiao.eventos.borrow().len(), 0, "leitura da própria config não vai pra trilha");

        // sondagem (config de OUTRO) → emite SÓ o negado (AC1)
        let neg = configs_do_usuario(&s, Some(&UserId("B".into())), Vec::new(), &espiao);
        assert_eq!(neg, Err(ConfigErro::NaoEncontrado));
        let ev = espiao.eventos.borrow();
        assert_eq!(ev.len(), 1, "só o negado (sondagem) emite");
        assert_eq!(ev[0], ("config.ler_pref".to_string(), ResultadoAutz::Negado));
    }
}
