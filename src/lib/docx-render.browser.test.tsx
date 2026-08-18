import { describe, expect, test } from "vitest";

import { sanitizarHtmlDocx } from "./docx-render.ts";

// #1053 (TST-07) — a fronteira de segurança do preview de docx.
//
// O `docx-render.ts` documenta que o HTML gerado passa por DOMPurify antes de
// ir para um `<iframe sandbox="">`. Só que **nenhum teste provava isso** — nem
// o que continua barrado, nem o que o afrouxamento `ADD_TAGS: ["style"]`
// pretendia preservar. Config de sanitização sem teste é afirmação: o dia em
// que alguém "melhorar" a lista de tags, nada acusa.
//
// A entrada aqui é **anexo de e-mail** — não-confiável por definição.
//
// Canal: `.component.test.tsx` (vitest + happy-dom) porque o DOMPurify precisa
// de DOM. O `node --test` não serve, e é por isso que este arquivo não é
// `.test.ts` — ver os 3 canais no WORKFLOW.md §5.0-bis.

describe("#1053: o que o sanitizador do docx BARRA", () => {
  test("remove <script>, inclusive aninhado e com atributo", () => {
    const sujo = `
      <div>antes</div>
      <script>window.roubar()</script>
      <div><script type="text/javascript">fetch("https://evil.example")</script></div>
      <div>depois</div>`;
    const limpo = sanitizarHtmlDocx(sujo);

    expect(limpo).not.toContain("<script");
    expect(limpo).not.toContain("roubar");
    expect(limpo).not.toContain("evil.example");
    // o conteúdo legítimo sobrevive — sanitizar não é apagar tudo
    expect(limpo).toContain("antes");
    expect(limpo).toContain("depois");
  });

  test("remove handlers on* (onclick, onerror, onload)", () => {
    const sujo = `
      <div onclick="roubar()">clique</div>
      <img src="x" onerror="roubar()">
      <body onload="roubar()"><p>texto</p></body>`;
    const limpo = sanitizarHtmlDocx(sujo);

    expect(limpo).not.toMatch(/onclick/i);
    expect(limpo).not.toMatch(/onerror/i);
    expect(limpo).not.toMatch(/onload/i);
    expect(limpo).not.toContain("roubar");
    expect(limpo).toContain("clique");
  });

  test("remove href=javascript: (e variações com espaço/caixa)", () => {
    for (const href of [
      "javascript:roubar()",
      "JaVaScRiPt:roubar()",
      " javascript:roubar()",
      "java\tscript:roubar()",
    ]) {
      const limpo = sanitizarHtmlDocx(`<a href="${href}">link</a>`);
      expect(limpo.toLowerCase()).not.toContain("javascript:");
      expect(limpo).not.toContain("roubar");
      // o texto do link fica; só o vetor sai
      expect(limpo).toContain("link");
    }
  });

  test("remove <iframe>/<object>/<embed> — moldura dentro da moldura", () => {
    const limpo = sanitizarHtmlDocx(
      `<iframe src="https://evil.example"></iframe>
       <object data="x.swf"></object>
       <embed src="x.swf">`,
    );
    expect(limpo).not.toContain("<iframe");
    expect(limpo).not.toContain("<object");
    expect(limpo).not.toContain("<embed");
  });
});

describe("#1053: o que o afrouxamento ADD_TAGS preservou — e SÓ isso", () => {
  // Este é o par do teste acima: sem ele, alguém "endurece" a config tirando o
  // ADD_TAGS e o preview perde a formatação sem nada reprovar.
  test("mantém <style> (é o motivo do ADD_TAGS)", () => {
    const limpo = sanitizarHtmlDocx(
      `<style>.docx p { margin: 0 }</style><p class="docx">texto</p>`,
    );
    expect(limpo).toContain("<style");
    expect(limpo).toContain("margin");
    expect(limpo).toContain("texto");
  });

  test("o ADD_TAGS não abriu <script> junto", () => {
    // A pergunta que o afrouxamento levanta: ele liberou só o `style`?
    const limpo = sanitizarHtmlDocx(
      `<style>.a{color:red}</style><script>roubar()</script>`,
    );
    expect(limpo).toContain("<style");
    expect(limpo).not.toContain("<script");
  });

  test("mantém a formatação legítima que o docx-preview emite", () => {
    const limpo = sanitizarHtmlDocx(
      `<div class="docx-wrapper"><p><strong>negrito</strong> e <em>itálico</em></p>
       <table><tr><td>célula</td></tr></table></div>`,
    );
    expect(limpo).toContain("<strong");
    expect(limpo).toContain("<em");
    expect(limpo).toContain("<table");
    expect(limpo).toContain("célula");
  });
});

describe("#1053: entrada degenerada não explode", () => {
  // O outro AC do card: arquivo corrompido não pode gerar exception não
  // capturada. Aqui na fronteira: HTML quebrado entra e sai string.
  test("HTML malformado, vazio e gigante devolvem string sem lançar", () => {
    for (const entrada of [
      "",
      "<<<>>>",
      "<div><p>sem fechar",
      "<div ".repeat(500),
      // escapes, nao bytes crus: um NUL literal no fonte faz o git tratar
      // o arquivo como BINARIO (foi o que aconteceu no primeiro commit desta fatia).
      "\u0000\uFFFF",
    ]) {
      expect(() => sanitizarHtmlDocx(entrada)).not.toThrow();
      expect(typeof sanitizarHtmlDocx(entrada)).toBe("string");
    }
  });
});
