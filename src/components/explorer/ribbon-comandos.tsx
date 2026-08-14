import type { Ref } from "react";
import {
  ArrowDownUp,
  ChevronDown,
  ClipboardPaste,
  Copy,
  FilePlus,
  FolderPlus,
  LayoutGrid,
  Link,
  List,
  MoreHorizontal,
  Network,
  PanelRight,
  PanelRightClose,
  PencilLine,
  Plus,
  Scissors,
  Search,
  Share2,
  Table as TableIcon,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { preencher, useIdioma } from "@/lib/idioma";
import type { FsEntry } from "@/lib/types";

import { TooltipAcao } from "./tooltip-acao";
import type { Ordem } from "./ordenar";
import type { AcoesMenu, Clipboard } from "./menu-arquivo";

/**
 * #871: LINHA 2 do explorer (Files) — ribbon de comandos estilo Windows 11.
 * Uma única fileira horizontal: `Novo ▾` · recortar/copiar/colar/renomear/
 * compartilhar/excluir · `Classificar ▾` · `Exibir ▾` · `⋯` · filtro in-folder ·
 * toggle do inspector · contagem. Props-driven (todo o estado/handlers moram no
 * ContentPane) — extraído da toolbar antiga do content-pane, ABSORVENDO o grupo
 * de views (#867) e o mesmo padrão de tooltip/atalho do #854.
 */
export interface RibbonComandosProps {
  currentPath: string;
  modo: "detalhes" | "lista" | "grade";
  onModo: (m: "detalhes" | "lista" | "grade") => void;
  ordem: Ordem;
  onOrdem: (o: Ordem) => void;
  acoes: AcoesMenu;
  clipboard: Clipboard | null;
  /** Caminhos selecionados (o Set do ContentPane, já espalhado em array). */
  selecionados: string[];
  /** A ÚNICA entrada selecionada (pro renomear); null com 0 ou >1 selecionados. */
  entradaUnica: FsEntry | null;
  filtro: string;
  onFiltro: (s: string) => void;
  /** #863: ref do Input do filtro (Ctrl+F foca-o pelo handler de teclas do ContentPane). */
  filtroRef?: Ref<HTMLInputElement>;
  mostrarOcultos: boolean;
  onOcultos: () => void;
  mostrarInspector: boolean;
  onToggleInspector?: () => void;
  totalItens: number;
}

/** Separador vertical fininho entre grupos do ribbon. */
function Divisor() {
  return <div className="mx-0.5 h-5 w-px bg-border" />;
}

export function RibbonComandos(props: RibbonComandosProps) {
  const {
    currentPath,
    modo,
    onModo,
    ordem,
    onOrdem,
    acoes,
    clipboard,
    selecionados,
    entradaUnica,
    filtro,
    onFiltro,
    filtroRef,
    mostrarOcultos,
    onOcultos,
    mostrarInspector,
    onToggleInspector,
    totalItens,
  } = props;
  const { t } = useIdioma();

  const semSelecao = selecionados.length === 0;
  const semClipboard = !clipboard || clipboard.paths.length === 0;

  return (
    <div className="flex shrink-0 items-center gap-1">
      {/* Novo ▾ */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm" className="h-8 gap-1.5">
            <Plus className="size-4" />
            <span className="text-xs">{t.arquivos.novoMenu}</span>
            <ChevronDown className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => acoes.novaPasta(currentPath)}>
            <FolderPlus className="size-4" />
            {t.arquivos.novaPasta}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => acoes.novoArquivo(currentPath)}>
            <FilePlus className="size-4" />
            {t.arquivos.novoArquivo}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {/* Backend pendente — visível mas desabilitado (não morto). */}
          <DropdownMenuItem disabled>
            <Link className="size-4" />
            {t.arquivos.novoAtalho}
          </DropdownMenuItem>
          {/* Só faz sentido em "Este computador"; backend do Confucius pendente. */}
          <DropdownMenuItem disabled>
            <Network className="size-4" />
            {t.arquivos.novaUnidadeRede}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Divisor />

      {/* Área de transferência */}
      <TooltipAcao label={t.arquivos.recortar} atalhoId="recortar">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          disabled={semSelecao}
          onClick={() => acoes.recortar(selecionados)}
          aria-label={t.arquivos.recortar}
        >
          <Scissors className="size-4" />
        </Button>
      </TooltipAcao>
      <TooltipAcao label={t.arquivos.copiar} atalhoId="copiar">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          disabled={semSelecao}
          onClick={() => acoes.copiar(selecionados)}
          aria-label={t.arquivos.copiar}
        >
          <Copy className="size-4" />
        </Button>
      </TooltipAcao>
      <TooltipAcao label={t.arquivos.colar} atalhoId="colar">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          disabled={semClipboard}
          onClick={() => acoes.colar(currentPath)}
          aria-label={t.arquivos.colar}
        >
          <ClipboardPaste className="size-4" />
        </Button>
      </TooltipAcao>
      <TooltipAcao label={t.arquivos.renomear} atalhoId="renomear">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          disabled={!entradaUnica}
          onClick={() => entradaUnica && acoes.renomear(entradaUnica)}
          aria-label={t.arquivos.renomear}
        >
          <PencilLine className="size-4" />
        </Button>
      </TooltipAcao>
      {/* Compartilhar — backend pendente (desabilitado, não morto). */}
      <TooltipAcao label={t.arquivos.compartilhar}>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          disabled
          aria-label={t.arquivos.compartilhar}
        >
          <Share2 className="size-4" />
        </Button>
      </TooltipAcao>
      <TooltipAcao label={t.arquivos.excluir} atalhoId="lixeira">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          disabled={semSelecao}
          onClick={() => acoes.paraLixeira(selecionados)}
          aria-label={t.arquivos.excluir}
        >
          <Trash2 className="size-4" />
        </Button>
      </TooltipAcao>

      <Divisor />

      {/* Classificar ▾ */}
      <DropdownMenu>
        <TooltipAcao label={t.arquivos.ordenarMenu}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={t.arquivos.ordenarMenu}
            >
              <ArrowDownUp className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipAcao>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={ordem.chave}
            onValueChange={(v) =>
              onOrdem({ ...ordem, chave: v as Ordem["chave"] })
            }
          >
            <DropdownMenuRadioItem value="nome">
              {t.arquivos.ordNome}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="modificado">
              {t.arquivos.ordModificado}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="tipo">
              {t.arquivos.ordTipo}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="tamanho">
              {t.arquivos.ordTamanho}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            value={ordem.direcao}
            onValueChange={(v) =>
              onOrdem({ ...ordem, direcao: v as Ordem["direcao"] })
            }
          >
            <DropdownMenuRadioItem value="asc">
              {t.arquivos.ordAsc}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="desc">
              {t.arquivos.ordDesc}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Exibir ▾ — absorve o antigo grupo BotaoView (#867). */}
      <DropdownMenu>
        <TooltipAcao label={t.arquivos.viewMenu}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={t.arquivos.viewMenu}
            >
              <LayoutGrid className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipAcao>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={modo}
            onValueChange={(v) => onModo(v as "detalhes" | "lista" | "grade")}
          >
            <DropdownMenuRadioItem value="detalhes">
              <TableIcon className="size-4" />
              {t.arquivos.viewDetalhes}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="lista">
              <List className="size-4" />
              {t.arquivos.viewLista}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="grade">
              <LayoutGrid className="size-4" />
              {t.arquivos.viewGrade}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* ⋯ Mais */}
      <DropdownMenu>
        <TooltipAcao label={t.arquivos.mais}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={t.arquivos.mais}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipAcao>
        <DropdownMenuContent align="start">
          <DropdownMenuCheckboxItem
            checked={mostrarOcultos}
            onCheckedChange={() => onOcultos()}
          >
            {t.arquivos.mostrarOcultos}
          </DropdownMenuCheckboxItem>
          <DropdownMenuItem onClick={() => acoes.propriedades()}>
            {t.arquivos.propriedades}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Filtro in-folder (as-you-type) */}
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={filtroRef}
          value={filtro}
          onChange={(e) => onFiltro(e.target.value)}
          onKeyDown={(e) => {
            // ESC no filtro: com texto, LIMPA e não propaga (senão o ESC da
            // lista limparia a seleção junto); vazio, só tira o foco do campo.
            if (e.key === "Escape") {
              if (filtro) {
                e.preventDefault();
                e.stopPropagation();
                onFiltro("");
              } else {
                e.currentTarget.blur();
              }
            }
          }}
          placeholder={t.arquivos.filtrar}
          aria-label={t.arquivos.filtrar}
          className="h-8 pl-8 pr-8"
        />
        {filtro && (
          <TooltipAcao label={t.arquivos.limparFiltro}>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-0.5 top-1/2 size-7 -translate-y-1/2"
              onClick={() => onFiltro("")}
              aria-label={t.arquivos.limparFiltro}
            >
              <X className="size-3.5" />
            </Button>
          </TooltipAcao>
        )}
      </div>

      {/* Toggle do painel de detalhes (inspector) */}
      {onToggleInspector && (
        <TooltipAcao label={t.arquivos.detalhes}>
          <Button
            variant={mostrarInspector ? "secondary" : "ghost"}
            size="icon"
            className="size-8"
            onClick={onToggleInspector}
            aria-pressed={mostrarInspector}
            aria-label={t.arquivos.detalhes}
          >
            {mostrarInspector ? (
              <PanelRightClose className="size-4" />
            ) : (
              <PanelRight className="size-4" />
            )}
          </Button>
        </TooltipAcao>
      )}

      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {selecionados.length > 0
          ? preencher(t.arquivos.itensSelec, { n: selecionados.length })
          : preencher(t.arquivos.total, { n: totalItens })}
      </span>
    </div>
  );
}
