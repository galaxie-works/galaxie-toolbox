// PROVA #1278: um iframe `srcDoc` HERDA a CSP do documento pai (politica efetiva
// = intersecao). Reproduz a estrutura do app: documento com a CSP do Tauri →
// iframe srcDoc do leitor dentro dele. Se a ponte de medicao nao roda, a altura
// nunca cresce e o leitor fica preso nos 120px iniciais.
import { it, expect, vi } from "vitest";
import { montarDocEmail } from "@/lib/corpo-email-doc";

// CSP REAL do app, verbatim de src-tauri/tauri.conf.json (linha 48).
const CSP_TAURI =
  "default-src 'self'; img-src 'self' data: blob: https: http: cid:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' ipc: http://ipc.localhost https: wss:; media-src 'self' data: blob: https:; frame-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'";

const escaparAttr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Monta pai-com-CSP contendo o iframe do leitor. O script da ponte foi ajustado
 * pra falar com `top` (o teste), em vez de `parent` (o iframe intermediario).
 */
function montarPai(csp: string | null): string {
  const docLeitor = montarDocEmail({
    corpo: "<div>" + Array.from({ length: 40 }, (_, i) => `<p>linha ${i}</p>`).join("") + "</div>",
    escuro: false,
    rotulo: "citado",
    nonce: crypto.randomUUID(),
    fator: 1,
  }).replace(/parent\.postMessage/g, "parent.parent.postMessage");
  const meta = csp ? `<meta http-equiv="Content-Security-Policy" content="${escaparAttr(csp)}">` : "";
  return `<!doctype html><html><head>${meta}</head><body style="margin:0">` +
    `<iframe sandbox="allow-popups allow-scripts" srcdoc="${escaparAttr(docLeitor)}" style="width:100%;height:120px;border:0"></iframe>` +
    `</body></html>`;
}

/** Sobe o pai e espera (ou nao) a mensagem de altura da ponte. */
async function pontePassa(csp: string | null, ms = 4000): Promise<boolean> {
  const outer = document.createElement("iframe");
  outer.setAttribute("sandbox", "allow-popups allow-scripts");
  outer.style.cssText = "width:600px;height:200px;border:0";
  outer.srcdoc = montarPai(csp);
  return await new Promise<boolean>((resolve) => {
    let pronto = false;
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { tipo?: string } | null;
      if (d && typeof d === "object" && d.tipo === "gt-reader-altura") {
        pronto = true;
        window.removeEventListener("message", onMsg);
        outer.remove();
        resolve(true);
      }
    };
    window.addEventListener("message", onMsg);
    document.body.appendChild(outer);
    setTimeout(() => {
      if (pronto) return;
      window.removeEventListener("message", onMsg);
      outer.remove();
      resolve(false);
    }, ms);
  });
}

it("CONTROLE: sem CSP no pai, a ponte de medicao CHEGA", async () => {
  expect(await pontePassa(null)).toBe(true);
}, 20000);

it("#1278: com a CSP REAL do Tauri no pai, a ponte NAO chega", async () => {
  expect(await pontePassa(CSP_TAURI)).toBe(false);
}, 20000);

/**
 * SONDA do sintoma 2 (tema escuro): sob a MESMA CSP herdada, um `<style>` inline
 * dentro do srcDoc ainda aplica? Aqui a sonda usa `allow-same-origin` SÓ pra o
 * teste conseguir ler o computed style — o produto continua opaque-origin.
 */
async function estiloInlineAplica(csp: string | null): Promise<string> {
  const docInterno =
    `<!doctype html><html><head><style>body{background-color:rgb(1,2,3)}</style>` +
    `</head><body></body></html>`;
  const meta = csp ? `<meta http-equiv="Content-Security-Policy" content="${escaparAttr(csp)}">` : "";
  const outer = document.createElement("iframe");
  outer.setAttribute("sandbox", "allow-scripts allow-same-origin");
  outer.srcdoc =
    `<!doctype html><html><head>${meta}</head><body style="margin:0">` +
    `<iframe id="alvo" sandbox="allow-scripts allow-same-origin" srcdoc="${escaparAttr(docInterno)}"></iframe>` +
    `</body></html>`;
  document.body.appendChild(outer);
  try {
    return await vi.waitFor(() => {
      const interno = outer.contentDocument?.querySelector<HTMLIFrameElement>("#alvo");
      const corpo = interno?.contentDocument?.body;
      if (!corpo) throw new Error("ainda carregando");
      const cor = getComputedStyle(corpo).backgroundColor;
      if (!cor) throw new Error("sem cor");
      return cor;
    }, { timeout: 5000, interval: 150 });
  } finally {
    outer.remove();
  }
}

it("sintoma 2: sob a CSP do Tauri o <style> inline do srcDoc AINDA aplica", async () => {
  expect(await estiloInlineAplica(null)).toBe("rgb(1, 2, 3)");
  expect(await estiloInlineAplica(CSP_TAURI)).toBe("rgb(1, 2, 3)");
}, 20000);
