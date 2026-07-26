/**
 * Tema claro/escuro.
 *
 * Aplicado no import, antes do React montar: a tela de "retomando a sessao"
 * aparece antes de qualquer ThemeToggle existir, e enquanto o tema morava
 * dentro do componente ela ficava sempre escura — o index.html abria com
 * class="dark" fixo e ninguem corrigia ate o toggle montar.
 */

import { useSyncExternalStore } from "react";

const CHAVE = "galaxie-theme";

export function temaEscuro(): boolean {
  const salvo = localStorage.getItem(CHAVE);
  if (salvo === "dark") return true;
  if (salvo === "light") return false;
  // Sem preferencia salva: segue o sistema.
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
}

export function aplicarTema(escuro: boolean) {
  document.documentElement.classList.toggle("dark", escuro);
  localStorage.setItem(CHAVE, escuro ? "dark" : "light");
}

/** Vale a partir do import, sem esperar componente nenhum. */
document.documentElement.classList.toggle("dark", temaEscuro());

/**
 * Hook reativo: acompanha a classe `dark` do <html> e re-renderiza quando o
 * tema muda (usado pra render de e-mail ciente do tema, por exemplo).
 */
function assinarTema(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
}
export function useTemaEscuro(): boolean {
  return useSyncExternalStore(
    assinarTema,
    () => document.documentElement.classList.contains("dark"),
    () => true
  );
}
