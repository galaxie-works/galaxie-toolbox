//! Fatia 1 do #1505 (desenho do @Altair): o binário de PRODUÇÃO que serve o que EXISTE — **sem
//! auth, sem flag, sem porta sintética**. Segue o padrão da casa (`remote-signaling/src/main.rs`).
//!
//! O que isto destrava HOJE, sem uma sessão sequer: o `DELETE /session` inteiro (sem-auth), **toda
//! rejeição** (sem cookie ⇒ 401 nas visíveis, 404 nas ocultas), e o **anti-oráculo ponta a ponta**
//! contra um socket REAL — rota inexistente e rota oculta indistinguíveis no fio. É a metade que
//! mais importa: o caminho PERMITIDO é funcionalidade, o **negado é a segurança**, e é o que a
//! `oneshot` prova em laboratório mas ninguém tinha provado contra um servidor de verdade.
//!
//! O caminho PERMITIDO (semear sessão) é a fatia 2 — um `[[bin]]` `dev-server` SEPARADO, não uma
//! flag: o binário de produção não CONTÉM o código de semeadura. OAuth é a fatia 3.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};

use galaxie_platform_back_office::{Auditor, EventoAutz, ResultadoAutz};
use galaxie_platform_identity::armazem::{
    ArmazemDominioMemoria, ArmazemMembroMemoria, ArmazemOrgMemoria,
};
use galaxie_platform_identity::sessao::ArmazemMemoria;

use crate::rotas;
use crate::sessao::Borda;

/// Relógio de PRODUÇÃO: epoch em segundos do `SystemTime`. A borda recebe `fn() -> u64` porque a
/// expiração (#1504 absoluto / #1512 ocioso) é time-aware; esta é a fonte real. Pré-1970 não
/// acontece num servidor — o `unwrap_or(0)` só evita um panic teórico.
fn agora_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Auditor de produção **INTERINO**: emite o evento como linha JSON estruturada em stdout, que o
/// coletor (OpenObserve) raspa. O DESTINO próprio (fatia (b) do #1505, cardada com a @Mira) troca
/// isto por um emissor que sai da caixa; até lá, stdout estruturado já é a direção certa (sair do
/// processo) e melhor que nada. 🔑 NUNCA loga claim — só ator/ação/resultado/alvo (o id da org).
struct AuditorLog;

impl Auditor for AuditorLog {
    fn registrar(&self, e: &EventoAutz) {
        let resultado = match e.resultado {
            ResultadoAutz::Permitido => "permitido",
            ResultadoAutz::Negado => "negado",
        };
        let alvo = e.acao.alvo().map(|o| o.0.as_str()).unwrap_or("");
        // Corpo montado à mão (campos controlados, sem dado livre de usuário) — consistente com o
        // envelope de erro. Se um dia entrar dado de usuário aqui, passa a serde_json como os DTOs.
        println!(
            r#"{{"tipo":"autz_backoffice","ator":"{}","acao":"{:?}","resultado":"{}","alvo":"{}"}}"#,
            e.ator.0, e.acao, resultado, alvo
        );
    }
}

/// Config do servidor. Mínima na fatia 1: só a porta. **Configuração é o que apodrece** (@Altair) —
/// então nada de auth/flag aqui; o que a fatia 1 precisa é só onde escutar.
pub struct Config {
    pub porta: u16,
}

impl Config {
    /// Lê a config do ambiente. `GALAXIE_PLATAFORMA_PORTA` (default 8080).
    pub fn from_env() -> Result<Self> {
        let porta = match std::env::var("GALAXIE_PLATAFORMA_PORTA") {
            Ok(s) => s.parse().context("GALAXIE_PLATAFORMA_PORTA inválida")?,
            Err(_) => 8080,
        };
        Ok(Config { porta })
    }
}

/// Sobe o servidor de produção com o que existe na pre-prod. Stores em memória **VAZIOS**: a fatia
/// 1 prova o caminho NEGADO (401/404), que não precisa de dado semeado — org inexistente ⇒ 404 com
/// store vazio. Dado real e caminho permitido vêm nas fatias seguintes (persistência/seed + auth).
pub async fn serve(config: Config) -> Result<()> {
    let borda = Borda::nova(
        ArmazemMemoria::novo(),
        agora_unix,
        Arc::new(AuditorLog),
        Arc::new(ArmazemOrgMemoria::novo()),
        Arc::new(ArmazemMembroMemoria::novo()),
        Arc::new(ArmazemDominioMemoria::novo()),
    );
    let app = rotas(borda);

    // `0.0.0.0`: atrás do Traefik, que termina o TLS de entrada e encaminha na mesma origem.
    let addr = SocketAddr::from(([0, 0, 0, 0], config.porta));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .with_context(|| format!("bind em {addr}"))?;
    tracing::info!("plataforma web servindo em {addr}");
    axum::serve(listener, app).await.context("axum::serve")?;
    Ok(())
}
