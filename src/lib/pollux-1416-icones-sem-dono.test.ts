// #1416 — ícone sem importador é código morto que PARECE vivo.
//
// Família #1328/#1355/#1386: função ou componente com aparência de uso, sem
// chamador. O custo não é disco — é o tempo do próximo, que encontra o arquivo e
// gasta a cabeça decidindo se é a versão boa. Foi o que quase aconteceu no #1260
// e o que fez o `getTreeContextMenu` viver meses com guarda e sem consumidor.
//
// Esta catraca não cabia no #1328: rodada lá, ela nasceria VERMELHA por causa
// dos dois arquivos que este card remove. Escrever uma versão que os excluísse
// seria guarda feita pra passar. Por isso ela chega junto com a remoção.
//
// Alcance, dito em voz alta: conta importador de PRODUÇÃO. Ícone usado só por
// teste é órfão do mesmo jeito — o teste passaria a ser a única razão de ele
// existir, que é exatamente o defeito.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const RAIZ = new URL("../..", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);
const SRC = join(RAIZ, "src");
const ICONES = join(SRC, "components", "ui", "icons");

const EXTENSOES = [".ts", ".tsx", ".json"];

function arquivosDe(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) arquivosDe(p, acc);
    else acc.push(p);
  }
  return acc;
}

const ehTeste = (p: string) => /\.(test|spec)\.tsx?$/.test(p);
const ehCodigo = (p: string) => /\.(ts|tsx)$/.test(p);

/**
 * Resolve um especificador de import no arquivo que ele aponta. `@/x` é o alias
 * de `src/x` (tsconfig/vite). Resolver DE VERDADE, em vez de casar o nome do
 * arquivo, é o ponto: `"@/screens/control-room"` e
 * `"@/components/ui/icons/marca/control-room"` terminam no mesmo sufixo e um
 * grep ingênuo dá o ícone como usado — foi o falso-positivo que eu levei ao
 * medir este card à mão.
 */
function resolverImport(deArquivo: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(deArquivo), spec);
  else return null; // pacote de node_modules

  const candidatos = [
    base,
    ...EXTENSOES.map((e) => base + e),
    ...EXTENSOES.map((e) => join(base, "index" + e)),
  ];
  for (const c of candidatos) {
    try {
      if (statSync(c).isFile()) return c;
    } catch {
      /* não existe: tenta o próximo */
    }
  }
  return null;
}

/** Todos os especificadores de um arquivo: `from "x"` e `import("x")`. */
function importsDe(fonte: string): string[] {
  const fora: string[] = [];
  for (const m of fonte.matchAll(/\bfrom\s*["']([^"']+)["']/g)) fora.push(m[1]);
  for (const m of fonte.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g))
    fora.push(m[1]);
  return fora;
}

/** Conjunto de arquivos alcançados por algum import de produção. */
function alcancadosPorProducao(): Set<string> {
  const alcancados = new Set<string>();
  for (const p of arquivosDe(SRC)) {
    if (!ehCodigo(p) || ehTeste(p)) continue;
    const fonte = readFileSync(p, "utf8");
    for (const spec of importsDe(fonte)) {
      const alvo = resolverImport(p, spec);
      // Auto-import não conta: arquivo não se mantém vivo sozinho.
      if (alvo && alvo !== p) alcancados.add(alvo);
    }
  }
  return alcancados;
}

describe("#1416 ícones sem importador", () => {
  it("todo arquivo de ui/icons é importado por código de produção", () => {
    const alcancados = alcancadosPorProducao();
    const orfaos = arquivosDe(ICONES)
      .filter((p) => !ehTeste(p))
      .filter((p) => !alcancados.has(p))
      .map((p) => relative(SRC, p).replace(/\\/g, "/"))
      .sort();

    assert.deepEqual(
      orfaos,
      [],
      "arquivo em ui/icons sem importador de produção — ou dá dono a ele, ou apaga (é código morto que parece vivo)",
    );
  });

  it("a varredura enxerga imports de verdade — não é vacuosa", () => {
    // Sem isto, um regex quebrado devolveria "zero órfãos" e a catraca viraria
    // enfeite. Ancoro em dois fatos que só valem se a resolução funcionar: um
    // ícone alcançado por ALIAS e um asset .json alcançado COM extensão.
    const alcancados = alcancadosPorProducao();
    assert.ok(
      alcancados.has(join(ICONES, "marca-anim.tsx")),
      "não resolvi nem o marca-anim, que o navegacao.ts importa por alias",
    );
    assert.ok(
      alcancados.has(join(ICONES, "marca", "pirate-costume.json")),
      "não resolvi o asset .json do pirata (import com extensão)",
    );
    assert.ok(alcancados.size > 50, `alcançados só ${alcancados.size} arquivos`);
  });
});
