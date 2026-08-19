// #1278: repro do leitor cortado (~120px) + tema escuro perdido. Precisa de
// NAVEGADOR REAL: a ponte de medicao roda DENTRO do iframe opaque-origin
// (SEC1 #1034) e conversa por postMessage — happy-dom nao executa isso.
// ⚠️ #1267: nada de `vi.mock(mod, async (importOriginal) => …)` aqui — pendura.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "vitest-browser-react";
import { IdiomaProvider } from "@/lib/idioma";

vi.mock("@/lib/api", { spy: true });

import { CorpoMensagem } from "./corpo-html";

// Corpo alto: se o iframe crescer ate o conteudo, passa MUITO de 120px.
const CORPO_ALTO =
  "<div>" +
  Array.from({ length: 60 }, (_, i) => `<p>linha ${i} do e-mail de teste</p>`).join("") +
  "</div>";

function iframeDoLeitor(): HTMLIFrameElement {
  const el = document.querySelector("iframe");
  if (!el) throw new Error("iframe do leitor nao encontrado");
  return el as HTMLIFrameElement;
}
const alturaDoIframe = () => iframeDoLeitor().getBoundingClientRect().height;

function montar() {
  render(
    <IdiomaProvider>
      <CorpoMensagem corpo={CORPO_ALTO} tipo="html" />
    </IdiomaProvider>,
  );
}

afterEach(() => {
  document.documentElement.classList.remove("dark");
});

// E-mail no estilo LinkedIn/newsletter: tabela com altura percentual. Isto
// resolve contra o VIEWPORT do iframe — que comeca em 120px.
const CORPO_TABELA_100 =
  '<table width="100%" height="100%" style="height:100%"><tr><td>' +
  Array.from({ length: 60 }, (_, i) => `<p>linha ${i}</p>`).join("") +
  "</td></tr></table>";

describe("#1278 leitor: altura do corpo", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("dark");
  });

  it("CLARO: o iframe cresce ate a altura do conteudo", async () => {
    montar();
    await vi.waitFor(() => expect(alturaDoIframe()).toBeGreaterThan(200), {
      timeout: 8000,
      interval: 250,
    });
  });

  it("TABELA height:100% (caso LinkedIn): o iframe cresce mesmo assim", async () => {
    render(
      <IdiomaProvider>
        <CorpoMensagem corpo={CORPO_TABELA_100} tipo="html" />
      </IdiomaProvider>,
    );
    await vi.waitFor(() => expect(alturaDoIframe()).toBeGreaterThan(200), {
      timeout: 8000,
      interval: 250,
    });
  });

  it("ESCURO: o iframe TAMBEM cresce (mesma ponte, mesmo piso)", async () => {
    document.documentElement.classList.add("dark");
    montar();
    await vi.waitFor(() => expect(alturaDoIframe()).toBeGreaterThan(200), {
      timeout: 8000,
      interval: 250,
    });
  });
});
