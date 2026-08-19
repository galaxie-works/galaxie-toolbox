// Monta o `srcDoc` do leitor de e-mail em iframe ISOLADO (#1034, SEC1).
//
// Defesa em camadas, todas aqui:
//  1) OPAQUE ORIGIN — o iframe usa `SANDBOX_LEITOR` (sem `allow-same-origin`),
//     então o documento do e-mail não alcança a origem do app: não lê cookies,
//     storage, nem o DOM do pai. `allow-scripts` fica SÓ pela ponte de medição
//     confiável (nossa, servida pela origem do app) — o e-mail não roda script.
//  2) CSP no srcDoc — `default-src 'none'` + `script-src`/`style-src` limitados
//     à ORIGEM DO APP: só o NOSSO script e o NOSSO css entram; nada de
//     script/conexão/form/frame do remetente.
//
//     ⚠️ #1278 — por que NÃO é mais `'nonce-…'` nem `<style>` inline: o srcDoc
//     HERDA a CSP do app, e a política efetiva é a INTERSEÇÃO. A CSP entregue
//     pelo Tauri traz nonce/hashes próprios, e pela spec **nonce ou hash na
//     diretiva ANULA o `'unsafe-inline'`** dela. Resultado medido no app
//     buildado (2026-08-19): script inline e `<style>` inline do srcDoc morriam
//     em silêncio — a ponte nunca rodava (corpo preso em 120px), a inversão do
//     escuro nunca aplicava, e o `overflow-y:hidden` do baseline sumia (a barra
//     de rolagem própria que o PO viu). Ler `tauri.conf.json` NÃO substitui
//     medir o header entregue: a config mente sobre o efeito.
//  3) DOMPurify como ÚLTIMA transformação (AC4) — a dobra do citado reparseia/
//     reserializa o HTML (`DOMParser`→`innerHTML`); sanitizar DEPOIS dela fecha
//     o mXSS que a reserialização poderia reintroduzir.
//
// A medição de altura/zoom (auto-fit #57 + zoom do usuário #76) não pode mais
// ler `iframe.contentDocument` (opaque origin ⇒ `null`). Ela passa a rodar
// DENTRO do iframe (script abaixo) e conversa com o pai por `postMessage`.

import DOMPurify from "dompurify";
import { dobrarCitado } from "./dobrar-citado";

/**
 * Sandbox do iframe do leitor. SEM `allow-same-origin` de propósito: o e-mail
 * vira opaque origin. `allow-scripts` existe apenas pra ponte de medição (o
 * único script que a CSP libera, pela origem do app). `allow-popups` preserva o
 * comportamento de abrir link em nova aba nos casos que escapam da intercepção.
 */
export const SANDBOX_LEITOR = "allow-popups allow-scripts";

export type OpcoesDocEmail = {
  /** HTML BRUTO do corpo (vindo do Graph). */
  corpo: string;
  /** Tema escuro do app — injeta a inversão por CSS. */
  escuro: boolean;
  /** Rótulo acessível do botão de dobra (#92, i18n). */
  rotulo: string;
  /**
   * Origem do app (`location.origin`), injetada em RUNTIME (#1278, desenho do
   * Altair). NUNCA literal: em `tauri dev` é `http://localhost:1420` e no app
   * buildado é `http://tauri.localhost` — fato perecível e específico de versão.
   * É ela que libera a ponte e o css na CSP do srcDoc.
   */
  origem: string;
  /** Fator de zoom do usuário (#76) embutido no 1º render; depois via postMessage. */
  fator: number;
};

// Tipos das mensagens da ponte iframe→pai (a validação real fica no listener
// do pai; aqui é só documentação do contrato).
export type MsgLeitor =
  | { tipo: "gt-reader-altura"; altura: number }
  | { tipo: "gt-reader-zoom"; direcao: 1 | -1 }
  | { tipo: "gt-reader-zoom-reset" }
  | { tipo: "gt-reader-link"; href: string; texto: string };

/**
 * CSP do srcDoc (AC2). Libera EXATAMENTE a origem do app — nada além.
 *
 * #1278: `script-src`/`style-src` recebem a origem em runtime, em vez de
 * `'nonce-…'` e `'unsafe-inline'`. Não se usa `'self'` aqui de propósito: o
 * documento é de ORIGEM OPACA (sandbox sem `allow-same-origin`), então `'self'`
 * não tem contra o que casar. Origem nomeada em runtime funciona em dev e em
 * produção sem ramo condicional e sem fato perecível no código.
 */
function cspSrcDoc(origem: string): string {
  return (
    `default-src 'none'; ` +
    `img-src data: https: http: cid:; ` +
    `style-src ${origem}; ` +
    `script-src ${origem}; ` +
    `frame-src 'none'; connect-src 'none'; form-action 'none'`
  );
}

/**
 * Constrói o documento HTML completo do leitor (o `srcDoc`).
 *
 * Ordem das transformações (AC4): `dobrarCitado(corpo)` → `DOMPurify.sanitize`.
 * O DOMPurify é o ÚLTIMO a tocar a string antes de virar srcDoc.
 */
export function montarDocEmail({
  corpo,
  escuro,
  rotulo,
  origem,
  fator,
}: OpcoesDocEmail): string {
  // #1278: baseline, dobra (#92) e inversão do escuro (#73) moram todos em
  // `leitor-corpo.css`, servido pela origem do app. Antes eram `<style>` inline
  // e a CSP herdada os matava. O escuro passa a ser a classe `gt-escuro` no
  // <html>, em vez de um segundo `<style>` condicional.
  const classeHtml = escuro ? ` class="gt-escuro"` : "";
  const fatorInicial = Number.isFinite(fator) ? fator : 1;

  // AC4: dobra ANTES (reparseia/reserializa), DOMPurify por ÚLTIMO. O `<details>`
  // que a dobra cria sobrevive via ADD_TAGS; `target` segue no ADD_ATTR (links).
  const corpoDobrado = dobrarCitado(corpo, rotulo);
  const corpoLimpo = DOMPurify.sanitize(corpoDobrado, {
    ADD_ATTR: ["target"],
    ADD_TAGS: ["details", "summary"],
  });

  return (
    `<!doctype html><html${classeHtml}><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${cspSrcDoc(origem)}">` +
    `<base target="_blank"><meta name="color-scheme" content="light">` +
    `<link rel="stylesheet" href="${origem}/leitor-corpo.css">` +
    `</head><body>${corpoLimpo}` +
    // A ponte vai no fim do <body> (o body já existe, mede de largada) e leva o
    // fator inicial por `data-fator` — antes era interpolado no script inline.
    `<script src="${origem}/leitor-ponte.js" data-fator="${fatorInicial}"></script>` +
    `</body></html>`
  );
}
