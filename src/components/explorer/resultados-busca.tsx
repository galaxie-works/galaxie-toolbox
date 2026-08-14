import { File, Folder, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useIdioma, preencher } from "@/lib/idioma";
import type { FsEntry } from "@/lib/types";
import { TooltipAcao } from "./tooltip-acao";

/**
 * #871 (fatia 2b): resultados da busca recursiva na pasta atual. Lista simples e
 * própria (SEM a virtualização do ContentPane — o backend capa em 1000). Cabeçalho
 * com contagem + fechar + spinner enquanto varre; cada linha mostra o nome e o
 * CAMINHO completo (o ponto da busca recursiva: onde o item mora). Clicar numa
 * pasta navega; num arquivo, abre (via o `onAbrir` do shell).
 */
interface ResultadosBuscaProps {
  query: string;
  resultados: FsEntry[];
  buscando: boolean;
  truncado: boolean;
  /** pasta → navega; arquivo → abre */
  onAbrir: (entry: FsEntry) => void;
  onFechar: () => void;
}

export function ResultadosBusca({
  query,
  resultados,
  buscando,
  truncado,
  onAbrir,
  onFechar,
}: ResultadosBuscaProps) {
  const { t } = useIdioma();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
      {/* Cabeçalho: contagem + query, spinner vivo e botão de fechar. */}
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {preencher(t.arquivos.buscaCabecalho, {
            n: resultados.length,
            query,
          })}
        </span>
        {buscando && <Spinner className="size-4 text-muted-foreground" />}
        <TooltipAcao label={t.arquivos.limparBusca}>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onFechar}
            aria-label={t.arquivos.limparBusca}
          >
            <X className="size-3.5" />
          </Button>
        </TooltipAcao>
      </div>

      {buscando && resultados.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
          <Spinner className="size-5" />
          <p className="text-sm">{t.arquivos.buscando}</p>
        </div>
      ) : !buscando && resultados.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-center">
          <p className="text-sm text-muted-foreground">{t.arquivos.buscaVazia}</p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {resultados.map((entry) => (
            <button
              key={entry.path}
              type="button"
              onClick={() => onAbrir(entry)}
              className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left hover:bg-muted"
            >
              {entry.isDir ? (
                <Folder className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <File className="size-4 shrink-0 text-muted-foreground" />
              )}
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm">{entry.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {entry.path}
                </span>
              </span>
            </button>
          ))}
          {truncado && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {t.arquivos.buscaTruncada}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
