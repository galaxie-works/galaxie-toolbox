// #714 (Explorer S3 UI): construtores DATA-DRIVEN do menu de contexto do
// Explorer + helpers puros (conflito de nome, nome único, nome válido). Em `.ts`
// puro (sem React/lucide) de propósito — testável no `node --test` e reusável. O
// renderer recursivo + os ícones vivem no `menu-contexto.tsx`; aqui só a árvore
// de itens. Espelha o padrão do menu de pastas do Bridge (control-room): uma
// lista tipada de itens montada por um builder, renderizada por `renderItens`.
import type { FsEntry } from "@/lib/types";

/** Operação pendente da área de transferência interna do Explorer. */
export type OperacaoClipboard = "copy" | "cut";

/** Estado da área de transferência interna (vive no shell — sobrevive à navegação). */
export interface Clipboard {
  paths: string[];
  op: OperacaoClipboard;
}

/** Chave de ícone (mapeada pra um componente lucide no `menu-contexto.tsx`). */
export type IconeMenu =
  | "abrir"
  | "abrirCom"
  | "recortar"
  | "copiar"
  | "colar"
  | "renomear"
  | "excluir"
  | "novaPasta"
  | "novoArquivo"
  | "copiarCaminho"
  | "revelar"
  | "propriedades";

/** Um item do menu de contexto (data-driven). `submenu` aninha recursivamente. */
export interface ItemMenu {
  id: string;
  label: string;
  icon?: IconeMenu;
  onClick?: () => void;
  disabled?: boolean;
  /** Renderiza um `ContextMenuSeparator` logo após este item. */
  separatorAfter?: boolean;
  variant?: "destructive";
  submenu?: ItemMenu[];
}

/** Rótulos i18n consumidos pelos builders (montados a partir de `t.arquivos`). */
export interface RotulosMenu {
  abrir: string;
  abrirCom: string;
  abrirComPadrao: string;
  recortar: string;
  copiar: string;
  colar: string;
  renomear: string;
  excluir: string;
  excluirPerm: string;
  novaPasta: string;
  novoArquivo: string;
  copiarCaminho: string;
  revelar: string;
  propriedades: string;
}

/** Callbacks de ação — a UI (content-pane) passa os handlers reais (que chamam a
 *  api do FS + dão refresh). Mantê-los à parte deixa o builder puro/testável. */
export interface AcoesMenu {
  abrir: (entry: FsEntry) => void;
  abrirCom: (entry: FsEntry) => void;
  recortar: (paths: string[]) => void;
  copiar: (paths: string[]) => void;
  colar: (destDir: string) => void;
  renomear: (entry: FsEntry) => void;
  paraLixeira: (paths: string[]) => void;
  excluirPerm: (paths: string[]) => void;
  novaPasta: (destDir: string) => void;
  novoArquivo: (destDir: string) => void;
  copiarCaminho: (paths: string[]) => void;
  revelar: (path: string) => void;
  propriedades: (entry: FsEntry) => void;
}

/**
 * Alvos de uma ação: opera sobre a SELEÇÃO quando o item clicado faz parte dela;
 * senão, só sobre o item clicado.
 */
export function alvosDe(entry: FsEntry, selecionados: string[]): string[] {
  return selecionados.length > 0 && selecionados.includes(entry.path)
    ? selecionados
    : [entry.path];
}

/**
 * Menu de contexto de um item (arquivo/pasta). Taxonomia v1: Abrir · Abrir com
 * (só arquivo) · Recortar · Copiar · Colar (só em pasta, com clipboard cheio) ·
 * Renomear (single) · Copiar caminho · Revelar · Excluir. `opts.permanente`
 * (Shift no open) troca "Excluir (Lixeira)" por "Excluir permanentemente".
 */
