// #1033 (auditoria #994, FE10/FE16): trava o CONTRATO Tauri↔React. O FE chama
// comandos por string (`invoke("nome")`) e o Rust os registra no
// `generate_handler![…]` (`src-tauri/src/lib.rs`). Uma divergência — invocar um
// comando que ninguém registra, ou aposentar um comando ainda invocado — hoje só
// aparece como bug em produção. Este gate a torna FALHA DE CI: faz o parse dos
// dois lados estaticamente e cruza.
//
// Estilo dos gates da Lúmen (parse do fonte, sem rodar o app). Rode com:
//   node --test --experimental-strip-types src/lib/contrato-tauri.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const LIB_RS = new URL("../../src-tauri/src/lib.rs", import.meta.url);
const SRC_DIR = fileURLToPath(new URL("../", import.meta.url)); // .../src

/**
 * Comandos REGISTRADOS: identificadores dentro do `tauri::generate_handler![…]`.
 * Cada entrada pode vir com prefixo de módulo (`remote::remote_session_start`) —
 * o NOME do comando (o que o `invoke` usa) é o último segmento `::`. Comentários
 * `//` são removidos por linha.
 */
function comandosRegistrados(): Set<string> {
  const rs = readFileSync(LIB_RS, "utf8");
  const i = rs.indexOf("generate_handler![");
  assert.ok(i >= 0, "não achei `generate_handler![` em src-tauri/src/lib.rs");
  const fim = rs.indexOf("])", i); // o handler fecha com `])`
  assert.ok(fim > i, "não achei o fecho `])` do generate_handler!");
  const bloco = rs.slice(i + "generate_handler![".length, fim);

  const cmds = new Set<string>();
  for (let linha of bloco.split("\n")) {
    linha = linha.replace(/\/\/.*$/, "").trim().replace(/,+$/, "").trim();
    if (!linha) continue;
    const nome = linha.split("::").pop()!.trim();
    if (/^[a-z_][a-z0-9_]*$/.test(nome)) cmds.add(nome);
  }
  return cmds;
}

/**
 * Comandos INVOCADOS pelo FE: literais de `invoke("nome")` / `invoke<T>("nome")`
 * em todo `src/**` (menos os próprios testes). Só literais — comando montado em
 * variável não dá pra cruzar estaticamente (o "dentro do que for praticável" do
 * AC). Mapa nome→arquivo pra a mensagem de erro apontar onde.
 */
function comandosInvocados(): Map<string, string> {
  const achados = new Map<string, string>();
  const re = /invoke(?:<[^>]*>)?\(\s*"([a-z_][a-z0-9_]*)"/g;
  (function walk(dir: string) {
    for (const entrada of readdirSync(dir)) {
      const p = join(dir, entrada);
      if (statSync(p).isDirectory()) {
        walk(p);
      } else if (/\.(ts|tsx)$/.test(entrada) && !/\.test\./.test(entrada)) {
        const texto = readFileSync(p, "utf8");
        for (const m of texto.matchAll(re)) {
          if (!achados.has(m[1])) achados.set(m[1], p);
        }
      }
    }
  })(SRC_DIR);
  return achados;
}

/**
 * #1033: comandos REGISTRADOS que o FE não invoca por literal — allowlist do que é
 * intencional (registrado pra um fluxo ainda não fiado no FE, ou chamado só do
 * Rust). Igual à baseline do #1221: entrada aqui exige justificativa, e a lista só
 * deve encolher. Um registrado-sem-uso NOVO reprova até virar uso ou entrar aqui.
 */
const REGISTRADOS_SEM_USO_FE: Record<string, string> = {
  // #1129 L1: expõe a chave pública/device_id do device pro registro (PoP). O
  // segredo nunca sai do Rust; a fiação FE virá numa fatia do Remote.
  remote_device_public_key: "#1129 L1 — chave pública do device, FE ainda não fia",
};

test("#1033: todo comando INVOCADO pelo FE está registrado no generate_handler! (senão CI quebra, não a produção)", () => {
  const registrados = comandosRegistrados();
  assert.ok(
    registrados.size > 100,
    `parse do generate_handler! só achou ${registrados.size} comandos — provável quebra do parser`,
  );
  const invocados = comandosInvocados();
  const orfaos: string[] = [];
  for (const [cmd, arquivo] of invocados) {
    if (!registrados.has(cmd)) orfaos.push(`${cmd} (invocado em ${arquivo})`);
  }
  assert.deepEqual(
    orfaos,
    [],
    `invoke("…") de comando NÃO registrado no Rust — some em produção como "command not found". Registre no generate_handler! ou corrija o nome:\n${orfaos.map((o) => "  " + o).join("\n")}`,
  );
});

test("#1033: todo comando REGISTRADO é invocado pelo FE, salvo allowlist justificada (a lista só encolhe)", () => {
  const registrados = comandosRegistrados();
  const invocados = new Set(comandosInvocados().keys());
  const semUso = [...registrados].filter(
    (c) => !invocados.has(c) && !(c in REGISTRADOS_SEM_USO_FE),
  );
  assert.deepEqual(
    semUso,
    [],
    `comando registrado no Rust que o FE nunca invoca (por literal). Se é uso morto, remova do generate_handler!; se é intencional (ainda não fiado / só-Rust), adicione ao REGISTRADOS_SEM_USO_FE com a justificativa:\n${semUso.map((o) => "  " + o).join("\n")}`,
  );
  // A allowlist não pode apodrecer: entrada que já virou uso deve sair dela.
  const allowlistObsoleta = Object.keys(REGISTRADOS_SEM_USO_FE).filter(
    (c) => !registrados.has(c) || invocados.has(c),
  );
  assert.deepEqual(
    allowlistObsoleta,
    [],
    `REGISTRADOS_SEM_USO_FE tem entrada que já é invocada (ou nem existe mais) — remova, a allowlist só encolhe: ${allowlistObsoleta.join(", ")}`,
  );
});
