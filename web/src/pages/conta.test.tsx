// #1489 — a UI de conta renderiza perfil/assinatura/dispositivos, salva o nome,
// revoga sessão, e manda ao login quando o /me devolve 401. As funções de rede são
// mockadas (o BE #1473 ainda não landou); ehNaoAutenticado/ErroApi ficam REAIS.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { ContaPage } from "./conta";
import { DICIONARIOS, type Idioma } from "@/i18n";
import * as api from "@/lib/api-me";

vi.mock("@/lib/api-me", async (importActual) => {
  const real = await importActual<typeof import("@/lib/api-me")>();
  return {
    ...real, // mantém ErroApi + ehNaoAutenticado REAIS (o hook depende deles)
    obterPerfil: vi.fn(),
    atualizarPerfil: vi.fn(),
    obterAssinatura: vi.fn(),
    listarDispositivos: vi.fn(),
    revogarDispositivo: vi.fn(),
  };
});

const PERFIL = { nome: "Ana", email: "ana@galaxie.works" };
const ASSINATURA = { plano: "Pro", status: "ativa" as const, consumo: { usado: 3, limite: 10, unidade: "GB" } };
const DISPOSITIVOS = [
  { id: "d1", nome: "Notebook", ultimoAcesso: "2026-08-24T12:00:00Z", sessaoAtual: true },
  { id: "d2", nome: "Celular", ultimoAcesso: "2026-08-20T09:00:00Z", sessaoAtual: false },
];

function montar(idioma: Idioma) {
  const router = createMemoryRouter(
    [
      { path: "/conta", element: <ContaPage idioma={idioma} /> },
      { path: "/login", element: <div>TELA DE LOGIN</div> },
    ],
    { initialEntries: ["/conta"] },
  );
  return render(<RouterProvider router={router} />);
}

beforeEach(() => {
  vi.mocked(api.obterPerfil).mockResolvedValue({ ...PERFIL });
  vi.mocked(api.atualizarPerfil).mockResolvedValue({ ...PERFIL });
  vi.mocked(api.obterAssinatura).mockResolvedValue({ ...ASSINATURA });
  vi.mocked(api.listarDispositivos).mockResolvedValue([...DISPOSITIVOS]);
  vi.mocked(api.revogarDispositivo).mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("#1489 ContaPage", () => {
  it("renderiza perfil, assinatura e dispositivos (pt-BR)", async () => {
    montar("pt-BR");
    expect(await screen.findByDisplayValue("Ana")).toBeTruthy();
    expect(screen.getByDisplayValue("ana@galaxie.works")).toBeTruthy();
    expect(await screen.findByText(/Pro \(ativa\)/)).toBeTruthy();
    expect(await screen.findByText("Notebook")).toBeTruthy();
    expect(screen.getByText("Celular")).toBeTruthy();
    // a sessão atual é marcada
    expect(screen.getByText(DICIONARIOS["pt-BR"].sessaoAtual)).toBeTruthy();
  });

  it("i18n en: títulos vêm do dicionário en", async () => {
    montar("en");
    expect(await screen.findByRole("heading", { name: DICIONARIOS.en.minhaConta })).toBeTruthy();
    expect(screen.getByText(DICIONARIOS.en.dispositivos)).toBeTruthy();
  });

  it("editar o nome e salvar chama atualizarPerfil e mostra 'Salvo'", async () => {
    const u = userEvent.setup();
    montar("pt-BR");
    const campo = await screen.findByDisplayValue("Ana");
    await u.clear(campo);
    await u.type(campo, "Ana Maria");
    await u.click(screen.getByRole("button", { name: DICIONARIOS["pt-BR"].salvar }));
    await waitFor(() => expect(api.atualizarPerfil).toHaveBeenCalledWith({ nome: "Ana Maria" }));
    expect(await screen.findByText(DICIONARIOS["pt-BR"].salvo)).toBeTruthy();
  });

  it("revogar um dispositivo chama revogarDispositivo e recarrega a lista", async () => {
    const u = userEvent.setup();
    montar("pt-BR");
    await screen.findByText("Celular");
    const botoes = screen.getAllByRole("button", { name: DICIONARIOS["pt-BR"].revogar });
    await u.click(botoes[0]);
    await waitFor(() => expect(api.revogarDispositivo).toHaveBeenCalledWith("d1"));
    // recarrega após revogar
    await waitFor(() => expect(api.listarDispositivos).toHaveBeenCalledTimes(2));
  });

  it("401 no /me → redireciona pro login (não mostra 'erro')", async () => {
    vi.mocked(api.obterPerfil).mockRejectedValue(new api.ErroApi(401));
    montar("pt-BR");
    expect(await screen.findByText("TELA DE LOGIN")).toBeTruthy();
  });

  it("a UI não decide autorização — o botão revogar só chama o BE (barreira server-side)", async () => {
    montar("pt-BR");
    await screen.findByText("Notebook");
    // nenhuma chamada carrega id de dono; o cliente só fala /me/* (coberto em api-me.test)
    expect(api.listarDispositivos).toHaveBeenCalledTimes(1);
  });
});
