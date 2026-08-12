// #677: helpers puros de caminho Windows para o Explorer. Em `.ts` (sem JSX) de
// propósito — funções puras, testáveis e sem dependência de React.

/**
 * Caminho pai (sobe um nível). O drive-root ("C:\") não tem pai — devolve ele
 * mesmo, então `up()` no topo vira no-op.
 */
export function pathPai(p: string): string {
  const s = p.replace(/\\+$/, "");
  if (/^[A-Za-z]:$/.test(s)) return `${s}\\`; // drive-root: já é o topo
  const i = s.lastIndexOf("\\");
  if (i < 0) return p;
  if (i <= 2) return s.slice(0, 3); // pai é o drive-root "C:\"
  return s.slice(0, i);
}

export interface SegmentoCaminho {
  label: string;
  /** Caminho acumulado até este segmento (inclusive), para navegar ao clicar. */
  path: string;
}

/**
 * Quebra um caminho em segmentos clicáveis, cada um carregando o `path`
 * acumulado. Lida com o drive-root ("C:\") como primeiro segmento.
 */
export function segmentosCaminho(p: string): SegmentoCaminho[] {
  const s = p.replace(/\\+$/, "");
  const partes = s.split("\\").filter(Boolean);
  const acc: SegmentoCaminho[] = [];
  let cur = "";
  partes.forEach((parte, i) => {
    cur = i === 0 ? `${parte}\\` : `${cur.replace(/\\$/, "")}\\${parte}`;
    acc.push({ label: parte, path: cur });
  });
  return acc;
}
