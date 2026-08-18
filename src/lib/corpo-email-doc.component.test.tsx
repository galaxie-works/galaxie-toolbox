// #1034 (SEC1) — isolamento do leitor de e-mail. Prova os ACs no ponto de
// verdade (`montarDocEmail` + `SANDBOX_LEITOR`), sem depender do runtime do
// DOMPurify (que sob happy-dom não sanitiza como o WebView2): as asserções
// olham o TEMPLATE e o ARGUMENTO do sanitize, não a saída sanitizada.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import DOMPurify from "dompurify";
import { montarDocEmail, SANDBOX_LEITOR } from "@/lib/corpo-email-doc";

const NONCE = "nonce-fixo-para-teste";
const base = { rotulo: "mostrar aparado", nonce: NONCE, fator: 1 };

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

describe("montarDocEmail — CSP no srcDoc (#1034 AC2)", () => {
  it("injeta a meta CSP e o nonce casa com o script da ponte", () => {
    const doc = montarDocEmail({ ...base, corpo: "<p>oi</p>", escuro: false });
    expect(doc).toContain('http-equiv="Content-Security-Policy"');
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain(`script-src 'nonce-${NONCE}'`);
    expect(doc).toContain("frame-src 'none'");
    expect(doc).toContain("connect-src 'none'");
    // O único script liberado é o NOSSO, com o mesmo nonce da CSP.
    expect(doc).toContain(`<script nonce="${NONCE}">`);
  });
});

describe("montarDocEmail — dark mode por CSS, sem script (#1034 AC3)", () => {
  it("escuro: inversão por filter e NENHUM Dark Reader", () => {
    const doc = montarDocEmail({ ...base, corpo: "<p>oi</p>", escuro: true });
    expect(doc).toContain("filter:invert(1)");
    // No código antigo o escuro injetava o bundle do Dark Reader + DarkReader.enable.
    expect(doc.toLowerCase()).not.toContain("darkreader");
  });

  it("claro: sem inversão", () => {
    const doc = montarDocEmail({ ...base, corpo: "<p>oi</p>", escuro: false });
    expect(doc).not.toContain("filter:invert(1)");
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
