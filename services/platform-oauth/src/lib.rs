//! **platform-oauth** — o fluxo OAuth federado (fatia 3 do #1505), lado DOMÍNIO.
//!
//! A fronteira (desenho do @Altair) é **I/O vs decisão**: a borda (`platform-http`) BUSCA bytes (o
//! redirect do provedor, a troca do `code`); ESTE crate DECIDE o que eles significam. Nada de HTTP,
//! nada de segredo aqui — puro e testável exatamente onde a segurança mora.
//!
//! Fatia A: a raiz de quem entra ([`Provedor`] com allowlist), o [`Pkce`] (S256 por TIPO), o estado
//! do fluxo ([`ArmazemEstadoOAuth`]: prazo + uso único atômico + amarra ao browser) e a
//! [`RedirectAllowlist`] EXATA. B = o handler `/auth/{provedor}`; C = o callback + troca do `code`
//! (a validação do token vive AQUI, devolvendo um `(Provedor, Subject)` verificado por construção).

#![forbid(unsafe_code)]

use std::collections::HashMap;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::rngs::OsRng;
use rand::RngCore;
use sha2::{Digest, Sha256};

/// Bytes de entropia de um segredo do fluxo (state, amarra, PKCE verifier). 32 = 256 bits.
const BYTES_SEGREDO: usize = 32;

fn segredo_url_safe() -> String {
    let mut bytes = [0u8; BYTES_SEGREDO];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Os provedores federados (allowlist do contrato §2). Enum FECHADO: `{provedor}` fora daqui ⇒ o
/// handler devolve a **falha uniforme** (não confirma quais existem — invariante 6).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provedor {
    Microsoft,
    MicrosoftPersonal,
    Google,
}

impl Provedor {
    /// Resolve o `{provedor}` do caminho contra a allowlist. Desconhecido ⇒ `None` (falha uniforme).
    #[must_use]
    pub fn da_rota(s: &str) -> Option<Provedor> {
        match s {
            "microsoft" => Some(Provedor::Microsoft),
            "microsoft-personal" => Some(Provedor::MicrosoftPersonal),
            "google" => Some(Provedor::Google),
            _ => None,
        }
    }

    #[must_use]
    pub fn slug(&self) -> &'static str {
        match self {
            Provedor::Microsoft => "microsoft",
            Provedor::MicrosoftPersonal => "microsoft-personal",
            Provedor::Google => "google",
        }
    }

    /// Se o e-mail asserido por este provedor é confiável pra **ligar um convite** (invariante 4
    /// completada, @Altair): o convite nasce por e-mail, e vincular `(provedor,subject)→UserId` por
    /// e-mail SÓ vale se o provedor VERIFICA o e-mail. `match` EXAUSTIVO — provedor novo OBRIGA a
    /// decidir por ele, não herda um default.
    ///
    /// ⚠️ **`microsoft-personal` é `false`**: conta pessoal com e-mail definido pelo dono é a
    /// garantia mais fraca; deixá-la ligar convite permitiria asserir um e-mail arbitrário e roubar
    /// o convite de outra pessoa. A regra vive NO TIPO, não num `if` esquecível.
    #[must_use]
    pub fn elegivel_para_ligar_convite(&self) -> bool {
        match self {
            Provedor::Microsoft | Provedor::Google => true,
            Provedor::MicrosoftPersonal => false,
        }
    }
}

/// PKCE — **só `S256`** (o `plain` é recusado por TIPO: não existe construtor que o produza). O
/// `verifier` é segredo (fica no servidor, no fluxo pendente); o `challenge` vai pro provedor.
pub struct Pkce {
    verifier: String,
    challenge: String,
}

impl Pkce {
    /// Gera um par novo: `verifier` = 256 bits CSPRNG (base64url); `challenge` = base64url(SHA256(verifier)).
    #[must_use]
    pub fn gerar() -> Pkce {
        let verifier = segredo_url_safe();
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        Pkce { verifier, challenge }
    }

