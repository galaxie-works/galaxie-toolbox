// #1490 fatia 3 — REMOVER MEMBRO (`DELETE /orgs/{org}/membros/{uid}`).
//
// Porque esta fatia sai agora e as irmãs não: o `DELETE` é o único método de
// escrita de membros **completamente especificado** — rota declarada (§4.3),
// sem corpo de entrada, e desde o #1620 com o slug de recusa na §3
// (`409 ultimo_admin`). Convidar e mudar-papel mutam COM corpo, e o corpo delas
// continua por declarar (#1618).
//
// O que estes testes medem, e é o que a fatia arrisca:
//   1. a confirmação NOMEIA quem sai (nome + e-mail) e diz o EFEITO;
//   2. o sucesso RELÊ do servidor — não remove a linha do array local;
//   3. `409 ultimo_admin` vira "promove outro admin antes", **nunca** "sem
//      permissão" — são problemas diferentes e só um deles o utilizador
//      resolve sozinho (condição do @Altair no #1620);
//   4. `409` com slug DESCONHECIDO cai no genérico, não na mensagem específica:
//      afirmar a razão errada é pior do que afirmar "não deu".
//
// Como no `admin-org.test.tsx`, o `fetch` é trocado por um duplo para exercitar
// a porta de rede REAL (`chamar`) — o que se mede é o que SAIU: método e URL.
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import { AdminOrgPage } from "./admin-org";
import { DICIONARIOS, type Idioma } from "@/i18n";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const MEMBROS = [
  { uid: "u-1", nome: "Ana Ribeiro", email: "ana@acme.pt", papel: "org_admin" },
  { uid: "u-2", nome: "Rui Costa", email: "rui@acme.pt", papel: "member" },
];

interface Pedido {
  url: string;
  metodo: string;
}

/**
 * Duplo de rede que responde por MÉTODO, e regista a ordem.
 *
 * A ordem importa: o que prova a releitura não é existir um `GET`, é existir um
 * `GET` **depois** do `DELETE`. Um duplo que só contasse chamadas deixaria
 * passar uma remoção otimista seguida de nada.
 */
function rede(aoApagar: () => Response) {
  const pedidos: Pedido[] = [];
  vi.stubGlobal("fetch", (entrada: string, init?: RequestInit) => {
    const metodo = init?.method ?? "GET";
    pedidos.push({ url: String(entrada), metodo });
    if (metodo === "DELETE") return Promise.resolve(aoApagar());
    if (String(entrada).includes("/me/orgs")) {
      return Promise.resolve(
        new Response(JSON.stringify([{ org: "acme", estado: "provisionada" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify(MEMBROS), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  return pedidos;
}

const semCorpo = (status: number) => new Response(null, { status });
const comErro = (codigo: string, status: number) =>
  new Response(JSON.stringify({ erro: codigo }), {
    status,
    headers: { "content-type": "application/json" },
  });

async function abrirConfirmacao(idioma: Idioma = "pt-BR") {
  const t = DICIONARIOS[idioma];
  render(<AdminOrgPage idioma={idioma} org="acme" />);
  await waitFor(() => expect(screen.getByText("Rui Costa")).toBeTruthy());
  const botoes = screen.getAllByRole("button", { name: t.remover });
  // `[1]` = a linha do Rui. A do Ana é a `[0]`.
  fireEvent.click(botoes[1]!);
  return t;
}

describe("#1490 — remover membro", () => {
  // ── anti-cegueira ───────────────────────────────────────────────────────
  // Sem isto, um render que falhasse daria "nenhum botão" e os testes de
  // recusa passariam por não encontrar nada que os contradissesse.
  it("a lista renderiza e cada membro tem botão de remover", async () => {
    rede(() => semCorpo(204));
    render(<AdminOrgPage idioma="pt-BR" org="acme" />);
    await waitFor(() => expect(screen.getByText("Ana Ribeiro")).toBeTruthy());
    expect(
      screen.getAllByRole("button", { name: DICIONARIOS["pt-BR"].remover }),
    ).toHaveLength(MEMBROS.length);
  });

  it("a confirmação NOMEIA quem sai (nome e e-mail) e diz o efeito", async () => {
    rede(() => semCorpo(204));
    const t = await abrirConfirmacao();

    const dialogo = screen.getByRole("dialog");
    expect(dialogo.textContent).toContain("Rui Costa");
    // O e-mail vai junto porque dois membros podem ter o mesmo nome.
    expect(dialogo.textContent).toContain("rui@acme.pt");
    expect(dialogo.textContent).toContain(t.removerAviso);
    // E NÃO nomeia o outro membro — a confirmação é sobre um só.
    expect(dialogo.textContent).not.toContain("Ana Ribeiro");
  });

  it("sucesso RELÊ do servidor (não tira a linha do array local)", async () => {
    const pedidos = rede(() => semCorpo(204));
    const t = await abrirConfirmacao();

    fireEvent.click(
      screen.getByRole("dialog").querySelector("button.bg-red-600")!,
    );

    await waitFor(() => {
      const iApagou = pedidos.findIndex((p) => p.metodo === "DELETE");
      expect(iApagou).toBeGreaterThanOrEqual(0);
      // 🔑 O que prova a releitura: existe um GET DEPOIS do DELETE.
      const releu = pedidos
        .slice(iApagou + 1)
        .some((p) => p.metodo === "GET" && p.url.includes("/orgs/acme/membros"));
      expect(releu, "não houve GET depois do DELETE — a lista ficou otimista").toBe(
        true,
      );
    });

    // E o que SAIU foi o que o contrato declara.
    const apagou = pedidos.find((p) => p.metodo === "DELETE")!;
    expect(apagou.url).toContain("/orgs/acme/membros/u-2");
    expect(t.remover).toBeTruthy();
  });

  it.each(["pt-BR", "en"] as Idioma[])(
    "409 `ultimo_admin` diz PROMOVE OUTRO, nunca 'sem permissão' (%s)",
    async (idioma) => {
      rede(() => comErro("ultimo_admin", 409));
      const t = await abrirConfirmacao(idioma);

      fireEvent.click(
        screen.getByRole("dialog").querySelector("button.bg-red-600")!,
      );

      await waitFor(() =>
        expect(screen.getByText(t.ultimoAdminDetalhe)).toBeTruthy(),
      );
      // O ponto inteiro da fatia: a mensagem que manda pedir suporte NÃO aparece.
      expect(screen.queryByText(t.semPermissao)).toBeNull();
      expect(screen.queryByText(t.semPermissaoDetalhe)).toBeNull();
    },
  );

  it("409 com slug DESCONHECIDO cai no genérico, não no específico", async () => {
    rede(() => comErro("algo_que_nao_existe", 409));
    const t = await abrirConfirmacao();

    fireEvent.click(
      screen.getByRole("dialog").querySelector("button.bg-red-600")!,
    );

    await waitFor(() => expect(screen.getByText(t.removerFalhou)).toBeTruthy());
    // Afirmar "é o último admin" sem o servidor o ter dito seria inventar a
    // razão — e mandaria promover alguém para resolver um problema diferente.
    expect(screen.queryByText(t.ultimoAdmin)).toBeNull();
  });

  it("cancelar não chama a rede", async () => {
    const pedidos = rede(() => semCorpo(204));
    const t = await abrirConfirmacao();

    fireEvent.click(screen.getByRole("button", { name: t.cancelar }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(pedidos.some((p) => p.metodo === "DELETE")).toBe(false);
  });
});
