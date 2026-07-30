/**
 * Historico de navegacao do Navigator (Story 5 / #177).
 *
 * Modelo proprio, DESACOPLADO das abas: cada visita e uma entrada
 * `{ url, nome, ts }`. A lista inteira persiste em localStorage — mesmo padrao
 * dos pins/grupos (`navigator-tabs.ts`) e dos favoritos (`navigator-bookmarks.ts`).
 * As funcoes de escrita sao imutaveis (devolvem uma nova lista) para casarem com
 * o `setState` do React.
 *
 * A CAPTURA acontece nos pontos onde o app COMMITA uma URL num webview: abrir um
 * app M365, tracar uma rota na omnibox ou abrir um favorito (todos funilam pelos
 * handlers do `App.tsx`). Sub-navegacao DENTRO da pagina (clicar um link no
 * Outlook/SharePoint) nao chega ao front sem um hook nativo `on_navigation`
 * (spec §8.1) — fica documentado como a evolucao natural desta base.
 */

export interface HistoryEntry {
  id: string;
  /** Destino http(s) visitado. */
  url: string;
  /** Rotulo curto (nome do app ou hostname). */
  nome: string;
  /** Momento da visita (epoch ms). */
  ts: number;
}

export const NAVIGATOR_HISTORY_KEY = "galaxie.navigator.history.v1";

/** Teto de entradas guardadas — o historico nao cresce sem limite entre sessoes. */
export const NAVIGATOR_HISTORY_MAX = 1000;

/** Visitas repetidas da MESMA url dentro desta janela nao viram nova entrada
 *  (so atualizam o timestamp) — evita poluir com recarregamentos/redirects. */
const JANELA_DEDUP_MS = 60_000;

let contadorId = 0;
/** Id local unico e estavel dentro da sessao (nao vaza pra fora do app). */
export function novoHistoricoId(): string {
  contadorId += 1;
  return `hist-${Date.now().toString(36)}-${contadorId}`;
}

function ehEntrada(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== "object") return false;
  const e = value as Partial<HistoryEntry>;
  return (
    typeof e.id === "string" &&
    typeof e.nome === "string" &&
    typeof e.url === "string" &&
    /^https?:\/\//i.test(e.url) &&
    typeof e.ts === "number" &&
    Number.isFinite(e.ts)
  );
}

/** Higieniza a lista vinda do storage (descarta entradas malformadas) e devolve
 *  ordenada por recencia (mais nova primeiro). */
function sanear(bruto: unknown): HistoryEntry[] {
  if (!Array.isArray(bruto)) return [];
  return bruto
    .filter(ehEntrada)
    .map((e) => ({ id: e.id, url: e.url, nome: e.nome, ts: e.ts }))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, NAVIGATOR_HISTORY_MAX);
}

export function loadHistorico(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return sanear(JSON.parse(localStorage.getItem(NAVIGATOR_HISTORY_KEY) || "[]"));
  } catch {
    return [];
  }
}

export function persistHistorico(entries: HistoryEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(NAVIGATOR_HISTORY_KEY, JSON.stringify(entries));
  } catch {
    // best-effort (storage indisponivel/quota cheia).
  }
}

/**
 * Registra uma visita no topo da lista (mais nova primeiro). So http(s) entra.
 * Se a entrada mais recente e a MESMA url dentro da janela de dedup, apenas
 * atualiza o timestamp/nome em vez de criar uma duplicata. Aplica o teto.
 */
export function registrarVisita(
  entries: HistoryEntry[],
  visita: { url: string; nome: string },
  now = Date.now(),
): HistoryEntry[] {
  const url = visita.url.trim();
  if (!/^https?:\/\//i.test(url)) return entries;
  const nome = (visita.nome || url).trim();

  const maisRecente = entries[0];
  if (
    maisRecente &&
    maisRecente.url === url &&
    now - maisRecente.ts < JANELA_DEDUP_MS
  ) {
    return [{ ...maisRecente, ts: now, nome }, ...entries.slice(1)];
  }

  const nova: HistoryEntry = { id: novoHistoricoId(), url, nome, ts: now };
  return [nova, ...entries].slice(0, NAVIGATOR_HISTORY_MAX);
}

/** Filtra por termo (nome ou url), preservando a ordem por recencia. */
export function buscarHistorico(
  entries: HistoryEntry[],
  termo: string,
): HistoryEntry[] {
  const q = termo.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(
    (e) =>
      e.nome.toLowerCase().includes(q) || e.url.toLowerCase().includes(q),
  );
}

export type PeriodoLimpeza = "ultima-hora" | "hoje" | "tudo";

/**
 * Limpa o historico por periodo. `tudo` zera; os demais removem as entradas
 * A PARTIR do corte (mantem o que e mais antigo que o corte). "hoje" usa o
 * inicio do dia local.
 */
export function limparHistorico(
  entries: HistoryEntry[],
  periodo: PeriodoLimpeza,
  now = Date.now(),
): HistoryEntry[] {
  if (periodo === "tudo") return [];
  let corte: number;
  if (periodo === "ultima-hora") {
    corte = now - 3_600_000;
  } else {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    corte = d.getTime();
  }
  return entries.filter((e) => e.ts < corte);
}

export interface MaisAcessado {
  url: string;
  nome: string;
  contagem: number;
  ultimoAcesso: number;
}

/**
 * "Mais acessados" REAL: conta as visitas por url e devolve as `limite` mais
 * frequentes (desempate pela mais recente). Substitui a lista estatica
 * `MAIS_USADOS` (spec §8.3).
 */
export function maisAcessados(
  entries: HistoryEntry[],
  limite = 9,
): MaisAcessado[] {
  const mapa = new Map<string, MaisAcessado>();
  for (const e of entries) {
    const atual = mapa.get(e.url);
    if (atual) {
      atual.contagem += 1;
      if (e.ts > atual.ultimoAcesso) {
        atual.ultimoAcesso = e.ts;
        atual.nome = e.nome;
      }
    } else {
      mapa.set(e.url, {
        url: e.url,
        nome: e.nome,
        contagem: 1,
        ultimoAcesso: e.ts,
      });
    }
  }
  return [...mapa.values()]
    .sort(
      (a, b) => b.contagem - a.contagem || b.ultimoAcesso - a.ultimoAcesso,
    )
    .slice(0, limite);
}
