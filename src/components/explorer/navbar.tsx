import { useEffect, useState, type Ref } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Monitor,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { useIdioma, preencher } from "@/lib/idioma";
import { statCaminho } from "@/lib/api";
import { CAMINHO_ESTE_PC, nomeBase, segmentosCaminho } from "./caminho";
import { TooltipAcao } from "./tooltip-acao";

/**
 * #677: barra de navegação no topo do painel de conteúdo — voltar/avançar/acima +
 * breadcrumb de segmentos clicáveis (cada um com seu caminho acumulado) e um campo
 * de endereço EDITÁVEL. Digitar um caminho valida via `statCaminho`: se for pasta,
 * navega; senão marca estado de erro (borda destrutiva). Enter confirma, Esc
 * cancela.
 */
export function NavBarArquivos({
  currentPath,
  canBack,
  canForward,
  onBack,
  onForward,
  onUp,
  onRefresh,
  onNavegar,
  buscaAtiva,
  onBuscar,
  onLimparBusca,
  onSairBusca,
  podeBuscar,
  buscaRef,
}: {
  currentPath: string;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onUp: () => void;
  onRefresh: () => void;
  onNavegar: (path: string) => void;
  // #871 (fatia 2b): busca recursiva na pasta atual.
  buscaAtiva: boolean;
  onBuscar: (query: string) => void;
  onLimparBusca: () => void;
  /** #968: ESC no campo de busca devolve o foco pra lista (round-trip do Ctrl+E). */
  onSairBusca?: () => void;
  podeBuscar: boolean;
  /** #968: ref do input de busca — Ctrl+E (no `aoTeclar` do ContentPane) foca-o. */
  buscaRef?: Ref<HTMLInputElement>;
}) {
  const { t } = useIdioma();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(currentPath);
  const [erro, setErro] = useState(false);
  const [validando, setValidando] = useState(false);
  // #871 (fatia 2b): campo de busca controlado (local à navbar).
  const [busca, setBusca] = useState("");

  // Some o termo do campo quando a busca é limpa por fora (ex.: navegação).
  useEffect(() => {
    if (!buscaAtiva) setBusca("");
  }, [buscaAtiva]);

  // Some o caminho novo no campo (e limpa erro) sempre que a navegação muda.
  useEffect(() => {
    setValor(currentPath);
    setErro(false);
  }, [currentPath]);

  async function confirmar() {
    const alvo = valor.trim();
    if (!alvo) return;
    setValidando(true);
    setErro(false);
    try {
      const info = await statCaminho(alvo);
      if (!info.isDir) {
        setErro(true);
        return;
      }
      setEditando(false);
      onNavegar(info.path);
    } catch {
      setErro(true);
    } finally {
      setValidando(false);
    }
  }

  const segmentos = segmentosCaminho(currentPath);

  return (
    <div className="flex shrink-0 items-center gap-1">
      <TooltipAcao label={t.arquivos.voltar} atalhoId="voltar">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          disabled={!canBack}
          onClick={onBack}
          aria-label={t.arquivos.voltar}
        >
          <ArrowLeft className="size-4" />
        </Button>
      </TooltipAcao>
      <TooltipAcao label={t.arquivos.avancar} atalhoId="avancar">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          disabled={!canForward}
          onClick={onForward}
          aria-label={t.arquivos.avancar}
        >
          <ArrowRight className="size-4" />
        </Button>
      </TooltipAcao>
      <TooltipAcao label={t.arquivos.acima} atalhoId="pastaAcima">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onUp}
          aria-label={t.arquivos.acima}
        >
          <ArrowUp className="size-4" />
        </Button>
      </TooltipAcao>
      {/* #871: atualizar (F5) — recarrega a pasta atual via o nonce do watcher. */}
      <TooltipAcao label={t.arquivos.atualizar} atalhoId="atualizar">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onRefresh}
          aria-label={t.arquivos.atualizar}
        >
          <RefreshCw className="size-4" />
        </Button>
      </TooltipAcao>

      {editando ? (
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <Input
            autoFocus
            value={valor}
            aria-label={t.arquivos.endereco}
            aria-invalid={erro || undefined}
            // #854: entra em edição com TUDO selecionado (Ctrl+A implícito) —
            // digitar substitui o caminho na hora.
            onFocus={(e) => e.target.select()}
            onChange={(e) => {
              setValor(e.target.value);
              setErro(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void confirmar();
              else if (e.key === "Escape") {
                setEditando(false);
                setValor(currentPath);
                setErro(false);
              }
            }}
            onBlur={() => setEditando(false)}
            className={cn("h-8", erro && "border-destructive")}
          />
          {validando && <Spinner className="size-4 text-muted-foreground" />}
          {erro && (
            <span className="shrink-0 text-xs text-destructive">
              {t.arquivos.enderecoInvalido}
            </span>
          )}
        </div>
      ) : (
        // #854: SEM lápis. Clicar no ESPAÇO VAZIO (depois do último segmento) ou
        // botão-direito > "Editar caminho" libera o campo. Clique num segmento
        // navega (onClick do botão, que não é o alvo do container).
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              className="flex min-w-0 flex-1 cursor-text items-center overflow-x-auto rounded-md border bg-background/40 px-1 py-0.5"
              onClick={(e) => {
                if (e.target === e.currentTarget) setEditando(true);
              }}
              title={t.arquivos.editarCaminho}
            >
              {/* #911: "This PC" é SEMPRE a raiz do breadcrumb (ícone + rótulo).
                  No This PC (caminho vazio) é o único segmento → o campo nunca
                  fica vazio/colapsado; num drive vira "This PC \ C: \ …". */}
              <span className="flex shrink-0 items-center">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-1.5 text-xs font-normal"
                  onClick={() => onNavegar(CAMINHO_ESTE_PC)}
                >
                  <Monitor className="size-3.5 shrink-0" />
                  {t.arquivos.drives}
                </Button>
              </span>
              {segmentos.map((seg) => (
                <span key={seg.path} className="flex shrink-0 items-center">
                  <span className="px-0.5 text-muted-foreground">\</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-xs font-normal"
                    onClick={() => onNavegar(seg.path)}
                  >
                    {seg.label}
                  </Button>
                </span>
              ))}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => setEditando(true)}>
              {t.arquivos.editarCaminho}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )}

      {/* #871 (fatia 2b/2c): busca recursiva. Numa pasta = a pasta atual; no This PC
          (`currentPath` vazio) = fan-out sobre TODOS os drives. O campo só fica
          desabilitado quando `!podeBuscar` (This PC antes dos drives carregarem). O
          placeholder é pelo caminho: vazio → "Buscar Este PC"; senão → a pasta.
          Enter dispara; Esc limpa e sai da busca. */}
      <div className="relative w-56 shrink-0">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={buscaRef}
          value={busca}
          disabled={!podeBuscar}
          onChange={(e) => setBusca(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const q = busca.trim();
              if (q) onBuscar(q);
            } else if (e.key === "Escape") {
              setBusca("");
              onLimparBusca();
              // #968 (Wagner): ESC SAI da busca — devolve o foco pra lista
              // (round-trip completo do Ctrl+E). Blur de fallback se a lista
              // não estiver ligada (defensivo).
              if (onSairBusca) onSairBusca();
              else e.currentTarget.blur();
            }
          }}
          placeholder={
            currentPath
              ? preencher(t.arquivos.buscarPasta, { pasta: nomeBase(currentPath) })
              : t.arquivos.buscarThisPc
          }
          aria-label={
            currentPath
              ? preencher(t.arquivos.buscarPasta, { pasta: nomeBase(currentPath) })
              : t.arquivos.buscarThisPc
          }
          className="h-8 pl-8 pr-8"
        />
        {busca && (
          <TooltipAcao label={t.arquivos.limparBusca}>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-0.5 top-1/2 size-7 -translate-y-1/2"
              onClick={() => {
                setBusca("");
                onLimparBusca();
              }}
              aria-label={t.arquivos.limparBusca}
            >
              <X className="size-3.5" />
            </Button>
          </TooltipAcao>
        )}
      </div>
    </div>
  );
}
