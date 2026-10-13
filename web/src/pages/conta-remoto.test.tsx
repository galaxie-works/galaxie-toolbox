// #1756 — a secção da `/conta` em que o membro limita o acesso remoto ao SEU device.
//
// O duplo de rede é uma BORDA COM ESTADO e com LATÊNCIA: o AC diz "aparece na
// lista após recarregar", e isso só se prova se a lista vier de quem guardou. A
// latência existe porque o duplo instantâneo já escondeu duas vezes o mesmo
// defeito (a releitura a desmontar o formulário e a região viva: #1752, #1472).
// As formas são as do §4.6 (`RestricaoDto` do `platform-http/src/remoto.rs`),
// tipadas com o tipo do cliente.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { ContaPage } from "./conta";
import { DICIONARIOS, type Idioma } from "@/i18n";
import type { RestricaoRemota } from "@/lib/api-me";
import type { CapacidadesRemotas } from "@/lib/remoto";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

const TODAS: CapacidadesRemotas = { screen: true, input: true, fileTransfer: true, clipboard: true, audio: true };
const SO_TELA: CapacidadesRemotas = { screen: true, input: false, fileTransfer: false, clipboard: false, audio: false };

type Pedido = { metodo: string; url: string; corpo: unknown };

function borda(opts: { restricoes?: RestricaoRemota[]; falharPut?: number } = {}) {
  const restricoes = structuredClone(opts.restricoes ?? []);
  const pedidos: Pedido[] = [];
  const chega = (r: Response) => new Promise<Response>((ok) => setTimeout(() => ok(r), 5));

  vi.stubGlobal("fetch", (entrada: string, init?: RequestInit) => {
    const url = String(entrada);
    const metodo = init?.method ?? "GET";
    const corpo: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
    pedidos.push({ metodo, url, corpo });

    if (url === "/api/v1/me") return chega(json({ nome: "Bia", email: "bia@acme.test", idioma: null }));
    if (url === "/api/v1/me/assinatura") return chega(json({ plano: "", status: "nenhuma" }));
    if (url === "/api/v1/me/dispositivos") return chega(json([]));
    if (url === "/api/v1/me/remoto/dispositivos") return chega(json(restricoes));
    const um = url.match(/^\/api\/v1\/me\/remoto\/dispositivos\/([^/]+)$/);
    if (um) {
      const id = decodeURIComponent(um[1]!);
      if (metodo === "PUT") {
        if (opts.falharPut) return chega(json({ erro: "x" }, opts.falharPut));
        const r: RestricaoRemota = { dispositivo_id: id, capacidades: (corpo as { capacidades: CapacidadesRemotas }).capacidades };
        const i = restricoes.findIndex((x) => x.dispositivo_id === id);
        if (i >= 0) restricoes[i] = r;
        else restricoes.push(r);
        return chega(json(r));
      }
      if (metodo === "DELETE") {
        const i = restricoes.findIndex((x) => x.dispositivo_id === id);
        if (i < 0) return chega(json({ erro: "nao_encontrado" }, 404));
        restricoes.splice(i, 1);
        return chega(new Response(null, { status: 204 }));
      }
    }
    return chega(json({ erro: "nao_encontrado" }, 404));
  });
  return { restricoes, pedidos };
}

function montar(idioma: Idioma = "pt-BR") {
  const router = createMemoryRouter(
    [
      { path: "/conta", element: <ContaPage idioma={idioma} /> },
      { path: "/login", element: <div>TELA DE LOGIN</div> },
    ],
    { initialEntries: ["/conta"] },
  );
  return render(<RouterProvider router={router} />);
}

/** A secção do Remote (por título), para não confundir com as outras da `/conta`. */
async function secao(idioma: Idioma = "pt-BR") {
  const titulo = await screen.findByText(DICIONARIOS[idioma].remotoMeTitulo);
  return titulo.closest("section") as HTMLElement;
}

const rotuloDe = (t: (typeof DICIONARIOS)["pt-BR"], id: string) => t.remotoDispositivo.replace("{id}", id);

