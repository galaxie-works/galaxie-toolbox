// Monta o `srcDoc` do leitor de e-mail em iframe ISOLADO (#1034, SEC1).
//
// Defesa em camadas, todas aqui:
//  1) OPAQUE ORIGIN — o iframe usa `SANDBOX_LEITOR` (sem `allow-same-origin`),
//     então o documento do e-mail não alcança a origem do app: não lê cookies,
//     storage, nem o DOM do pai. `allow-scripts` fica SÓ pela ponte de medição
//     confiável (nossa, com nonce) — o e-mail em si não roda script.
//  2) CSP no srcDoc — `default-src 'none'` + `script-src 'nonce-…'`: só o NOSSO
//     script roda; imagens e estilos inline do e-mail funcionam, mas nada de
//     script/conexão/form/frame do remetente.
//  3) DOMPurify como ÚLTIMA transformação (AC4) — a dobra do citado reparseia/
//     reserializa o HTML (`DOMParser`→`innerHTML`); sanitizar DEPOIS dela fecha
//     o mXSS que a reserialização poderia reintroduzir.
//
// A medição de altura/zoom (auto-fit #57 + zoom do usuário #76) não pode mais
// ler `iframe.contentDocument` (opaque origin ⇒ `null`). Ela passa a rodar
// DENTRO do iframe (script abaixo) e conversa com o pai por `postMessage`.

import DOMPurify from "dompurify";
import { dobrarCitado, estiloDobra } from "./dobrar-citado";
import { estiloInversaoEscuro } from "./dark-reader-inject";

