/**
 * docx → HTML sanitizado para pré-visualização (#189 · épico #178, Slice 2).
 *
 * O `docx-preview` renderiza o OOXML num container do DOM; extraímos o HTML,
 * passamos pelo **DOMPurify** e o componente injeta num `<iframe sandbox="">`
 * com CSP estrito (sem rede, sem script) — a mesma moldura de segurança do TXT.
 *
 * A lib é carregada **sob demanda** (dynamic import) para não pesar o bundle
 * principal — a maioria dos e-mails não abre um docx.
 */
import DOMPurify from "dompurify";

export async function renderDocxParaHtml(bytes: Uint8Array): Promise<string> {
  const { renderAsync } = await import("docx-preview");
  // Container destacado (não entra no documento visível); só serve de alvo
  // para o docx-preview montar o HTML que vamos extrair.
  const container = document.createElement("div");
  await renderAsync(new Blob([bytes as BlobPart]), container, undefined, {
    inWrapper: true,
    // Imagens como data: URL (funcionam dentro do iframe sandbox + CSP;
    // blob: URLs seriam de origem opaca e não carregariam lá).
    useBase64URL: true,
    breakPages: false,
    ignoreLastRenderedPageBreak: true,
  });
  return sanitizarHtmlDocx(container.innerHTML);
}

/**
 * A FRONTEIRA DE SEGURANÇA do preview de docx (#1053, TST-07).
 *
 * Extraída de dentro do `renderDocxParaHtml` para poder ser testada: aquela
 * função precisa de DOM **e** do `docx-preview` (dynamic import), então a
 * sanitização — que é a parte que importa para segurança — ficava inalcançável
 * por teste. O conteúdo vem de um anexo de e-mail: entrada não-confiável.
 *
 * `ADD_TAGS: ["style"]` é um **afrouxamento deliberado** da config padrão do
 * DOMPurify: o `docx-preview` emite um `<style>` com o CSS do documento, e sem
 * ele o preview perde a fidelidade. O afrouxamento é seguro porque o HTML vai
 * para um `<iframe sandbox="">` com CSP estrita (sem rede, sem script) — o
 * `<style>` não executa nada e a CSP corta qualquer `url()` que sobre.
 *
 * ⚠️ O afrouxamento é do `<style>` e **de mais nada**: `<script>`, handlers
 * `on*` e `href="javascript:"` continuam removidos pelo default do DOMPurify.
 * É exatamente isso que os testes prendem — antes deles, nada provava nem o que
 * o afrouxamento preserva, nem o que ele NÃO abriu junto.
 *
 * ## Por que `FORCE_BODY: true` (#1053)
 *
 * `ADD_TAGS: ["style"]` **sozinho era inerte**. Medido em Chromium real
 * (DOMPurify 3.4.12): `sanitize('<style>.a{color:red}</style><p>x</p>',
 * { ADD_TAGS: ["style"] })` devolve `'<p>x</p>'` — sem o `<style>`.
 *
 * A causa é o parser, não o DOMPurify: um `<style>` no início do fragmento é
 * **içado para o `<head>`**, e o DOMPurify serializa só o `<body>`. O
 * `FORCE_BODY` obriga o conteúdo a ficar no body, e aí o `<style>` sobrevive.
 *
 * ⇒ Durante todo esse tempo o preview de docx **perdia o CSS do documento** em
 * silêncio: o comentário prometia fidelidade, e a config entregava texto cru.
 * `FORCE_BODY` **não afrouxa nada** — os testes de barreira (script/`on*`/
 * `javascript:`/iframe) seguem passando com ele ligado.
 */
export function sanitizarHtmlDocx(html: string): string {
  return DOMPurify.sanitize(html, { ADD_TAGS: ["style"], FORCE_BODY: true });
}