describe("#1756 /conta — o membro limita o acesso remoto ao seu dispositivo", () => {
  it("AC1: mostra as restrições que já definiu, uma por device", async () => {
    borda({ restricoes: [{ dispositivo_id: "pc-bia", capacidades: SO_TELA }] });
    montar();
    const t = DICIONARIOS["pt-BR"];
    const s = await secao();
    const item = (await within(s).findByText(rotuloDe(t, "pc-bia"))).closest("li") as HTMLElement;
    expect(within(item).getByText(t.remotoCapacidade.screen)).toBeTruthy();
  });

  it("vazio diz que ainda não limitou nada (não é uma lista vazia muda)", async () => {
    borda();
    montar();
    expect(await screen.findByText(DICIONARIOS["pt-BR"].remotoMeVazio)).toBeTruthy();
  });

  it("AC2: ID + capacidades ⇒ PUT com o corpo do contrato, e a linha vem do SERVIDOR e persiste", async () => {
    const { pedidos } = borda();
    const u = userEvent.setup();
    montar();
    const t = DICIONARIOS["pt-BR"];
    const s = await secao();
    await within(s).findByText(t.remotoMeVazio);
    await u.type(within(s).getByRole("textbox", { name: t.remotoDeviceId }), "laptop:bia@1");
    // Parte de TUDO permitido; o membro desmarca o que quer proibir.
    await u.click(within(s).getByRole("checkbox", { name: t.remotoCapacidade.fileTransfer }));
    await u.click(within(s).getByRole("button", { name: t.remotoMeAdicionar }));

    const put = await waitFor(() => {
      const p = pedidos.find((x) => x.metodo === "PUT");
      expect(p).toBeTruthy();
      return p as Pedido;
    });
    // O id vai CODIFICADO no caminho (o `@` e o `:` são válidos no `remote-net`),
    // e o corpo leva as 5 capacidades, nem mais nem menos.
    expect(put.url).toBe("/api/v1/me/remoto/dispositivos/laptop%3Abia%401");
    expect(put.corpo).toEqual({ capacidades: { ...TODAS, fileTransfer: false } });

    const item = (await within(s).findByText(rotuloDe(t, "laptop:bia@1"))).closest("li") as HTMLElement;
    expect(within(item).queryByText(new RegExp(t.remotoCapacidade.fileTransfer))).toBeNull();
    // Recarregar a página: a linha volta porque está GUARDADA.
    cleanup();
    montar();
    expect(await within(await secao()).findByText(rotuloDe(t, "laptop:bia@1"))).toBeTruthy();
  });

  it("AC2: ID fora do formato ⇒ diz o que está errado e NÃO envia", async () => {
    const { pedidos } = borda();
    const u = userEvent.setup();
    montar();
    const t = DICIONARIOS["pt-BR"];
    const s = await secao();
    const campo = within(s).getByRole("textbox", { name: t.remotoDeviceId });
    await u.type(campo, "pc bia");
    expect(within(s).getByText(t.remotoDeviceIdInvalido)).toBeTruthy();
    expect(campo.getAttribute("aria-invalid")).toBe("true");
    const botao = within(s).getByRole("button", { name: t.remotoMeAdicionar }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    await u.click(botao);
    expect(pedidos.some((p) => p.metodo === "PUT")).toBe(false);
  });

  it("AC3: explica que SÓ reduz, e não pede nada da org (o membro não vê o teto)", async () => {
    const { pedidos } = borda();
    montar();
    const t = DICIONARIOS["pt-BR"];
    const s = await secao();
    expect(within(s).getByText(t.remotoMeExplica)).toBeTruthy();
    await within(s).findByText(t.remotoMeVazio);
    expect(pedidos.some((p) => p.url.includes("/orgs/"))).toBe(false);
  });

  it("AC4: remover ⇒ DELETE e a linha some (o device volta ao que a org permite)", async () => {
    const { pedidos } = borda({ restricoes: [{ dispositivo_id: "pc-bia", capacidades: SO_TELA }] });
    const u = userEvent.setup();
    montar();
    const t = DICIONARIOS["pt-BR"];
    const s = await secao();
    await within(s).findByText(rotuloDe(t, "pc-bia"));
    await u.click(within(s).getByRole("button", { name: t.remotoMeRemover }));
    expect(await within(s).findByText(t.remotoMeVazio)).toBeTruthy();
    expect(pedidos.some((p) => p.metodo === "DELETE" && p.url === "/api/v1/me/remoto/dispositivos/pc-bia")).toBe(true);
  });

  it("AC5: o aviso 'salvo, ainda não aplicado' está visível na secção", async () => {
    borda();
    montar();
    const t = DICIONARIOS["pt-BR"];
    const s = await secao();
    expect(within(s).getByRole("status", { name: t.remotoNaoAplicado })).toBeTruthy();
  });

  it("o resultado chega à MESMA região, vazia desde o início, e sobrevive à releitura", async () => {
    const { pedidos } = borda();
    const u = userEvent.setup();
    montar();
    const t = DICIONARIOS["pt-BR"];
    const s = await secao();
    await within(s).findByText(t.remotoMeVazio);
    const antes = within(s).getByRole("status", { name: t.resultadoSalvar });
    expect(antes.textContent).toBe("");
    await u.type(within(s).getByRole("textbox", { name: t.remotoDeviceId }), "pc-bia");
    await u.click(within(s).getByRole("button", { name: t.remotoMeAdicionar }));
    // Espera a releitura que se segue à escrita TERMINAR e assentar.
    await waitFor(() =>
      expect(pedidos.filter((p) => p.metodo === "GET" && p.url === "/api/v1/me/remoto/dispositivos").length).toBe(2),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(within(s).getByRole("status", { name: t.resultadoSalvar })).toBe(antes);
    expect(antes.textContent).toBe(t.salvo);
  });

  it("recusa (ex.: 64 devices, `409`) ⇒ a falha aparece e o que o membro escreveu FICA", async () => {
    borda({ falharPut: 409 });
    const u = userEvent.setup();
    montar();
    const t = DICIONARIOS["pt-BR"];
    const s = await secao();
    await within(s).findByText(t.remotoMeVazio);
    await u.type(within(s).getByRole("textbox", { name: t.remotoDeviceId }), "pc-bia");
    await u.click(within(s).getByRole("button", { name: t.remotoMeAdicionar }));
    const regiao = within(s).getByRole("status", { name: t.resultadoSalvar });
    await waitFor(() => expect(regiao.textContent).toBe(t.remotoFalhou));
    await new Promise((r) => setTimeout(r, 20));
    expect((within(s).getByRole("textbox", { name: t.remotoDeviceId }) as HTMLInputElement).value).toBe("pc-bia");
  });

  it("401 a meio (sessão morta) ⇒ login", async () => {
    borda({ falharPut: 401 });
    const u = userEvent.setup();
    montar();
    const t = DICIONARIOS["pt-BR"];
    const s = await secao();
    await within(s).findByText(t.remotoMeVazio);
    await u.type(within(s).getByRole("textbox", { name: t.remotoDeviceId }), "pc-bia");
    await u.click(within(s).getByRole("button", { name: t.remotoMeAdicionar }));
    expect(await screen.findByText("TELA DE LOGIN")).toBeTruthy();
  });
});

describe("#1756 AC6 — i18n: a secção não mistura idiomas", () => {
  function copy(idioma: Idioma): string[] {
    const d = DICIONARIOS[idioma];
    return [
      d.remotoMeTitulo, d.remotoMeExplica, d.remotoMeAdicionar, d.remotoMeRemover, d.remotoMeVazio,
      d.remotoNaoAplicado, d.remotoDeviceId, d.remotoDeviceIdInvalido, d.remotoAcesso, d.salvo, d.resultadoSalvar,
      ...Object.values(d.remotoCapacidade), d.remotoDispositivo.replace("{id}", "").trim(),
    ];
  }

  it.each([
    ["pt-BR", "en"],
    ["en", "pt-BR"],
  ] as const)("em %s, nada da copy de %s (texto e aria-labels)", async (idioma, outro) => {
    borda({ restricoes: [{ dispositivo_id: "pc-x", capacidades: TODAS }] });
    const u = userEvent.setup();
    montar(idioma);
    const t = DICIONARIOS[idioma];
    const s = await secao(idioma);
    await within(s).findByText(rotuloDe(t, "pc-x"));
    // Abre o que só aparece por interação: o erro de ID e o "Salvo".
    await u.type(within(s).getByRole("textbox", { name: t.remotoDeviceId }), "a b");
    const meu = new Set(copy(idioma));
    const alheias = copy(outro).filter((x) => x.length > 0 && !meu.has(x));
    expect(alheias.length).toBeGreaterThan(8); // anti-vazio
    const visivel = [
      s.textContent ?? "",
      ...[...s.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label") ?? ""),
    ].join("\n");
    for (const x of alheias) expect(visivel, `"${x}" (${outro}) em ${idioma}`).not.toContain(x);
    expect(visivel).toContain(t.remotoMeExplica);
    expect(visivel).toContain(t.remotoDeviceIdInvalido);
  });
});
