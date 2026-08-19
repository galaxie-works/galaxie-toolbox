// #1278 — EXPERIMENTO pedido pelo `altair` no parecer: a via (B) (ponte como
// arquivo externo da origem do app) sobrevive a CSP HERDADA num documento de
// ORIGEM OPACA? Tres saidas possiveis, com controle.
//
// Fidelidade ao app (corrigida em relacao ao meu 1o arranjo): o documento PAI
// NAO e sandboxed — no app ele e documento normal same-origin. So o LEITOR e
// opaco (`SANDBOX_LEITOR`, sem allow-same-origin).
import { it, expect } from "vitest";
import { SANDBOX_LEITOR } from "@/lib/corpo-email-doc";

const ORIGEM = location.origin;

// CSP REAL do app, verbatim de src-tauri/tauri.conf.json:48.
const CSP_TAURI =
  "default-src 'self'; img-src 'self' data: blob: https: http: cid:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' ipc: http://ipc.localhost https: wss:; media-src 'self' data: blob: https:; frame-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'";

// A mesma, com a ORIGEM NOMEADA no script-src (a decisao do `altair`).
const CSP_TAURI_ORIGEM_NOMEADA = CSP_TAURI.replace(
  "script-src 'self' 'wasm-unsafe-eval'",
  `script-src 'self' 'wasm-unsafe-eval' ${ORIGEM}`,
);

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type Resultado = { executou: boolean; violacao: string | null };

/**
 * @param cspPai   CSP do documento do app (null = controle, sem CSP)
 * @param cspFilho CSP do srcDoc do leitor (o `cspSrcDoc` da SEC1, variando o script-src)
 */
async function rodar(
  cspPai: string | null,
  cspFilho: string,
  modo: "externo" | "inline" = "externo",
  ms = 3500,
): Promise<Resultado> {
  const nonce = crypto.randomUUID();
  const cspFilhoFinal = modo === "inline" ? `default-src 'none'; script-src 'nonce-${nonce}'` : cspFilho;
  const carga =
    modo === "inline"
      ? `<script nonce="${nonce}">parent.parent.postMessage({tipo:"gt-ponte-externa-ok"},"*");</script>`
      : `<script src="${ORIGEM}/__probe-ponte.js"></script>`;
  const docLeitor =
    `<!doctype html><html><head>` +
    `<meta http-equiv="Content-Security-Policy" content="${esc(cspFilhoFinal)}">` +
    `</head><body>${carga}</body></html>`;
  const metaPai = cspPai
    ? `<meta http-equiv="Content-Security-Policy" content="${esc(cspPai)}">`
    : "";
  const pai = document.createElement("iframe"); // NAO sandboxed: modela o app
  pai.style.cssText = "width:400px;height:120px;border:0";
  pai.srcdoc =
    `<!doctype html><html><head>${metaPai}</head><body style="margin:0">` +
    `<script src="${ORIGEM}/__probe-vigia.js"></script>` +
    `<iframe sandbox="${SANDBOX_LEITOR}" srcdoc="${esc(docLeitor)}" style="width:100%;height:100px;border:0"></iframe>` +
    `</body></html>`;

  return await new Promise<Resultado>((resolve) => {
    let executou = false;
    let violacao: string | null = null;
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { tipo?: string; directive?: string; blockedURI?: string } | null;
      if (!d || typeof d !== "object") return;
      if (d.tipo === "gt-ponte-externa-ok") executou = true;
      if (d.tipo === "csp-violation" && !violacao) {
        violacao = `${d.directive} bloqueou ${d.blockedURI}`;
      }
    };
    window.addEventListener("message", onMsg);
    document.body.appendChild(pai);
    setTimeout(() => {
      window.removeEventListener("message", onMsg);
      pai.remove();
      resolve({ executou, violacao });
    }, ms);
  });
}

// script-src do srcDoc nas duas formas que interessam.
const FILHO_SELF = "default-src 'none'; script-src 'self'";
const FILHO_ORIGEM = `default-src 'none'; script-src ${ORIGEM}`;

it("EXPERIMENTO da via (B) — 3 saidas, com controle", async () => {
  const controle = await rodar(null, FILHO_ORIGEM);
  // CONTROLE NEGATIVO: o formato de PRODUCAO (inline+nonce) sob a CSP do Tauri.
  // Tem de ser BLOQUEADO — se executar, este arranjo perdeu a heranca e todos
  // os outros braços sao invalidos.
  const negativo = await rodar(CSP_TAURI, "", "inline");
  const negativoSemCsp = await rodar(null, "", "inline");
  const comSelf = await rodar(CSP_TAURI, FILHO_SELF);
  const comOrigemNoFilhoSo = await rodar(CSP_TAURI, FILHO_ORIGEM);
  const comOrigemNosDois = await rodar(CSP_TAURI_ORIGEM_NOMEADA, FILHO_ORIGEM);

  const linhas = [
    `ORIGEM medida = ${ORIGEM}`,
    `0a. CTRL-NEG (pai SEM CSP, filho inline+nonce = producao) .... executou=${negativoSemCsp.executou} violacao=${negativoSemCsp.violacao ?? "-"}`,
    `0b. CTRL-NEG (CSP Tauri, filho inline+nonce = PRODUCAO HOJE) . executou=${negativo.executou} violacao=${negativo.violacao ?? "-"}  <-- TEM de ser false`,
    `1. CONTROLE (pai sem CSP, filho com origem nomeada) .......... executou=${controle.executou} violacao=${controle.violacao ?? "-"}`,
    `2. CSP Tauri + filho 'self' .................................. executou=${comSelf.executou} violacao=${comSelf.violacao ?? "-"}`,
    `3. CSP Tauri + filho ORIGEM nomeada .......................... executou=${comOrigemNoFilhoSo.executou} violacao=${comOrigemNoFilhoSo.violacao ?? "-"}`,
    `4. CSP Tauri com ORIGEM + filho ORIGEM ....................... executou=${comOrigemNosDois.executou} violacao=${comOrigemNosDois.violacao ?? "-"}`,
  ].join("\n");

  // O resultado E o relatorio: falho de proposito pra imprimir a tabela.
  expect.soft(controle.executou, "CONTROLE precisa executar").toBe(true);
  throw new Error("RESULTADO DO EXPERIMENTO:\n" + linhas);
}, 40000);
