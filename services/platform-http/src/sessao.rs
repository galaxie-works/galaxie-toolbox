//! Extractor de sessão da borda — a **condição 6 do @Altair** aterrissando: o principal (quem é
//! o solicitante e o que ele alcança) vem SEMPRE da sessão viva no servidor, NUNCA do caminho, do
//! payload ou de um header que o cliente controle. A borda transforma "um cookie" em "uma `Sessao`"
//! aqui, num lugar só; um handler que queira o solicitante pede [`SessaoAtual`] e recebe o que o
//! servidor resolveu — não tem como um handler ler identidade de outra fonte.

use std::sync::{Arc, Mutex};

use axum::extract::FromRequestParts;
use axum::http::header;
use axum::http::request::Parts;
use axum::response::Response;

use galaxie_platform_identity::sessao::ArmazemMemoria;
use galaxie_platform_identity::Sessao;
use galaxie_platform_web::contrato::CodigoErro;
use galaxie_platform_web::sessao_do_cookie;

use crate::erro::resposta_de_erro;

/// Estado compartilhado da borda.
///
/// O armazém fica atrás de um `Mutex` porque o caminho autenticado COM atividade (`tocar`, #1512)
/// precisa de `&mut` — a leitura de hoje (`validar`) não, mas o mesmo estado serve os dois. O
/// **relógio é injetável** (`agora`) porque a expiração (#1504 absoluto / #1512 ocioso) é
/// time-aware: os testes fixam o tempo em vez de dormir, e a prod passa `SystemTime`.
pub struct Borda {
    pub armazem: Mutex<ArmazemMemoria>,
    pub agora: fn() -> u64,
}

impl Borda {
    /// Constrói o estado a partir de um armazém e um relógio. Envolve em `Arc` para o axum
    /// clonar barato entre handlers.
    pub fn nova(armazem: ArmazemMemoria, agora: fn() -> u64) -> Arc<Self> {
        Arc::new(Borda {
            armazem: Mutex::new(armazem),
            agora,
        })
    }
}

/// O tipo de estado que o `Router` carrega.
pub type EstadoBorda = Arc<Borda>;

/// A sessão VIVA do request, extraída do cookie `__Host-gx_sess` e validada no armazém do
/// SERVIDOR (invariante 6). Um handler que peça `SessaoAtual` só roda se a sessão existir e
/// estiver viva; ele nunca vê "quem o cliente diz ser".
///
/// Sem cookie de sessão, cookie duplicado (semântica exatamente-um do #1501) ou sessão
/// revogada/expirada ⇒ **401 uniforme** (`NaoAutenticado`) — a rejeição NÃO distingue "não mandou"
/// de "expirou" de "revogada", senão viraria um oráculo do estado da sessão alheia.
pub struct SessaoAtual(pub Sessao);

impl FromRequestParts<EstadoBorda> for SessaoAtual {
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut Parts,
        estado: &EstadoBorda,
    ) -> Result<Self, Self::Rejection> {
        // Header ausente ou não-UTF8 vira string vazia ⇒ `sessao_do_cookie` devolve `None` ⇒ 401.
        let header_cookie = parts
            .headers
            .get(header::COOKIE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        let agora = (estado.agora)();
        let armazem = estado
            .armazem
            .lock()
            .expect("armazém de sessão não deve estar envenenado");
        match sessao_do_cookie(&*armazem, header_cookie, agora) {
            // Clona pra soltar o lock/borrow do armazém antes de o handler rodar.
            Some(sessao) => Ok(SessaoAtual(sessao.clone())),
            None => Err(resposta_de_erro(CodigoErro::NaoAutenticado)),
        }
    }
}
