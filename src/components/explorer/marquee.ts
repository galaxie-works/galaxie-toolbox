// #748: geometria PURA do marquee (rubber-band). Sem React e sem imports —
// carrega direto no `node --test`. O hook que a usa vive em `use-marquee.ts`.
//
// `indicesNoRetangulo`: dado um retângulo em COORDENADAS DE CONTEÚDO (0,0 = topo
// da área virtualizada, cresce com o scroll) + a métrica do grid, devolve os
// índices dos itens intersectados. Não olha o DOM — calcula por LINHA×COLUNA,
// então itens fora do viewport (virtualizados) também entram se o retângulo os
// cobre logicamente.

export interface RetanguloMarquee {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Métrica do grid virtualizado (mesma usada pra posicionar as linhas):
 * `cols` itens por linha, cada linha com `alturaLinha` px; a área tem `largura`
 * px e `alturaTotal` px (getTotalSize). `gap`/`padX` são o espaçamento e o
 * padding horizontal do container da grade (px-1). `modoGrade` = multi-coluna.
 */
export interface GridMetrica {
  cols: number;
  alturaLinha: number;
  largura: number;
  alturaTotal: number;
  count: number;
  gap: number;
  padX: number;
  modoGrade: boolean;
}

export function normalizarRetangulo(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): RetanguloMarquee {
  return {
    x1: Math.min(ax, bx),
    y1: Math.min(ay, by),
    x2: Math.max(ax, bx),
    y2: Math.max(ay, by),
  };
}

/**
 * Índices (ordem visível) dos itens que o retângulo intersecta. Percorre só as
 * LINHAS cobertas verticalmente; em grade, testa a sobreposição horizontal de
 * cada coluna. Em lista/detalhes (`cols === 1`), a linha inteira conta.
 */
export function indicesNoRetangulo(
  rect: RetanguloMarquee,
  m: GridMetrica,
): number[] {
  const { cols, alturaLinha, largura, count, gap, padX, modoGrade } = m;
  if (count <= 0 || cols <= 0 || alturaLinha <= 0) return [];
  const out: number[] = [];
  const totalLinhas = Math.ceil(count / cols);
  const rowFrom = Math.max(0, Math.floor(rect.y1 / alturaLinha));
  const rowTo = Math.min(totalLinhas - 1, Math.floor(rect.y2 / alturaLinha));
  // Largura de cada coluna na grade (repeat(cols, 1fr) com gap e padding lateral).
  const colW = modoGrade
    ? (largura - 2 * padX - (cols - 1) * gap) / cols
    : largura;
  for (let r = rowFrom; r <= rowTo; r++) {
    if (!modoGrade) {
      if (r < count) out.push(r);
      continue;
    }
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (i >= count) break;
      const left = padX + c * (colW + gap);
      const right = left + colW;
      if (rect.x2 >= left && rect.x1 <= right) out.push(i);
    }
  }
  return out;
}
