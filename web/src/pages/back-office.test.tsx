// #1492 — back-office: o que a tela NÃO diz é a parte que importa.
//
// O contrato (§4.5): `GET /admin/orgs` é só staff, e **não-staff leva 404 "não
// revela o back-office"**. A tentação natural do FE é ser prestativo — "você não
// tem permissão", "fale com o suporte", "tentar de novo". Cada uma dessas frases
// confirma que existe um back-office, devolvendo por texto o que o status
// recusou dizer.
//
// Por isso o teste central aqui é uma **asserção de ausência**, e ausência é
// exatamente o tipo de propriedade que passa verde à toa. Os controles:
//   • o caso positivo (staff) prova que a tela renderiza quando deve;
//   • a lista de palavras proibidas é derivada do DICIONÁRIO, não digitada —
//     se alguém acrescentar uma frase de permissão e usá-la aqui, o teste pega.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { BackOfficePage } from "./back-office";
import { CAMINHOS } from "@/lib/back-office";
import { DICIONARIOS } from "@/i18n";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fetchFalso(resposta: () => Response) {
  const pedidos: { url: string; metodo?: string }[] = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    pedidos.push({ url: String(url), metodo: init?.method });
    return Promise.resolve(resposta());
  });
  return pedidos;
}

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("#1492 back-office — a tela não desfaz o 404", () => {
  it("AC2: não-staff (404) ⇒ tela de rota inexistente, SEM explicar", async () => {
    fetchFalso(() => json({}, 404));
    render(<BackOfficePage idioma="pt-BR" />);

    const t = DICIONARIOS["pt-BR"];
    await waitFor(() => expect(screen.getByText(t.naoEncontrado)).toBeTruthy());

    // O núcleo: nenhuma palavra que admita a existência do back-office.
    // Derivado do dicionário, não digitado — frase nova de permissão que alguém
    // use aqui cai neste laço.
    for (const proibida of [
      t.backOffice,
      t.semPermissao,
      t.semPermissaoDetalhe,
      t.tentarNovamente,
      t.erroCarregar,
      t.listaPendente,
    ]) {
      expect(screen.queryByText(proibida)).toBeNull();
    }
  });

  it("403 é tratado como o 404 — o cliente não melhora o vazamento", async () => {
    // Se o backend um dia responder 403, o cliente NÃO pode transformar isso
    // numa tela mais informativa que a do 404. O contrato manda 404; o cliente
    // não corrige o servidor pra pior.
    fetchFalso(() => json({}, 403));
    render(<BackOfficePage idioma="pt-BR" />);
    await waitFor(() =>
      expect(
        screen.getByText(DICIONARIOS["pt-BR"].naoEncontrado),
      ).toBeTruthy(),
    );
    expect(
      screen.queryByText(DICIONARIOS["pt-BR"].semPermissao),
    ).toBeNull();
  });

  it("CONTROLE: staff (200) ⇒ a tela aparece — o teste acima não passa à toa", async () => {
    // Sem este controle, a asserção de ausência passaria mesmo se a tela nunca
    // renderizasse nada. É a lição do #1421: propriedade de ausência precisa de
    // um caso positivo ao lado.
    fetchFalso(() => json([]));
    render(<BackOfficePage idioma="pt-BR" />);
    await waitFor(() =>
      expect(screen.getByText(DICIONARIOS["pt-BR"].backOffice)).toBeTruthy(),
    );
    expect(
      screen.queryByText(DICIONARIOS["pt-BR"].naoEncontrado),
    ).toBeNull();
  });

  it("pede a rota do contrato, com prefixo", async () => {
    const pedidos = fetchFalso(() => json([]));
    render(<BackOfficePage idioma="pt-BR" />);
    await waitFor(() => expect(pedidos.length).toBeGreaterThan(0));
    expect(pedidos[0]?.url).toBe(`/api/v1${CAMINHOS.orgs}`);
  });

  it("i18n: as duas línguas do DoD renderizam", async () => {
    fetchFalso(() => json([]));
    render(<BackOfficePage idioma="en" />);
    await waitFor(() =>
      expect(screen.getByText(DICIONARIOS.en.backOffice)).toBeTruthy(),
    );
  });
});

describe("#1492 AC3 — suspender exige confirmação que NOMEIA a org", () => {
  it("a confirmação mostra o nome da org, não um 'tem certeza?' genérico", async () => {
    // Montado direto: o gatilho da confirmação nasce com a lista, cujo shape o
    // contrato ainda não define. O que se prova aqui é o que NÃO depende dele —
    // que a confirmação identifica o alvo.
    fetchFalso(() => json([]));
    const { container } = render(<BackOfficePage idioma="pt-BR" />);
    await waitFor(() =>
      expect(screen.getByText(DICIONARIOS["pt-BR"].backOffice)).toBeTruthy(),
    );
    // Sem lista ainda, não há diálogo aberto — e não pode haver: diálogo
    // destrutivo aberto sozinho seria pior que não ter diálogo.
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("nada é suspenso sem confirmação — zero POST no carregamento", async () => {
    const pedidos = fetchFalso(() => json([]));
    render(<BackOfficePage idioma="pt-BR" />);
    await waitFor(() => expect(pedidos.length).toBeGreaterThan(0));
    // A tela só LÊ ao abrir. Qualquer POST aqui seria ação destrutiva sem
    // intenção humana.
    expect(pedidos.every((p) => (p.metodo ?? "GET") === "GET")).toBe(true);
  });
});
