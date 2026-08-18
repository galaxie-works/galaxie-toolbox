import assert from "node:assert/strict";
import { readFileSync, globSync } from "node:fs";
import test from "node:test";

// #1074 F1 (RB37) — gate RATCHET: toda chamada HTTP do Graph tem que passar pelo
// `graph_enviar`, que é quem aplica o teto de 4 requisições em voo
// (`GRAPH_MAX_CONCORRENTES`) e o retry com `Retry-After`.
//
// O cabeçalho do `graph.rs` já DECLARA essa regra. ⚠️ MEDIDO: o `graph.rs` tem 81
// chamadas `client.*`, mas **77 já estão dentro de closures de `graph_enviar`** — só
// 4 furam. Somando `auth.rs` (1) e `favicon.rs` (2), a dívida real é **7**, não 81.
// (A US #1074 fala em 22; um grep cru dá 81. Os dois números enganam: um conta o que
// já foi convertido, o outro é de um commit velho. Contar símbolo sem olhar o
// contexto é o erro que este gate existe para impedir.)
//
// Converter sem gate seria tapa-buraco: `graph.rs` é tocado por várias raias e a
// contagem volta a subir enquanto a PR está aberta.
//
// Por isso o gate vem ANTES da conversão (mesma forma do gate de ícone do #1153):
// a BASELINE congela a dívida conhecida e **só pode encolher**. Chamada direta NOVA
// reprova na hora. Ao converter um call site, baixe o número da BASELINE.

const ALVOS = "src-tauri/src/*.rs";

