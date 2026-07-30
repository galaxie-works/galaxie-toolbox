export type NavigatorTabLifecycle = "ativa" | "fundo" | "dormindo";

export interface AbaBrowser {
  id: string;
  nome: string;
  url: string;
  favicon?: string;
  estado: NavigatorTabLifecycle;
  ultimoAcesso: number;
  scrollY?: number;
  fixada?: boolean;
  manterAcordada?: boolean;
  reativando?: boolean;
  /** Aba privada (Story 5): navegacao nao entra no historico e o chip ganha
   *  tratamento visual distinto. Privadas nunca sao pinadas/persistidas. */
  privada?: boolean;
}

export interface NavigatorMemorySettings {
  idleMinutes: number;
  maxLive: number;
}

export const NAVIGATOR_MEMORY_DEFAULTS: NavigatorMemorySettings = {
  idleMinutes: 30,
  maxLive: 5,
};

export const NAVIGATOR_MEMORY_SETTINGS_KEY =
  "galaxie.navigator.memory-settings.v1";
const PINNED_TABS_KEY = "galaxie.navigator.pinned-tabs.v1";

function isBrowserTab(value: unknown): value is Partial<AbaBrowser> {
  if (!value || typeof value !== "object") return false;
  const tab = value as Partial<AbaBrowser>;
  return (
    typeof tab.id === "string" &&
    typeof tab.nome === "string" &&
    typeof tab.url === "string" &&
    tab.url.startsWith("https://")
  );
}

export function loadNavigatorMemorySettings(): NavigatorMemorySettings {
  if (typeof window === "undefined") return NAVIGATOR_MEMORY_DEFAULTS;
  try {
    const parsed = JSON.parse(
      localStorage.getItem(NAVIGATOR_MEMORY_SETTINGS_KEY) || "null",
    ) as Partial<NavigatorMemorySettings> | null;
    return {
      idleMinutes:
        typeof parsed?.idleMinutes === "number" &&
        Number.isFinite(parsed.idleMinutes) &&
        parsed.idleMinutes > 0
          ? parsed.idleMinutes
          : NAVIGATOR_MEMORY_DEFAULTS.idleMinutes,
      maxLive:
        typeof parsed?.maxLive === "number" &&
        Number.isInteger(parsed.maxLive) &&
        parsed.maxLive > 0
          ? parsed.maxLive
          : NAVIGATOR_MEMORY_DEFAULTS.maxLive,
    };
  } catch {
    return NAVIGATOR_MEMORY_DEFAULTS;
  }
}

/** Só pins atravessam sessões; todos voltam descartados até o primeiro clique. */
export function loadPinnedNavigatorTabs(): AbaBrowser[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(
      localStorage.getItem(PINNED_TABS_KEY) || "[]",
    ) as unknown;
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed.filter(isBrowserTab).map((tab) => ({
      id: tab.id!,
      nome: tab.nome!,
      url: tab.url!,
      favicon: typeof tab.favicon === "string" ? tab.favicon : undefined,
      estado: "dormindo",
      ultimoAcesso: now,
      scrollY: typeof tab.scrollY === "number" ? tab.scrollY : undefined,
      fixada: true,
      manterAcordada: Boolean(tab.manterAcordada),
    }));
  } catch {
    return [];
  }
}

export function persistPinnedNavigatorTabs(tabs: AbaBrowser[]): void {
  if (typeof window === "undefined") return;
  try {
    const pinned = tabs
      .filter((tab) => tab.fixada)
      .map(
        ({
          id,
          nome,
          url,
          favicon,
          scrollY,
          fixada,
          manterAcordada,
        }) => ({
          id,
          nome,
          url,
          favicon,
          scrollY,
          fixada,
          manterAcordada,
        }),
      );
    localStorage.setItem(PINNED_TABS_KEY, JSON.stringify(pinned));
  } catch {
    // Persistência de pins é best-effort (storage indisponível/quota cheia).
  }
}

export function orderPinnedFirst(tabs: AbaBrowser[]): AbaBrowser[] {
  return [
    ...tabs.filter((tab) => tab.fixada),
    ...tabs.filter((tab) => !tab.fixada),
  ];
}

/**
 * Retorna abas vivas elegíveis para descarte. Idle vence primeiro; depois o
 * teto escolhe a LRU. Ativa, fixada e keep-awake nunca entram na lista.
 */
export function tabsToSleep(
  tabs: AbaBrowser[],
  activeId: string | null,
  settings: NavigatorMemorySettings,
  now = Date.now(),
): string[] {
  const candidates = tabs
    .filter(
      (tab) =>
        tab.estado === "fundo" &&
        tab.id !== activeId &&
        !tab.fixada &&
        !tab.manterAcordada,
    )
    .sort((left, right) => left.ultimoAcesso - right.ultimoAcesso);
  const selected = new Set(
    candidates
      .filter(
        (tab) => now - tab.ultimoAcesso >= settings.idleMinutes * 60_000,
      )
      .map((tab) => tab.id),
  );

  let liveAfterIdle =
    tabs.filter((tab) => tab.estado !== "dormindo").length - selected.size;
  for (const candidate of candidates) {
    if (liveAfterIdle <= settings.maxLive) break;
    if (selected.has(candidate.id)) continue;
    selected.add(candidate.id);
    liveAfterIdle -= 1;
  }
  return [...selected];
}

