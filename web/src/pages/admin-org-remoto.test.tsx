// #1472 — painel do Remote no admin da org, contra o §4.6 do contrato.
//
// O duplo de rede aqui é uma BORDA COM ESTADO, não um `fetch` que devolve sempre
// o mesmo corpo: o AC1 diz "aparece na lista E persiste após recarregar", e isso
// só se prova se a lista vier de quem guardou, não de quem clicou. As formas são
// as medidas no `platform-http/src/remoto.rs` (DTOs) e tipadas com os tipos do
// `lib/remoto.ts`: se a forma do cliente divergir da que o duplo devolve, o
// `tsc` reprova antes do teste rodar.
//
// O que estes testes NÃO provam: a autz do servidor (member ⇒ 403, org alheia ⇒
// 404, suspensão). Isso vive nos testes `remoto_*` do `router.rs`; aqui mede-se
// a REAÇÃO da tela a cada resposta.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminOrgPage } from "./admin-org";
import { DICIONARIOS, type Idioma } from "@/i18n";
import {
  CAPACIDADES,
  type CapacidadesRemotas,
  type ConcessaoRemota,
  type PoliticaRemota,
} from "@/lib/remoto";
import type { Membro } from "@/lib/org";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
const vazio = (status: number) => new Response(null, { status });

const MEMBROS: Membro[] = [
  { uid: "dev-user", nome: "Ana Souza", email: "ana@acme.test", papel: "org_admin" },
  { uid: "membro-2", nome: "Bia Lima", email: "bia@acme.test", papel: "member" },
];

const TODAS: CapacidadesRemotas = { screen: true, input: true, fileTransfer: true, clipboard: true, audio: true };

/** O default do §4.6: nunca gravado ⇒ as 5 a `true`, `clique`, `false`. */
const POLITICA_DEFAULT: PoliticaRemota = {
  capacidades_maximas: TODAS,
  modo_aprovacao: "clique",
  permitir_nao_supervisionado: false,
};

type Pedido = { metodo: string; url: string; corpo: unknown };

/**
 * Uma borda em memória com as regras medidas do §4.6:
 * - `negar`: toda rota da org responde `403 {erro}` (o `member`, ou a suspensão total);
 * - `suspensa`: política e conceder ⇒ `403 org_suspensa`; listar e revogar ATRAVESSAM;
 * - `falharPost`: o `POST` responde este status (para as recusas).
 */
function borda(
  opts: { negar?: string; suspensa?: boolean; falharPost?: number; erroPost?: string; concessoes?: ConcessaoRemota[] } = {},
) {
  const estado = {
    politica: structuredClone(POLITICA_DEFAULT),
    concessoes: structuredClone(opts.concessoes ?? []),
    seq: opts.concessoes?.length ?? 0,
  };
  const pedidos: Pedido[] = [];
  const suspensa = () => json({ erro: "org_suspensa" }, 403);

  vi.stubGlobal("fetch", (entrada: string, init?: RequestInit) => {
    const url = String(entrada);
    const metodo = init?.method ?? "GET";
    const corpo: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
    pedidos.push({ metodo, url, corpo });

    if (opts.negar) return Promise.resolve(json({ erro: opts.negar }, 403));

    if (url === "/api/v1/orgs/acme/membros") {
      return Promise.resolve(opts.suspensa ? suspensa() : json(MEMBROS));
    }
    if (url === "/api/v1/orgs/acme/remoto/politica") {
      if (opts.suspensa) return Promise.resolve(suspensa());
      if (metodo === "PUT") estado.politica = corpo as PoliticaRemota;
      return Promise.resolve(json(estado.politica));
    }
    if (url === "/api/v1/orgs/acme/remoto/concessoes") {
      if (metodo === "GET") return Promise.resolve(json(estado.concessoes));
      if (opts.suspensa) return Promise.resolve(suspensa());
      if (opts.falharPost) return Promise.resolve(json({ erro: opts.erroPost ?? "x" }, opts.falharPost));
      const novo = corpo as Pick<ConcessaoRemota, "sujeito" | "objeto" | "capacidades">;
      const c: ConcessaoRemota = {
        id: `cr-${++estado.seq}`,
        ...novo,
        concedida_por: "dev-user",
        concedida_em: 1_700_000_000,
        revogada_em: null,
        ativa: true,
      };
      estado.concessoes.push(c);
      return Promise.resolve(json(c, 201));
    }
    const revogar = url.match(/^\/api\/v1\/orgs\/acme\/remoto\/concessoes\/([^/]+)$/);
    if (revogar && metodo === "DELETE") {
      const c = estado.concessoes.find((x) => x.id === revogar[1]);
      if (!c) return Promise.resolve(json({ erro: "nao_encontrado" }, 404));
      c.revogada_em ??= 1_700_000_100;
      c.ativa = false;
      return Promise.resolve(vazio(204));
    }
    return Promise.resolve(json({ erro: "nao_encontrado" }, 404));
  });
  return { estado, pedidos };
}