/**
 * Sandbox do iframe do leitor. SEM `allow-same-origin` de propósito: o e-mail
 * vira opaque origin. `allow-scripts` existe apenas pra ponte de medição (o
 * único script que a CSP libera, via nonce). `allow-popups` preserva o
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
  /** Nonce único por render — casa com o `<script>` da ponte na CSP. */
  nonce: string;
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
 * Ponte de medição CONFIÁVEL (nossa) injetada no fim do <body>. Roda porque a
 * CSP libera exatamente este nonce. NÃO acessa `parent.document` (opaque origin
 * proíbe) — só `parent.postMessage`. Replica a MESMA lógica do antigo
 * `ajustar()`: piso de legibilidade 0.75 (#57) × fator do usuário (#76).
 */
function scriptMedicao(nonce: string, fatorInicial: number): string {
  const fator = Number.isFinite(fatorInicial) ? fatorInicial : 1;
  // `String.raw`-free: mantido em ASCII simples; sem `</script>` interno.
  const js =
    `(function(){` +
    `var FATOR=${fator},PISO=0.75,ultAltura=-1,ultLargura=-1,agendado=false;` +
    `function medir(){` +
    `var body=document.body;if(!body)return;` +
    // zoom=1 pra medir a largura natural do conteúdo, como o ajustar() fazia.
    `body.style.zoom="1";` +
    `var conteudo=body.scrollWidth,disponivel=document.documentElement.clientWidth;` +
    `var ideal=(conteudo>disponivel&&conteudo>0)?disponivel/conteudo:1;` +
    // Piso 0.75 (#57): nunca encolher a ponto de virar ilegível; excedente rola.
    `var base=Math.max(PISO,ideal),efetivo=base*FATOR;` +
    `body.style.zoom=String(efetivo);` +
    `var rolaX=conteudo*efetivo>disponivel+1;` +
    `var h=Math.ceil(body.getBoundingClientRect().height)+4+(rolaX?16:0);` +
    // Só posta se mudou de verdade — quebra o loop resize↔altura.
    `if(Math.abs(h-ultAltura)>1){ultAltura=h;parent.postMessage({tipo:"gt-reader-altura",altura:h},"*");}` +
    `}` +
    `function agendar(){if(agendado)return;agendado=true;requestAnimationFrame(function(){agendado=false;medir();});}` +
    `window.addEventListener("load",function(){medir();` +
    `document.querySelectorAll("img").forEach(function(img){if(!img.complete)img.addEventListener("load",agendar,{once:true});});});` +
    // Só re-mede quando a LARGURA muda (arrastar o splitter); altura não, pra
    // não criar feedback (o pai reajusta a altura do iframe → dispara resize).
    `window.addEventListener("resize",function(){var w=document.documentElement.clientWidth;if(w!==ultLargura){ultLargura=w;medir();}});` +
    // Dobra do citado (#92): abrir/fechar muda a altura. `toggle` não borbulha.
    `document.addEventListener("toggle",agendar,true);` +
    // Conteúdo tardio (childList). NÃO observa attributes: senão o nosso
    // body.style.zoom re-dispararia o observer num loop.
    `new MutationObserver(agendar).observe(document.documentElement,{subtree:true,childList:true});` +
    // Link-safety (#91): intercepta o clique e MANDA o destino pro pai decidir
    // (http → modal de confirmação; outros → SO). Nada abre direto aqui.
    `document.addEventListener("click",function(e){var a=e.target&&e.target.closest?e.target.closest("a"):null;if(!a||!a.href)return;e.preventDefault();parent.postMessage({tipo:"gt-reader-link",href:a.href,texto:a.textContent||""},"*");});` +
    // Zoom manual (#76): CTRL+roda / CTRL +/−/0 → manda a INTENÇÃO pro pai, que
    // é o dono do clamp (ZOOM_MIN/MAX) e devolve o novo fator por postMessage.
    `document.addEventListener("wheel",function(e){if(!e.ctrlKey)return;e.preventDefault();parent.postMessage({tipo:"gt-reader-zoom",direcao:e.deltaY<0?1:-1},"*");},{passive:false});` +
    `document.addEventListener("keydown",function(e){if(!e.ctrlKey)return;if(e.key==="+"||e.key==="="){e.preventDefault();parent.postMessage({tipo:"gt-reader-zoom",direcao:1},"*");}else if(e.key==="-"||e.key==="_"){e.preventDefault();parent.postMessage({tipo:"gt-reader-zoom",direcao:-1},"*");}else if(e.key==="0"){e.preventDefault();parent.postMessage({tipo:"gt-reader-zoom-reset"},"*");}});` +
    // Fator vindo do pai (após o clamp): aplica e re-mede, sem recarregar o srcDoc.
    `window.addEventListener("message",function(e){if(e.source!==window.parent)return;var d=e.data;if(d&&d.tipo==="gt-reader-set-fator"&&typeof d.fator==="number"){FATOR=d.fator;medir();}});` +
    // Script fica no fim do <body>: o body já existe, então mede de largada.
    `if(document.readyState!=="loading")medir();` +
    `})();`;
  return `<script nonce="${nonce}">${js}</script>`;
}

/** CSP do srcDoc (AC2). O `<NONCE>` casa com o script da ponte de medição. */
function cspSrcDoc(nonce: string): string {
  return (
    `default-src 'none'; ` +
    `img-src data: https: http: cid:; ` +
    `style-src 'unsafe-inline'; ` +
    `script-src 'nonce-${nonce}'; ` +
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
  nonce,
  fator,
}: OpcoesDocEmail): string {
  const baseline =
    // ROOT rola no eixo X quando algo largo estoura mesmo no zoom mínimo (#57);
    // overflow-y hidden — a altura é medida e aplicada por fora.
    `<style>:root{color-scheme:light}html{margin:0;padding:0;overflow-x:auto;overflow-y:hidden}` +
    `body{margin:0;background:#fff;color:#111;` +
    `font-family:system-ui,-apple-system,Segoe UI,sans-serif;` +
    `font-size:14px;line-height:1.5;padding:6px;overflow-wrap:anywhere}` +
    `img{max-width:100%;height:auto}a{color:#7c3aed}` +
    estiloDobra() +
    `</style>`;
  const inversao = escuro ? `<style>${estiloInversaoEscuro()}</style>` : "";

  // AC4: dobra ANTES (reparseia/reserializa), DOMPurify por ÚLTIMO. O `<details>`
  // que a dobra cria sobrevive via ADD_TAGS; `target` segue no ADD_ATTR (links).
  const corpoDobrado = dobrarCitado(corpo, rotulo);
  const corpoLimpo = DOMPurify.sanitize(corpoDobrado, {
    ADD_ATTR: ["target"],
    ADD_TAGS: ["details", "summary"],
  });

  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${cspSrcDoc(nonce)}">` +
    `<base target="_blank"><meta name="color-scheme" content="light">` +
    baseline +
    inversao +
    `</head><body>${corpoLimpo}` +
    scriptMedicao(nonce, fator) +
    `</body></html>`
  );
}