    /// O `code_verifier` (segredo do servidor; vai no fluxo pendente, nunca pro cliente).
    #[must_use]
    pub fn verifier(&self) -> &str {
        &self.verifier
    }

    /// O `code_challenge` (vai pro provedor na iniciação, com `method=S256`).
    #[must_use]
    pub fn challenge(&self) -> &str {
        &self.challenge
    }

    /// O method — SEMPRE `S256`. Constante, não campo: não há como pedir `plain`.
    #[must_use]
    pub fn metodo() -> &'static str {
        "S256"
    }
}

/// O `state` OAuth: token opaco (CSPRNG) que amarra o início do fluxo ao callback.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Estado(pub String);

impl Estado {
    #[must_use]
    pub fn gerar() -> Estado {
        Estado(segredo_url_safe())
    }
}

/// Amarra ao BROWSER (invariante 2 completada, @Altair): o `/auth` põe este nonce num cookie curto,
/// e o callback confere. Uso único não basta — quem obteve um `state` (visível no redirect) o
/// completaria; a amarra exige "foi ESTE browser que começou", e o browser só tem o cookie se ele
/// iniciou o fluxo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AmarraNavegador(pub String);

impl AmarraNavegador {
    #[must_use]
    pub fn gerar() -> AmarraNavegador {
        AmarraNavegador(segredo_url_safe())
    }
}

/// O que o `/auth/{provedor}` guarda pra o callback consumir.
#[derive(Debug, Clone)]
pub struct FluxoPendente {
    pub provedor: Provedor,
    pub verificador_pkce: String,
    pub amarra: AmarraNavegador,
    /// Prazo CURTO (epoch seg): um fluxo OAuth é de segundos/minutos, não horas. Além dele, `consumir`
    /// recusa — mesmo que o `state` reapareça, o CSRF de login não pode ficar aberto indefinidamente.
    pub expira_unix: u64,
}

/// Falha de INFRA do armazém — NÃO de auth. O backing em memória nunca falha, mas a assinatura
/// devolve `Result` desde o dia 1 (regra do @Altair, já aplicada ao `ArmazemOrg`): quando o backing
/// real entrar — e ele PRECISA entrar antes de haver 2ª instância da borda, senão o callback não
/// acha o `state` entre requests — muda UMA linha na trait, não toda assinatura + todo consumidor.
///
/// E aqui a distinção MUDA a resposta (review do @Altair no #1543): `Err` (armazém fora do ar) vira
/// **falha de INFRA** (`resposta_de_falha` na borda), distinta de `Ok(None)` (state inválido/vencido/
/// amarra errada = **falha uniforme de AUTH**). Conflar as duas — uma queda virar "login inválido" —
/// é seguro pro cliente e CEGO pra nós: ninguém vê incidente e o log não distingue queda de ataque.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ErroArmazem {
    /// Armazém indisponível (backing real fora do ar). Nunca ocorre na impl em memória.
    Indisponivel,
}

/// Armazém dos fluxos OAuth EM CURSO, indexado pelo `state`. `iniciar` grava; `consumir` valida e
/// REMOVE — uso único **atômico**: o mesmo `state` não completa duas vezes, nem em corrida. Ambos
/// devolvem `Result` (ver [`ErroArmazem`]): `Err` é queda de infra, nunca "auth negada".
pub trait ArmazemEstadoOAuth {
    /// Grava um fluxo pendente sob o seu `state` (chamado por `/auth/{provedor}`). `Err` só em queda
    /// de infra do backing real.
    fn iniciar(&mut self, state: Estado, fluxo: FluxoPendente) -> Result<(), ErroArmazem>;

