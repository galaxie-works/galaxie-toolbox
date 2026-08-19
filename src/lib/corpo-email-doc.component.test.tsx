// #1034 (SEC1) — isolamento do leitor de e-mail. Prova os ACs no ponto de
// verdade (`montarDocEmail` + `SANDBOX_LEITOR`), sem depender do runtime do
// DOMPurify (que sob happy-dom não sanitiza como o WebView2): as asserções
// olham o TEMPLATE e o ARGUMENTO do sanitize, não a saída sanitizada.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import DOMPurify from "dompurify";
import { montarDocEmail, SANDBOX_LEITOR } from "@/lib/corpo-email-doc";

// #1278: o nonce saiu; o que libera a ponte e o css agora e a ORIGEM DO APP,
// injetada em runtime. Aqui ela e fixa so pra o teste ser deterministico.
const ORIGEM = "http://origem-de-teste.local";
const base = { rotulo: "mostrar aparado", origem: ORIGEM, fator: 1 };

afterEach(() => vi.restoreAllMocks());

describe("SANDBOX_LEITOR — opaque origin (#1034 AC1)", () => {
  it("NÃO contém allow-same-origin, mas mantém allow-scripts (ponte de medição)", () => {
    // No código antigo o sandbox era "allow-same-origin allow-popups[ allow-scripts]"
    // → esta asserção falharia (vermelho antes).
    expect(SANDBOX_LEITOR).not.toContain("allow-same-origin");
    expect(SANDBOX_LEITOR).toContain("allow-scripts");
  });

  it("é o valor realmente aplicado no atributo sandbox de um iframe", () => {
    const { container } = render(<iframe title="leitor" sandbox={SANDBOX_LEITOR} />);
    const el = container.querySelector("iframe")!;
    expect(el.getAttribute("sandbox")).toBe(SANDBOX_LEITOR);
    expect(el.getAttribute("sandbox")).not.toContain("allow-same-origin");
  });
});

describe("montarDocEmail — CSP no srcDoc (#1034 AC2 · #1278)", () => {
  it("injeta a meta CSP e libera SÓ a origem do app", () => {
    const doc = montarDocEmail({ ...base, corpo: "<p>oi</p>", escuro: false });
    expect(doc).toContain('http-equiv="Content-Security-Policy"');
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain(`script-src ${ORIGEM}`);
    expect(doc).toContain(`style-src ${ORIGEM}`);
    expect(doc).toContain("frame-src 'none'");
    expect(doc).toContain("connect-src 'none'");
  });

  // #1278 — os três guardas que impedem a REGRESSÃO de voltar. Cada um destes
  // era o estado ANTIGO do código, e cada um morria em silêncio sob a CSP que o
  // app herda (nonce/hash na diretiva ANULA o 'unsafe-inline' dela).
  it("NÃO usa nonce nem `unsafe-inline` — eles são inertes sob a CSP herdada", () => {
    const doc = montarDocEmail({ ...base, corpo: "<p>oi</p>", escuro: true });
    expect(doc).not.toContain("nonce");
    expect(doc).not.toContain("unsafe-inline");
  });

  it("NÃO tem `<script>` inline nem `<style>` inline — só arquivos da origem", () => {
    const doc = montarDocEmail({ ...base, corpo: "<p>oi</p>", escuro: true });
    // `<script src=...>` sim; `<script>` com corpo, não.
    expect(doc).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/);
    expect(doc).not.toContain("<style");
  });

  it("carrega ponte e css COMO ARQUIVOS servidos pela origem do app", () => {
    const doc = montarDocEmail({ ...base, corpo: "<p>oi</p>", escuro: false, fator: 1.5 });
    expect(doc).toContain(`<link rel="stylesheet" href="${ORIGEM}/leitor-corpo.css">`);
    expect(doc).toContain(`<script src="${ORIGEM}/leitor-ponte.js"`);
    // O fator inicial (#76) viaja por atributo, já que não há mais script inline.
    expect(doc).toContain('data-fator="1.5"');
  });
});

describe("montarDocEmail — dark mode por CSS, sem script (#1034 AC3 · #1278)", () => {
  // #1278: a inversão continua por CSS e sem script, mas mora no arquivo
  // `leitor-corpo.css` (regra `html.gt-escuro`) em vez de um `<style>` inline
  // que a CSP herdada bloqueava. O que o doc carrega agora é a CLASSE.
  it("escuro: marca a classe de inversão no <html> e NENHUM Dark Reader", () => {
    const doc = montarDocEmail({ ...base, corpo: "<p>oi</p>", escuro: true });
    expect(doc).toContain('<html class="gt-escuro"');
    expect(doc.toLowerCase()).not.toContain("darkreader");
  });

  it("claro: sem a classe de inversão", () => {
    const doc = montarDocEmail({ ...base, corpo: "<p>oi</p>", escuro: false });
    expect(doc).not.toContain("gt-escuro");
  });
});

describe("montarDocEmail — DOMPurify por ÚLTIMO (#1034 AC4, mXSS)", () => {
  it("dobra ANTES do sanitize: o sanitize recebe o <details> gerado pela dobra", () => {
    const spy = vi.spyOn(DOMPurify, "sanitize");
    const corpo =
      "<div>Resposta nova, claramente longa o suficiente pra sobrar</div>" +
      '<div class="gmail_quote">Trecho citado antigo, tambem longo o suficiente</div>';
    montarDocEmail({ ...base, corpo, escuro: false });
    expect(spy).toHaveBeenCalled();
    const arg = String(spy.mock.calls.at(-1)?.[0] ?? "");
    // A dobra (que cria o <details class="gt-aparado">) rodou ANTES do sanitize.
    // Na ordem ANTIGA (sanitize→dobra) o sanitize receberia o corpo CRU, sem
    // <details> → asserção vermelha no código antigo. Prova determinística da
    // ordem, independente de como o DOMPurify se comporta sob happy-dom.
    expect(arg).toContain('<details class="gt-aparado"');
  });
});
