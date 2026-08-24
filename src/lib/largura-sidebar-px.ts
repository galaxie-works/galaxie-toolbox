// #1392 (passe do PO, 2ª reprovação) — a intenção do usuário mora em PIXELS.
//
// O que veio antes guardava a largura em PORCENTAGEM (o `autoSaveId` do
// `react-resizable-panels` só sabe %). Porcentagem é a unidade errada para esta
// decisão: 20% de 1280 são 256px e 20% de 3000 são 600px, então a mesma
// "escolha" engorda sozinha quando a janela cresce. Foi isso que o `wagner`
// reprovou duas vezes — e a minha 1ª correção não pegou porque tratou o
// SINTOMA (reajustar no resize) mantendo a % como fonte.
//
// Aqui a fonte é px. A % vira detalhe de implementação, recalculada a cada
// mudança de largura do grupo.

/** Chave própria: o layout em % do `autoSaveId` não serve mais e sai de cena. */
export const CHAVE_LARGURA_PX = "bridge.sidebar.px";

export interface LimitesSidebar {
  /** Piso de LEGIBILIDADE, em px — não escala com a janela (#466). */
  minPx: number;
  /** Teto proporcional: o sidebar não pode comer o conteúdo. */
  maxPct: number;
}

/**
 * A largura que o sidebar deve ter, em px, dado o que o usuário escolheu e o
 * tamanho atual do grupo.
 *
 * O piso é px e o teto é %, e isso é de propósito: legibilidade não escala com
 * a tela (256px continuam sendo 256px de texto), mas "não comer o conteúdo" é
 * proporcional por natureza. Numa janela estreita o teto pode ficar ABAIXO do
 * piso — aí o teto ganha, senão o sidebar não caberia.
 */
export function larguraSidebarPx(
  desejadaPx: number,
  grupoPx: number,
  { minPx, maxPct }: LimitesSidebar,
): number {
  if (!(grupoPx > 0)) return desejadaPx;
  const tetoPx = (grupoPx * maxPct) / 100;
  if (tetoPx < minPx) return Math.round(tetoPx);
  return Math.round(Math.min(tetoPx, Math.max(minPx, desejadaPx)));
}

/** px → % do grupo, que é a única unidade que o painel aceita. */
export function pctDoGrupo(px: number, grupoPx: number): number {
  if (!(grupoPx > 0)) return 0;
  return Math.round((px / grupoPx) * 1000) / 10;
}

/**
 * Lê a largura escolhida. `null` = nunca escolheu (usa o default do #466).
 *
 * Storage indisponível (modo privado, cota) devolve `null` em vez de estourar:
 * não saber a escolha do usuário é um estado normal, não um erro.
 */
export function lerLarguraPx(
  storage: Pick<Storage, "getItem">,
): number | null {
  try {
    const cru = storage.getItem(CHAVE_LARGURA_PX);
    if (cru === null) return null;
    const n = Number(cru);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Grava a escolha. Falha de storage é silenciosa: não vale derrubar a tela. */
export function gravarLarguraPx(
  storage: Pick<Storage, "setItem">,
  px: number,
): void {
  try {
    storage.setItem(CHAVE_LARGURA_PX, String(Math.round(px)));
  } catch {
    /* modo privado / cota: a sessão segue com a largura em memória */
  }
}
