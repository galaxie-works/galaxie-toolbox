//! #1695 fatia 5 — carga da config OAuth do AMBIENTE.
//!
//! AC3 do #1695: o `client_secret` vem do COFRE por env/`_FILE`, **NUNCA do código**. Cada provedor
//! liga só se a sua config está COMPLETA (`client_id` + `client_secret` + `redirect_uri`); config
//! PARCIAL **falha no boot** (fail-closed — meio-provedor ligado é bug de deploy, não se corre com
//! ele). Nenhum provedor configurado ⇒ lista vazia ⇒ a borda sobe com OAuth DESLIGADO (`/auth` = 404,
//! como a fatia 1). A ativação REAL em prod ainda espera a DNS/app-registration (#1549).

use anyhow::{bail, Context, Result};

use galaxie_platform_oauth::Provedor;

use crate::sessao::ConfigProvedor;

/// Os provedores federados que a plataforma PODE ligar. Array fixo (não derivado): provedor novo no
/// domínio obriga a entrar aqui E em [`prefixo_env`] (match exaustivo) — não liga por acidente.
const PROVEDORES: [Provedor; 3] =
    [Provedor::Microsoft, Provedor::MicrosoftPersonal, Provedor::Google];

/// O PREFIXO de env de um provedor. Explícito (não derivado do `slug`): `microsoft-personal` tem
/// hífen — inválido em nome de variável de ambiente — então o mapa é uma DECISÃO, não uma transformação
/// de string frágil. `match` exaustivo.
fn prefixo_env(provedor: Provedor) -> &'static str {
    match provedor {
        Provedor::Microsoft => "GALAXIE_OAUTH_MICROSOFT",
        Provedor::MicrosoftPersonal => "GALAXIE_OAUTH_MICROSOFT_PERSONAL",
        Provedor::Google => "GALAXIE_OAUTH_GOOGLE",
    }
}

/// Lê a config OAuth do ambiente REAL (env do processo + ficheiros do cofre). Casca fina sobre
/// [`carregar`], que é o núcleo testável.
pub fn do_ambiente() -> Result<Vec<(Provedor, ConfigProvedor)>> {
    carregar(|k| std::env::var(k).ok(), |p| std::fs::read_to_string(p))
}

/// Núcleo testável: `env` lê uma variável; `ler_arquivo` lê o conteúdo de um ficheiro (o cofre via
/// `_FILE`). Separa I/O de DECISÃO — o teste injeta mapas, sem tocar no ambiente do processo (env é
/// global e os testes correm em paralelo).
///
/// Por provedor, os 3 campos têm de estar TODOS presentes (liga) ou TODOS ausentes (desligado); o
/// meio-termo é `Err` (fail-closed no boot). O `client_secret` resolve-se por [`ler_segredo`] (`_FILE`
/// antes de valor direto).
pub fn carregar(
    env: impl Fn(&str) -> Option<String>,
    ler_arquivo: impl Fn(&str) -> std::io::Result<String>,
) -> Result<Vec<(Provedor, ConfigProvedor)>> {
    let mut ligados = Vec::new();
    for provedor in PROVEDORES {
        let pfx = prefixo_env(provedor);
        let client_id = env(&format!("{pfx}_CLIENT_ID"));
        let redirect_uri = env(&format!("{pfx}_REDIRECT_URI"));
        let client_secret = ler_segredo(pfx, &env, &ler_arquivo)?;

        match (client_id, client_secret, redirect_uri) {
            // Ausência TOTAL é intencional — o provedor fica desligado (sem entrada na allowlist).
            (None, None, None) => {}
            // Config completa — liga. O `client_secret` NUNCA é logado (só viaja pro `CorpoTroca`).
            (Some(client_id), Some(client_secret), Some(redirect_uri)) => {
                ligados.push((provedor, ConfigProvedor { client_id, redirect_uri, client_secret }));
            }
            // Meio-provedor: fail-closed. Subir com um provedor pela metade é um bug de deploy silencioso.
            _ => bail!(
                "{pfx}: config OAuth PARCIAL — exige CLIENT_ID + (CLIENT_SECRET | CLIENT_SECRET_FILE) \
                 + REDIRECT_URI, ou NENHUM dos três. Meio-provedor recusa subir (fail-closed)."
            ),
        }
    }
    Ok(ligados)
}

