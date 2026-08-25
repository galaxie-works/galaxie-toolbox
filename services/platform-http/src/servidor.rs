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

use galaxie_platform_back_office::{AcaoBackOffice, Auditor, EventoAutz, ResultadoAutz};
use galaxie_platform_identity::armazem::{
    ArmazemDominioMemoria, ArmazemMembroMemoria, ArmazemOrgMemoria,
};
use galaxie_platform_identity::sessao::ArmazemMemoria;

use crate::rotas;
use crate::sessao::Borda;

/// Relógio de PRODUÇÃO: epoch em segundos do `SystemTime`. A borda recebe `fn() -> u64` porque a
/// expiração (#1504 absoluto / #1512 ocioso) é time-aware; esta é a fonte real.
///
/// 🔑 **O fallback tem DIREÇÃO (achado do @Altair, #1539; mesma lição do logout #1526).** Se o
/// relógio ler antes de 1970 (RTC morto, VM restaurada, container com data errada), o `Err` não
/// pode virar `0`: com `agora = 0` **toda** sessão passa (`0 < qualquer prazo`) e o serviço
/// IMORTALIZA sessões que já deviam ter expirado — fail-OPEN numa leitura que porteia acesso.
/// Satura pra `u64::MAX`: aí **tudo expira** (todo mundo é deslogado) — fail-CLOSED, e o serviço
/// segue de pé (sem panic). O lado seguro de uma checagem de acesso é o que NEGA.
fn agora_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(u64::MAX)
}

/// O evento de auditoria como sai no log (linha JSON). 🔑 NUNCA carrega claim — só ator/ação/
/// resultado/alvo (o id da org). Serializado por `serde_json`, NÃO interpolado (achado do @Altair,
/// #1539): o `ator` vai nascer do `subject` do provedor OAuth (fatia 3) — dado EXTERNO por desenho.
/// Interpolar deixaria um `subject` com `"` FORJAR entradas de auditoria (injeção de log). Dado que
/// vem de fora não se interpola, se serializa — a mesma regra dos DTOs (`MembroDto`).
#[derive(serde::Serialize)]
struct EventoAuditoriaLog<'a> {
    tipo: &'a str,
    ator: &'a str,
    acao: &'a str,
    resultado: &'a str,
    alvo: &'a str,
}

/// Nome de contrato da ação pro log — explícito, não `Debug` (que carregaria o id embutido e mudaria
/// se alguém renomeasse a variante).
fn acao_nome(acao: &AcaoBackOffice) -> &'static str {
    match acao {
        AcaoBackOffice::ListarOrgs => "listar_orgs",
        AcaoBackOffice::ProvisionarOrg(_) => "provisionar_org",
        AcaoBackOffice::VerificarOrg(_) => "verificar_org",
        AcaoBackOffice::SuspenderOrg(_) => "suspender_org",
    }
}

/// Auditor de produção **INTERINO**: emite o evento como linha JSON estruturada em stdout, que o
/// coletor (OpenObserve) raspa. O DESTINO próprio (fatia (b) do #1505, cardada com a @Mira) troca
/// isto por um emissor que sai da caixa; até lá, stdout estruturado já é a direção certa (sair do
/// processo) e melhor que nada.
struct AuditorLog;

impl Auditor for AuditorLog {
    fn registrar(&self, e: &EventoAutz) {
        let resultado = match e.resultado {
            ResultadoAutz::Permitido => "permitido",
            ResultadoAutz::Negado => "negado",
        };
        let ev = EventoAuditoriaLog {
            tipo: "autz_backoffice",
            ator: &e.ator.0,
            acao: acao_nome(e.acao),
            resultado,
            alvo: e.acao.alvo().map(|o| o.0.as_str()).unwrap_or(""),
        };
        // Se a serialização falhar (não deve, campos são `&str`), não emitir é melhor que emitir lixo.
        if let Ok(linha) = serde_json::to_string(&ev) {
            println!("{linha}");
        }
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
    servir(borda, config).await
}

/// Relógio de produção exposto: o `dev-server` (fatia 2) usa o MESMO `SystemTime` — a sessão
/// semeada tem prazos NORMAIS (condição 2 do @Altair: sessão de dev não é mais poderosa que a real).
pub fn agora_de_producao() -> u64 {
    agora_unix()
}

/// Serve uma `Borda` JÁ MONTADA — o mecanismo de bind+serve, compartilhado pelo binário de produção
/// ([`serve`], que monta a Borda vazia sem auth) e pelo `dev-server` (fatia 2, que monta a Borda com
/// uma sessão semeada). A SEMEADURA não mora aqui — mora no bin do dev-server (condição 1 do @Altair:
/// se ficasse na lib atrás de flag, alguém a ligaria um dia).
pub async fn servir(borda: crate::EstadoBorda, config: Config) -> Result<()> {
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

#[cfg(test)]
mod tests {
    use super::*;

    // Achado 2 do @Altair (#1539): o log de auditoria serializa, não interpola — um `ator` vindo do
    // `subject` OAuth com `"` NÃO forja entradas. Prova: subject malicioso que tenta injetar um
    // `"resultado":"permitido"` sai ESCAPADO, e o resultado REAL (negado) sobrevive.
    #[test]
    fn log_de_auditoria_escapa_dado_externo_e_nao_injeta() {
        let ev = EventoAuditoriaLog {
            tipo: "autz_backoffice",
            ator: r#"eve","resultado":"permitido","x":""#, // subject forjando
            acao: "suspender_org",
            resultado: "negado",
            alvo: "acme",
        };
        let linha = serde_json::to_string(&ev).unwrap();
        // Reparse: é UM objeto JSON válido, com o resultado VERDADEIRO — a injeção não pegou.
        let v: serde_json::Value = serde_json::from_str(&linha).unwrap();
        assert_eq!(v["resultado"], "negado", "o resultado real, não o forjado pelo ator");
        assert_eq!(
            v["ator"], r#"eve","resultado":"permitido","x":""#,
            "o ator inteiro (com aspas) vira UM campo, escapado — não fecha o objeto"
        );
    }

    // O relógio nega no fallback (achado 1): pré-1970 satura pra u64::MAX (tudo expira), nunca 0
    // (que validaria tudo). Aqui o relógio real é > 0 e < MAX; o teste amarra a DIREÇÃO do fallback
    // documentada — se alguém trocar por unwrap_or(0), o comentário mente e o serviço vira fail-open.
    #[test]
    fn relogio_real_e_plausivel() {
        let agora = agora_unix();
        assert!(agora > 1_700_000_000, "epoch de 2023+ — relógio real, não o fallback 0");
        assert!(agora < u64::MAX, "não é o fallback de saturação");
    }
}