const ativa = (id: string, uid: string, dispositivo: string, capacidades: CapacidadesRemotas): ConcessaoRemota => ({
  id,
  sujeito: { tipo: "utilizador", uid },
  objeto: { tipo: "dispositivo", id: dispositivo },
  capacidades,
  concedida_por: "dev-user",
  concedida_em: 1_700_000_000,
  revogada_em: null,
  ativa: true,
});

async function abrirRemoto(idioma: Idioma = "pt-BR") {
  const u = userEvent.setup();
  render(<AdminOrgPage idioma={idioma} org="acme" />);
  await u.click(screen.getByRole("button", { name: DICIONARIOS[idioma].remoto }));
  return u;
}

describe("#1472 painel do Remote", () => {
  it("AC4: o aviso 'salvo, ainda não aplicado' está visível com o painel", async () => {
    borda();
    await abrirRemoto();
    const t = DICIONARIOS["pt-BR"];
    // Região viva NOMEADA (o `Alerta` exige-o): distinguível de outra faixa na página.
    expect(await screen.findByRole("status", { name: t.remotoNaoAplicado })).toBeTruthy();
    // Visível COM as duas áreas que configuram acesso, não em vez delas.
    expect(screen.getByText(t.remotoConcessoes)).toBeTruthy();
    expect(await screen.findByText(t.remotoTeto)).toBeTruthy();
  });

  it("AC1: concede com o atalho 'Só ver' ⇒ aparece na lista, e o que saiu é o corpo do contrato", async () => {
    const { pedidos } = borda();
    const u = await abrirRemoto();
    const t = DICIONARIOS["pt-BR"];

    await u.selectOptions(await screen.findByRole("combobox", { name: t.remotoMembro }), "membro-2");
    await u.type(screen.getByRole("textbox", { name: t.remotoDeviceId }), "pc-bia");
    // "Só ver" é o atalho por omissão; clica-se nele à mesma, para o teste não depender disso.
    await u.click(screen.getByRole("radio", { name: t.remotoAtalho.ver }));
    await u.click(screen.getByRole("button", { name: t.remotoConceder }));

    const post = await waitFor(() => {
      const p = pedidos.find((x) => x.metodo === "POST");
      expect(p).toBeTruthy();
      return p as Pedido;
    });
    // O corpo EXATO: sujeito/objeto etiquetados e as 5 capacidades, nem mais nem menos
    // (uma 6.ª seria `400` no BE, que tem `deny_unknown_fields`).
    expect(post.corpo).toEqual({
      sujeito: { tipo: "utilizador", uid: "membro-2" },
      objeto: { tipo: "dispositivo", id: "pc-bia" },
      capacidades: { screen: true, input: false, fileTransfer: false, clipboard: false, audio: false },
    });

    const linha = (await screen.findByText(t.remotoDispositivo.replace("{id}", "pc-bia"))).closest("tr") as HTMLElement;
    expect(within(linha).getByText("Bia Lima")).toBeTruthy();
    expect(within(linha).getByText(t.remotoAtalho.ver)).toBeTruthy();
    expect(within(linha).getByText(t.remotoAtiva)).toBeTruthy();
  });

  it("AC1: a linha vem do SERVIDOR (relê depois do POST) e persiste ao recarregar a tela", async () => {
    const { pedidos } = borda();
    const u = await abrirRemoto();
    const t = DICIONARIOS["pt-BR"];
    await u.selectOptions(await screen.findByRole("combobox", { name: t.remotoMembro }), "membro-2");
    await u.type(screen.getByRole("textbox", { name: t.remotoDeviceId }), "pc-bia");
    await u.click(screen.getByRole("radio", { name: t.remotoAtalho.total }));
    await u.click(screen.getByRole("button", { name: t.remotoConceder }));
    const nova = (await screen.findByText(t.remotoDispositivo.replace("{id}", "pc-bia"))).closest("tr") as HTMLElement;
    expect(within(nova).getByText(t.remotoAtalho.total)).toBeTruthy();

    // Não otimista: houve um GET da lista DEPOIS do POST.
    const iPost = pedidos.findIndex((p) => p.metodo === "POST");
    expect(
      pedidos.slice(iPost + 1).some((p) => p.metodo === "GET" && p.url.endsWith("/remoto/concessoes")),
    ).toBe(true);

    // "Recarregar a página": desmonta tudo e volta. A linha reaparece porque está guardada.
    cleanup();
    await abrirRemoto();
    const linha = (await screen.findByText(t.remotoDispositivo.replace("{id}", "pc-bia"))).closest("tr") as HTMLElement;
    expect(within(linha).getByText(t.remotoAtalho.total)).toBeTruthy();
  });

  it("AC1: 'Personalizado' parte do atalho escolhido e manda só o que ficou marcado", async () => {
    const { pedidos } = borda();
    const u = await abrirRemoto();
    const t = DICIONARIOS["pt-BR"];
    await u.selectOptions(await screen.findByRole("combobox", { name: t.remotoMembro }), "membro-2");
    await u.type(screen.getByRole("textbox", { name: t.remotoDeviceId }), "pc-bia");
    await u.click(screen.getByRole("radio", { name: t.remotoAtalho.personalizado }));
    // Parte de "Só ver": a tela vem marcada; acrescenta-se o áudio.
    const form = screen.getByRole("button", { name: t.remotoConceder }).closest("form") as HTMLElement;
    expect((within(form).getByRole("checkbox", { name: t.remotoCapacidade.screen }) as HTMLInputElement).checked).toBe(true);
    await u.click(within(form).getByRole("checkbox", { name: t.remotoCapacidade.audio }));
    await u.click(screen.getByRole("button", { name: t.remotoConceder }));

    await waitFor(() =>
      expect(pedidos.find((p) => p.metodo === "POST")?.corpo).toMatchObject({
        capacidades: { screen: true, input: false, fileTransfer: false, clipboard: false, audio: true },
      }),
    );
    // Um conjunto que não é atalho aparece pelas capacidades, com os rótulos do dicionário.
    expect(
      await screen.findByText(`${t.remotoCapacidade.screen}, ${t.remotoCapacidade.audio}`),
    ).toBeTruthy();
  });

  it("vocabulário (canário AC6 do #1683): exatamente as 5 capacidades, nem câmera nem túnel", async () => {
    borda();
    const u = await abrirRemoto();
    const t = DICIONARIOS["pt-BR"];
    await screen.findByText(t.remotoTeto);
    // O teto mostra as caixas sempre; o "Conceder" só em "Personalizado".
    await u.click(screen.getByRole("radio", { name: t.remotoAtalho.personalizado }));
    const rotulos = new Set(screen.getAllByRole("checkbox").map((c) => c.closest("label")?.textContent));
    // As 5 em cada um dos dois formulários (+ a caixa do não supervisionado no teto).
    for (const k of CAPACIDADES) expect(screen.getAllByRole("checkbox", { name: t.remotoCapacidade[k] })).toHaveLength(2);
    expect(rotulos.size).toBe(CAPACIDADES.length + 1);
    expect(Object.keys(t.remotoCapacidade).sort()).toEqual([...CAPACIDADES].sort());
  });

  it("device ID fora do formato do `remote-net` ⇒ diz o que está errado e NÃO envia", async () => {
    const { pedidos } = borda();
    const u = await abrirRemoto();
    const t = DICIONARIOS["pt-BR"];
    await u.selectOptions(await screen.findByRole("combobox", { name: t.remotoMembro }), "membro-2");
    const campo = screen.getByRole("textbox", { name: t.remotoDeviceId });
    await u.type(campo, "pc bia"); // espaço: o BE devolve 400

    expect(screen.getByText(t.remotoDeviceIdInvalido)).toBeTruthy();
    expect(campo.getAttribute("aria-invalid")).toBe("true");
    const botao = screen.getByRole("button", { name: t.remotoConceder }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    await u.click(botao);
    expect(pedidos.some((p) => p.metodo === "POST")).toBe(false);
  });

  it("sem membro escolhido, não há o que conceder", async () => {
    borda();
    const u = await abrirRemoto();
    const t = DICIONARIOS["pt-BR"];
    await u.type(await screen.findByRole("textbox", { name: t.remotoDeviceId }), "pc-bia");
    expect((screen.getByRole("button", { name: t.remotoConceder }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("recusa do servidor no POST ⇒ a falha aparece, nada é dado como concedido", async () => {
    borda({ falharPost: 404 }); // ex.: o membro saiu da org entretanto
    const u = await abrirRemoto();
    const t = DICIONARIOS["pt-BR"];
    await u.selectOptions(await screen.findByRole("combobox", { name: t.remotoMembro }), "membro-2");
    await u.type(screen.getByRole("textbox", { name: t.remotoDeviceId }), "pc-bia");
    await u.click(screen.getByRole("button", { name: t.remotoConceder }));

    expect(await screen.findByRole("status", { name: t.remotoFalhou })).toBeTruthy();
    expect(screen.getByText(t.remotoSemConcessoes)).toBeTruthy();
    // O que o admin escreveu FICA, para corrigir e tentar de novo.
    expect((screen.getByRole("textbox", { name: t.remotoDeviceId }) as HTMLInputElement).value).toBe("pc-bia");
  });

  it("POST recusado por `org_suspensa` (suspensa com o formulário aberto) ⇒ diz que a ORG está suspensa", async () => {
    // A releitura NÃO revelaria nada: a lista atravessa a suspensão e voltaria
    // igual, e o clique pareceria ignorado. Daí a mensagem própria.
    borda({ falharPost: 403, erroPost: "org_suspensa" });
    const u = await abrirRemoto();
    const t = DICIONARIOS["pt-BR"];
    await u.selectOptions(await screen.findByRole("combobox", { name: t.remotoMembro }), "membro-2");
    await u.type(screen.getByRole("textbox", { name: t.remotoDeviceId }), "pc-bia");
    await u.click(screen.getByRole("button", { name: t.remotoConceder }));

    expect(await screen.findByRole("status", { name: t.orgSuspensa })).toBeTruthy();
    expect(screen.queryByRole("status", { name: t.remotoFalhou })).toBeNull();
  });

  it("AC2: revogar pede confirmação NOMEADA e, confirmado, a lista mostra 'Revogada'", async () => {
    const { pedidos } = borda({ concessoes: [ativa("cr-1", "membro-2", "pc-bia", TODAS)] });
    const u = await abrirRemoto();
    const t = DICIONARIOS["pt-BR"];

    await u.click(await screen.findByRole("button", { name: t.remotoRevogar }));
    const dialogo = screen.getByRole("dialog", { name: t.remotoRevogar });
    // Nomeia QUEM e QUE device: um "tem certeza?" genérico clica-se no automático.
    expect(within(dialogo).getByText("Bia Lima")).toBeTruthy();
    expect(within(dialogo).getByText(t.remotoDispositivo.replace("{id}", "pc-bia"))).toBeTruthy();
    // O foco de entrada NÃO está no botão que destrói.
    expect(document.activeElement?.textContent).toBe(t.cancelar);

    await u.click(within(dialogo).getByRole("button", { name: t.remotoRevogar }));
    expect(pedidos.some((p) => p.metodo === "DELETE" && p.url === "/api/v1/orgs/acme/remoto/concessoes/cr-1")).toBe(true);

    const linha = (await screen.findByText(t.remotoRevogada)).closest("tr") as HTMLElement;
    expect(within(linha).getByText("Bia Lima")).toBeTruthy();
    // Uma revogada não oferece "revogar" outra vez: o botão não mudaria nada.
    expect(within(linha).queryByRole("button")).toBeNull();
  });

  it("cancelar a revogação não manda nada", async () => {
    const { pedidos } = borda({ concessoes: [ativa("cr-1", "membro-2", "pc-bia", TODAS)] });
    const u = await abrirRemoto();
    const t = DICIONARIOS["pt-BR"];
    await u.click(await screen.findByRole("button", { name: t.remotoRevogar }));
    await u.click(screen.getByRole("button", { name: t.cancelar }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(pedidos.some((p) => p.metodo === "DELETE")).toBe(false);
  });

  it("AC3: quem não gere a org (403 negado) não vê concessões NEM o teto", async () => {
    const { pedidos } = borda({ negar: "negado" });
    await abrirRemoto();
    const t = DICIONARIOS["pt-BR"];
    expect(await screen.findByText(t.semPermissao)).toBeTruthy();
    expect(screen.queryByText(t.remotoConcessoes)).toBeNull();
    expect(screen.queryByText(t.remotoTeto)).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("button", { name: t.remotoConceder })).toBeNull();
    // E a tela não chega a pedir o teto: a lista fechou a porta antes.
    expect(pedidos.some((p) => p.url.endsWith("/remoto/politica"))).toBe(false);
  });

  it("teto: nasce do servidor e o PUT manda os 3 campos (substituição INTEIRA)", async () => {
    const { pedidos } = borda();
    const u = await abrirRemoto();
    const t = DICIONARIOS["pt-BR"];
    await screen.findByText(t.remotoTeto);
    const salvar = screen.getByRole("button", { name: t.salvar }) as HTMLButtonElement;
    // Sem edição não há o que mandar.
    expect(salvar.disabled).toBe(true);

    const teto = salvar.closest("form") as HTMLElement;
    await u.click(within(teto).getByRole("checkbox", { name: t.remotoCapacidade.fileTransfer }));
    await u.selectOptions(within(teto).getByRole("combobox", { name: t.remotoAprovacaoTitulo }), "senha");
    await u.click(salvar);

    await waitFor(() =>
      expect(pedidos.find((p) => p.metodo === "PUT")?.corpo).toEqual({
        capacidades_maximas: { ...TODAS, fileTransfer: false },
        modo_aprovacao: "senha",
        permitir_nao_supervisionado: false,
      }),
    );
    // O "Salvo" sobrevive à releitura que o PUT dispara (o formulário remonta).
    expect(await screen.findByText(t.salvo)).toBeTruthy();
    const relido = screen.getByRole("button", { name: t.salvar }).closest("form") as HTMLElement;
    expect((within(relido).getByRole("checkbox", { name: t.remotoCapacidade.fileTransfer }) as HTMLInputElement).checked).toBe(false);
  });

  it("teto: os 3 modos de aprovação do contrato, com os rótulos do dicionário", async () => {
    borda();
    await abrirRemoto();
    const t = DICIONARIOS["pt-BR"];
    const select = await screen.findByRole("combobox", { name: t.remotoAprovacaoTitulo });
    const opcoes = within(select).getAllByRole("option") as HTMLOptionElement[];
    expect(opcoes.map((o) => o.value)).toEqual(["clique", "senha", "senha_ou_clique"]);
    expect(opcoes.map((o) => o.textContent)).toEqual([
      t.remotoAprovacao.clique,
      t.remotoAprovacao.senha,
      t.remotoAprovacao.senha_ou_clique,
    ]);
  });

  it("org suspensa: a lista e o REVOGAR atravessam; conceder e o teto dizem que a org está suspensa", async () => {
    const { pedidos } = borda({ suspensa: true, concessoes: [ativa("cr-1", "membro-2", "pc-bia", TODAS)] });
    const u = await abrirRemoto();
    const t = DICIONARIOS["pt-BR"];

    // A lista está lá (sem os nomes: o GET de membros também é barrado; fica o uid).
    const linha = (await screen.findByText("membro-2")).closest("tr") as HTMLElement;
    expect(within(linha).getByText(t.remotoAtiva)).toBeTruthy();
    // O formulário de conceder e o teto dão lugar ao aviso da suspensão.
    await waitFor(() => expect(screen.getAllByText(t.orgSuspensa).length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: t.remotoConceder })).toBeNull();
    expect(screen.queryByRole("button", { name: t.salvar })).toBeNull();

    // Revogar continua possível: acesso nunca fica preso por a org estar suspensa.
    await u.click(within(linha).getByRole("button", { name: t.remotoRevogar }));
    await u.click(within(screen.getByRole("dialog")).getByRole("button", { name: t.remotoRevogar }));
    expect(await screen.findByText(t.remotoRevogada)).toBeTruthy();
    expect(pedidos.some((p) => p.metodo === "DELETE")).toBe(true);
  });
});

describe("#1472 AC5 — i18n: nenhuma string do outro idioma no painel", () => {
  /** Todas as strings do Remote num idioma (as `Record` achatadas). */
  function copyDoRemoto(idioma: Idioma): string[] {
    return Object.entries(DICIONARIOS[idioma])
      .filter(([k]) => k.startsWith("remoto"))
      .flatMap(([, v]) => (typeof v === "string" ? [v] : Object.values(v as Record<string, string>)))
      .map((s) => s.replace("{id}", "").trim());
  }

  it.each([
    ["pt-BR", "en"],
    ["en", "pt-BR"],
  ] as const)("em %s, nada da copy de %s aparece (texto e aria-labels)", async (idioma, outro) => {
    borda({ concessoes: [ativa("cr-1", "membro-2", "pc-bia", TODAS), { ...ativa("cr-2", "membro-2", "pc-2", TODAS), ativa: false, revogada_em: 1 }] });
    const u = await abrirRemoto(idioma);
    const t = DICIONARIOS[idioma];
    await screen.findByText(t.remotoTeto);
    // Abre o que só aparece por interação: as caixas do "Personalizado" e o diálogo.
    await u.click(screen.getByRole("radio", { name: t.remotoAtalho.personalizado }));
    await u.click(screen.getByRole("button", { name: t.remotoRevogar }));
    await u.type(screen.getByRole("textbox", { name: t.remotoDeviceId }), "x y");

    const meu = new Set(copyDoRemoto(idioma));
    // Strings iguais nos dois idiomas não provam nada; fora da comparação.
    const alheias = copyDoRemoto(outro).filter((s) => s.length > 0 && !meu.has(s));
    expect(alheias.length).toBeGreaterThan(10); // anti-vazio

    const visivel = [
      document.body.textContent ?? "",
      ...[...document.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label") ?? ""),
    ].join("\n");
    for (const s of alheias) expect(visivel, `"${s}" (${outro}) visível em ${idioma}`).not.toContain(s);
    // E a copy do próprio idioma está mesmo lá (o teste não passa com a tela vazia).
    expect(visivel).toContain(t.remotoNaoAplicado);
    expect(visivel).toContain(t.remotoRevogada);
    expect(visivel).toContain(t.remotoDeviceIdInvalido);
  });
});
