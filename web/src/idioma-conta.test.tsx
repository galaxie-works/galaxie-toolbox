// #1732 — a UI honra o idioma da CONTA (`/me.idioma`) em vez do navegador.
// Precedência: conta > navegador > pt-BR. Trava (1) a regra pura, (2) o provider
// (troca pro idioma da conta, ignora 401, acompanha o `<html lang>`), e (3) o
// CAMINHO DE PRODUÇÃO: o `App` real, browser em inglês e conta pt-BR, mostra o
// `/conta` em pt-BR — prova que o provider está fiado E que a página o consome
// (um teste só do provider não pega uma página que continue a ler o navegador).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { DICIONARIOS, idiomaDaConta, resolverIdioma, type Idioma } from "@/i18n";
import { IdiomaProvider } from "@/components/idioma-provider";
import { useIdiomaAtivo } from "@/idioma-contexto";
import { App } from "@/App";
import * as api from "@/lib/api-me";

vi.mock("@/lib/api-me", async (importActual) => {
  const real = await importActual<typeof import("@/lib/api-me")>();
  return {
    ...real, // ErroApi + ehNaoAutenticado REAIS
    obterPerfil: vi.fn(),
    atualizarPerfil: vi.fn(),
    obterAssinatura: vi.fn(),
    listarDispositivos: vi.fn(),
    revogarDispositivo: vi.fn(),
  };
});

const PERFIL_PT = { nome: "Ana", email: "ana@galaxie.works", idioma: "pt-BR" };

beforeEach(() => {
  vi.spyOn(window.navigator, "language", "get").mockReturnValue("en-US");
});
afterEach(() => {
  cleanup();
  vi.mocked(api.obterPerfil).mockReset();
  vi.restoreAllMocks();
  document.documentElement.lang = "";
});

describe("#1732 — regra pura: conta > navegador > pt-BR", () => {
  it.each([
    ["pt-BR", "en-US", "pt-BR"], // conta vence o navegador
    ["en", "pt-BR", "en"],
    ["EN-gb", "pt-BR", "en"], // tag com região / caixa
    ["pt", "en-US", "pt-BR"],
    [null, "en-GB", "en"], // sem conta → navegador
    [undefined, "pt-PT", "pt-BR"],
    ["fr-FR", "en-US", "en"], // conta fora do suportado → navegador
    [null, "fr", "pt-BR"], // nada suportado → pt-BR
    ["  ", "en", "en"], // vazio não conta como preferência
  ] as const)("resolverIdioma(%j, %j) === %j", (conta, nav, esperado) => {
    expect(resolverIdioma(conta, nav)).toBe(esperado);
  });

  it("idiomaDaConta não inventa idioma pro que a UI não fala", () => {
    expect(idiomaDaConta("es")).toBeNull();
    expect(idiomaDaConta("portuguese")).toBeNull(); // só a tag, não o nome
    expect(idiomaDaConta(null)).toBeNull();
  });
});

function Rotulo({ idioma }: { idioma?: Idioma }) {
  const ativo = useIdiomaAtivo(idioma);
  return <h1>{DICIONARIOS[ativo].minhaConta}</h1>;
}

describe("#1732 — IdiomaProvider", () => {
  it("com sessão: troca pro idioma da conta, mesmo com o navegador em inglês", async () => {
    vi.mocked(api.obterPerfil).mockResolvedValue(PERFIL_PT);
    render(
      <IdiomaProvider>
        <Rotulo />
      </IdiomaProvider>,
    );
    expect(await screen.findByText(DICIONARIOS["pt-BR"].minhaConta)).toBeTruthy();
    // O `<html lang>` é escrito num efeito à parte, DEPOIS do commit que pinta o texto:
    // sob carga (CI) o findByText resolve antes. Espera-se a escrita, não se assume a ordem.
    await waitFor(() => expect(document.documentElement.lang).toBe("pt-BR")); // AC3
  });

  it("sem sessão (401, ex.: /login): fica no navegador e não quebra", async () => {
    vi.mocked(api.obterPerfil).mockRejectedValue(new api.ErroApi(401));
    render(
      <IdiomaProvider>
        <Rotulo />
      </IdiomaProvider>,
    );
    await waitFor(() => expect(api.obterPerfil).toHaveBeenCalled());
    expect(screen.getByText(DICIONARIOS.en.minhaConta)).toBeTruthy();
    await waitFor(() => expect(document.documentElement.lang).toBe("en"));
  });

  it("o idioma explícito por prop vence o da conta", async () => {
    vi.mocked(api.obterPerfil).mockResolvedValue(PERFIL_PT);
    render(
      <IdiomaProvider>
        <Rotulo idioma="en" />
      </IdiomaProvider>,
    );
    await waitFor(() => expect(document.documentElement.lang).toBe("pt-BR"));
    expect(screen.getByText(DICIONARIOS.en.minhaConta)).toBeTruthy();
  });
});

describe("#1732 — caminho de produção (App real)", () => {
  it("browser em inglês + conta pt-BR → o /conta sai em pt-BR", async () => {
    vi.mocked(api.obterPerfil).mockResolvedValue(PERFIL_PT);
    vi.mocked(api.obterAssinatura).mockReturnValue(new Promise(() => {}));
    vi.mocked(api.listarDispositivos).mockReturnValue(new Promise(() => {}));
    render(<App />); // `/` → RaizPage → /conta
    expect(await screen.findByText(DICIONARIOS["pt-BR"].minhaConta)).toBeTruthy();
    expect(screen.queryByText(DICIONARIOS.en.minhaConta)).toBeNull();
  });
});
