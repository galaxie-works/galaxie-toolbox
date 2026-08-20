import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import test from "node:test";

// #1421 — ratchet de código exportado sem consumidor.
//
// ── Por que ratchet, e não lista de exceções ────────────────────────────────
// O `altair` abriu o card a partir da ressalva da `lumen` (3ª ocorrência da
// classe, no #1328): um detector de código morto num repo com histórico produz
// lista grande, e a saída usual — "estes N são conhecidos, ignore" — precisa de
// curadoria contínua, ninguém revisa depois do primeiro dia, e APODRECE. Foi o
// que aconteceu no #1221.
//
// Aqui é **um número, que só pode encolher**. Não há item para curar. Mesmo
// mecanismo do `oxlint-ratchet.test.ts` (#1056), que já provou funcionar.
//
// ── Por que knip, e não o meu próprio detector ─────────────────────────────
// Eu cheguei neste card vindo do #1416, com um resolvedor de imports cross-file
// pronto — e escrevi um detector caseiro. A escolha foi pelo knip porque a
// própria medição me deu o motivo: eu errei o número TRÊS vezes neste card, e
// sempre no meu código de contagem, nunca no knip.
//   567 → 241: o caseiro misturava caminho relativo com absoluto e chamava de
//              órfão coisa importada na cara dele (`ATALHOS_BRIDGE`);
//   239 → 187: o meu script de medição fazia `if (i.files)` — array VAZIO é
//              truthy em JS, então contei arquivos que não tinham achado nenhum.
// O knip usa o compilador TypeScript. O meu usava regex e aritmética minhas, e
// elas erraram em 3 de 3 tentativas. Para um número que gateia o CI, isso
// decide sozinho.
//
// ── O que quase passou batido, e é o alerta principal deste arquivo ────────
// Rodei knip com `--include exports --include types` e ele NÃO viu um export
// órfão que eu plantei de propósito. A causa: arquivo que ninguém importa é
// classificado por ele como **`files`**, não como `exports`. Sem `--include
// files` o ratchet teria nascido com um falso-negativo enorme — 61 arquivos
// invisíveis, um TERÇO do número — e ficaria verde para sempre.
//
// É o modo de falha que mais me preocupa aqui: teto inflado só atrapalha; teto
// CEGO faz o gate mentir. Por isso o teste abaixo não confia na configuração —
// ele planta um órfão e exige que o número suba.
//
// ── Condição 3 do `altair`: versão e número andam juntos ───────────────────
// O teto só significa algo para uma versão do detector. Subir o knip pode
// revelar mais e estourar o teto sozinho, e a reação natural seria elevar o
// teto no susto — a morte do ratchet. Então a versão é lida do `package.json` e
// CONFERIDA contra a que foi medida: bump e re-medição na MESMA PR.

/** Medido em 2026-08-20, `pre-prod` @ 6f0cecc, com knip 6.32.2. Só encolhe. */
const TETO = 187;

/** A versão com que o `TETO` foi medido. Trocar uma exige trocar o outro. */
const VERSAO_MEDIDA = "6.32.2";

/**
 * Vendorizado: não escrevemos, e contá-lo faria o número oscilar por upstream.
 *
 * `components/ui/icons/` é exceção — é NOSSA arte (foi de lá que saíram os
 * órfãos do #1328 e do #1416). Sem a exceção, a pasta que originou a discussão
 * ficaria fora do detector, que é o pior lugar possível para um ponto cego.
 */
function ehVendor(arquivo: string): boolean {
  const a = arquivo.replace(/\\/g, "/");
  if (a.includes("components/ui/icons/")) return false;
  return (
    a.includes("components/reui/") ||
    a.includes("components/ui/") ||
    a.includes("components/animate-ui/")
  );
}

interface AchadoKnip {
  file: string;
  files?: unknown[];
  exports?: unknown[];
  types?: unknown[];
}

