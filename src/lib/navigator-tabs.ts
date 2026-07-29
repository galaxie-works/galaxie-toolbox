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
