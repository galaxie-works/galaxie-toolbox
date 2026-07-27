/**
 * "Show trimmed content" (estilo Gmail) para o corpo HTML do e-mail.
 *
 * Heurística portada do MailVault (`src/utils/iframeQuoteFolding.js` +
 * `src/utils/quoteFolding.js`) — a referência aprovada pelo PO — e ampliada com
 * os padrões do Outlook/Exchange que o Bridge recebe via Graph.
 *
 * DIFERENÇA IMPORTANTE em relação ao MailVault: lá a dobra é um `<script>`
 * injetado no `srcDoc`. Aqui NÃO dá: o iframe do `CorpoHtml` só ganha
 * `allow-scripts` no tema escuro (pro Dark Reader) — no tema claro o sandbox é
 * estrito de propósito. Então a detecção roda AQUI (no React, sobre o HTML já
 * sanitizado pelo DOMPurify) e o que vai pro iframe é um `<details>/<summary>`
 * nativo: o toggle é do navegador, funciona sem script nenhum, é acessível
 * (o summary já anuncia expandido/recolhido) e responde a teclado.
 *
 * O `CorpoHtml` escuta o evento `toggle` (em captura — `toggle` não borbulha)
 * pra remedir a altura do iframe quando o bloco abre/fecha.
 */

/** Elementos que, quando aparecem, marcam o início do histórico citado. */
const SELETORES_CITACAO = [
  ".gmail_quote",
  ".gmail_quote_container",
  ".yahoo_quoted",
  '[class*="moz-cite"]',
  "blockquote[type='cite']",
  // Outlook / Exchange
  "#appendonsend",
  "#divRplyFwdMsg",
  ".OutlookMessageHeader",
  '[id*="divRplyFwd" i]',
].join(",");

/** Elementos de assinatura (Gmail, Yahoo, Outlook). */
const SELETORES_ASSINATURA = [
  ".gmail_signature",
  ".yahoo_signature",
  '[class*="signature" i]',
  '[id*="signature" i]',
].join(",");

/**
 * Cabeçalhos textuais que abrem o trecho citado. Testados contra o INÍCIO do
 * texto do elemento — um wrapper que comece com conteúdo novo nunca casa.
 */
