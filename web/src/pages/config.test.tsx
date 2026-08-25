// #1491 — a UI de config é DATA-DRIVEN: renderiza só as chaves que o BE devolve
// (a allowlist do #1471), por tipo; salva só o que foi tocado; 401 → login.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { ConfigPage } from "./config";
import { DICIONARIOS, type Idioma } from "@/i18n";
import * as api from "@/lib/api-config";
import { ErroApi } from "@/lib/http";

vi.mock("@/lib/api-config", () => ({
  obterConfig: vi.fn(),
  salvarConfig: vi.fn(),
}));

const ALLOWLIST: api.ItemConfig[] = [
  { chave: "notificacoes", valor: true, tipo: "bool", rotulo: { "pt-BR": "Notificações", en: "Notifications" } },
  { chave: "tema", valor: "claro", tipo: "opcao", opcoes: ["claro", "escuro"] },
  { chave: "apelido", valor: "Ana", tipo: "texto" },
];

function montar(idioma: Idioma) {
  const router = createMemoryRouter(
    [
      { path: "/config", element: <ConfigPage idioma={idioma} /> },
      { path: "/login", element: <div>TELA DE LOGIN</div> },
    ],
    { initialEntries: ["/config"] },
  );
  return render(<RouterProvider router={router} />);
}

beforeEach(() => {
  vi.mocked(api.obterConfig).mockResolvedValue(ALLOWLIST.map((i) => ({ ...i })));
  vi.mocked(api.salvarConfig).mockResolvedValue(ALLOWLIST.map((i) => ({ ...i })));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("#1491 ConfigPage", () => {
  it("renderiza SÓ as chaves da allowlist do BE, cada uma pelo seu tipo", async () => {
    montar("pt-BR");
    // bool → checkbox
    expect(await screen.findByRole("checkbox")).toBeTruthy();
    // opcao → combobox (select) com as opções
    expect(screen.getByRole("combobox")).toBeTruthy();
    // texto → textbox com o valor atual
    expect(screen.getByDisplayValue("Ana")).toBeTruthy();
    // exatamente 3 controles — a UI não inventa chave fora do que o BE devolveu
    expect(screen.getByText("Notificações")).toBeTruthy();
  });

  it("salvar manda SÓ a chave tocada (patch), não a allowlist inteira", async () => {
    const u = userEvent.setup();
    montar("pt-BR");
    await u.click(await screen.findByRole("checkbox")); // toca 'notificacoes' → false
    await u.click(screen.getByRole("button", { name: DICIONARIOS["pt-BR"].salvar }));
    await waitFor(() => expect(api.salvarConfig).toHaveBeenCalledWith({ notificacoes: false }));
  });

  it("botão salvar fica desabilitado sem edição (nada a mandar)", async () => {
    montar("pt-BR");
    const botao = await screen.findByRole("button", { name: DICIONARIOS["pt-BR"].salvar });
    expect((botao as HTMLButtonElement).disabled).toBe(true);
  });

  it("allowlist vazia → 'Nada para configurar' (a web não inventa chave)", async () => {
    vi.mocked(api.obterConfig).mockResolvedValue([]);
    montar("pt-BR");
    expect(await screen.findByText(DICIONARIOS["pt-BR"].semConfig)).toBeTruthy();
  });

  it("401 → redireciona pro login", async () => {
    vi.mocked(api.obterConfig).mockRejectedValue(new ErroApi(401));
    montar("pt-BR");
    expect(await screen.findByText("TELA DE LOGIN")).toBeTruthy();
  });

  it("i18n en", async () => {
    montar("en");
    expect(await screen.findByRole("heading", { name: DICIONARIOS.en.configuracoes })).toBeTruthy();
  });
});
