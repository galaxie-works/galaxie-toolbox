// GUARDA DE REGRESSÃO #1278 — em navegador real.
//
// O bug: o `srcDoc` do leitor HERDA a CSP do app; a política efetiva é a
// INTERSEÇÃO. A CSP que o Tauri ENTREGA traz nonce/hashes próprios e, pela spec
// de CSP, **nonce ou hash na diretiva ANULA o `'unsafe-inline'` dela**. Com isso
// morriam em silêncio, de uma vez: a ponte de medição (`<script>` inline → corpo
// preso em 120px), a inversão do escuro e o `overflow-y:hidden` do baseline
// (`<style>` inline → barra de rolagem própria no iframe).
//
// ⚠️ A CSP abaixo espelha a ENTREGUE (medida no app buildado em 2026-08-19),
// NÃO a do `tauri.conf.json` — a config diz `style-src 'self' 'unsafe-inline'`
// e o efeito real é outro, porque o Tauri injeta o nonce. Foi exatamente por
// copiar a config em vez de medir o header que eu cheguei a uma conclusão
// errada neste card. Se algum dia a CSP do app mudar, o dado que vale é o
// header, não o arquivo.
import { it, expect } from "vitest";
import { montarDocEmail, SANDBOX_LEITOR } from "@/lib/corpo-email-doc";

const ORIGEM = location.origin;

/** Forma da CSP ENTREGUE pelo app: `unsafe-inline` presente porém INERTE. */
const CSP_APP_ENTREGUE =
  "default-src 'self'; img-src 'self' data: blob: https: http: cid:; " +
  "style-src 'self' 'unsafe-inline' 'nonce-13132143493429813339'; " +
  "script-src 'self' 'wasm-unsafe-eval' 'sha256-ZERPGwTcBz8/GDc1Yq2msqRIhiJHMQfyDLx/3eKjq2E='; " +
  "connect-src 'self'; frame-src 'self' blob:";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Monta o documento do app (com a CSP entregue) contendo o iframe do leitor, e
 * espera a ponte reportar. O pai NÃO é sandboxed — no app ele é documento
 * normal same-origin; só o leitor é de origem opaca.
 */
async function pontePassa(docLeitor: string, ms = 4000): Promise<boolean> {
  const pai = document.createElement("iframe");
  pai.style.cssText = "position:fixed;left:-9999px;width:600px;height:300px;border:0";
  pai.srcdoc =
    `<!doctype html><html><head>` +
    `<meta http-equiv="Content-Security-Policy" content="${esc(CSP_APP_ENTREGUE)}">` +
    `</head><body style="margin:0">` +
    `<iframe sandbox="${SANDBOX_LEITOR}" srcdoc="${esc(docLeitor)}" style="width:100%;height:120px;border:0"></iframe>` +
    `</body></html>`;
  return await new Promise<boolean>((resolve) => {
    let ok = false;
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { tipo?: string } | null;
      if (d && typeof d === "object" && d.tipo === "gt-reader-altura") ok = true;
    };
    // A ponte posta para `parent` — que aqui é o documento-do-app intermediário,
    // não a janela do teste. Como esse intermediário NÃO é sandboxed (é o app),
    // ele é same-origin e dá para escutar nele de fora. Sem isto o teste mede o
    // próprio arranjo, não o alvo: medido, um leitor que funciona parece morto.
    pai.addEventListener("load", () => {
      pai.contentWindow?.addEventListener("message", onMsg as EventListener);
    });
    document.body.appendChild(pai);
    setTimeout(() => {
      pai.contentWindow?.removeEventListener("message", onMsg as EventListener);
      pai.remove();
      resolve(ok);
    }, ms);
  });
}

const CORPO = "<div>" + Array.from({ length: 30 }, (_, i) => `<p>linha ${i}</p>`).join("") + "</div>";

/** A FORMA ANTIGA, reconstruída aqui: ponte como `<script>` inline com nonce. */
function docLeitorAntigo(): string {
  const nonce = crypto.randomUUID();
  return (
    `<!doctype html><html><head>` +
    `<meta http-equiv="Content-Security-Policy" content="${esc(`default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'`)}">` +
    `<style>html{overflow-y:hidden}</style>` +
    `</head><body>${CORPO}` +
    `<script nonce="${nonce}">parent.postMessage({tipo:"gt-reader-altura",altura:999},"*");</script>` +
    `</body></html>`
  );
}

it("#1278 a FORMA ANTIGA (script inline + nonce) é bloqueada pela CSP herdada", async () => {
  // Este é o controle NEGATIVO: se ele passar a valer `true`, a herança deixou
  // de morder e os outros testes deste arquivo perdem o sentido — não é motivo
  // para comemorar, é motivo para reinvestigar.
  expect(await pontePassa(docLeitorAntigo())).toBe(false);
}, 20000);

it("#1278 a FORMA NOVA (arquivos da origem do app) ATRAVESSA a CSP herdada", async () => {
  const doc = montarDocEmail({
    corpo: CORPO,
    escuro: false,
    rotulo: "mostrar aparado",
    origem: ORIGEM,
    fator: 1,
  });
  expect(await pontePassa(doc)).toBe(true);
}, 20000);

it("#1278 o doc gerado não reintroduz inline (a armadilha que causou o bug)", () => {
  const doc = montarDocEmail({
    corpo: CORPO,
    escuro: true,
    rotulo: "mostrar aparado",
    origem: ORIGEM,
    fator: 1,
  });
  expect(doc).not.toContain("<style");
  expect(doc).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/);
  expect(doc).not.toContain("nonce");
});
