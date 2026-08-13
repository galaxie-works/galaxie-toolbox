import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUp, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useIdioma } from "@/lib/idioma";
import { statCaminho } from "@/lib/api";
import { segmentosCaminho } from "./caminho";
import { AtalhosLegenda } from "./atalhos-legenda";

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
  onNavegar,
}: {
  currentPath: string;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onUp: () => void;
  onNavegar: (path: string) => void;
}) {
  const { t } = useIdioma();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(currentPath);
  const [erro, setErro] = useState(false);
  const [validando, setValidando] = useState(false);

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
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        onClick={onUp}
        aria-label={t.arquivos.acima}
      >
        <ArrowUp className="size-4" />
      </Button>

      {editando ? (
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <Input
            autoFocus
            value={valor}
            aria-label={t.arquivos.endereco}
            aria-invalid={erro || undefined}
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
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <div className="flex min-w-0 flex-1 items-center overflow-x-auto rounded-md border bg-background/40 px-1 py-0.5">
            {segmentos.map((seg, i) => (
              <span key={seg.path} className="flex shrink-0 items-center">
                {i > 0 && (
                  <span className="px-0.5 text-muted-foreground">\</span>
                )}
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
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            onClick={() => setEditando(true)}
            aria-label={t.arquivos.editarCaminho}
          >
            <Pencil className="size-4" />
          </Button>
        </div>
      )}

      {/* #733: legenda de atalhos (cheatsheet) — lê do catálogo central. */}
      <AtalhosLegenda />
    </div>
  );
}