// --- Grupos de aba (Story 3) -------------------------------------------------
//
// Grupos são entidades nomeadas + coloridas (semente dos Workspaces M365, spec
// §5.3). Ficam DESACOPLADOS do `AbaBrowser`: a definição do grupo vive na sua
// própria lista e a filiação numa tabela `abaId → grupoId`. Isso mantém o
// estado de abas do `App.tsx` intocado — a strip só precisa de UM handler novo
// (reordenar). A cor sai de TOKENS de tema (contraste claro/escuro já tratado),
// nunca de hex; a etiqueta do grupo é sempre o NOME + um pontinho colorido, para
// não depender só da cor (a11y, spec §10).

/** Cores de grupo mapeadas a tokens do tema (não usar hex). */
export const NAVIGATOR_GROUP_COLORS = {
  rosa: { dot: "bg-primary", borda: "border-primary/40", faixa: "bg-primary/10" },
  violeta: { dot: "bg-info", borda: "border-info/40", faixa: "bg-info/10" },
  verde: { dot: "bg-success", borda: "border-success/40", faixa: "bg-success/10" },
  ambar: { dot: "bg-warning", borda: "border-warning/40", faixa: "bg-warning/10" },
  vermelho: {
    dot: "bg-destructive",
    borda: "border-destructive/40",
    faixa: "bg-destructive/10",
  },
} as const;

export type NavigatorGroupColor = keyof typeof NAVIGATOR_GROUP_COLORS;

/** Ordem de oferta das cores no seletor + rodízio na criação de grupos. */
export const NAVIGATOR_GROUP_COLOR_ORDER: NavigatorGroupColor[] = [
  "rosa",
  "violeta",
  "verde",
  "ambar",
  "vermelho",
];

export interface NavigatorGroup {
  id: string;
  nome: string;
  cor: NavigatorGroupColor;
  /** Recolhido esconde os chips do grupo (só o header fica) — muda a altura da
   *  strip e o `ResizeObserver` reposiciona as webviews de graça (spec §5.3). */
  recolhido: boolean;
}

/** Filiação abaId → grupoId (grupos são desacoplados do AbaBrowser). */
export type NavigatorMembership = Record<string, string>;

export const NAVIGATOR_GROUPS_KEY = "galaxie.navigator.groups.v1";
export const NAVIGATOR_MEMBERSHIP_KEY = "galaxie.navigator.tab-groups.v1";

function isGroupColor(value: unknown): value is NavigatorGroupColor {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(NAVIGATOR_GROUP_COLORS, value)
  );
}

function isGroup(value: unknown): value is NavigatorGroup {
  if (!value || typeof value !== "object") return false;
  const g = value as Partial<NavigatorGroup>;
  return (
    typeof g.id === "string" && typeof g.nome === "string" && isGroupColor(g.cor)
  );
}

/** Definições de grupo persistem entre sessões (base pros Workspaces). */
export function loadNavigatorGroups(): NavigatorGroup[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(
      localStorage.getItem(NAVIGATOR_GROUPS_KEY) || "[]",
    ) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isGroup).map((g) => ({
      id: g.id,
      nome: g.nome,
      cor: g.cor,
      recolhido: Boolean(g.recolhido),
    }));
  } catch {
    return [];
  }
}

export function persistNavigatorGroups(groups: NavigatorGroup[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(NAVIGATOR_GROUPS_KEY, JSON.stringify(groups));
  } catch {
    // best-effort (storage indisponível/quota cheia).
  }
}

export function loadNavigatorMembership(): NavigatorMembership {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(
      localStorage.getItem(NAVIGATOR_MEMBERSHIP_KEY) || "{}",
    ) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: NavigatorMembership = {};
    for (const [abaId, grupoId] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (typeof grupoId === "string") out[abaId] = grupoId;
    }
    return out;
  } catch {
    return {};
  }
}

export function persistNavigatorMembership(
  membership: NavigatorMembership,
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(NAVIGATOR_MEMBERSHIP_KEY, JSON.stringify(membership));
  } catch {
    // best-effort.
  }
}

/** Descarta filiações órfãs (aba fechada ou grupo inexistente) — mantém o mapa
 *  enxuto sem crescer sem limite entre sessões. */
export function podarMembership(
  membership: NavigatorMembership,
  abas: AbaBrowser[],
  groups: NavigatorGroup[],
): NavigatorMembership {
  const abasVivas = new Set(abas.map((a) => a.id));
  const gruposVivos = new Set(groups.map((g) => g.id));
  const out: NavigatorMembership = {};
  for (const [abaId, grupoId] of Object.entries(membership)) {
    if (abasVivas.has(abaId) && gruposVivos.has(grupoId)) out[abaId] = grupoId;
  }
  return out;
}

