// #1044 (SEC14) — a fronteira de segurança do PREVIEW de docx é o iframe.
//
// O `docx-render.browser.test.tsx` (#1053) já prova o SANITIZADOR
// (`sanitizarHtmlDocx`): o que o DOMPurify barra e o que preserva. Mas a
// sanitização é só a 1ª camada; a 2ª é a MOLDURA em que o HTML é injetado —
// `<iframe sandbox="">` + meta CSP `default-src 'none'`. O `docx-preview-viewer`
// documenta que "mantém a MESMA postura de segurança", só que NADA amarrava
// isso: o dia em que alguém afrouxa o `sandbox` (pra rodar um script do
// documento) ou tira a CSP pra "ajustar o preview", a defesa em profundidade cai
// em silêncio e o verde continua verde.
//
// A entrada é anexo de e-mail / arquivo aberto — não-confiável por definição.
//
// Canal `.component.test.tsx` (vitest + happy-dom) porque as asserções olham o
// DOM renderizado do componente. Ver os 3 canais no WORKFLOW.md §5.0-bis.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { DocxPreviewViewer } from "./docx-preview-viewer.tsx";

const HTML = "<div class='docx'><p>corpo do documento</p></div>";

function montar(html: string) {
  const { container } = render(
    <DocxPreviewViewer html={html} rotulo="preview.docx" vazioTexto="vazio" />,
  );
  return container;
}

describe("#1044 SEC14: o iframe do preview de docx é inerte (sandbox)", () => {
  it("aplica sandbox=\"\" — sem allow-scripts nem allow-same-origin", () => {
    const iframe = montar(HTML).querySelector("iframe");
    expect(iframe).not.toBeNull();
    // Estado ANTIGO/regressão: sandbox="allow-scripts" (ou ausente) → falha aqui.
    // `getAttribute` distingue "" (presente e vazio = mais estrito) de null (ausente).
    const sandbox = iframe!.getAttribute("sandbox");
    expect(sandbox).toBe("");
    expect(sandbox).not.toContain("allow-scripts");
    expect(sandbox).not.toContain("allow-same-origin");
  });
});

describe("#1044 SEC14: a CSP do srcDoc barra tudo por padrão", () => {
  it("injeta a meta CSP com default-src 'none' e sem script-src", () => {
    const iframe = montar(HTML).querySelector("iframe");
    const srcDoc = iframe!.getAttribute("srcdoc") ?? "";
    expect(srcDoc).toContain('http-equiv="Content-Security-Policy"');
    expect(srcDoc).toContain("default-src 'none'");
    // Nenhuma diretiva reabre script: sem `script-src`, `default-src 'none'`
    // já bloqueia execução. Se alguém adicionar um `script-src`, revisar aqui.
    expect(srcDoc).not.toContain("script-src");
    // O corpo sanitizado chega dentro do srcDoc (a moldura não come o conteúdo).
    expect(srcDoc).toContain("corpo do documento");
  });
});

describe("#1044 SEC14: html vazio não renderiza iframe", () => {
  it("cai no texto de vazio, sem superfície de execução", () => {
    const container = montar("   ");
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).toContain("vazio");
  });
});
