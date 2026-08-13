// #714 (Explorer S3 UI): renderer do menu de contexto data-driven + wrapper
// `ComMenu` (espelha o `comMenu` do Bridge/control-room) + `RenameInput`. Reusa
// os MESMOS primitivos Radix do app (`@/components/ui/context-menu`) — nada de
// menu custom. A árvore de itens vem do `menu-arquivo.ts` (puro/testável).
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  AppWindow,
  ClipboardPaste,
  Copy,
  ExternalLink,
  FilePlus2,
  FolderOpen,
  FolderPlus,
  Info,
  Link2,
  Pencil,
  Scissors,
  Trash2,
} from "lucide-react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { separarNomeExt } from "./caminho";
import type { IconeMenu, ItemMenu } from "./menu-arquivo";

const ICONES: Record<IconeMenu, ComponentType<{ className?: string }>> = {
  abrir: FolderOpen,
  abrirCom: AppWindow,
  recortar: Scissors,
  copiar: Copy,
  colar: ClipboardPaste,
  renomear: Pencil,
  excluir: Trash2,
  novaPasta: FolderPlus,
  novoArquivo: FilePlus2,
  copiarCaminho: Link2,
  revelar: ExternalLink,
  propriedades: Info,
};

/** Renderiza recursivamente uma lista de `ItemMenu` como itens/submenus Radix. */
function renderItens(itens: ItemMenu[]): ReactNode {
  return itens.map((it) => {
    const Icon = it.icon ? ICONES[it.icon] : null;
    const node = it.submenu ? (
      <ContextMenuSub>
        <ContextMenuSubTrigger className="gap-2">
          {Icon && <Icon />}
          {it.label}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-56">
          {renderItens(it.submenu)}
        </ContextMenuSubContent>
      </ContextMenuSub>
    ) : (
      <ContextMenuItem
        className="gap-2"
        variant={it.variant}
        disabled={it.disabled}
        onSelect={() => it.onClick?.()}
      >
        {Icon && <Icon />}
        {it.label}
      </ContextMenuItem>
    );
    return (
      <Fragment key={it.id}>
        {node}
        {it.separatorAfter && <ContextMenuSeparator />}
      </Fragment>
    );
  });
}

/**
 * Wrapper que envolve uma linha/tile num `ContextMenu` Radix (mesmo aninhamento
 * do `comMenu` do Bridge). `onOpen(shift)` reporta se o Shift estava pressionado
 * no clique direito (pro gate de exclusão permanente). Itens são função pra
 * montar sob demanda com o estado (Shift) já atualizado.
 */
export function ComMenu({
  itens,
  onOpen,
  onClick,
  className,
  children,
}: {
  itens: ItemMenu[];
  onOpen?: (shift: boolean) => void;
  onClick?: (e: ReactMouseEvent<HTMLDivElement>) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={className}
          onClick={onClick}
          onContextMenu={(e) => onOpen?.(e.shiftKey)}
        >
          {children}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {renderItens(itens)}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * Campo de rename in-place. Autofocus + seleciona só a BASE (sem a extensão).
 * Enter confirma; Esc cancela; Tab confirma + avança; blur confirma (o pai trata
 * nome inválido/conflito vindo do blur cancelando em silêncio). Para de propagar
 * teclado/clique pra não acionar a seleção/abertura da linha por baixo.
 */
export function RenameInput({
  inicial,
  ehPasta = false,
  onConfirmar,
  onCancelar,
  className,
}: {
  inicial: string;
  /** #714: pasta seleciona o nome TODO; arquivo, só a base (antes da extensão). */
  ehPasta?: boolean;
  onConfirmar: (nome: string, opts: { mover: boolean; viaBlur: boolean }) => void;
  onCancelar: () => void;
  className?: string;
}) {
  const [valor, setValor] = useState(inicial);
  const ref = useRef<HTMLInputElement>(null);
  const commitRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // #714 (Wagner): quando o rename vem do ContextMenu do Radix, o menu ao FECHAR
    // devolve o foco ao trigger — roubando o foco do input recém-montado. rAF
    // dobrado foca DEPOIS desse restore, então o cursor cai no campo sem clique.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        el.focus();
        // Pasta: nome todo. Arquivo: só a base (dotfiles/sem-ponto = nome todo).
        const fim = ehPasta
          ? inicial.length
          : separarNomeExt(inicial).base.length || inicial.length;
        el.setSelectionRange(0, fim);
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [inicial, ehPasta]);

  return (
    <input
      ref={ref}
      value={valor}
      spellCheck={false}
      onChange={(e) => setValor(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          commitRef.current = true;
          onConfirmar(valor, { mover: false, viaBlur: false });
        } else if (e.key === "Escape") {
          e.preventDefault();
          commitRef.current = true;
          onCancelar();
        } else if (e.key === "Tab") {
          e.preventDefault();
          commitRef.current = true;
          onConfirmar(valor, { mover: true, viaBlur: false });
        }
      }}
      onBlur={() => {
        // Enter/Esc/Tab já finalizaram — não confirma de novo no blur que segue.
        if (commitRef.current) return;
        onConfirmar(valor, { mover: false, viaBlur: true });
      }}
      className={cn(
        "min-w-0 flex-1 rounded-sm border border-ring bg-background px-1 py-0 text-sm outline-none ring-1 ring-ring/40",
        className,
      )}
    />
  );
}
