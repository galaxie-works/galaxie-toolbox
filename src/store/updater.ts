/**
 * Atualização estilo React `setState`: valor novo OU `(prev) => novo`.
 * Compartilhado pelos slices pra manter a semântica dos antigos `usePersistedState`.
 */
export type Updater<T> = T | ((prev: T) => T);

export function resolver<T>(atual: T, upd: Updater<T>): T {
  return typeof upd === "function" ? (upd as (p: T) => T)(atual) : upd;
}
