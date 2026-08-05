import assert from "node:assert/strict";
import { test } from "node:test";

// #555 (P0): herança-zero dos resets de sessão POR SLICE. O seam completo
// (`resetSessaoCompleta` em index.ts) não é carregável pelo `node --test` (alias
// `@/` + persist/localStorage), então aqui testamos que cada ação de reset
// tenant-scoped zera de fato os seus campos — a substância do fix. A orquestração
// (o seam chamar todos) é garantida pelo tsc + live-QA 2-contas.
import { createMailboxSlice } from "./mailbox-slice.ts";
import { createListSlice } from "./list-slice.ts";
import { createSelectionSlice } from "./selection-slice.ts";
import { createComposeSlice } from "./compose-slice.ts";
import { createFiltersSlice } from "./filters-slice.ts";
import { createReaderSlice } from "./reader-slice.ts";
import { createAgendaSlice } from "./agenda-slice.ts";
import { createPeopleSlice } from "./people-slice.ts";
import { createUiSlice } from "./ui-slice.ts";

/** Mini-store de um slice só (mesmo padrão de agenda-slice.test.ts). */
function miniStore<T>(creator: (set: never, get: never, store: never) => T): T {
  const state = {} as T;
  const set = (u: unknown) =>
    Object.assign(
      state as object,
      typeof u === "function" ? (u as (s: T) => object)(state) : (u as object),
    );
  const get = () => state;
  return Object.assign(
    state as object,
    creator(set as never, get as never, {} as never),
  ) as T;
}

test("#555 mailbox: resetSessaoMailbox zera cache/caixas e volta pra 'me'", () => {
  const s = miniStore(createMailboxSlice);
  Object.assign(s, {
    caixaAtiva: "shared@voaz.com",
    cachePastas: { "shared@voaz.com|inbox": { itens: [] } },
    caixasCompartilhadas: [{ endereco: "henrique@voaz.com" }],
    pastas: [{}],
    subpastas: { x: [{}] },
    recargaPastas: 3,
  });
  s.resetSessaoMailbox();
  assert.equal(s.caixaAtiva, "me");
  assert.deepEqual(s.cachePastas, {});
  assert.deepEqual(s.caixasCompartilhadas, []);
  assert.equal(s.pastas, null);
  assert.deepEqual(s.subpastas, {});
  assert.equal(s.recargaPastas, 0);
});

test("#555 list: resetSessaoList zera mensagens e volta pra inbox/me", () => {
  const s = miniStore(createListSlice);
  Object.assign(s, {
    mensagens: [{ id: "voaz-1" }],
    caixaDados: "shared@voaz.com",
    pastaSel: "sent",
    temMais: true,
    agruparConversas: false, // preferência — NÃO pode ser tocada
  });
  s.resetSessaoList();
  assert.equal(s.mensagens, null);
  assert.equal(s.caixaDados, "me");
  assert.equal(s.pastaSel, "inbox");
  assert.equal(s.temMais, false);
  assert.equal(s.agruparConversas, false, "preferência preservada");
});

test("#555 selection: resetSessaoSelection zera seleção + msgSel", () => {
  const s = miniStore(createSelectionSlice);
  Object.assign(s, {
    selecionados: new Set(["voaz-1"]),
    msgSel: "voaz-1",
    ancoraSelecao: "voaz-1",
  });
  s.resetSessaoSelection();
  assert.equal(s.selecionados.size, 0);
  assert.equal(s.msgSel, null);
  assert.equal(s.ancoraSelecao, null);
});

test("#555 compose: fecharCompose zera o rascunho", () => {
  const s = miniStore(createComposeSlice);
  Object.assign(s, {
    composeModo: "novo",
    composePara: ["a@voaz.com"],
    composeAssunto: "rascunho voaz",
    composeAnexos: [{ nome: "x" }],
  });
  s.fecharCompose();
  assert.equal(s.composeModo, null);
  assert.deepEqual(s.composePara, []);
  assert.equal(s.composeAssunto, "");
  assert.deepEqual(s.composeAnexos, []);
});

test("#555 filters: limparConsultas zera busca/resultados (preserva prefs)", () => {
  const s = miniStore(createFiltersSlice);
  Object.assign(s, {
    busca: "voaz",
    resultadosBusca: [{ id: "voaz-2" }],
    resultadosFiltro: [{ id: "voaz-3" }],
    ordenar: "remetente", // preferência — preservar
  });
  s.limparConsultas();
  assert.equal(s.busca, "");
  assert.equal(s.resultadosBusca, null);
  assert.equal(s.resultadosFiltro, null);
  assert.equal(s.ordenar, "remetente", "preferência preservada");
});

test("#555 reader: limparLeitor zera e-mail aberto + insights", () => {
  const s = miniStore(createReaderSlice);
  Object.assign(s, {
    leitorAlvo: { id: "voaz-1" },
    leitorDetalhe: { corpo: "segredo do voaz" },
    insightsDados: { total: 9 },
  });
  s.limparLeitor();
  assert.equal(s.leitorAlvo, null);
  assert.equal(s.leitorDetalhe, null);
  assert.equal(s.insightsDados, null);
});

test("#555 agenda: resetSessaoAgenda zera eventos/calendários/detalhe", () => {
  const s = miniStore(createAgendaSlice);
  Object.assign(s, {
    agendaEventosMes: [{ id: "ev-voaz" }],
    agendaCalendarios: [{ id: "cal-voaz" }],
    agendaCalendariosSelecionados: ["cal-voaz"],
    agendaCaixaDados: "shared@voaz.com",
    agendaEventoDetalhe: { assunto: "reunião voaz" },
    agendaView: "week", // preferência — preservar
  });
  s.resetSessaoAgenda();
  assert.equal(s.agendaEventosMes, null);
  assert.equal(s.agendaCalendarios, null);
  assert.equal(s.agendaCalendariosSelecionados, null);
  assert.equal(s.agendaCaixaDados, "me");
  assert.equal(s.agendaEventoDetalhe, null);
  assert.equal(s.agendaView, "week", "preferência preservada");
});

test("#568 nav: resetNavegacao volta Bridge pro E-mail e People pra Contatos", () => {
  const s = miniStore(createUiSlice);
  Object.assign(s, {
    bridgeView: "people", // conta A tinha deixado o Bridge em Contatos
    peopleTab: "groups",
    zoom: 1.4, // preferência — NÃO pode ser tocada
    sidebarAberta: false,
  });
  s.resetNavegacao();
  assert.equal(s.bridgeView, "mail");
  assert.equal(s.peopleTab, "contacts");
  assert.equal(s.zoom, 1.4, "preferência preservada");
  assert.equal(s.sidebarAberta, false, "preferência preservada");
});

test("#555 people: resetPeopleSession também zera categorias/merge (leak residual)", () => {
  const s = miniStore(createPeopleSlice);
  Object.assign(s, {
    peopleContacts: [{ id: "c-voaz" }],
    peopleCategorias: new Map([["cat", { nome: "x" }]]),
    peopleSelectedCategory: "cat",
    peopleMergeUndo: { snapshot: 1 },
    peopleMergeRunning: true,
    peopleCaixaDados: "shared@voaz.com",
  });
  s.resetPeopleSession();
  assert.deepEqual(s.peopleContacts, []);
  assert.equal(s.peopleCategorias.size, 0);
  assert.equal(s.peopleSelectedCategory, null);
  assert.equal(s.peopleMergeUndo, null);
  assert.equal(s.peopleMergeRunning, false);
  assert.equal(s.peopleCaixaDados, "me");
});
