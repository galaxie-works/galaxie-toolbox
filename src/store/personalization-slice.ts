import type { StateCreator } from "zustand";

import {
  CHAVE_NOTIFICACOES,
  PREF_PADRAO,
  type EscopoNotificacao,
  type PreferenciasNotificacao,
} from "@/lib/sons-notificacao";
import {
  aplicarAltoContraste,
  aplicarModoTema,
  aplicarTemaVisual,
  altoContrasteSalvo,
  CHAVE_ALTO_CONTRASTE,
  CHAVE_MODO_TEMA,
  CHAVE_TEMA_VISUAL,
  modoTemaSalvo,
  temaVisualSalvo,
  type ModoTema,
  type TemaVisual,
} from "@/lib/tema";
import {
  CHAVE_BOOT_FUNDO_IMAGEM,
  urlDoFundo,
} from "@/lib/backgrounds";
import type { AppStore } from "./index";

/**
 * Preferências da área Personalization da Settings (#119–#122).
 *
 * A #119 inaugura o slice com sons e fundo estrelado. As chaves reais são
 * gravadas pelo storage custom do store único, sem criar blob paralelo.
 */
export interface PersonalizationSlice {
  /** Sons por evento. Preserva `bridge.notificacoes` e o contrato do #48. */
  notificacoes: PreferenciasNotificacao;
  /** Exibe o fundo estrelado em todas as superfícies do app. */
  fundoEstrelado: boolean;
  /** #378: id da imagem de fundo (registry `backgrounds.ts`) ou `null` = fundo
   *  do tema. Mutuamente exclusivo com `fundoEstrelado`. */
  fundoImagem: string | null;
  /** Claro, escuro ou seguindo a preferência do sistema operacional. */
  modoTema: ModoTema;
  /** Paleta/estilo visual independente do modo claro/escuro. */
  temaVisual: TemaVisual;
  /** Alto contraste (#136): sobrepõe o Mood com o preset `high-contrast`. */
  altoContraste: boolean;

  setSomNotificacao: (escopo: EscopoNotificacao, somId: string) => void;
  setFundoEstrelado: (ativo: boolean) => void;
  setFundoImagem: (id: string | null) => void;
  setModoTema: (modo: ModoTema) => void;
  setTemaVisual: (tema: TemaVisual) => void;
  setAltoContraste: (ativo: boolean) => void;
}

export const PERSONALIZATION_KEYS = {
  notificacoes: CHAVE_NOTIFICACOES,
  fundoEstrelado: "galaxie-toolbox.background.stars",
  fundoImagem: "galaxie-toolbox.background.image",
  modoTema: CHAVE_MODO_TEMA,
  temaVisual: CHAVE_TEMA_VISUAL,
  altoContraste: CHAVE_ALTO_CONTRASTE,
} as const;

export type PersonalizationPersistido = Pick<
  PersonalizationSlice,
  | "notificacoes"
  | "fundoEstrelado"
  | "fundoImagem"
  | "modoTema"
  | "temaVisual"
  | "altoContraste"
>;

export const createPersonalizationSlice: StateCreator<
  AppStore,
  [["zustand/persist", unknown]],
  [],
  PersonalizationSlice
> = (set, get) => ({
  notificacoes: { ...PREF_PADRAO },
  fundoEstrelado: true,
  fundoImagem: null,
  modoTema: modoTemaSalvo(),
  temaVisual: temaVisualSalvo(),
  altoContraste: altoContrasteSalvo(),

  setSomNotificacao: (escopo, somId) =>
    set((state) => ({
      notificacoes: { ...state.notificacoes, [escopo]: somId },
    })),
  setFundoEstrelado: (ativo) => set({ fundoEstrelado: ativo }),
  setFundoImagem: (id) => {
    // #378: imagem e estrelas são mutuamente exclusivas — escolher imagem
    // desliga o starry. Escreve a chave de boot (URL) pra o index.html pintar
    // cedo e não piscar; remove ao voltar pro tema (None).
    const url = urlDoFundo(id);
    try {
      // Mantém o <html> vivo em sincronia com o que o boot (index.html) pinta.
      // Sem isso, trocar pra "None" numa sessão que BOOTOU com imagem deixa o
      // `backgroundImage` de boot preso no <html>: como o Estrelas retorna null
      // quando fundoEstrelado=false, nada cobre a imagem antiga e o "None" só
      // faria efeito após reload.
      const raiz = document.documentElement;
      if (url) {
        localStorage.setItem(CHAVE_BOOT_FUNDO_IMAGEM, url);
        raiz.style.backgroundImage = `url("${url}")`;
        raiz.style.backgroundSize = "cover";
        raiz.style.backgroundPosition = "center";
      } else {
        localStorage.removeItem(CHAVE_BOOT_FUNDO_IMAGEM);
        raiz.style.backgroundImage = "";
        raiz.style.backgroundSize = "";
        raiz.style.backgroundPosition = "";
      }
    } catch {
      // best-effort
    }
    set(id ? { fundoImagem: id, fundoEstrelado: false } : { fundoImagem: null });
  },
  setModoTema: (modo) => {
    aplicarModoTema(modo);
    set({ modoTema: modo });
  },
  setTemaVisual: (tema) => {
    aplicarTemaVisual(tema);
    set({ temaVisual: tema });
  },
  setAltoContraste: (ativo) => {
    // Ligado sobrepõe o Mood; desligado volta ao Mood atual.
    aplicarAltoContraste(ativo, get().temaVisual);
    set({ altoContraste: ativo });
  },
});
