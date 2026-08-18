/**
 * Contrato de APLICAÇÃO das capabilities (#802/#803).
 *
 * Por que este arquivo existe: o gate adversarial da Lumen (PR #818,
 * `lumen-provider-surface-contract.test.ts`) foi descartado sem merge, e o
 * substituto apontado — `capabilities-surface.test.ts` — cobre APENAS a função
 * pura `surfaceSuportada()`. Ele prova que a TABELA responde certo; não prova
 * que alguém CONSULTA a tabela, nem em que ordem. Os dois furos que geraram
 * #802/#803 (SharePoint chamado em conta MS pessoal; Mail pedido antes do gate)
 * passariam com aquele teste 100% verde. Aqui se testa a aplicação.
 *
 * Ancoragem: só em SÍMBOLOS do código (nomes de função, identificadores,
 * chamadas). O gate original quebrou por ancorar em texto de COMENTÁRIO
 * (`// sessao invalida`), que sumiu num refactor e levou o teste junto.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const controlRoom = readFileSync(
  new URL("../screens/control-room.tsx", import.meta.url),
  "utf8",
);
const graph = readFileSync(
  new URL("../../src-tauri/src/graph.rs", import.meta.url),
  "utf8",
);

const GATE_WORK = 'if (u.accountKind === "work")';
const GATE_MAIL = 'if (!surfaceSuportada(user, "mail"))';

/** Bloco `{...}` balanceado a partir do símbolo `marcador`. */
function bloco(fonte: string, marcador: string): string {
  const inicio = fonte.indexOf(marcador);
  assert.notEqual(inicio, -1, `símbolo ausente: ${marcador}`);
  const abre = fonte.indexOf("{", inicio);
  assert.notEqual(abre, -1, `abertura ausente: ${marcador}`);
  let nivel = 0;
  for (let i = abre; i < fonte.length; i += 1) {
    if (fonte[i] === "{") nivel += 1;
    if (fonte[i] === "}") nivel -= 1;
    if (nivel === 0) return fonte.slice(inicio, i + 1);
  }
  assert.fail(`fechamento ausente: ${marcador}`);
}

/** Trecho entre dois SÍMBOLOS (nunca entre comentários). */
function entre(fonte: string, de: string, ate: string): string {
  const inicio = fonte.indexOf(de);
  assert.notEqual(inicio, -1, `símbolo ausente: ${de}`);
  const fim = fonte.indexOf(ate, inicio);
  assert.notEqual(fim, -1, `símbolo ausente: ${ate}`);
  return fonte.slice(inicio, fim);
}

/** A chamada só pode existir DENTRO do gate de conta work — nunca fora dele. */
function soComContaWork(regiao: string, chamada: string, onde: string): void {
  const gate = bloco(regiao, GATE_WORK);
  const escapou = regiao.replace(gate, "");
  assert.ok(gate.includes(chamada), `${chamada} não está no gate work (${onde})`);
  assert.ok(
    !escapou.includes(chamada),
    `${chamada} escapou do gate de conta work (${onde}) — é o furo do #802`,
  );
}

const caminhos = [
  // restore: do símbolo da chamada de restauração até a próxima função nomeada.
  ["restore", entre(app, "api.restoreSession()", "async function handleLogin(")],
  ["login", bloco(app, "async function handleLogin(")],
] as const;

for (const [nome, regiao] of caminhos) {
  test(`#802 ${nome}: MS pessoal não chama SharePoint`, () => {
    soComContaWork(regiao, "api.listSites(", nome);
    soComContaWork(regiao, "carregarDetalhes(", nome);
  });

  test(`#802 ${nome}: falha do SharePoint degrada, não desloga`, () => {
    const gate = bloco(regiao, GATE_WORK);
    const falha = bloco(gate, "catch");
    assert.ok(
      falha.includes("setSites([])"),
      `${nome}: a falha de sites tem que limpar a lista`,
    );
    assert.ok(
      !falha.includes("setUser(null)"),
      `${nome}: 400/403 opcional NÃO pode derrubar a sessão (regressão do #802)`,
    );
  });
}

test("#803 Bridge gateia o Mail ANTES da primeira request de pastas", () => {
  const gateEm = controlRoom.indexOf(GATE_MAIL);
  assert.notEqual(gateEm, -1, "gate de capability do Mail sumiu");
  const requestEm = controlRoom.indexOf("crMailFolders", gateEm);
  assert.notEqual(requestEm, -1, "request de pastas não encontrada após o gate");

  const anterior = controlRoom.slice(0, gateEm);
  assert.ok(
    !anterior.includes(".crMailFolders("),
    "houve request de Mail ANTES do gate de capability — é o furo do #803",
  );

  const corpo = bloco(controlRoom, GATE_MAIL);
  assert.ok(corpo.includes("setPastas([])"), "o gate tem que limpar as pastas");
  assert.ok(corpo.includes("return"), "o gate tem que interromper o efeito");
});

test("#803 cr_pessoas só consulta o diretório /users em conta de org", () => {
  const pessoas = bloco(graph, "pub fn cr_pessoas(");
  const orgEm = pessoas.indexOf("if eh_org");
  assert.notEqual(orgEm, -1, "gate eh_org sumiu de cr_pessoas");

  const antes = pessoas.slice(0, orgEm);
  assert.ok(
    !antes.includes("{GRAPH}/users"),
    "/users é consultado antes do gate de org — é o furo do #803",
  );
  assert.equal(
    pessoas.split("{GRAPH}/users").length - 1,
    1,
    "há mais de uma consulta a /users em cr_pessoas; só a de dentro do gate é válida",
  );
});