const MARCADORES_CITACAO: RegExp[] = [
  // ----- Original Message ----- / --- Mensagem original --- / Forwarded
  /^-{2,}\s*(original message|mensagem original|mensagem encaminhada|forwarded message|begin forwarded message|ursprüngliche nachricht|message d'origine)\s*-{0,}/i,
  // On <data>, Fulano <x@y> wrote: / Em <data>, Fulano escreveu:
  /^(on|em)\b[\s\S]{0,240}?\b(wrote|escreveu|escribió|a écrit)\s*:/i,
  // De: ... Enviada: ... Para: (cabeçalho clássico do Outlook)
  /^(de|from|von)\s*:[\s\S]{0,320}?\b(sent|enviada|enviado|to|para|date|data|datum|an)\s*:/i,
  // Divisor de underscores que o Outlook/Exchange usa antes do citado
  /^_{5,}/,
];

/** Assinatura em texto puro: linha "-- " (sig dash) fechando a mensagem. */
const MARCADOR_ASSINATURA = /^--\s*$/;

/** Linha de citação em texto puro ("> ..."). */
const MARCADOR_MAIOR_QUE = /^>/;

/** Texto normalizado (nbsp vira espaço) e sem espaços nas pontas. */
function texto(no: Node): string {
  return (no.textContent ?? "").replace(/ /g, " ").trim();
}

/** `true` se `a` vem antes de `b` no documento. */
function vemAntes(a: Node, b: Node): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/** Guarda o candidato que aparece primeiro no documento. */
function maisCedo(atual: Element | null, novo: Element): Element {
  return atual && vemAntes(atual, novo) ? atual : novo;
}

/**
 * Bloco de citação em texto puro: varre os filhos do fim pro começo enquanto
 * forem vazios ou começarem com ">". Porta do `splitQuotedContent` do MailVault
 * (caso "> prefix quote blocks at the end").
 */
function inicioBlocoMaiorQue(pai: Element): Element | null {
  const filhos = Array.from(pai.children);
  let inicio: Element | null = null;
  let citadas = 0;
  for (let i = filhos.length - 1; i >= 0; i--) {
    const t = texto(filhos[i]);
    if (MARCADOR_MAIOR_QUE.test(t)) {
      inicio = filhos[i];
      citadas++;
      continue;
    }
    if (t === "") continue; // linhas em branco no meio do bloco não quebram
    break;
  }
  return citadas >= 2 ? inicio : null;
}

/** Desce por wrappers de filho único — onde o conteúdo de verdade mora. */
function conteudoReal(raiz: Element): Element {
  let atual = raiz;
  while (atual.children.length === 1 && texto(atual) === texto(atual.children[0])) {
    atual = atual.children[0];
  }
  return atual;
}

/** Acha o elemento a partir do qual tudo deve ser dobrado (ou `null`). */
function acharInicioDaDobra(body: HTMLElement): Element | null {
  let candidato: Element | null = null;

  // 1) Estrutural: classes/ids conhecidos de citação.
  for (const el of Array.from(body.querySelectorAll(SELETORES_CITACAO))) {
    candidato = maisCedo(candidato, el);
  }

  // 2) `blockquote` genérico — só quando NÃO houver nada de substancial depois
  //    dele (evita dobrar uma citação decorativa no meio do texto).
  for (const bq of Array.from(body.querySelectorAll("blockquote"))) {
    let depois = "";
    for (let n = bq.nextSibling; n; n = n.nextSibling) depois += texto(n);
    if (depois.length <= 80) candidato = maisCedo(candidato, bq);
  }

  // 3) Textual: cabeçalhos de citação no INÍCIO do texto do elemento.
  for (const el of Array.from(body.querySelectorAll("*"))) {
    const t = texto(el);
    if (!t) continue;
    if (MARCADORES_CITACAO.some((re) => re.test(t))) {
      candidato = maisCedo(candidato, el);
      break; // querySelectorAll é ordem de documento: o 1º já é o mais externo
    }
  }

  // 4) `<hr>` seguido de cabeçalho "De:/From:" — separador clássico do Outlook.
  for (const hr of Array.from(body.querySelectorAll("hr"))) {
    let depois = "";
    for (let n = hr.nextSibling; n && depois.length < 320; n = n.nextSibling) {
      depois += " " + texto(n);
    }
    if (/^\s*(de|from|von)\s*:/i.test(depois)) candidato = maisCedo(candidato, hr);
  }

  // 5) Assinatura: elemento marcado, ou a linha "-- " que fecha a mensagem.
  const alvo = conteudoReal(body);
  for (const sig of Array.from(body.querySelectorAll(SELETORES_ASSINATURA))) {
    candidato = maisCedo(candidato, sig);
  }
  for (const filho of Array.from(alvo.children)) {
    if (MARCADOR_ASSINATURA.test(texto(filho))) {
      candidato = maisCedo(candidato, filho);
      break;
    }
  }

  // 6) Bloco "> ..." no fim (e-mail em texto puro convertido pra HTML).
  const bloco = inicioBlocoMaiorQue(alvo);
  if (bloco) candidato = maisCedo(candidato, bloco);

  return candidato;
}

/** Vale a pena dobrar? (não pode esconder tudo, nem dobrar migalha) */
function conteudoRelevante(el: Element | DocumentFragment): boolean {
  const t = (el.textContent ?? "").trim();
  if (t.length >= 12) return true;
  return !!(el as ParentNode).querySelector?.("img,table");
}

/**
 * Envolve o histórico citado/assinatura num `<details>` recolhido com um botão
 * "⋯" (o `<summary>`). Devolve o HTML transformado; se nada for detectado — ou
 * se dobrar esconderia a mensagem inteira — devolve o HTML original.
 *
 * @param html  HTML JÁ SANITIZADO (a transformação roda depois do DOMPurify,
 *              pra que o `<details>` que criamos não seja removido).
 * @param rotulo Rótulo acessível do botão (i18n).
 */
export function dobrarCitado(html: string, rotulo: string): string {
  if (!html) return html;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return html;
  }
  const body = doc.body;
  if (!body) return html;

  const inicio = acharInicioDaDobra(body);
  if (!inicio || !inicio.parentNode) return html;

  const pai = inicio.parentNode;
  // Marca o ponto de inserção e move o trecho (e tudo que vem depois) pra fora.
  const marca = doc.createComment("gt-aparado");
  pai.insertBefore(marca, inicio);
  const trecho = doc.createDocumentFragment();
  for (let n: ChildNode | null = marca.nextSibling; n; ) {
    const prox: ChildNode | null = n.nextSibling;
    trecho.appendChild(n);
    n = prox;
  }

  const desfazer = () => {
    pai.insertBefore(trecho, marca);
    marca.remove();
  };

  // Sobrou mensagem visível? E o que foi dobrado é relevante? Senão, desiste.
  if (!conteudoRelevante(body) || !conteudoRelevante(trecho)) {
    desfazer();
    return html;
  }

  const details = doc.createElement("details");
  details.className = "gt-aparado";
  const summary = doc.createElement("summary");
  summary.className = "gt-aparado-botao";
  summary.setAttribute("aria-label", rotulo);
  summary.setAttribute("title", rotulo);
  summary.textContent = "⋯"; // ⋯ (mesmo glifo do MailVault)
  details.appendChild(summary);
  details.appendChild(trecho);
  pai.replaceChild(details, marca);

  return body.innerHTML;
}

