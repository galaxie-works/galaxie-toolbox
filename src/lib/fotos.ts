// Cache de fotos (avatar) de contatos internos (#39).
//
// Resolve a foto de exibição de um remetente/participante INTERNO (mesmo domínio
// do tenant) para pintar o AvatarImage; sem foto, a UI cai nas iniciais
// (AvatarFallback). Estratégia:
//
//  - Memória (Map) + localStorage, com TTL: ~30 dias para foto, ~24h para o
//    negative-cache (sem foto / sem permissão). LRU de ~300 entradas.
//  - Só e-mails INTERNOS (mesmo domínio de `AppUser.email`) — externos não têm
//    foto acessível pelo Graph; nem chegam a virar request.
//  - Coleta em lote: os chamadores pedem as fotos das linhas VISÍVEIS; um
//    debounce de ~150ms junta tudo e dispara 1 request por até 20 fotos
//    (`crFotosContatos` → `$batch` do Graph).
//  - Chave = e-mail em minúsculas.
//
// Não é um componente React: é um store-módulo com assinatura (subscribe) para
// os componentes re-renderizarem quando fotos novas chegam (hook `useFotos`).

import { useEffect, useReducer } from "react";

import { crFotosContatos } from "./api";

const CHAVE = "bridge.fotos";
const TTL_POS = 30 * 24 * 3600_000; // 30 dias (tem foto)
const TTL_NEG = 24 * 3600_000; //      24h (sem foto / sem permissão — 404/403)
const LRU_MAX = 300;
const LOTE = 20; // teto do $batch do Graph
const DEBOUNCE_MS = 150;

interface Entrada {
  foto: string | null; // null = negative-cache (sem foto)
  exp: number; // epoch ms de expiração
}

const memoria = new Map<string, Entrada>();
const pendentes = new Set<string>(); // aguardando o próximo lote
const emVoo = new Set<string>(); // já num request em andamento
const ouvintes = new Set<() => void>();
let dominio: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let hidratado = false;

/** Carrega o cache do localStorage na primeira leitura, podando o que expirou. */
function hidratar(): void {
  if (hidratado) return;
  hidratado = true;
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (!bruto) return;
    const obj = JSON.parse(bruto) as Record<string, Entrada>;
    const agora = Date.now();
    for (const [email, e] of Object.entries(obj)) {
      if (e && typeof e.exp === "number" && e.exp > agora) memoria.set(email, e);
    }
  } catch {
    // cache corrompido/indisponível: começa vazio.
  }
}

/** Grava no localStorage, podando expirados e aplicando o teto LRU. O Map
 *  preserva a ordem de inserção; nas escritas re-inserimos no fim (ver
 *  `guardar`), então os primeiros são os menos recentes. */
function persistir(): void {
  try {
    const agora = Date.now();
    for (const [k, e] of memoria) if (e.exp <= agora) memoria.delete(k);
    if (memoria.size > LRU_MAX) {
      const excedente = memoria.size - LRU_MAX;
      let i = 0;
      for (const k of memoria.keys()) {
        if (i++ >= excedente) break;
        memoria.delete(k);
      }
    }
    const obj: Record<string, Entrada> = {};
    for (const [k, e] of memoria) obj[k] = e;
    localStorage.setItem(CHAVE, JSON.stringify(obj));
  } catch {
    // Sem quota: segue só com o cache em memória.
  }
}

/** Insere/atualiza uma entrada movendo-a para o fim (recência aproximada). */
function guardar(email: string, foto: string | null): void {
  memoria.delete(email);
  memoria.set(email, { foto, exp: Date.now() + (foto ? TTL_POS : TTL_NEG) });
}

function notificar(): void {
  for (const l of ouvintes) l();
}

function interno(email: string): boolean {
  return dominio != null && email.endsWith("@" + dominio);
}

/** Define o domínio do tenant (de `AppUser.email`) — só e-mails deste domínio
 *  viram request de foto. Chamar ao logar / carregar o usuário. */
export function configurarDominioFotos(email: string | null | undefined): void {
  dominio = email?.split("@")[1]?.toLowerCase() || null;
}

/** Foto em cache de um e-mail: data URI (tem foto), `null` (sabidamente sem
 *  foto) ou `undefined` (ainda não resolvido). Não dispara request. */
export function getFoto(
  email: string | null | undefined
): string | null | undefined {
  if (!email) return undefined;
  hidratar();
  const k = email.toLowerCase();
  const e = memoria.get(k);
  if (!e) return undefined;
  if (e.exp <= Date.now()) {
    memoria.delete(k);
    return undefined;
  }
  return e.foto;
}

/** Enfileira e-mails internos ainda não resolvidos para o próximo lote. */
export function pedirFotos(emails: (string | null | undefined)[]): void {
  hidratar();
  const agora = Date.now();
  let algo = false;
  for (const raw of emails) {
    if (!raw) continue;
    const email = raw.toLowerCase();
    if (!interno(email)) continue;
    if (pendentes.has(email) || emVoo.has(email)) continue;
    const e = memoria.get(email);
    if (e && e.exp > agora) continue; // já resolvido e válido
    pendentes.add(email);
    algo = true;
  }
  if (algo) agendarFlush();
}

function agendarFlush(): void {
  if (timer) return;
  timer = setTimeout(flush, DEBOUNCE_MS);
}

async function flush(): Promise<void> {
  timer = null;
  if (pendentes.size === 0) return;
  const lote = [...pendentes].slice(0, LOTE);
  for (const e of lote) {
    pendentes.delete(e);
    emVoo.add(e);
  }
  try {
    const mapa = await crFotosContatos(lote);
    for (const email of lote) {
      // Ausente no retorno = trata como sem foto.
      guardar(email, email in mapa ? mapa[email] : null);
    }
    persistir();
    notificar();
  } catch {
    // Falha (403 sem re-consent, offline, 429 estourado): NÃO cacheia — tenta de
    // novo numa próxima coleta. Enquanto isso, a UI mostra as iniciais.
  } finally {
    for (const e of lote) emVoo.delete(e);
    if (pendentes.size > 0) agendarFlush(); // sobrou fila → próximo lote
  }
}

/** Limpa o cache (memória + disco) e a fila. Chamar no logout (privacidade) e no
 *  login — assim, após um re-consent (login novo), fotos que estavam em
 *  negative-cache por falta de permissão são buscadas de novo. */
export function limparFotos(): void {
  memoria.clear();
  pendentes.clear();
  emVoo.clear();
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  try {
    localStorage.removeItem(CHAVE);
  } catch {
    // ignora
  }
  notificar();
}

/**
 * Hook: assina o cache para re-renderizar quando fotos novas chegam e expõe
 * `getFoto`/`pedirFotos` (funções estáveis a nível de módulo). Uso típico:
 * pedir as fotos das linhas visíveis num efeito e ler `getFoto(email)` na hora
 * de renderizar o Avatar.
 */
export function useFotos(): {
  getFoto: typeof getFoto;
  pedirFotos: typeof pedirFotos;
} {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    ouvintes.add(tick);
    return () => {
      ouvintes.delete(tick);
    };
  }, []);
  return { getFoto, pedirFotos };
}
