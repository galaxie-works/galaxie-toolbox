import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// #1148 — o canal de renovação TURN não pode divergir entre TS e Rust.
//
// ── O defeito que esta guarda impede ───────────────────────────────────────
// O cliente manda `{"type":"renew_ice_servers"}` e espera
// `{"type":"ice_servers_renewed", ...}`. Esses nomes nascem do `serde` no
// `protocol.rs` (`#[serde(tag = "type", rename_all = "snake_case")]`), e o TS os
// repete à mão. Um rename no Rust — ou um typo no TS — compila dos dois lados,
// passa no lint, passa no build, e **só falha em runtime, no meio de um
// atendimento, 30 minutos depois de começar**. É exatamente a classe do
// `contrato-tauri.test.ts` (#1033), aqui aplicada ao WebSocket.
//
// A direção gateada é **TS→Rust**: nome que o cliente usa e o servidor não
// conhece. O contrário (variante no Rust sem uso no TS) não reprova — o BE
// legitimamente expõe mensagem antes de o FE consumir, e gatear isso pediria
// lista de exceções, que é a doença do #1421.

const RAIZ = new URL("../..", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);
const PROTOCOL_RS = join(
  RAIZ,
  "services",
  "remote-signaling",
  "src",
  "protocol.rs",
);
const SIGNALING_TS = join(RAIZ, "src", "lib", "remote-signaling.ts");

/**
 * As variantes de um enum do `protocol.rs`, já no `snake_case` que viaja no fio.
 *
 * O `serde` com `rename_all = "snake_case"` converte `RenewIceServers` em
 * `renew_ice_servers`. Derivar isso (em vez de digitar a lista) é o que faz a
 * guarda detectar um rename em vez de congelar a minha cópia dele.
 */
function variantesNoFio(enumNome: string): Set<string> {
  const fonte = readFileSync(PROTOCOL_RS, "utf8");
  const i = fonte.indexOf(`pub enum ${enumNome} {`);
  assert.ok(i >= 0, `não achei \`pub enum ${enumNome}\` em protocol.rs`);

  // Do `{` até o `}` na coluna 0 — o fecho do enum.
  const corpo = fonte.slice(i, fonte.indexOf("\n}", i));
  const nomes = new Set<string>();
  for (const linha of corpo.split("\n").slice(1)) {
    const t = linha.trim();
    if (!t || t.startsWith("//") || t.startsWith("#[") || t.startsWith("///")) {
      continue;
    }
    // Variante começa com maiúscula no início da linha: `Registered {`,
    // `RenewIceServers,`. Campos internos são minúsculos, então não casam.
    const m = t.match(/^([A-Z][A-Za-z0-9]*)\s*[,{]/);
    if (m?.[1]) {
      nomes.add(
        m[1].replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase(),
      );
    }
  }
  return nomes;
}

/**
 * Os valores de `type:` que a união do TS declara, para um dos dois lados.
 *
 * O fim da união é achado por ESTRUTURA (a primeira linha depois do início que
 * começa na coluna 0 e não faz parte do alias), não por caractere. A 1ª versão
 * procurava `";\n"` e o arquivo é CRLF: `";\n"` nunca casa em `";\r\n"`, então o
 * bloco ia até o fim do arquivo e a união do cliente "continha" as mensagens do
 * servidor. Quem acusou foi a asserção, não uma releitura minha — terceira
 * armadilha de parser deste tipo em um dia, e a terceira pega pelo próprio teste.
 */
function tiposNoTs(uniao: string): string[] {
  const fonte = readFileSync(SIGNALING_TS, "utf8");
  const linhas = fonte.split(/\r?\n/);
  const inicio = linhas.findIndex((l) =>
    l.startsWith(`export type ${uniao} =`),
  );
  assert.ok(inicio >= 0, `não achei \`export type ${uniao}\` no TS`);

  const bloco: string[] = [];
  for (const linha of linhas.slice(inicio + 1)) {
    // Continuação do alias: indentada, ou fechando com `;`. Uma linha nova
    // começando na coluna 0 (outro `export`, um comentário de topo) encerra.
    if (/^\S/.test(linha) && linha.trim() !== "") break;
    bloco.push(linha);
  }
  return [...bloco.join("\n").matchAll(/type:\s*"([a-z_]+)"/g)].map(
    (m) => m[1] as string,
  );
}

test("#1148: a varredura enxerga os dois lados (anti-vazio)", () => {
  const cliente = variantesNoFio("ClientMessage");
  const servidor = variantesNoFio("ServerMessage");
  assert.ok(
    cliente.size >= 4,
    `li ${cliente.size} variantes de ClientMessage — parse quebrado devolveria ` +
      `conjunto vazio, e vazio faria as asserções de baixo passarem sempre`,
  );
  assert.ok(servidor.size >= 5, `li ${servidor.size} variantes de ServerMessage`);
  assert.ok(tiposNoTs("ClientMessage").length >= 5, "união TS do cliente vazia");
  assert.ok(tiposNoTs("ServerMessage").length >= 5, "união TS do servidor vazia");

  // Âncora do card: as duas mensagens do #1148 existem no Rust. Se alguém
  // remover a rota, esta guarda avisa antes de o cliente falar sozinho.
  assert.ok(
    cliente.has("renew_ice_servers"),
    "`RenewIceServers` sumiu do protocol.rs — o cliente do #1148 ficaria falando com ninguém",
  );
  assert.ok(
    servidor.has("ice_servers_renewed"),
    "`IceServersRenewed` sumiu do protocol.rs",
  );
});

test("#1148: nenhum `type` do TS é desconhecido do Rust", () => {
  for (const [uniao, enumRust] of [
    ["ClientMessage", "ClientMessage"],
    ["ServerMessage", "ServerMessage"],
  ] as const) {
    const noFio = variantesNoFio(enumRust);
    const desconhecidos = tiposNoTs(uniao).filter((t) => !noFio.has(t));
    assert.deepEqual(
      desconhecidos,
      [],
      `\`${uniao}\` (TS) declara \`type\` que o \`${enumRust}\` do protocol.rs ` +
        `não tem. Compila, passa no lint e só falha EM RUNTIME:\n  ` +
        `${desconhecidos.join("\n  ")}`,
    );
  }
});
