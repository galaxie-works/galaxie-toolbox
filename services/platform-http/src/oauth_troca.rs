//! Cliente HTTP de SAÍDA da troca `code`→token (#1695 fatia C, lado BORDA — a "busca de bytes").
//!
//! O `platform-oauth` DECIDE (monta o corpo, faz o parsing); ESTE módulo faz a única chamada de
//! SAÍDA do fluxo, com a config disciplinada que o @Altair especificou — e que mora AQUI, num sítio só:
//!   * **`rustls`, nunca `native-tls`** (garantido pelo `default-features=false`+`rustls-tls` no
//!     Cargo — senão o OpenSSL voltava de carona);
//!   * **timeout explícito** — uma chamada de saída sem timeout PENDURA o login (DoS na porta de entrada);
//!   * **redirect DESLIGADO** (`Policy::none`) — o `reqwest` segue 302 por padrão, e um 302 do
//!     token-endpoint faria **reenviar o `code` + `client_secret` a outro host** (vazamento por
//!     gentileza da biblioteca). Desligado, um 3xx vira resposta final que o parsing recusa.

use std::time::Duration;

use galaxie_platform_oauth::{extrair_id_token, CorpoTroca, ErroTroca};

/// Timeout da troca (segundos). Curto: o token-endpoint responde em ~1s; além disto é falha de rede.
const TIMEOUT_TROCA_SEG: u64 = 10;

/// Falha da troca na BORDA. `Rede` = não chegou resposta (timeout/TLS/DNS/conexão) — infra. `Troca` =
/// chegou resposta mas não deu um `id_token` (o provedor recusou, ou a resposta é inválida).
///
/// ⚠️ A distinção é **só pro LOG**: a borda (o `/callback`, fatia 4) COLAPSA as duas numa falha de
/// login **UNIFORME no fio** (anti-oráculo — nota do @Altair): o cliente não pode distinguir "provedor
/// recusou" de "resposta inválida" por status/corpo.
#[derive(Debug)]
pub enum ErroExchange {
    /// Transporte falhou (timeout, TLS, DNS, conexão) — nenhuma resposta do provedor chegou.
    Rede,
    /// Chegou resposta, mas a troca não deu um `id_token` (ver [`ErroTroca`]).
    Troca(ErroTroca),
}

/// O cliente reqwest DISCIPLINADO da troca — a config de segurança do @Altair num sítio só. Construído
/// UMA vez e reusado (o reqwest faz pooling de conexão). `rustls` vem do Cargo (`default-features=false`).
#[must_use]
pub fn cliente_troca() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(TIMEOUT_TROCA_SEG))
        // 🔑 redirect DESLIGADO: um 302 do token-endpoint reenviaria `code`+`client_secret` a outro host.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("cliente reqwest é construível com config estática")
}

/// POSTa o [`CorpoTroca`] no `url_token` e extrai o `id_token` do CORPO da resposta. Lê o corpo
/// **independente do status** — o token-endpoint devolve `400` com `{"error":…}` nas recusas OAuth, e
/// o [`extrair_id_token`] classifica por CONTEÚDO (`error` vs `id_token`), não por status. `Err(Rede)`
/// só se o transporte falhar. O `id_token` devolvido é **cru, ainda NÃO verificado** (JWKS = C-3).
pub async fn postar_troca(
    cliente: &reqwest::Client,
    url_token: &str,
    corpo: CorpoTroca,
) -> Result<String, ErroExchange> {
    let resp = cliente
        .post(url_token)
        .header(
            reqwest::header::CONTENT_TYPE,
            "application/x-www-form-urlencoded",
        )
        .body(corpo.expor().to_owned())
        .send()
        .await
        .map_err(|_| ErroExchange::Rede)?;
    let texto = resp.text().await.map_err(|_| ErroExchange::Rede)?;
    extrair_id_token(&texto).map_err(ErroExchange::Troca)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    use axum::routing::{any, post};
    use axum::Router;
    use galaxie_platform_oauth::montar_corpo_troca;

    /// Sobe um mock HTTP num porto efémero e devolve o base URL. O `http://` NÃO exerce TLS — os
    /// testes provam a LÓGICA (parsing, status, redirect-off, timeout), não o rustls (esse só corre
    /// contra os provedores reais em produção).
    async fn subir(app: Router) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        format!("http://{addr}")
    }

    fn corpo() -> CorpoTroca {
        montar_corpo_troca("code", "https://p/cb", "cid", "secret", "verif")
    }

    #[tokio::test]
    async fn troca_sucesso_extrai_id_token() {
        let app = Router::new().route(
            "/token",
            post(|| async { r#"{"access_token":"AT","id_token":"eyJ.JWT","token_type":"Bearer"}"# }),
        );
        let base = subir(app).await;
        let r = postar_troca(&cliente_troca(), &format!("{base}/token"), corpo()).await;
        assert_eq!(r.unwrap(), "eyJ.JWT");
    }

    #[tokio::test]
    async fn troca_erro_oauth_le_o_corpo_mesmo_em_400() {
        // Recusa OAuth vem como 400 com `{error}` — lê o corpo mesmo em 400 e classifica por conteúdo.
        let app = Router::new().route(
            "/token",
            post(|| async {
                (
                    axum::http::StatusCode::BAD_REQUEST,
                    r#"{"error":"invalid_grant","error_description":"code expired"}"#,
                )
            }),
        );
        let base = subir(app).await;
        let r = postar_troca(&cliente_troca(), &format!("{base}/token"), corpo()).await;
        assert!(
            matches!(r, Err(ErroExchange::Troca(ErroTroca::ProvedorRecusou(ref e))) if e == "invalid_grant"),
            "{r:?}"
        );
    }

    #[tokio::test]
    async fn redirect_do_token_endpoint_nao_e_seguido() {
        // 🔑 A prova de segurança do @Altair: um 302 do token-endpoint NÃO pode reenviar code+secret
        // pro alvo. O alvo `/roubo` (qualquer método) incrementa um contador — tem de ficar em ZERO.
        let hits = Arc::new(AtomicUsize::new(0));
        let hits2 = hits.clone();
        let app = Router::new()
            .route(
                "/token",
                post(|| async {
                    axum::response::Response::builder()
                        .status(axum::http::StatusCode::FOUND)
                        .header(axum::http::header::LOCATION, "/roubo")
                        .body(axum::body::Body::empty())
                        .unwrap()
                }),
            )
            .route(
                "/roubo",
                any(move || {
                    let h = hits2.clone();
                    async move {
                        h.fetch_add(1, Ordering::SeqCst);
                        "roubei o secret"
                    }
                }),
            );
        let base = subir(app).await;
        let r = postar_troca(&cliente_troca(), &format!("{base}/token"), corpo()).await;
        // O 302 (corpo vazio) não é token → RespostaInvalida; e o alvo do redirect NUNCA foi tocado.
        assert!(matches!(r, Err(ErroExchange::Troca(ErroTroca::RespostaInvalida))), "{r:?}");
        assert_eq!(
            hits.load(Ordering::SeqCst),
            0,
            "o redirect foi SEGUIDO — code+client_secret vazaram pro alvo!"
        );
    }
}
