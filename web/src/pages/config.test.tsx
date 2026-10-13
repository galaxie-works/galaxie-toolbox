// #1491 — a UI de config é DATA-DRIVEN: renderiza só as chaves que o BE devolve
// (a allowlist do #1471), por tipo; salva só o que foi tocado; 401 → login.
//
// #1749 (achado da @Íris): este teste passava com um mock que INVENTAVA um campo
// `rotulo` que o BE nunca manda — e a tela real mostrava `app.tema` cru. Agora o
// fixture é o formato REAL do `GET /api/v1/me/config` (dev-server, pre-prod
// `89e37dfb`), e o tipo `ItemConfig` já não declara `rotulo`: um mock que o
// reinvente é erro de `tsc` (propriedade em excesso), não um teste verde.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { ConfigPage } from "./config";
import { DICIONARIOS, type Idioma } from "@/i18n";
import { rotuloDaChave, rotuloDaOpcao } from "@/lib/rotulos-config";
import * as api from "@/lib/api-config";
import { ErroApi } from "@/lib/http";

vi.mock("@/lib/api-config", () => ({
  obterConfig: vi.fn(),
  salvarConfig: vi.fn(),
}));

/** A resposta REAL do BE (medida pela Íris no #1749): sem `rotulo`. */
const RESPOSTA_REAL: api.ItemConfig[] = [
  { chave: "app.tema", tipo: "opcao", opcoes: ["claro", "escuro", "sistema"], valor: "escuro" },
  { chave: "app.notificacoes", tipo: "bool", valor: true },
];
/** + uma chave que o FE ainda não conhece, e do tipo `texto` (o 3.º controle). */
const COM_DESCONHECIDA: api.ItemConfig[] = [
  ...RESPOSTA_REAL,
  { chave: "app.apelido", tipo: "texto", valor: "Ana" },
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
  vi.mocked(api.obterConfig).mockResolvedValue(COM_DESCONHECIDA.map((i) => ({ ...i })));
  vi.mocked(api.salvarConfig).mockResolvedValue({ ok: [], falhas: [] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("#1491 ConfigPage", () => {
  it("renderiza SÓ as chaves da allowlist do BE, cada uma pelo seu tipo", async () => {
    montar("pt-BR");
    expect(await screen.findByRole("checkbox")).toBeTruthy(); // bool
    expect(screen.getByRole("combobox")).toBeTruthy(); // opcao
    expect(screen.getByDisplayValue("Ana")).toBeTruthy(); // texto
    expect(screen.getAllByRole("checkbox")).toHaveLength(1); // a UI não inventa chave
  });

  it("salvar manda SÓ a chave tocada (patch), não a allowlist inteira", async () => {
    const u = userEvent.setup();
    montar("pt-BR");
    await u.click(await screen.findByRole("checkbox")); // toca 'app.notificacoes' → false
    await u.click(screen.getByRole("button", { name: DICIONARIOS["pt-BR"].salvar }));
    await waitFor(() => expect(api.salvarConfig).toHaveBeenCalledWith({ "app.notificacoes": false }));
  });

  it("save OK (todas gravadas) → mostra 'Salvo'", async () => {
    vi.mocked(api.salvarConfig).mockResolvedValue({ ok: ["app.notificacoes"], falhas: [] });
    const u = userEvent.setup();
    montar("pt-BR");
    const t = DICIONARIOS["pt-BR"];
    await u.click(await screen.findByRole("checkbox"));
    // #1752 (pedido da @Íris): a região viva existe ANTES do 1.º Salvar, vazia.
    // Uma região que nasce já com o texto é anunciada de forma inconsistente.
    const antes = screen.getByRole("status", { name: t.resultadoSalvar });
    expect(antes.textContent).toBe("");
    await u.click(screen.getByRole("button", { name: t.salvar }));
    await waitFor(() => expect(antes.textContent).toBe(t.salvo));
    // …e é o MESMO nó depois: só o conteúdo mudou.
    expect(screen.getByRole("status", { name: t.resultadoSalvar })).toBe(antes);
  });

  it("save PARCIAL → reporta POR CHAVE pelo RÓTULO (nunca a chave crua), e nunca 'Salvo' global (#1588)", async () => {
    vi.mocked(api.salvarConfig).mockResolvedValue({
      ok: [],
      falhas: [{ chave: "app.notificacoes", status: 400 }],
    });
    const u = userEvent.setup();
    const { container } = montar("pt-BR");
    await u.click(await screen.findByRole("checkbox"));
    await u.click(screen.getByRole("button", { name: DICIONARIOS["pt-BR"].salvar }));
    const t = DICIONARIOS["pt-BR"];
    expect(await screen.findByText(`${t.naoGuardado}: ${t.configChave["app.notificacoes"]}`)).toBeTruthy();
    expect(container.textContent).not.toContain("app.notificacoes");
    expect(screen.queryByText(t.salvo)).toBeNull();
    // #1752: a falha também é anunciada, na mesma região de nome estável…
    const regiao = screen.getByRole("status", { name: t.resultadoSalvar });
    expect(regiao.textContent).toBe("Não salvo: Notificações");
    // …e em pt-BR. "Não guardado" era pt-PT; o literal acima amarra a copy, não o dicionário.
    expect(container.textContent).not.toMatch(/guardado/i);
  });

  it("#1752 en: a falha é anunciada em inglês, com o nome da região em inglês", async () => {
    vi.mocked(api.salvarConfig).mockResolvedValue({
      ok: [],
      falhas: [{ chave: "app.notificacoes", status: 400 }],
    });
    const u = userEvent.setup();
    montar("en");
    await u.click(await screen.findByRole("checkbox"));
    await u.click(screen.getByRole("button", { name: DICIONARIOS.en.salvar }));
    // Literais: amarram a copy do card, não o que o dicionário disser.
    const regiao = await screen.findByRole("status", { name: "Save result" });
    expect(regiao.textContent).toBe("Not saved: Notifications");
  });

  it("401 durante o SAVE (sessão morta a meio) → redireciona pro login", async () => {
    vi.mocked(api.salvarConfig).mockRejectedValue(new ErroApi(401));
    const u = userEvent.setup();
    montar("pt-BR");
    await u.click(await screen.findByRole("checkbox"));
    await u.click(screen.getByRole("button", { name: DICIONARIOS["pt-BR"].salvar }));
    expect(await screen.findByText("TELA DE LOGIN")).toBeTruthy();
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
});

describe("#1749 — rótulos da config vêm do dicionário (contra o formato REAL do BE)", () => {
  it("pt-BR: Tema / Claro·Escuro·Sistema / Notificações, e NENHUMA chave `app.*` no DOM", async () => {
    vi.mocked(api.obterConfig).mockResolvedValue(RESPOSTA_REAL.map((i) => ({ ...i })));
    const { container } = montar("pt-BR");
    const select = await screen.findByRole("combobox");
    expect(screen.getByText("Tema")).toBeTruthy();
    expect(screen.getByText("Notificações")).toBeTruthy();
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Claro", "Escuro", "Sistema"]);
    expect(container.textContent).not.toMatch(/app\./);
  });

  it("en: Theme / Light·Dark·System / Notifications, e nenhum valor de opção em português", async () => {
    vi.mocked(api.obterConfig).mockResolvedValue(RESPOSTA_REAL.map((i) => ({ ...i })));
    const { container } = montar("en");
    const select = await screen.findByRole("combobox");
    expect(screen.getByText("Theme")).toBeTruthy();
    expect(screen.getByText("Notifications")).toBeTruthy();
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Light", "Dark", "System"]);
    expect(container.textContent).not.toMatch(/Claro|Escuro|Sistema|app\./);
  });

  it("o rótulo é só o que se MOSTRA: o valor que vai pro BE continua o dado cru", async () => {
    vi.mocked(api.obterConfig).mockResolvedValue(RESPOSTA_REAL.map((i) => ({ ...i })));
    const u = userEvent.setup();
    montar("en");
    const select = (await screen.findByRole("combobox")) as HTMLSelectElement;
    expect(select.value).toBe("escuro"); // o valor real, não "Dark"
    await u.selectOptions(select, "Light");
    await u.click(screen.getByRole("button", { name: DICIONARIOS.en.salvar }));
    await waitFor(() => expect(api.salvarConfig).toHaveBeenCalledWith({ "app.tema": "claro" }));
  });

  it.each([
    ["pt-BR", "Preferência"],
    ["en", "Preference"],
  ] as const)("chave que o FE não conhece → o fallback, nunca a chave crua (%s)", async (idioma, literal) => {
    const { container } = montar(idioma); // beforeEach: inclui `app.apelido`
    // O LITERAL, não `DICIONARIOS[idioma].configChaveDesconhecida`: lendo o próprio
    // dicionário, um "Preference" que regredisse para "Preferência" no `en`
    // passava verde (achado da @Lúmen no gate do #1749, mutante R8).
    expect(await screen.findByText(literal)).toBeTruthy();
    expect(container.textContent).not.toContain("app.apelido");
  });

  it("uma chave do servidor nunca alcança o protótipo do dicionário", () => {
    const t = DICIONARIOS["pt-BR"];
    for (const chave of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(rotuloDaChave(t, chave)).toBe(t.configChaveDesconhecida);
    }
    expect(rotuloDaOpcao(t, "constructor")).toBe("constructor"); // dado cru, não uma função
  });
});
