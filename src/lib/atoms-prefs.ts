/**
 * Preferências de personalização do Atoms (#187, Slice 5). Ordem + visibilidade
 * dos widgets customizáveis + densidade. Persistido em localStorage (padrão dos
 * navigator-prefs) — reabrir o app mantém o layout do usuário.
 *
 * Só os widgets "de conteúdo" são customizáveis. O feed "Atenção agora" é âncora
 * fixa (não entra aqui) e os cards de sistema (OneDrive/Teams) são condicionais.
 */

export type WidgetId = "agenda" | "email" | "todos" | "speeddial";

/** Ordem canônica + conjunto válido de widgets customizáveis. */
export const WIDGETS: readonly WidgetId[] = [
  "agenda",
  "email",
  "todos",
  "speeddial",
] as const;

export type Densidade = "confortavel" | "compacta";

export interface AtomsPrefs {
  ordem: WidgetId[];
  /** Widgets desligados. Speed-dial nasce oculto (opt-in). */
  ocultos: WidgetId[];
  densidade: Densidade;
}

export const ATOMS_PREFS_KEY = "atoms.prefs.v1";

export function prefsPadrao(): AtomsPrefs {
  return { ordem: [...WIDGETS], ocultos: ["speeddial"], densidade: "confortavel" };
}

/**
 * Normaliza uma ordem persistida contra o conjunto atual de widgets: mantém a
 * ordem salva dos conhecidos e ANEXA os novos (forward-compat quando uma slice
 * futura adiciona um widget), descartando ids inválidos.
 */
function normalizarOrdem(ordem: unknown): WidgetId[] {
  const arr = Array.isArray(ordem) ? ordem : [];
  const validos = arr.filter((x): x is WidgetId =>
    WIDGETS.includes(x as WidgetId),
  );
  const semDup = [...new Set(validos)];
  const faltando = WIDGETS.filter((w) => !semDup.includes(w));
  return [...semDup, ...faltando];
}

export function normalizarAtomsPrefs(p: Partial<AtomsPrefs>): AtomsPrefs {
  return {
    ordem: normalizarOrdem(p.ordem),
    ocultos: Array.isArray(p.ocultos)
      ? p.ocultos.filter((x): x is WidgetId => WIDGETS.includes(x as WidgetId))
      : [],
    densidade: p.densidade === "compacta" ? "compacta" : "confortavel",
  };
}

export function loadAtomsPrefs(): AtomsPrefs {
  try {
    const cru = localStorage.getItem(ATOMS_PREFS_KEY);
    if (!cru) return prefsPadrao();
    const p = JSON.parse(cru) as Partial<AtomsPrefs>;
    return normalizarAtomsPrefs(p);
  } catch {
    return prefsPadrao();
  }
}

export function persistAtomsPrefs(prefs: AtomsPrefs): void {
  try {
    localStorage.setItem(ATOMS_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // best-effort (modo privado / quota): a UI segue com o estado em memória.
  }
}
