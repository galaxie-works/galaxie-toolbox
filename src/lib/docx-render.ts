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
  // Mantém o <style> que o docx-preview gera (fidelidade); o DOMPurify sanea o
  // CSS/HTML e a CSP do iframe corta qualquer rede que sobrar.
  return DOMPurify.sanitize(container.innerHTML, { ADD_TAGS: ["style"] });
}
