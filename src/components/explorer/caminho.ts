// #677: helpers puros de caminho Windows para o Explorer. Em `.ts` (sem JSX) de
// propósito — funções puras, testáveis e sem dependência de React.

/**
 * #855: sentinel de caminho para "Este computador" (a grade de drives). Caminho
 * vazio = nenhuma pasta real selecionada; o shell mostra a `DrivesView` quando
 * `currentPath` é este sentinel e os drives já carregaram, e o item "Este
 * computador" no sidebar fica ativo. Vazio é seguro: nenhum caminho real do FS é
 * "", e o watcher/ContentPane do shell já ignoram caminho vazio.
 */
export const CAMINHO_ESTE_PC = "";

/**
 * #1287: sentinelas de caminho das outras raízes semânticas (Cloud drives,
 * Locais de rede, Acesso rápido) — cada uma tem uma view de tiles no estilo do
 * This PC. Como o `CAMINHO_ESTE_PC`, NÃO são pastas reais do FS: o `::x::` nunca
 * colide com um caminho Windows. Servem de `currentPath` (roteia a view) e de
 * `value` do accordion na árvore — uma fonte só pros dois.
 */
export const CAMINHO_CLOUD = "::cloud::";
export const CAMINHO_REDE = "::locais-rede::";
export const CAMINHO_ACESSO_RAPIDO = "::acesso-rapido::";

/**
 * Raiz "virtual" = sentinel sem pasta real por trás (This PC + as três do
 * #1287). O shell usa isto pra NÃO observar/listar/buscar o caminho como se
 * fosse disco (senão o watcher e o `listarDir` batem num alvo inexistente).
 */
export function ehRaizVirtual(path: string): boolean {
  return (
    path === CAMINHO_ESTE_PC ||
    path === CAMINHO_CLOUD ||
    path === CAMINHO_REDE ||
    path === CAMINHO_ACESSO_RAPIDO
  );
}

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

/**
 * Junta um diretório com um nome de filho (separador Windows `\`). Normaliza a
 * barra final do diretório e cobre o drive-root ("C:\" ou "C:").
 */
export function juntarCaminho(dir: string, nome: string): string {
  const base = dir.replace(/\\+$/, "");
  return `${base}\\${nome}`;
}

/** Último componente do caminho (nome do arquivo/pasta). */
export function nomeBase(p: string): string {
  const s = p.replace(/\\+$/, "");
  const i = s.lastIndexOf("\\");
  return i < 0 ? s : s.slice(i + 1);
}

/**
 * Quebra um nome em base + extensão (a extensão inclui o ponto). Dotfiles
 * (".env") e nomes sem ponto não têm extensão — o nome inteiro é a base. Serve
 * pra seleção do rename in-place (seleciona só a base).
 */
export function separarNomeExt(nome: string): { base: string; ext: string } {
  const i = nome.lastIndexOf(".");
  if (i <= 0) return { base: nome, ext: "" };
  return { base: nome.slice(0, i), ext: nome.slice(i) };
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
