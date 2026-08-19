// #1321 — teste da JORNADA, não da composição que eu mesmo declaro.
//
// O outro arquivo (`atualizacao-notas.component.test.tsx`) monta um bloco
// equivalente ao do modal; ele prova o renderizador. ESTE monta o
// `<Atualizacao/>` DE VERDADE, com o feed mockado, e afirma sobre o DOM que o
// usuário vê. É a diferença que me custou o #1299 hoje: provar a peça não é
// provar o caminho.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

const NOTAS = [
  "## 🔔 Atualização do app",
  "- **O aviso só aparece** quando existe versão mais nova.",
  "",
  "## 🪟 Janela",
  ...Array.from({ length: 60 }, (_, i) => `- item longo número ${i}`),
].join("\n");

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: async () => ({ version: "9.9.9", date: "2026-08-19 06:11:36", body: NOTAS }),
}));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "0.46.0" }));
vi.mock("@/lib/telemetria", () => ({ telUpdateVerificado: vi.fn() }));
// Preserva o módulo real e troca SÓ o `openUrl` — mockar `@/lib/api` inteiro
// derruba o store (`agenda-slice` importa `crAgenda` daqui).
vi.mock("@/lib/api", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  openUrl: vi.fn(),
}));

import { Atualizacao } from "@/components/atualizacao";
import { IdiomaProvider } from "@/lib/idioma";

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
});
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

async function abrirModal() {
  const r = render(
    <IdiomaProvider>
      <Atualizacao />
    </IdiomaProvider>
  );
  // o efeito de boot resolve check()+getVersion() em microtasks
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return r;
}

describe("#1321 o modal REAL com o changelog real", () => {
  it("abre e mostra o bloco de notas", async () => {
    await abrirModal();
    expect(screen.getByText(/Atualização do app|app update/i)).toBeTruthy();
  });

  it("o teto de altura mira o VIEWPORT do ScrollArea (defeito da v0.46.0)", async () => {
    await abrirModal();
    // O AlertDialog vai pra um PORTAL: o conteúdo não está no `container` do
    // render, e sim no `document.body`.
    const root = document.body.querySelector('[data-slot="scroll-area"]');
    expect(root, "o modal precisa ter o scrollbox das notas").toBeTruthy();
    expect(root!.className).toContain("data-[slot=scroll-area-viewport]:max-h-40");
    // O bug era exatamente este: teto solto no Root, cujo viewport `size-full`
    // não tem altura resolvida para clipar.
    expect(root!.className).not.toMatch(/(^|\s)max-h-40(\s|$)/);
  });

  it("o Markdown do feed NÃO chega cru ao usuário", async () => {
    await abrirModal();
    const container = document.body;
    const texto = container.textContent ?? "";
    expect(texto).not.toContain("##");
    expect(texto).not.toContain("**");
    expect(container.querySelector("strong")?.textContent).toContain("O aviso só aparece");
    expect(container.querySelectorAll("li").length).toBeGreaterThan(60);
  });
});
