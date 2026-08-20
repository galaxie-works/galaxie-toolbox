import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// #1033 (FE16) — o contrato Tauri↔React não pode divergir em silêncio.
//
// `invoke("comando_que_nao_existe")` compila, passa no lint, passa no build e
// só falha EM RUNTIME, na máquina do usuário, quando alguém clica no botão. A
// auditoria #994 varreu e não achou divergência — resultado positivo que só
// vale se ficar congelado: sem gate, ele volta a divergir no primeiro PR.
//
// A direção que importa é **invocado sem registro**. O contrário (registrado
// sem invocador) NÃO reprova: um comando pode existir para uma tela futura ou
// ser chamado de outro ponto do Rust, e transformar isso em falha exigiria uma
// lista de exceções — a doença que o #1421 e o #1221 documentam. Fica reportado
// no `console` como informação, sem gatear.
//
// Guardas de método, aprendidas nas varreduras de hoje (#1306, #1416, #1421):
//   - DERIVAR as listas, nunca digitá-las;
//   - anti-vazio: parse quebrado devolvendo zero divergências passaria pra
//     sempre — gate que não vê nada é pior que gate nenhum;
//   - a própria varredura tem asserção, não só o que ela varre.

const RAIZ = new URL("../..", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);
const SRC = join(RAIZ, "src");
const LIB_RS = join(RAIZ, "src-tauri", "src", "lib.rs");

/**
 * Os comandos registrados no `generate_handler![...]`. O nome do comando é o
 * ÚLTIMO segmento do caminho (`fs_explorer::fs_watch` → `fs_watch`): é assim
 * que o Tauri o expõe, e casar o caminho inteiro daria falso-negativo.
 */
function comandosRegistrados(): Set<string> {
  const fonte = readFileSync(LIB_RS, "utf8");
  const i = fonte.indexOf("generate_handler![");
  assert.ok(i >= 0, "não achei o `generate_handler![` em lib.rs");
  const fim = fonte.indexOf("])", i);
  assert.ok(fim > i, "não achei o fim do `generate_handler![`");
  const bloco = fonte.slice(i, fim);
  const nomes = new Set<string>();
  for (const linha of bloco.split("\n").slice(1)) {
    const t = linha.trim().replace(/,$/, "");
    if (!t || t.startsWith("//")) continue;
    nomes.add(t.split("::").pop() as string);
  }
  return nomes;
}

function arquivosDe(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) arquivosDe(p, acc);
    else if (/\.(ts|tsx)$/.test(nome)) acc.push(p);
  }
  return acc;
}

interface Invocacao {
  cmd: string;
  arquivo: string;
}

/** Todo `invoke("cmd")` / `invoke<T>("cmd")` do frontend, com a origem. */
function comandosInvocados(): Invocacao[] {
  const fora: Invocacao[] = [];
  for (const p of arquivosDe(SRC)) {
    // Os próprios testes de contrato citam nomes de comando em asserções; ler
    // a si mesmo criaria eco (um nome inventado num teste viraria "invocação").
    if (/\.(test|spec)\.tsx?$/.test(p)) continue;
    const fonte = readFileSync(p, "utf8");
    for (const m of fonte.matchAll(
      /\binvoke\s*(?:<[^>]*>)?\s*\(\s*"([a-z_0-9]+)"/g,
    )) {
      fora.push({ cmd: m[1], arquivo: p.slice(SRC.length + 1).replace(/\\/g, "/") });
    }
  }
  return fora;
}

test("#1033: a varredura enxerga os dois lados — não é vacuosa", () => {
  // Sem isto, um regex quebrado devolveria "zero divergências" e o gate viraria
  // enfeite verde. Os pisos são folgados de propósito: eles pegam parse MORTO,
  // não flutuação normal do repo.
  const registrados = comandosRegistrados();
  const invocados = comandosInvocados();
  assert.ok(
    registrados.size > 100,
    `só ${registrados.size} comandos registrados lidos de lib.rs — o parse quebrou`,
  );
  assert.ok(
    invocados.length > 100,
    `só ${invocados.length} invocações lidas do frontend — o regex quebrou`,
  );
  // Âncora concreta: um comando que existe dos dois lados. Se ele sumir de
  // qualquer um dos lados, é porque a leitura parou de funcionar.
  assert.ok(registrados.has("fs_watch"), "não li `fs_watch` do lib.rs");
});

test("#1033: todo comando invocado no frontend está registrado no Rust", () => {
  const registrados = comandosRegistrados();
  const orfaos = comandosInvocados().filter((i) => !registrados.has(i.cmd));

  assert.deepEqual(
    orfaos,
    [],
    "invoke() de comando que o Rust NÃO registra — isto compila, passa no build " +
      "e falha só em runtime, na máquina do usuário. Ou registra o comando no " +
      "`generate_handler![]`, ou corrige o nome.",
  );
});

test("#1033: comandos registrados sem invocador (informativo, não gateia)", () => {
  const invocados = new Set(comandosInvocados().map((i) => i.cmd));
  const semUso = [...comandosRegistrados()].filter((c) => !invocados.has(c));
  // Não reprova: um comando pode servir a uma tela futura ou ser chamado de
  // outro ponto do Rust. Gatear isto exigiria lista de exceções, que é
  // exatamente o que o #1421 e o #1221 ensinaram a não fazer.
  if (semUso.length > 0) {
    console.log(
      `#1033: ${semUso.length} comando(s) Rust sem invocador no frontend: ${semUso.sort().join(", ")}`,
    );
  }
  assert.ok(true);
});