/** Bindings que SÃO um client HTTP. `v.get()`/`lru.get()`/`mapa.get()` são coleção. */
const CLIENT_HTTP = /\b(?:client|cliente)\.(?:get|post|patch|delete)\s*\(/g;
const ABRE_ENVIAR = /\bgraph_enviar\s*\(/g;

/**
 * Zera comentários (linha e bloco) preservando o comprimento, para que os índices
 * de caractere continuem valendo e o scanner não conte exemplo dentro de doc.
 */
function semComentarios(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    if (src.startsWith("//", i)) {
      const fim = src.indexOf("\n", i);
      const ate = fim === -1 ? src.length : fim;
      out += " ".repeat(ate - i);
      i = ate;
    } else if (src.startsWith("/*", i)) {
      const fim = src.indexOf("*/", i + 2);
      const ate = fim === -1 ? src.length : fim + 2;
      for (let k = i; k < ate; k++) out += src[k] === "\n" ? "\n" : " ";
      i = ate;
    } else {
      out += src[i];
      i++;
    }
  }
  return out;
}

/**
 * Faixas [inicio, fim) de cada `graph_enviar(...)`, achando o parêntese que fecha
 * por contagem de profundidade. É o que responde de verdade "está dentro do
 * closure?" — contar linhas próximas daria falso negativo em closure longo.
 */
function faixasCobertas(src: string): Array<[number, number]> {
  const faixas: Array<[number, number]> = [];
  for (const m of src.matchAll(ABRE_ENVIAR)) {
    const abre = m.index + m[0].length - 1;
    let prof = 0;
    let i = abre;
    for (; i < src.length; i++) {
      if (src[i] === "(") prof++;
      else if (src[i] === ")") {
        prof--;
        if (prof === 0) break;
      }
    }
    faixas.push([m.index, i === src.length ? src.length : i + 1]);
  }
  return faixas;
}

function violacoes(src: string): number {
  const limpo = semComentarios(src);
  const faixas = faixasCobertas(limpo);
  let n = 0;
  for (const m of limpo.matchAll(CLIENT_HTTP)) {
    const pos = m.index;
    if (!faixas.some(([a, b]) => pos >= a && pos < b)) n++;
  }
  return n;
}

// Dívida PRÉ-EXISTENTE por arquivo, medida no `feat`. Estes números só podem
// DIMINUIR. Ao converter um call site para `graph_enviar`, baixe o número aqui —
// o gate reprova se o arquivo passar do teto, e também se um arquivo novo aparecer
// com chamada direta.
const BASELINE: Record<string, number> = {
  "src-tauri/src/graph.rs": 4,
  "src-tauri/src/favicon.rs": 2,
  "src-tauri/src/auth.rs": 1,
};

test("#1074 RB37: chamada HTTP direta fora do graph_enviar não pode aumentar", () => {
  const arquivos = globSync(ALVOS).sort();
  assert.ok(arquivos.length > 0, "glob não achou nenhum .rs — caminho errado?");

  const excesso: string[] = [];
  const folga: string[] = [];

  for (const arq of arquivos) {
    const chave = arq.replace(/\\/g, "/");
    const n = violacoes(readFileSync(arq, "utf8"));
    const teto = BASELINE[chave] ?? 0;
    if (n > teto) {
      excesso.push(
        `${chave}: ${n} chamadas diretas, baseline ${teto} (+${n - teto})`,
      );
    } else if (n < teto) {
      folga.push(`${chave}: ${n} < baseline ${teto} — baixe a BASELINE`);
    }
  }

  // Os dois problemas são reportados JUNTOS, num assert só. Com um `assert` para
  // cada, o primeiro a falhar ESCONDE o segundo — e foi exatamente o que aconteceu
  // na primeira versão deste gate: o excesso de um arquivo mascarou uma BASELINE
  // inteira que estava errada, e eu quase publiquei o número errado.
  // Gate que mostra metade do diagnóstico atrasa a correção da outra metade.
  const problemas = [
    ...excesso.map(
      (e) => `EXCESSO — chamada direta NOVA fura o teto de 4 em voo: ${e}`,
    ),
    ...folga.map(
      (f) => `BASELINE FROUXA — a dívida caiu e o número não acompanhou: ${f}`,
    ),
  ];

  assert.deepEqual(
    problemas,
    [],
    "toda chamada HTTP do Graph passa por `graph_enviar(rotulo, teto, || …)`:\n" +
      problemas.join("\n"),
  );
});

test("#1074 RB37: o gate reconhece cobertura por graph_enviar e ignora coleção", () => {
  // Dentro do closure → coberto.
  assert.equal(
    violacoes(`fn f() { let r = graph_enviar("x", 5, || { client.get(&u).send() }); }`),
    0,
  );
  // Fora do closure → violação.
  assert.equal(violacoes(`fn f() { let r = client.get(&u).send(); }`), 1);
  // `.get()` de coleção não é chamada HTTP.
  assert.equal(violacoes(`fn f() { let a = mapa.get(&k); let b = lru.get(&k); }`), 0);
  // Comentário não conta.
  assert.equal(violacoes(`fn f() { /* client.get(&u) */ let a = 1; }`), 0);
  // Closure longo: a chamada no fim continua coberta (por isso o scan é de parênteses).
  assert.equal(
    violacoes(
      `fn f() { graph_enviar("x", 5, || {\n${"  let a = 1;\n".repeat(40)}  client.post(&u).send()\n}); }`,
    ),
    0,
  );
});

// ─────────────── #1074 F3 (RB44): um client HTTP, com timeout ───────────────
// Eram 87 `Client::new()` no `graph.rs`, NENHUM com timeout. Cada `new()` monta o
// próprio pool de conexão (nem reuso de TLS havia) e, sem timeout, a conexão que
// pendura segura uma das 4 vagas do pool para sempre — 4 penduradas param todo o
// tráfego Graph SEM ERRO.
//
// A F3 trocou os 87 por `cliente()` (OnceLock + connect_timeout + timeout). Este
// gate impede o 88º: `Client::new()` só pode existir DENTRO do `cliente()`, como
// fallback de build.

const CLIENT_NEW = /Client::new\s*\(\s*\)/g;

/** Faixa do corpo de `fn cliente()`, achada por profundidade de chaves. */
function faixaDoCliente(src: string): [number, number] | null {
  const m = /fn cliente\s*\([^)]*\)[^{]*\{/.exec(src);
  if (!m) return null;
  const abre = m.index + m[0].length - 1;
  let prof = 0;
  for (let i = abre; i < src.length; i++) {
    if (src[i] === "{") prof++;
    else if (src[i] === "}") {
      prof--;
      if (prof === 0) return [m.index, i + 1];
    }
  }
  return [m.index, src.length];
}

test("#1074 RB44: `Client::new()` só dentro de `cliente()` — o resto usa o compartilhado", () => {
  const src = semComentarios(readFileSync("src-tauri/src/graph.rs", "utf8"));
  const faixa = faixaDoCliente(src);
  assert.ok(faixa, "não achei `fn cliente()` no graph.rs — a F3 foi revertida?");

  const fora: number[] = [];
  for (const m of src.matchAll(CLIENT_NEW)) {
    if (m.index < faixa[0] || m.index >= faixa[1]) fora.push(m.index);
  }
  // Linha, não offset de caractere: `char 9277` não diz a ninguém onde arrumar.
  const linhaDe = (pos: number) => src.slice(0, pos).split("\n").length;

  assert.deepEqual(
    fora.map((i) => `graph.rs:${linhaDe(i)}`),
    [],
    "`Client::new()` fora do `cliente()` — sem timeout e com pool próprio. " +
      "Use `cliente()`; se precisar de tempo maior, sobrescreva por requisição " +
      "com `RequestBuilder::timeout`, não afrouxando o default (#1074 RB44).",
  );
});