export function getFileContextMenu(
  entry: FsEntry,
  selecionados: string[],
  clipboard: Clipboard | null,
  acoes: AcoesMenu,
  rotulos: RotulosMenu,
  opts: { permanente?: boolean } = {},
): ItemMenu[] {
  const alvos = alvosDe(entry, selecionados);
  const multi = alvos.length > 1;
  const podeColar =
    clipboard != null && clipboard.paths.length > 0 && entry.isDir;

  const itens: ItemMenu[] = [];

  itens.push({
    id: "abrir",
    label: rotulos.abrir,
    icon: "abrir",
    onClick: () => acoes.abrir(entry),
  });
  if (!entry.isDir) {
    itens.push({
      id: "abrirCom",
      label: rotulos.abrirCom,
      icon: "abrirCom",
      submenu: [
        {
          id: "abrirCom.padrao",
          label: rotulos.abrirComPadrao,
          icon: "abrirCom",
          onClick: () => acoes.abrirCom(entry),
        },
      ],
    });
  }
  // Separador após o grupo "abrir".
  itens[itens.length - 1].separatorAfter = true;

  itens.push({
    id: "recortar",
    label: rotulos.recortar,
    icon: "recortar",
    onClick: () => acoes.recortar(alvos),
  });
  itens.push({
    id: "copiar",
    label: rotulos.copiar,
    icon: "copiar",
    onClick: () => acoes.copiar(alvos),
  });
  itens.push({
    id: "colar",
    label: rotulos.colar,
    icon: "colar",
    disabled: !podeColar,
    separatorAfter: true,
    onClick: () => acoes.colar(entry.path),
  });

  itens.push({
    id: "renomear",
    label: rotulos.renomear,
    icon: "renomear",
    disabled: multi,
    onClick: () => acoes.renomear(entry),
  });
  itens.push({
    id: "copiarCaminho",
    label: rotulos.copiarCaminho,
    icon: "copiarCaminho",
    onClick: () => acoes.copiarCaminho(alvos),
  });
  itens.push({
    id: "revelar",
    label: rotulos.revelar,
    icon: "revelar",
    separatorAfter: true,
    onClick: () => acoes.revelar(entry.path),
  });

  if (opts.permanente) {
    itens.push({
      id: "excluirPerm",
      label: rotulos.excluirPerm,
      icon: "excluir",
      variant: "destructive",
      separatorAfter: true,
      onClick: () => acoes.excluirPerm(alvos),
    });
  } else {
    itens.push({
      id: "excluir",
      label: rotulos.excluir,
      icon: "excluir",
      variant: "destructive",
      separatorAfter: true,
      onClick: () => acoes.paraLixeira(alvos),
    });
  }

  itens.push({
    id: "propriedades",
    label: rotulos.propriedades,
    icon: "propriedades",
    onClick: () => acoes.propriedades(entry),
  });

  return itens;
}

/**
 * Menu de contexto do espaço vazio da pasta atual: Colar (com clipboard cheio) +
 * Nova pasta + Novo arquivo — todos operam sobre `currentPath`.
 */
export function getEmptySpaceContextMenu(
  currentPath: string,
  clipboard: Clipboard | null,
  acoes: AcoesMenu,
  rotulos: RotulosMenu,
): ItemMenu[] {
  const podeColar = clipboard != null && clipboard.paths.length > 0;
  return [
    {
      id: "colar",
      label: rotulos.colar,
      icon: "colar",
      disabled: !podeColar,
      separatorAfter: true,
      onClick: () => acoes.colar(currentPath),
    },
    {
      id: "novaPasta",
      label: rotulos.novaPasta,
      icon: "novaPasta",
      onClick: () => acoes.novaPasta(currentPath),
    },
    {
      id: "novoArquivo",
      label: rotulos.novoArquivo,
      icon: "novoArquivo",
      onClick: () => acoes.novoArquivo(currentPath),
    },
  ];
}

// --- Helpers puros de nome (rename / criar) --------------------------------

/** Caracteres proibidos em nome de arquivo/pasta no Windows. */
const CHARS_INVALIDOS = /[<>:"/\\|?*]/;

/** Nome válido: não-vazio (após trim) e sem caracteres proibidos. */
export function nomeValido(nome: string): boolean {
  const t = nome.trim();
  return t.length > 0 && !CHARS_INVALIDOS.test(t);
}

/**
 * True se já existe um irmão com esse nome (case-insensitive, como o NTFS),
 * ignorando o próprio item que está sendo renomeado (`ignorarPath`).
 */
export function nomeEmConflito(
  nome: string,
  irmaos: FsEntry[],
  ignorarPath?: string,
): boolean {
  const alvo = nome.trim().toLowerCase();
  if (!alvo) return false;
  return irmaos.some(
    (e) => e.path !== ignorarPath && e.name.toLowerCase() === alvo,
  );
}

/**
 * Gera um nome único a partir de `base` sufixando " (2)", " (3)"… quando já há um
 * irmão com esse nome (case-insensitive). Serve pro default de "Nova pasta".
 */
export function nomeUnico(base: string, irmaos: FsEntry[]): string {
  const existentes = new Set(irmaos.map((e) => e.name.toLowerCase()));
  if (!existentes.has(base.toLowerCase())) return base;
  let n = 2;
  while (existentes.has(`${base} (${n})`.toLowerCase())) n++;
  return `${base} (${n})`;
}
