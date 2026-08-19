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

/**
 * Formata a data do feed para o BADGE do modal (#1258).
 *
 * O bug (achado da `Iris`): `atualizacao.tsx` fazia `novo.date?.split(" ")[0]`,
 * que so funcionaria em `"2026-08-19 06:11:36"`. O feed REAL publica
 * `pub_date: "2026-08-19T06:11:36Z"` (conferido no `latest.json` da v0.46.0),
 * sem espaco — o split devolvia a string inteira e o usuario via
 * `Versao 0.46.0 (2026-08-19T06:11:36Z)`, um timestamp de maquina na cara dele.
 *
 * Apresentacao escolhida: data NUMERICA na ordem do idioma (pt `19/08/2026`,
 * en `08/19/2026`). O badge e estreito, entao mes por extenso ("19 de ago. de
 * 2026") ocupa demais; e ano com 4 digitos porque `dateStyle:"short"` em en-US
 * vira `8/19/26`, que envelhece mal num aviso de versao.
 *
 * ⚠️ FUSO — as duas metades da regra, e elas sao diferentes de proposito:
 *  - String com HORA (instante real): converte para o fuso LOCAL. Em `-03`,
 *    `2026-08-19T01:00:00Z` e mesmo dia **18** para quem le — mostrar 19 seria
 *    mentir sobre o relogio do usuario.
 *  - String SO com data (`2026-08-19`, sem hora): renderiza LITERAL, sem passar
 *    por `Date`. `new Date("2026-08-19")` e meia-noite UTC e voltaria 18/08 em
 *    fuso negativo — a armadilha classica, aqui evitada em vez de "corrigida".
 *
 * @param bruto    `update.date` do plugin (ISO, forma com espaco, ou ausente).
 * @param idioma   locale do app (`pt`/`en`) — define a ORDEM dos campos.
 * @param timeZone fuso explicito; so os testes passam (produção usa o da maquina).
 * @returns data formatada, ou `""` quando nao da para ler — o badge entao mostra
 *          so a versao (o consumidor ja faz `?? ""` + `.trim()`).
 */
export function formatarDataFeed(
  bruto: string | undefined | null,
  idioma: string,
  timeZone?: string
): string {
  const s = bruto?.trim();
  if (!s) return "";

  const formatar = (d: Date, tz?: string) =>
    new Intl.DateTimeFormat(idioma, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      ...(tz ? { timeZone: tz } : {}),
    }).format(d);

  // Caso 1 — SO data: literal, sem conversao de fuso (ver aviso acima).
  const soData = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (soData) {
    const [, a, m, d] = soData;
    // UTC + timeZone UTC: os campos saem exatamente como vieram, e o Intl
    // continua decidindo a ORDEM pelo idioma.
    return formatar(new Date(Date.UTC(+a, +m - 1, +d)), "UTC");
  }

  // Caso 2 — instante completo (ISO, o formato real do feed): converte pro local.
  const dt = new Date(s);
  if (!Number.isNaN(dt.getTime())) return formatar(dt, timeZone);

  // Caso 3 — forma com espaco que o `Date` nao parseia (ex.: o RFC3339 folgado
  // `2026-08-19 06:11:36.0 +00:00:00` que o Tauri ja emitiu). Cai no prefixo de
  // data, que e literal — mesma regra do caso 1.
  const prefixo = /^(\d{4})-(\d{2})-(\d{2})\b/.exec(s);
  if (prefixo) {
    const [, a, m, d] = prefixo;
    return formatar(new Date(Date.UTC(+a, +m - 1, +d)), "UTC");
  }

  // Ilegivel: melhor badge so com a versao do que lixo na cara do usuario.
  return "";
}