    /// Consome o `state` (chamado pelo callback): sai do armazém SEMPRE (uso único — o `state` é
    /// queimado ao ser tocado) e devolve o fluxo SÓ se não venceu **E** a amarra do browser confere.
    /// `Ok(None)` = inexistente / vencido / amarra errada — o handler transforma em **falha uniforme
    /// de auth**. `Err` = armazém indisponível — o handler transforma em **falha de infra**, distinta.
    fn consumir(
        &mut self,
        state: &Estado,
        amarra: &AmarraNavegador,
        agora_unix: u64,
    ) -> Result<Option<FluxoPendente>, ErroArmazem>;
}

/// Primeira impl: em memória. O `remove` é o ponto ATÔMICO do uso único — exatamente um chamador
/// tira o fluxo; um 2º `consumir` do mesmo `state` já não o acha.
#[derive(Debug, Default)]
pub struct ArmazemMemoria {
    fluxos: HashMap<Estado, FluxoPendente>,
}

impl ArmazemMemoria {
    #[must_use]
    pub fn novo() -> Self {
        Self::default()
    }
}

impl ArmazemEstadoOAuth for ArmazemMemoria {
    fn iniciar(&mut self, state: Estado, fluxo: FluxoPendente) -> Result<(), ErroArmazem> {
        self.fluxos.insert(state, fluxo);
        Ok(()) // memória nunca cai; o `Result` é a assinatura à prova do backing real
    }

    fn consumir(
        &mut self,
        state: &Estado,
        amarra: &AmarraNavegador,
        agora_unix: u64,
    ) -> Result<Option<FluxoPendente>, ErroArmazem> {
        // Tira SEMPRE (uso único queima o state ao ser tocado); só então valida prazo + amarra.
        // `Ok(None)` nos três casos de auth (inexistente/vencido/amarra) — indistinguíveis por
        // design; `Err` ficaria reservado à queda de infra (impossível em memória, daí só `Ok`).
        let Some(fluxo) = self.fluxos.remove(state) else {
            return Ok(None); // inexistente (ou já queimado)
        };
        if agora_unix >= fluxo.expira_unix {
            return Ok(None); // vencido
        }
        if fluxo.amarra != *amarra {
            return Ok(None); // outro browser
        }
        Ok(Some(fluxo))
    }
}

/// Allowlist EXATA de `redirect_uri` (invariante 3): correspondência byte-a-byte, **sem prefixo nem
/// sufixo** — o furo clássico (prefixo/sufixo permitem desviar o `code` pra um host do atacante). O
/// handler só monta a URL de autorização com um `redirect_uri` que esteja AQUI.
pub struct RedirectAllowlist {
    permitidos: Vec<String>,
}

impl RedirectAllowlist {
    #[must_use]
    pub fn nova(permitidos: Vec<String>) -> Self {
        Self { permitidos }
    }

