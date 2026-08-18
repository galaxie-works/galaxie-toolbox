/**
 * Viewer de docx — #956 (Path B: endurecer o `docx-preview`, não trocar de engine).
 *
 * O render legado jogava o HTML do `docx-preview` num `<iframe sandbox="">` com
 * uma moldura genérica (`preview-arquivo.tsx` → `HtmlSandboxViewer`). Resultado:
 * "ZOADO" no runtime do Wagner. A causa NÃO é o `docx-preview` (que é fiel), e
 * sim a moldura em que injetamos o HTML dele:
 *
 *  1. Cada página vira uma `section.docx` com **largura FÍSICA fixa** vinda do
 *     OOXML (`style.width = pageSize.width`, ~794px em A4 — ver
 *     `docx-preview.mjs:3103`). Num painel estreito isso ESTOURA na horizontal,
 *     sem fit-to-width nem zoom → página cortada/minúscula.
 *  2. A folha default do `docx-preview` embrulha tudo num `.docx-wrapper` com
 *     `background: gray; padding: 30px` (ver `docx-preview.mjs:3274`) — um "desk"
 *     cinza que, no painel pequeno e no dark mode, destoa do app.
 *  3. A moldura antiga ainda somava `body{padding:16px}` por cima do wrapper
 *     (padding duplo) e fixava `background:#fff;color:#111` — ignorando o
 *     tema escuro do app (o xlsx/Univer já segue o tema; o docx não seguia).
 *
 * Este viewer resolve a MOLDURA, sem trocar de engine e sem mexer na postura de
 * segurança: mantém `sandbox=""` (nenhum script do documento roda) e a MESMA CSP
 * estrita. Ele apenas injeta, DEPOIS da folha do `docx-preview`, um `<style>` com
 * overrides `!important` que:
 *   - neutralizam o wrapper cinza e o padding duplo;
 *   - trocam a largura física fixa da página por **fit-to-width** (reflui pra
 *     largura do preview, com `max-width` pra virar uma coluna de leitura) e
 *     removem a altura A4 fixa (documento curto não vira uma folha vazia gigante);
 *   - dão à página um visual de "folha" (sombra/raio) sobre um fundo neutro que
 *     ACOMPANHA o tema (claro/escuro) do app.
 * A página em si continua branca com texto preto (fidelidade — como o preview do
 * Word/Google Docs), só a moldura ao redor é que fica temática.
 *
 * Mora num módulo próprio, carregado por `React.lazy` no `preview-arquivo.tsx`,
 * espelhando o padrão do `UniverXlsxViewer` (#942). O HTML já chega sanitizado
 * (DOMPurify, em `docx-render.ts`).
 */
import { useTemaEscuro } from "@/lib/tema";

/** Cores da MOLDURA (não da página) por tema — a folha continua branca. */
const MOLDURA = {
  claro: { desk: "#f1f5f9", edge: "rgba(0,0,0,.15)" },
  escuro: { desk: "#0b1220", edge: "rgba(0,0,0,.55)" },
} as const;

/** Overrides de framing aplicados DEPOIS da folha do docx-preview (por isso os
 *  `!important`: a largura/altura físicas vêm como estilo INLINE na section). */
function estiloMoldura(escuro: boolean): string {
  const c = escuro ? MOLDURA.escuro : MOLDURA.claro;
  return `
  html,body{margin:0;padding:0;height:100%;background:${c.desk}}
  /* neutraliza o "desk" cinza fixo e o padding do wrapper do docx-preview */
  .docx-wrapper{background:transparent !important;padding:24px 16px !important;align-items:stretch !important}
  /* fit-to-width: mata a largura FÍSICA fixa (A4) que estourava o painel e a
     altura fixa da folha; a página reflui pra largura do preview, virando uma
     coluna de leitura centralizada com cara de folha. */
  .docx-wrapper>section.docx{
    width:100% !important;max-width:820px;min-height:0 !important;
    margin:0 auto 24px !important;box-sizing:border-box;
    padding:clamp(20px,5vw,56px) !important;
    background:#fff;border-radius:6px;
    box-shadow:0 1px 3px ${c.edge},0 8px 24px ${c.edge} !important;
  }
  section.docx{overflow:visible !important}
  /* fallback de fonte legível quando a fonte do docx (Calibri/Cambria) não
     existe na máquina — sem sobrepor as fontes que o documento especifica. */
  .docx{font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}
  .docx img{max-width:100%;height:auto}
  .docx table{max-width:100%}`;
}

export function DocxPreviewViewer({
  html,
  rotulo,
  vazioTexto,
}: {
  html: string;
  rotulo: string;
  vazioTexto: string;
}) {
  const escuro = useTemaEscuro();

  if (!html.trim()) {
    return (
      <div className="p-6 text-center text-xs text-muted-foreground">
        {vazioTexto}
      </div>
    );
  }

  // Mesma moldura de segurança do render legado: sandbox="" (inerte) + CSP
  // estrita. O `estiloMoldura` entra DEPOIS do `<style>` do docx-preview (que
  // veio embutido no `html`), então vence a cascata onde precisa.
  const srcDoc = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">
</head><body>${html}<style>${estiloMoldura(escuro)}</style></body></html>`;

  return (
    <iframe
      // sandbox="" continua o mais estrito possível: nenhum script do documento
      // roda. Só mudamos o CSS da moldura — a postura de segurança é a mesma.
      sandbox=""
      srcDoc={srcDoc}
      title={rotulo}
      className="min-h-0 w-full flex-1 border-0"
    />
  );
}