/// O `client_secret`, preferindo `<pfx>_CLIENT_SECRET_FILE` (caminho do cofre — lê o ficheiro e apara
/// só o `\n`/`\r` final que `docker secret`/`printf` deixam, sem mexer no miolo do segredo) sobre
/// `<pfx>_CLIENT_SECRET` (valor direto). `Ok(None)` = nenhum dos dois presente. Um `_FILE` que aponta
/// ficheiro ilegível é `Err` COM contexto — não se mascara em "ausente" (seria fail-open silencioso).
fn ler_segredo(
    pfx: &str,
    env: &impl Fn(&str) -> Option<String>,
    ler_arquivo: &impl Fn(&str) -> std::io::Result<String>,
) -> Result<Option<String>> {
    if let Some(caminho) = env(&format!("{pfx}_CLIENT_SECRET_FILE")) {
        let conteudo = ler_arquivo(&caminho)
            .with_context(|| format!("{pfx}_CLIENT_SECRET_FILE: não consegui ler {caminho}"))?;
        return Ok(Some(conteudo.trim_end_matches(['\n', '\r']).to_string()));
    }
    Ok(env(&format!("{pfx}_CLIENT_SECRET")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    /// `env` a partir de um mapa; `ler_arquivo` a partir de outro (caminho→conteúdo). Sem tocar no
    /// ambiente do processo.
    fn carregar_de(
        vars: &[(&str, &str)],
        arquivos: &[(&str, &str)],
    ) -> Result<Vec<(Provedor, ConfigProvedor)>> {
        let vars: HashMap<String, String> =
            vars.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        let arquivos: HashMap<String, String> =
            arquivos.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        carregar(
            |k| vars.get(k).cloned(),
            |p| {
                arquivos
                    .get(p)
                    .cloned()
                    .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, p.to_string()))
            },
        )
    }

    /// Extrai o `Err` sem exigir `Debug` no tipo `Ok` (`ConfigProvedor` NÃO é `Debug` — guarda o
    /// `client_secret`, que não pode ser imprimível; por isso nada de `unwrap_err`/`assert_eq` no vec).
    fn erro_de(r: Result<Vec<(Provedor, ConfigProvedor)>>) -> String {
        match r {
            Ok(_) => panic!("esperava Err, veio Ok"),
            Err(e) => format!("{e:#}"),
        }
    }

    #[test]
    fn ambiente_vazio_nao_liga_nenhum_provedor() {
        // Fatia 1: sem config, OAuth DESLIGADO (lista vazia ⇒ a borda sobe com /auth=404).
        assert!(carregar_de(&[], &[]).unwrap().is_empty());
    }

    #[test]
    fn provedor_completo_liga_com_secret_direto() {
        let got = carregar_de(
            &[
                ("GALAXIE_OAUTH_GOOGLE_CLIENT_ID", "cid-g"),
                ("GALAXIE_OAUTH_GOOGLE_CLIENT_SECRET", "seg-g"),
                ("GALAXIE_OAUTH_GOOGLE_REDIRECT_URI", "https://p.example/cb/google"),
            ],
            &[],
        )
        .unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].0, Provedor::Google);
        assert_eq!(got[0].1.client_id, "cid-g");
        assert_eq!(got[0].1.client_secret, "seg-g");
        assert_eq!(got[0].1.redirect_uri, "https://p.example/cb/google");
    }

    #[test]
    fn secret_file_tem_prioridade_e_apara_newline_final() {
        // `_FILE` (cofre) ganha do valor direto; o `\n` final do ficheiro é aparado, o miolo intacto.
        let got = carregar_de(
            &[
                ("GALAXIE_OAUTH_GOOGLE_CLIENT_ID", "cid-g"),
                ("GALAXIE_OAUTH_GOOGLE_CLIENT_SECRET", "valor-direto-ignorado"),
                ("GALAXIE_OAUTH_GOOGLE_CLIENT_SECRET_FILE", "/run/secrets/g"),
                ("GALAXIE_OAUTH_GOOGLE_REDIRECT_URI", "https://p.example/cb/google"),
            ],
            &[("/run/secrets/g", "seg-do-cofre\n")],
        )
        .unwrap();
        assert_eq!(got[0].1.client_secret, "seg-do-cofre", "_FILE vence e apara o \\n final");
    }

    #[test]
    fn secret_file_ilegivel_falha_nao_mascara() {
        // `_FILE` aponta um ficheiro que não existe ⇒ Err (fail-closed), nunca "secret ausente".
        let msg = erro_de(carregar_de(
            &[
                ("GALAXIE_OAUTH_GOOGLE_CLIENT_ID", "cid-g"),
                ("GALAXIE_OAUTH_GOOGLE_CLIENT_SECRET_FILE", "/run/secrets/sumiu"),
                ("GALAXIE_OAUTH_GOOGLE_REDIRECT_URI", "https://p.example/cb/google"),
            ],
            &[],
        ));
        assert!(msg.contains("CLIENT_SECRET_FILE"), "o erro aponta o _FILE: {msg}");
    }

    #[test]
    fn config_parcial_falha_fail_closed() {
        // client_id + redirect, mas SEM secret ⇒ meio-provedor ⇒ recusa subir.
        let msg = erro_de(carregar_de(
            &[
                ("GALAXIE_OAUTH_MICROSOFT_CLIENT_ID", "cid-m"),
                ("GALAXIE_OAUTH_MICROSOFT_REDIRECT_URI", "https://p.example/cb/microsoft"),
            ],
            &[],
        ));
        assert!(msg.contains("PARCIAL"), "fail-closed em parcial: {msg}");
    }

    #[test]
    fn provedores_sao_independentes() {
        // Google completo liga; microsoft-personal ausente fica desligado — sem interferência.
        let got = carregar_de(
            &[
                ("GALAXIE_OAUTH_GOOGLE_CLIENT_ID", "cid-g"),
                ("GALAXIE_OAUTH_GOOGLE_CLIENT_SECRET", "seg-g"),
                ("GALAXIE_OAUTH_GOOGLE_REDIRECT_URI", "https://p.example/cb/google"),
            ],
            &[],
        )
        .unwrap();
        assert_eq!(got.len(), 1, "só o Google ligou");
        assert!(got.iter().all(|(p, _)| *p == Provedor::Google));
    }

    #[test]
    fn prefixo_env_e_distinto_por_provedor() {
        // O hífen do slug `microsoft-personal` vira `_` no env — e os 3 prefixos são distintos.
        let pfxs: Vec<&str> = PROVEDORES.iter().map(|p| prefixo_env(*p)).collect();
        assert_eq!(pfxs, ["GALAXIE_OAUTH_MICROSOFT", "GALAXIE_OAUTH_MICROSOFT_PERSONAL", "GALAXIE_OAUTH_GOOGLE"]);
        assert!(!prefixo_env(Provedor::MicrosoftPersonal).contains('-'), "sem hífen no nome de env");
    }
}
