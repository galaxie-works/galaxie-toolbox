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
 * #1287 (reprovação da Lúmen): o valor-sentinela do nó-RAIZ do accordion do
 * sidebar. As três raízes novas usam a PRÓPRIA sentinela de caminho (clicar no
 * cabeçalho navega pra view de tiles); o This PC não pode, porque a sentinela de
 * caminho dele é `""` e string vazia não serve de `value` de accordion.
 */
const ARVORE_ESTE_PC = "::este-pc::";

/** Ícone de uma raiz, por ID. O mapa id → componente mora em `icone-raiz.ts`:
 *  este arquivo é lido pelo `node --test` e não pode importar React. */
export type IdIconeRaiz = "monitor" | "cloud" | "network" | "pin";

/** Chave do título em `t.arquivos` — de novo, ID e não valor: `caminho.ts` não
 *  importa dicionário, e o rótulo tem de sair do MESMO lugar nos 4 consumidores. */
export type ChaveTituloRaiz =
  | "drives"
  | "driveSecaoCloud"
  | "driveSecaoRede"
  | "acessoRapido";

/**
 * #1287: uma raiz semântica do Files — sentinela, ícone e título, juntos.
 *
 * Existe por uma medição da `Lúmen` que eu confirmei: o mesmo fato estava
 * escrito em QUATRO lugares (ícone na árvore, ícone+título da view, rótulo do
 * `onLocalChange`, rótulo do breadcrumb). Trocar o ícone só num deles deixava
 * sidebar e página discordando sobre o que é aquela raiz, com a suíte inteira
 * verde. Guarda que pina uma das quatro cópias parece mais forte do que é.
 */
export interface RaizVirtual {
  /** `currentPath` que roteia a view. */
  sentinela: string;
  /** `value` do accordion na árvore (≠ sentinela só no This PC). */
  valorArvore: string;
  icone: IdIconeRaiz;
  titulo: ChaveTituloRaiz;
}

/** A ordem é a que o sidebar mostra. */
export const RAIZES_VIRTUAIS: readonly RaizVirtual[] = [
  {
    sentinela: CAMINHO_ESTE_PC,
    valorArvore: ARVORE_ESTE_PC,
    icone: "monitor",
    titulo: "drives",
  },
  {
    sentinela: CAMINHO_CLOUD,
    valorArvore: CAMINHO_CLOUD,
    icone: "cloud",
    titulo: "driveSecaoCloud",
  },
  {
    sentinela: CAMINHO_REDE,
    valorArvore: CAMINHO_REDE,
    icone: "network",
    titulo: "driveSecaoRede",
  },
  {
    sentinela: CAMINHO_ACESSO_RAPIDO,
    valorArvore: CAMINHO_ACESSO_RAPIDO,
    icone: "pin",
    titulo: "acessoRapido",
  },
];

/** A raiz de um `currentPath`, ou `null` se for pasta de verdade. */
export function raizVirtual(path: string): RaizVirtual | null {
  return RAIZES_VIRTUAIS.find((r) => r.sentinela === path) ?? null;
}

/**
 * Raiz "virtual" = sentinel sem pasta real por trás (This PC + as três do
 * #1287). O shell usa isto pra NÃO observar/listar/buscar o caminho como se
 * fosse disco (senão o watcher e o `listarDir` batem num alvo inexistente).
 */
export function ehRaizVirtual(path: string): boolean {
  return raizVirtual(path) !== null;
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
