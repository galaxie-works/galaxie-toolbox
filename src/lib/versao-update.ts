// Comparacao de versao do updater (#1264).
//
// O modal de atualizacao so pode aparecer quando a versao do feed e
// ESTRITAMENTE mais nova que a instalada. O bug do PO era o dialogo reoferecer
// a MESMA versao ja instalada a cada abertura do app: `check()` do plugin
// devolveu pacote, o front confiou e mostrou. Aqui fica o funil unico que
// decide isso — em .ts puro, testavel sem Tauri.
//
// Rode com:  node --test --experimental-strip-types src/lib/versao-update.test.ts

/** Partes de uma versao semver, ja normalizadas para comparacao. */
interface Partes {
  nums: number[];
  /** Sufixo de pre-release (`-beta.1`), sem o hifen. Vazio = release final. */
  pre: string;
}

/**
 * Quebra "1.2.3-beta.4+build" em partes comparaveis.
 *
 * Tolerante de proposito: o feed e um JSON publicado por outra esteira, entao
 * "v0.45.1", espaco sobrando ou versao com 2 casas nao podem derrubar o app —
 * o que nao for numero vira 0 e a comparacao segue.
 */
function partes(versao: string): Partes {
  const limpa = versao.trim().replace(/^v/i, "");
  const semBuild = limpa.split("+")[0];
  const hifen = semBuild.indexOf("-");
  const nucleo = hifen === -1 ? semBuild : semBuild.slice(0, hifen);
  const pre = hifen === -1 ? "" : semBuild.slice(hifen + 1);
  const nums = nucleo
    .split(".")
    .map((p) => Number.parseInt(p, 10))
    .map((n) => (Number.isFinite(n) ? n : 0));
  return { nums, pre };
}

/**
 * Compara duas versoes semver.
 *
 * @returns negativo se `a` < `b`, 0 se equivalentes, positivo se `a` > `b`.
 */
export function comparaVersoes(a: string, b: string): number {
  const pa = partes(a);
  const pb = partes(b);
  const casas = Math.max(pa.nums.length, pb.nums.length);
  for (let i = 0; i < casas; i++) {
    const diff = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  // Nucleo igual: release final ganha de pre-release (1.0.0 > 1.0.0-beta).
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === "") return 1;
  if (pb.pre === "") return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

/**
 * Decide se o modal de atualizacao pode aparecer.
 *
 * Regra unica (#1264): so oferece quando a disponivel e ESTRITAMENTE mais nova
 * que a instalada. Igual, mais velha, vazia ou ilegivel = nao oferece — o feed
 * republicado com `pub_date` novo (mesmo numero de versao) nao engana mais
 * ninguem, porque a data nao entra na conta.
 */
export function deveOferecerAtualizacao(
  instalada: string | undefined | null,
  disponivel: string | undefined | null
): boolean {
  if (!disponivel?.trim()) return false;
  // Sem saber a instalada nao da para afirmar que a do feed e mais nova;
  // na duvida o app fica quieto (atualizacao e conveniencia, nao alarme).
  if (!instalada?.trim()) return false;
  return comparaVersoes(disponivel, instalada) > 0;
}