export interface NavigatorLane {
  tipo: "pins" | "grupo" | "soltas";
  grupo?: NavigatorGroup;
  abas: AbaBrowser[];
}

/**
 * Fatia a strip em lanes na ordem visual: pins (compactos, nunca agrupados) →
 * cada grupo com membros (na ordem de `groups`) → abas soltas. A ordem DENTRO de
 * cada lane vem da posição da aba no array `abas` (fonte única de ordem). Grupos
 * sem membros não viram lane, mas a definição segue viva (menu + persistência).
 */
export function montarLanes(
  abas: AbaBrowser[],
  groups: NavigatorGroup[],
  membership: NavigatorMembership,
): NavigatorLane[] {
  const lanes: NavigatorLane[] = [];
  const pins = abas.filter((a) => a.fixada);
  if (pins.length > 0) lanes.push({ tipo: "pins", abas: pins });

  const grupoDaAba = (a: AbaBrowser): string | undefined =>
    a.fixada ? undefined : membership[a.id];

  for (const grupo of groups) {
    const membros = abas.filter((a) => grupoDaAba(a) === grupo.id);
    if (membros.length > 0) lanes.push({ tipo: "grupo", grupo, abas: membros });
  }

  const gruposVivos = new Set(groups.map((g) => g.id));
  const soltas = abas.filter((a) => {
    if (a.fixada) return false;
    const g = membership[a.id];
    return !g || !gruposVivos.has(g);
  });
  if (soltas.length > 0) lanes.push({ tipo: "soltas", abas: soltas });

  return lanes;
}

/**
 * Aplica a nova ordem de UMA lane sobre a lista completa de ids, preservando a
 * posição das abas de fora da lane. Reorder é ordem de chip pura — as webviews
 * compartilham um mesmo rect, então isto não custa nada na camada nativa.
 */
export function reordenarLane(
  idsAtuais: string[],
  laneNovaOrdem: string[],
): string[] {
  const laneSet = new Set(laneNovaOrdem);
  let i = 0;
  return idsAtuais.map((id) => (laneSet.has(id) ? laneNovaOrdem[i++] : id));
}

// --- Favicons (Story 4b / #276) ----------------------------------------------
// O favicon de cada site (buscado no Rust, do próprio domínio) é cacheado por
// ORIGEM (scheme://host) em localStorage. Abas de apps M365 já têm ícone próprio
// (urlIcone) — o cache cobre as abas web livres, que antes caíam no globo.

export const NAVIGATOR_FAVICON_CACHE_KEY = "galaxie.navigator.favicons.v1";

/** Origem `scheme://host` de uma URL http(s); outros esquemas → null. */
export function origemDaUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export function loadFaviconCache(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(
      localStorage.getItem(NAVIGATOR_FAVICON_CACHE_KEY) || "{}",
    ) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [origem, uri] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof uri === "string" && uri.startsWith("data:")) out[origem] = uri;
    }
    return out;
  } catch {
    return {};
  }
}

export function persistFaviconCache(cache: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(NAVIGATOR_FAVICON_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // best-effort: data URIs podem estourar a quota; sem cache o globo cobre.
  }
}

// --- Sessão anterior (#274) ---------------------------------------------------
// Por #173, só as PINADAS sobrevivem ao restart; as normais somem. Aqui tiramos
// um snapshot das abas abertas (só url/nome, na ordem, SEM pinadas — já voltam —
// e SEM privadas, por privacidade) a cada mudança. No boot, o App captura o
// snapshot da sessão ANTERIOR e oferece restaurar (sem restaurar automático).

export const NAVIGATOR_LAST_SESSION_KEY = "galaxie.navigator.last-session.v1";

export interface AbaSessao {
  url: string;
  nome: string;
}

export function loadLastSession(): AbaSessao[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(
      localStorage.getItem(NAVIGATOR_LAST_SESSION_KEY) || "[]",
    ) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (a): a is AbaSessao =>
          !!a &&
          typeof a === "object" &&
          typeof (a as AbaSessao).url === "string" &&
          (a as AbaSessao).url.startsWith("https://") &&
          typeof (a as AbaSessao).nome === "string",
      )
      .map((a) => ({ url: a.url, nome: a.nome }));
  } catch {
    return [];
  }
}

/** Salva o snapshot da sessão: abas normais (não pinadas, não privadas, https). */
export function persistLastSession(tabs: AbaBrowser[]): void {
  if (typeof window === "undefined") return;
  try {
    const snapshot: AbaSessao[] = tabs
      .filter(
        (t) => !t.fixada && !t.privada && t.url.startsWith("https://"),
      )
      .map((t) => ({ url: t.url, nome: t.nome }));
    localStorage.setItem(NAVIGATOR_LAST_SESSION_KEY, JSON.stringify(snapshot));
  } catch {
    // best-effort.
  }
}