    /// `true` só se `uri` for IGUAL (byte-a-byte) a um da lista — jamais `starts_with`/`ends_with`.
    #[must_use]
    pub fn permite(&self, uri: &str) -> bool {
        self.permitidos.iter().any(|p| p == uri)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlist_de_provedor_recusa_desconhecido() {
        assert_eq!(Provedor::da_rota("microsoft"), Some(Provedor::Microsoft));
        assert_eq!(Provedor::da_rota("google"), Some(Provedor::Google));
        assert_eq!(Provedor::da_rota("microsoft-personal"), Some(Provedor::MicrosoftPersonal));
        // Desconhecido ⇒ None (o handler vira falha uniforme, não confirma quais existem).
        assert_eq!(Provedor::da_rota("facebook"), None);
        assert_eq!(Provedor::da_rota(""), None);
        assert_eq!(Provedor::da_rota("MICROSOFT"), None, "case-sensitive: só o slug exato");
    }

    #[test]
    fn so_provedor_de_email_verificado_liga_convite() {
        assert!(Provedor::Microsoft.elegivel_para_ligar_convite());
        assert!(Provedor::Google.elegivel_para_ligar_convite());
        // ⚠️ microsoft-personal NÃO — e-mail fraco; ligar convite aqui seria roubo de conta.
        assert!(!Provedor::MicrosoftPersonal.elegivel_para_ligar_convite());
    }

    #[test]
    fn pkce_e_s256_e_o_challenge_e_o_sha256_do_verifier() {
        let p = Pkce::gerar();
        assert_eq!(Pkce::metodo(), "S256");
        // challenge == base64url(sha256(verifier)) — reproduz e confere.
        let esperado = URL_SAFE_NO_PAD.encode(Sha256::digest(p.verifier().as_bytes()));
        assert_eq!(p.challenge(), esperado);
        // dois pares diferem (CSPRNG); verifier é URL-safe e não-trivial.
        assert_ne!(Pkce::gerar().verifier(), Pkce::gerar().verifier());
        assert!(p.verifier().len() >= 40);
    }

    fn fluxo(amarra: &AmarraNavegador, expira: u64) -> FluxoPendente {
        FluxoPendente {
            provedor: Provedor::Google,
            verificador_pkce: "v".into(),
            amarra: amarra.clone(),
            expira_unix: expira,
        }
    }

    #[test]
    fn consumir_e_uso_unico_atomico() {
        let mut a = ArmazemMemoria::novo();
        let state = Estado::gerar();
        let amarra = AmarraNavegador::gerar();
        a.iniciar(state.clone(), fluxo(&amarra, 1000)).unwrap();

        // 1º consumo confere (dentro do prazo, amarra certa). `.unwrap()` prova que é `Ok` (não
        // `Err` de infra) e `.is_some()` que achou o fluxo.
        assert!(a.consumir(&state, &amarra, 500).unwrap().is_some());
        // 2º consumo do MESMO state ⇒ Ok(None): já foi queimado (uso único). `.unwrap()` prova `Ok`
        // (não `Err` de infra) e `.is_none()` que não achou — "não achei" é falha de AUTH, não de infra.
        assert!(a.consumir(&state, &amarra, 500).unwrap().is_none(), "state não completa duas vezes");
    }

    #[test]
    fn consumir_recusa_vencido_e_browser_errado() {
        let amarra = AmarraNavegador::gerar();
        let outra = AmarraNavegador::gerar();

        // Vencido: agora >= expira ⇒ None.
        let mut a = ArmazemMemoria::novo();
        let s1 = Estado::gerar();
        a.iniciar(s1.clone(), fluxo(&amarra, 1000)).unwrap();
        assert!(a.consumir(&s1, &amarra, 1000).unwrap().is_none(), "vencido recusa");

        // Amarra errada (outro browser) ⇒ Ok(None), mesmo dentro do prazo.
        let mut b = ArmazemMemoria::novo();
        let s2 = Estado::gerar();
        b.iniciar(s2.clone(), fluxo(&amarra, 1000)).unwrap();
        assert!(b.consumir(&s2, &outra, 500).unwrap().is_none(), "browser errado recusa");
        // E queimou (uso único ao tocar): nem o browser certo completa depois.
        assert!(b.consumir(&s2, &amarra, 500).unwrap().is_none(), "tocar queima o state");
    }

    #[test]
    fn redirect_allowlist_e_exata() {
        let a = RedirectAllowlist::nova(vec![
            "https://platform.thegalaxie.cloud/api/v1/auth/google/callback".into(),
        ]);
        assert!(a.permite("https://platform.thegalaxie.cloud/api/v1/auth/google/callback"));
        // prefixo/sufixo NÃO passam (o furo clássico de desvio do code).
        assert!(!a.permite("https://platform.thegalaxie.cloud/api/v1/auth/google/callback/../evil"));
        assert!(!a.permite("https://evil.com/https://platform.thegalaxie.cloud/api/v1/auth/google/callback"));
        assert!(!a.permite("https://platform.thegalaxie.cloud/api/v1/auth/google/callback?x=1"));
    }
}
