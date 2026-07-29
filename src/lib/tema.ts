/**
 * Tema visual + modo claro/escuro/sistema.
 *
 * Este módulo aplica as preferências no import, antes do React montar. O
 * estado editável vive no slice Zustand; a leitura direta do localStorage aqui
 * existe somente para impedir flash de tema durante o boot.
 */

import { useSyncExternalStore } from "react";

export const CHAVE_MODO_TEMA = "galaxie-theme";
export const CHAVE_TEMA_VISUAL = "galaxie-toolbox.theme";
export const CHAVE_ALTO_CONTRASTE = "galaxie-toolbox.altoContraste";

/**
 * `data-theme` do preset de alto contraste (#136). NÃO é uma opção de Mood: mora
 * só no `theme-presets.css` e sobrepõe o Mood quan­do o Accessibility está ligado.
 */
export const TEMA_ALTO_CONTRASTE = "high-contrast";

export const MODOS_TEMA = ["light", "dark", "system"] as const;
export type ModoTema = (typeof MODOS_TEMA)[number];

export const TEMAS_VISUAIS = [
  "galaxie",
  "claude-plus",
  "melancholik-mint",
  "zen-inspired",
  "sunny-sprout",
  "nordic-moss",
  "fallout",
] as const;
export type TemaVisual = (typeof TEMAS_VISUAIS)[number];

const mediaEscura = window.matchMedia?.("(prefers-color-scheme: dark)");

function textoSalvo(chave: string): string | null {
  const bruto = localStorage.getItem(chave);
  if (bruto === null) return null;

  // Aceita tanto o formato legado cru quanto JSON string do persist.
  try {
    const parsed = JSON.parse(bruto);
    return typeof parsed === "string" ? parsed : bruto;
  } catch {
    return bruto;
  }
}

export function modoTemaSalvo(): ModoTema {
  const salvo = textoSalvo(CHAVE_MODO_TEMA);
  return MODOS_TEMA.includes(salvo as ModoTema)
    ? (salvo as ModoTema)
    : "system";
}

export function temaVisualSalvo(): TemaVisual {
  const salvo = textoSalvo(CHAVE_TEMA_VISUAL);
  return TEMAS_VISUAIS.includes(salvo as TemaVisual)
    ? (salvo as TemaVisual)
    : "galaxie";
}

export function temaEscuro(modo = modoTemaSalvo()): boolean {
  if (modo === "dark") return true;
  if (modo === "light") return false;
  return mediaEscura?.matches ?? true;
}

function sincronizarTemaJanela(escuro: boolean) {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return;
  }

  import("@tauri-apps/api/window")
    .then(({ getCurrentWindow }) =>
      getCurrentWindow().setTheme(escuro ? "dark" : "light")
    )
    .catch(() => {
      // Versão sem API/permissão: mantém a moldura padrão do Windows.
    });
}

export function aplicarModoTema(modo: ModoTema) {
  const escuro = temaEscuro(modo);
  document.documentElement.classList.toggle("dark", escuro);
  sincronizarTemaJanela(escuro);
}

export function aplicarTemaVisual(tema: TemaVisual) {
  document.documentElement.dataset.theme = tema;
}

export function altoContrasteSalvo(): boolean {
  try {
    const bruto = localStorage.getItem(CHAVE_ALTO_CONTRASTE);
    if (bruto === null) return false;
    try {
      return JSON.parse(bruto) === true;
    } catch {
      return bruto === "true";
    }
  } catch {
    return false;
  }
}

/**
 * Liga/desliga o alto contraste (#136). Ligado → `data-theme="high-contrast"`,
 * sobrepondo o Mood. Desligado → volta ao Mood (`temaBase`). Usa o MESMO
 * mecanismo do `aplicarTemaVisual` (o atributo `data-theme` no <html>).
 */
export function aplicarAltoContraste(
  ativo: boolean,
  temaBase: TemaVisual = temaVisualSalvo()
) {
  document.documentElement.dataset.theme = ativo
    ? TEMA_ALTO_CONTRASTE
    : temaBase;
}

/** Vale a partir do import, sem esperar componente nenhum. */
aplicarTemaVisual(temaVisualSalvo());
aplicarModoTema(modoTemaSalvo());
// Alto contraste sobrepõe o Mood no boot (evita flash do Mood antes de hidratar).
if (altoContrasteSalvo()) aplicarAltoContraste(true);

/** No modo Sistema, acompanha mudanças do SO durante toda a sessão. */
mediaEscura?.addEventListener("change", () => {
  if (modoTemaSalvo() === "system") {
    aplicarModoTema("system");
  }
});

/**
 * Hook reativo: acompanha a classe `dark` do <html> e re-renderiza quando o
 * modo muda (usado também pelo render de e-mail ciente do tema).
 */
function assinarTema(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => obs.disconnect();
}

export function useTemaEscuro(): boolean {
  return useSyncExternalStore(
    assinarTema,
    () => document.documentElement.classList.contains("dark"),
    () => true
  );
}
