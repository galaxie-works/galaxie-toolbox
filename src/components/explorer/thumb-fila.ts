// #738 (Explorer perf F3): fila de thumbnails com PRIORIDADE DE VIEWPORT +
// cancelamento. As Miniaturas visíveis (IntersectionObserver, dentro do
// virtualizado) pedem o thumb webp (data URI) ao backend `gerarThumbnail`. A
// fila limita a concorrência e prioriza o pedido MAIS RECENTE (LIFO): no scroll
// rápido, o tile que acabou de entrar na tela ganha vez; o que saiu é CANCELADO
// antes de começar. Um LRU (por path|mtime|maxSize) guarda os data URIs já
// resolvidos pra re-scroll instantâneo sem novo IPC. NUNCA toca no original — o
// backend devolve só o webp pequeno.
import { gerarThumbnail } from "@/lib/api";

const MAX_CONCORRENTES = 6;
const LRU_MAX = 400;
// #820 (P0): teto da fila. A fila prioriza o viewport com LIFO (`pop`), mas os
// pedidos que saíram de tela ficam no FUNDO (`push`) e nunca drenam enquanto a
// rolagem alimenta o topo — em pasta densa (Downloads 5000+) isso empilha
// Tarefas + Promises + closures sem limite, o heap cresce com a rolagem e o GC
// longo congela a UI (piora quanto mais rola; trava até parado). O teto descarta
// a MAIS ANTIGA (fundo = já fora de tela, menor prioridade) resolvendo `null`.
const FILA_MAX = 128;

const cache = new Map<string, string>(); // `${path}|${mtime}|${maxSize}` → dataUri
function cacheGet(chave: string): string | undefined {
  const v = cache.get(chave);
  if (v !== undefined) {
    cache.delete(chave);
    cache.set(chave, v);
  }
  return v;
}
function cacheSet(chave: string, uri: string): void {
  if (cache.has(chave)) cache.delete(chave);
  cache.set(chave, uri);
  if (cache.size > LRU_MAX) {
    const primeiro = cache.keys().next().value;
    if (primeiro !== undefined) cache.delete(primeiro);
  }
}

interface Tarefa {
  path: string;
  chave: string;
  maxSize: number;
  cancelado: () => boolean;
  resolve: (uri: string | null) => void;
}

const fila: Tarefa[] = [];
let ativos = 0;

function bombear(): void {
  while (ativos < MAX_CONCORRENTES && fila.length > 0) {
    // LIFO: o pedido mais recente (viewport atual) tem prioridade sobre o que já
    // saiu de tela numa rolagem rápida.
    const t = fila.pop();
    if (!t) break;
    if (t.cancelado()) {
      t.resolve(null);
      continue;
    }
    const doCache = cacheGet(t.chave);
    if (doCache !== undefined) {
      t.resolve(doCache);
      continue;
    }
    ativos += 1;
    void gerarThumbnail(t.path, t.maxSize)
      .then((ref) => {
        const uri = ref?.dataUri ?? "";
        if (uri) cacheSet(t.chave, uri);
        t.resolve(t.cancelado() || !uri ? null : uri);
      })
      .catch(() => t.resolve(null))
      .finally(() => {
        ativos -= 1;
        bombear();
      });
  }
}

/**
 * Pede o thumb (data URI) de `path` (invalidação por `mtime`, dimensão por
 * `maxSize`). Resolve com o data URI, ou `null` se cancelado / falhou / fora do
 * Tauri (aí a Miniatura mostra o ícone). `cancelado()` é checado antes de
 * começar e depois de terminar — a Miniatura o liga no unmount/saiu-da-tela.
 */
export function solicitarThumb(
  path: string,
  mtime: number,
  maxSize: number,
  cancelado: () => boolean,
): Promise<string | null> {
  const chave = `${path}|${mtime}|${maxSize}`;
  const doCache = cacheGet(chave);
  if (doCache !== undefined) return Promise.resolve(doCache);
  return new Promise((resolve) => {
    fila.push({ path, chave, maxSize, cancelado, resolve });
    // #820 (P0): impõe o teto — descarta as MAIS ANTIGAS (fundo, já fora de
    // tela) resolvendo `null`, pra a fila não crescer sem limite no scroll longo
    // e vazar Promises/closures (o que estourava o GC e travava a UI).
    while (fila.length > FILA_MAX) {
      const velha = fila.shift();
      velha?.resolve(null);
    }
    bombear();
  });
}