/**
 * CSS do botão de dobra, injetado no baseline do `srcDoc`.
 *
 * As CORES vêm por tema (em vez de deixar o Dark Reader inverter junto com o
 * e-mail, como o resto do baseline faz): o cinza claro do chip do Gmail bate
 * quase exatamente no fundo que o DR gera pro body, e o botão sumia no escuro.
 * O `!important` resolve as duas coisas de uma vez — o DR não sobrescreve
 * declarações `!important` do autor, e o `<style>` do próprio e-mail (que vem
 * DEPOIS do nosso no documento) também não.
 */
export function estiloDobra(escuro: boolean): string {
  const fundo = escuro ? "#3c4043" : "#dadce0";
  const fundoHover = escuro ? "#4d5155" : "#c6cad0";
  const cor = escuro ? "#dadce0" : "#3c4043";
  return (
    `details.gt-aparado{margin:2px 0;display:block!important}` +
    `details.gt-aparado>summary.gt-aparado-botao{` +
    `display:inline-block!important;list-style:none!important;cursor:pointer;` +
    `user-select:none;box-sizing:content-box;height:14px;line-height:14px;` +
    `padding:0 8px;margin:4px 0;border:0!important;border-radius:8px;` +
    `background:${fundo}!important;color:${cor}!important;` +
    `font:700 14px/14px system-ui,-apple-system,Segoe UI,sans-serif;` +
    `letter-spacing:1px;vertical-align:middle;zoom:1}` +
    `details.gt-aparado>summary.gt-aparado-botao::-webkit-details-marker{display:none}` +
    `details.gt-aparado>summary.gt-aparado-botao::marker{content:""}` +
    `details.gt-aparado>summary.gt-aparado-botao:hover{background:${fundoHover}!important}` +
    `details.gt-aparado>summary.gt-aparado-botao:focus-visible{` +
    `outline:2px solid #7c3aed;outline-offset:2px}`
  );
}
