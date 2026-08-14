// #869 (Quick access pin/sort): store + helpers PUROS do "Acesso rápido"
// fixável pelo usuário. Em `.ts` puro (sem JSX) de propósito — o teste headless
// (`node --test --experimental-strip-types`) importa daqui, e o CI não carrega
// `.tsx`. A persistência é localStorage puro (via `usePersistedState`): pin de
// Acesso rápido é conveniência de UI LOCAL, não dado tenant-scoped — não passa
// pelo store/reset de sessão.
import type { FsEntry } from "@/lib/types";

/** Chave do localStorage dos pins de Acesso rápido (array de `PinAcessoRapido`). */
export const CHAVE_PINS_ACESSO_RAPIDO = "explorer.quickaccess.pins.v1";

/**
 * Um pin do usuário. Guardamos o `name` junto do `path` pra rotular o nó SEM
 * reler o disco — uma pasta fixada que sumiu ainda mostra o rótulo salvo (só não
 * expande; degrada sem crashar).
 */
export interface PinAcessoRapido {
  path: string;
  name: string;
}

/**
 * Normaliza um caminho Windows pra comparar/deduplicar: sem barra(s) final(is) e
 * em minúsculas (NTFS é case-insensitive). Só serve de CHAVE de comparação — o
 * caminho exibido/navegado continua sendo o original.
 */
function normalizar(path: string): string {
  return path.replace(/\\+$/, "").toLowerCase();
}

/**
 * `true` se o caminho já está fixado (comparação normalizada). SÍNCRONO — lê
 * direto do array persistido, então serve pra decidir o rótulo do menu no ATO de
 * abrir, sem estado async (lição do P0 #778: item do ContextMenu não pode
 * depender de estado que não está pronto na abertura).
 */
export function estaFixado(pins: PinAcessoRapido[], path: string): boolean {
  const alvo = normalizar(path);
  return pins.some((p) => normalizar(p.path) === alvo);
}

/**
 * Fixa um caminho (idempotente: dedupe por path normalizado). Devolve um NOVO
 * array (não muta) — casa com o setState do `usePersistedState`.
 */
export function adicionarPin(
  pins: PinAcessoRapido[],
  pin: PinAcessoRapido,
): PinAcessoRapido[] {
  if (estaFixado(pins, pin.path)) return pins;
  return [...pins, pin];
}

/** Desafixa um caminho (comparação normalizada). Novo array; no-op se ausente. */
export function removerPin(
  pins: PinAcessoRapido[],
  path: string,
): PinAcessoRapido[] {
  const alvo = normalizar(path);
  return pins.filter((p) => normalizar(p.path) !== alvo);
}

/** Sintetiza um `FsEntry` de pasta a partir de um pin (vira nó lazy da árvore). */
function pinParaEntry(pin: PinAcessoRapido): FsEntry {
  return {
    name: pin.name,
    path: pin.path,
    isDir: true,
    isSymlink: false,
    size: 0,
    modifiedMs: null,
    createdMs: null,
    extension: null,
    isHidden: false,
    isReadonly: false,
  };
}

/**
 * Monta a lista final do "Acesso rápido": pins do usuário + dirs conhecidos do
 * sistema (`dirsConhecidos`), DEDUPADOS por caminho normalizado e ORDENADOS
 * alfabeticamente pelo nome exibido (`localeCompare`, case-insensitive) — ordem
 * estável, independente de quem fixou o quê. Os pins entram primeiro no mapa,
 * então num mesmo caminho o rótulo do usuário prevalece sobre o do sistema; a
 * ordenação final por nome unifica tudo num só critério.
 */
export function mesclarAcessoRapido(
  pins: PinAcessoRapido[],
  sistema: FsEntry[],
): FsEntry[] {
  const porPath = new Map<string, FsEntry>();
  for (const pin of pins) {
    porPath.set(normalizar(pin.path), pinParaEntry(pin));
  }
  for (const e of sistema) {
    const chave = normalizar(e.path);
    if (!porPath.has(chave)) porPath.set(chave, e);
  }
  return [...porPath.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}
