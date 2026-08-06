/**
 * Catálogo de sons de notificação do Bridge (#48).
 *
 * Os 13 WAV vivem em `src/assets/sons/` (importados como URL pelo Vite via
 * `vite/client`). Cada som ganha um nome de exibição com EXATAMENTE 19
 * caracteres — regra do PO. O `id` estável é o nome do arquivo (sem extensão),
 * o que a preferência guarda em localStorage (`"<id>"` ou `"none"`).
 *
 * A preferência é lida de duas formas:
 *  - na UI (Settings > Notificações) via `usePersistedState(CHAVE_NOTIFICACOES)`;
 *  - no gatilho de novos e-mails (#43) via `tocarSomEscopo`, que lê o
 *    localStorage cru fora do React.
 */

import somAeroporto from "@/assets/sons/mixkit-airport-announcement-ding-1569.wav";
import somSinoNotif from "@/assets/sons/mixkit-bell-notification-933.wav";
import somBike from "@/assets/sons/mixkit-bike-bell-ring-595.wav";
import somCoralBencao from "@/assets/sons/mixkit-bless-choir-655.wav";
import somApitoBrinquedo from "@/assets/sons/mixkit-cartoon-toy-whistle-616.wav";
import somAssobio from "@/assets/sons/mixkit-cartoon-whistling-738.wav";
import somHarpa from "@/assets/sons/mixkit-choir-harp-bless-657.wav";
import somPalhaco from "@/assets/sons/mixkit-clown-horn-at-circus-715.wav";
import somRangente from "@/assets/sons/mixkit-funny-squeaky-toy-hits-2813.wav";
import somGuitarraAlerta from "@/assets/sons/mixkit-guitar-notification-alert-2320.wav";
import somViolao from "@/assets/sons/mixkit-guitar-stroke-down-slow-2339.wav";
import somInterface from "@/assets/sons/mixkit-software-interface-back-2575.wav";
import somPortaLoja from "@/assets/sons/mixkit-store-door-bell-ring-934.wav";

import { DICIONARIOS } from "@/lib/strings";
import { idiomaAtual } from "@/lib/idioma-core";

/** Um som selecionável: id estável (nome do arquivo) e URL. O nome de exibição
 *  é localizado (#579) — ver `nomeSom`. */
export interface SomNotificacao {
  id: string;
  src: string;
}

/** Valor guardado quando o usuário escolhe não tocar som algum. */
export const VALOR_SEM_SOM = "none";

/**
 * Os 13 sons. O `id` (nome do arquivo) é estável e é o que a preferência guarda;
 * o nome de exibição é localizado por `nomeSom(id)` (#579), fonte no namespace
 * `sons` do dicionário. A ORDEM aqui é a ordem do dropdown.
 */
export const SONS: SomNotificacao[] = [
  { id: "mixkit-guitar-stroke-down-slow-2339", src: somViolao },
  { id: "mixkit-guitar-notification-alert-2320", src: somGuitarraAlerta },
  { id: "mixkit-bell-notification-933", src: somSinoNotif },
  { id: "mixkit-store-door-bell-ring-934", src: somPortaLoja },
  { id: "mixkit-bike-bell-ring-595", src: somBike },
  { id: "mixkit-airport-announcement-ding-1569", src: somAeroporto },
  { id: "mixkit-cartoon-whistling-738", src: somAssobio },
  { id: "mixkit-cartoon-toy-whistle-616", src: somApitoBrinquedo },
  { id: "mixkit-funny-squeaky-toy-hits-2813", src: somRangente },
  { id: "mixkit-clown-horn-at-circus-715", src: somPalhaco },
  { id: "mixkit-choir-harp-bless-657", src: somHarpa },
  { id: "mixkit-bless-choir-655", src: somCoralBencao },
  { id: "mixkit-software-interface-back-2575", src: somInterface },
];

/**
 * Nome de exibição LOCALIZADO de um som (#579). Acessor **não-hook** (mesmo padrão
 * do `plateLabel`/`textoUi`): lê `idiomaAtual()` puro — pode ser chamado do lib
 * (fora do React) e reage à troca de idioma via re-render do `IdiomaProvider`.
 * Fallback pro `id` se a chave sumir (som novo sem tradução).
 */
export function nomeSom(id: string): string {
  const nomes = DICIONARIOS[idiomaAtual()].sons as Record<string, string>;
  return nomes[id] ?? id;
}

/** Escopos de notificação que podem ter um som configurado. */
export type EscopoNotificacao =
  | "emailRecebido"
  | "mensagemRecebida"
  | "sincronizacao";

/** Preferências persistidas: por escopo, um id de som ou `"none"`. */
export type PreferenciasNotificacao = Record<EscopoNotificacao, string>;

/** Chave única em localStorage (compartilhada entre a UI e o gatilho do #43). */
export const CHAVE_NOTIFICACOES = "bridge.notificacoes";

/** Padrão: nada toca até o usuário escolher. */
export const PREF_PADRAO: PreferenciasNotificacao = {
  emailRecebido: VALOR_SEM_SOM,
  mensagemRecebida: VALOR_SEM_SOM,
  sincronizacao: VALOR_SEM_SOM,
};

/** Acha um som pelo id; `undefined` para `"none"` ou id desconhecido. */
export function somPorId(id: string): SomNotificacao | undefined {
  return SONS.find((s) => s.id === id);
}

/**
 * Toca o som de um id. No-op silencioso para `"none"`, id inválido ou se o
 * autoplay for bloqueado (ex.: sem gesto do usuário). Volume moderado.
 */
export function tocarSom(id: string): void {
  const som = somPorId(id);
  if (!som) return;
  try {
    const audio = new Audio(som.src);
    audio.volume = 0.5;
    void audio.play().catch(() => {
      /* autoplay bloqueado / dispositivo sem áudio: ignora */
    });
  } catch {
    /* Audio indisponível: ignora */
  }
}

/** Lê as preferências do localStorage cru (fora do React), com fallback ao padrão. */
export function lerPreferencias(): PreferenciasNotificacao {
  try {
    const bruto = localStorage.getItem(CHAVE_NOTIFICACOES);
    if (!bruto) return PREF_PADRAO;
    const parsed = JSON.parse(bruto) as Partial<PreferenciasNotificacao>;
    return { ...PREF_PADRAO, ...parsed };
  } catch {
    return PREF_PADRAO;
  }
}

/** Toca o som configurado para um escopo, lendo a preferência atual. */
export function tocarSomEscopo(escopo: EscopoNotificacao): void {
  tocarSom(lerPreferencias()[escopo]);
}
