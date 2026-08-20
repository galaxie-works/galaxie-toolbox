// Aritmética de largura de painel redimensionável — a parte que erra é a conta
// (px → % do grupo, limites, storage indisponível), não a fiação em React.
//
// Nasceu no #869 (largura default do sidebar do Files acompanha o caption mais
// largo) e mudou pra `lib/` no #912, quando o sidebar do Bridge precisou da
// mesma conta pra virar painel com splitter sem perder a largura que o #466
// escolheu a dedo. Dois consumidores em features diferentes é o que prova que
// isto nunca foi coisa do Explorer.

/** Chave que o `react-resizable-panels` usa pra guardar o layout do grupo. */
export function chaveLayout(autoSaveId: string): string {
  return `react-resizable-panels:${autoSaveId}`;
}

/**
 * O usuário já arrastou o handle alguma vez? Se sim, o layout dele MANDA — o
 * adendo diz que o resize manual do #819 continua valendo, e sobrescrever a
 * escolha de quem arrastou seria pior do que não ter auto-largura nenhuma.
 */
export function temLayoutSalvo(
  autoSaveId: string,
  storage: Pick<Storage, "getItem">,
): boolean {
  try {
    return storage.getItem(chaveLayout(autoSaveId)) !== null;
  } catch {
    // localStorage pode lançar (modo privado, storage cheio). Sem certeza de
    // que há layout salvo, o seguro é NÃO mexer no painel de ninguém.
    return true;
  }
}

/**
 * Converte a largura de conteúdo medida (px) na fatia do grupo (%) que o painel
 * deve ocupar, respeitando os limites do próprio painel.
 *
 * `grupoPx <= 0` acontece antes do layout existir (medida tirada cedo demais):
 * aí não há resposta honesta, e devolver `null` deixa quem chamou não fazer
 * nada em vez de aplicar um número inventado.
 */
export function larguraIdealPct({
  conteudoPx,
  folgaPx,
  grupoPx,
  minPct,
  maxPct,
}: {
  conteudoPx: number;
  /** Padding do `aside` + respiro do scroll — o que não é texto. */
  folgaPx: number;
  grupoPx: number;
  minPct: number;
  maxPct: number;
}): number | null {
  if (!(grupoPx > 0) || !(conteudoPx > 0)) return null;
  const pct = ((conteudoPx + folgaPx) / grupoPx) * 100;
  if (!Number.isFinite(pct)) return null;
  return Math.min(maxPct, Math.max(minPct, pct));
}
