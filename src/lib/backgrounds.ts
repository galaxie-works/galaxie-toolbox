/**
 * Registry das imagens de fundo do app (#378, Settings > Personalization >
 * Background). Extensível: pra adicionar mais imagens, só dar append no array —
 * a galeria em `background-settings.tsx` renderiza a partir daqui, sem tocar na
 * UI. As imagens vivem em `public/backgrounds/` (servidas em `/backgrounds/…`).
 */
export interface AppBackground {
  /** Id estável (persistido no store). */
  id: string;
  /** Rótulo curto exibido no card. */
  label: string;
  /** Thumb da galeria (pode ser igual ao `full` se já for leve). */
  thumb: string;
  /** Imagem aplicada como fundo do app (cover/center). */
  full: string;
  /** Crédito/legenda opcional. */
  credito?: string;
}

export const APP_BACKGROUNDS: AppBackground[] = [
  {
    id: "glacial",
    label: "Glacial Drift",
    thumb: "/backgrounds/glacial.jpg",
    full: "/backgrounds/glacial.jpg",
    credito: "Kayak on a frozen lake",
  },
];

/** Resolve o `full` (URL) de um id de fundo, ou `null` se não existir. */
export function urlDoFundo(id: string | null | undefined): string | null {
  if (!id) return null;
  return APP_BACKGROUNDS.find((b) => b.id === id)?.full ?? null;
}

/** Chave de boot (index.html) pra pintar a imagem cedo e não piscar. */
export const CHAVE_BOOT_FUNDO_IMAGEM = "galaxie-toolbox.background.imageUrl";