/** Saída crua — guardada para a mensagem de erro poder mostrá-la (#1262). */
function rodarKnip(): string {
  try {
    return execFileSync(
      process.execPath,
      [
        "node_modules/knip/bin/knip.js",
        "--include",
        "exports",
        "--include",
        "types",
        "--include",
        "files",
        "--no-config-hints",
        "--reporter",
        "json",
      ],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (e) {
    // knip sai != 0 quando há achado; a saída é o que interessa nos dois casos.
    const err = e as { stdout?: string; stderr?: string };
    return (err.stdout ?? "") + (err.stderr ?? "");
  }
}

function contar(saida: string): number {
  let issues: AchadoKnip[];
  try {
    issues = (JSON.parse(saida) as { issues?: AchadoKnip[] }).issues ?? [];
  } catch {
    // Vazio-por-erro e vazio-de-verdade são coisas diferentes; confundi-los foi
    // o #1262. A mensagem carrega a evidência em vez de mandar adivinhar.
    throw new Error(
      `o knip não devolveu JSON válido. Saída crua (${saida.length} bytes):\n${saida.slice(0, 2000)}`,
    );
  }
  let total = 0;
  for (const i of issues) {
    if (ehVendor(i.file)) continue;
    total += (i.files?.length ?? 0) > 0 ? 1 : 0;
    total += i.exports?.length ?? 0;
    total += i.types?.length ?? 0;
  }
  return total;
}

test("#1421: a versão do knip é a que mediu o teto", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    devDependencies: Record<string, string>;
  };
  const declarada = pkg.devDependencies.knip;
  assert.equal(
    declarada,
    VERSAO_MEDIDA,
    `o knip mudou de versão (${declarada}) sem o teto ser re-medido. ` +
      "Condição do `altair` no #1421: bump e re-medição na MESMA PR, com o " +
      "número novo justificado — senão o gate fica vermelho sem ninguém ter " +
      "piorado nada, e o reflexo é elevar o teto no susto.",
  );
});

test("#1421: o detector NÃO é cego — órfão plantado faz o número subir", () => {
  // Condição 4 do `altair` (validação retroativa), na forma em que ela se
  // aplica: o detector tem de ver a CLASSE que originou a discussão — export/
  // arquivo de código sem consumidor, a mesma dos #1328, #1355 e #1416.
  //
  // Isto não é cerimônia: com a configuração errada o knip ficou CEGO pra
  // exatamente este caso, e o ratchet teria nascido verde-pra-sempre. Um teto
  // que nunca sobe pode significar repo limpo ou detector morto, e sem esta
  // prova não dá pra distinguir os dois.
  const isca = "src/lib/zz-orfao-plantado-1421.ts";
  const antes = contar(rodarKnip());
  writeFileSync(isca, "export const ORFAO_PLANTADO_1421 = 1;\n");
  try {
    const depois = contar(rodarKnip());
    assert.ok(
      depois > antes,
      `plantei um export sem consumidor e o número NÃO subiu (${antes} → ${depois}). O detector está cego pra classe que este card existe pra pegar.`,
    );
  } finally {
    rmSync(isca, { force: true });
  }
});

test("#1421: código exportado sem consumidor não cresce", () => {
  const saida = rodarKnip();
  const atual = contar(saida);

  // Sanidade: spawn quebrado devolvendo zero faria o ratchet passar pra sempre.
  // Gate que não vê nada é pior que gate nenhum.
  assert.ok(
    atual > 0,
    `o detector não achou NADA — quase certamente o spawn/parse quebrou, não que o repo esteja limpo. Saída crua (${saida.length} bytes):\n${saida.slice(0, 2000)}`,
  );

  assert.ok(
    atual <= TETO,
    `código sem consumidor SUBIU: ${atual} (teto ${TETO}). ` +
      "Ou o que entrou tem consumidor e falta ligá-lo, ou é morto e não devia " +
      "entrar. Encolher é sempre verde: se removeste algo, baixa o TETO junto.",
  );

  // O teto não pode ficar FROUXO: se caiu bem abaixo, alguém limpou e esqueceu
  // de apertar, e o ratchet para de morder. Mesma trava do #1056.
  assert.ok(
    atual >= TETO - 15,
    `o teto ficou frouxo: atual ${atual}, teto ${TETO}. Baixa o TETO para ${atual} — ratchet que não aperta deixa de ser ratchet.`,
  );
});
