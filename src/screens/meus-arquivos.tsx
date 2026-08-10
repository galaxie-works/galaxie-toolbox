import { MetricaChip } from "@/components/metrica-chip";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import {
  Frame,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@/components/reui/frame";
import { Spinner } from "@/components/ui/spinner";
import { FileStackIcon } from "@/components/ui/file-stack";
import { FoldersIcon } from "@/components/ui/folders";
import { SquareActivityIcon } from "@/components/ui/square-activity";
import { cn, formatBytes } from "@/lib/utils";
import { preencher, useIdioma } from "@/lib/idioma";
import * as api from "@/lib/api";
import type { PastaOD, TipoArquivo, UsoOneDrive } from "@/lib/types";
import { ChevronDown, Folder } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const fmt = (n: number, i: string) => n.toLocaleString(i);

/**
 * Card de uso do OneDrive (usado x limite), expansível — na expansão mostra os
 * tipos de arquivo mais comuns. Os tipos vêm por CONTAGEM (o Graph não dá peso
 * por tipo), buscados só quando a pessoa expande.
 */
function CardUso({ uso }: { uso: UsoOneDrive | null }) {
  const { idioma, t } = useIdioma();
  const [aberto, setAberto] = useState(false);
  const [tipos, setTipos] = useState<TipoArquivo[] | null>(null);

  // Carrega os tipos assim que a quota chega, para o "peek" (espiada) no
  // estado fechado funcionar — igual ao c-card-13, que assume conteudo presente.
  useEffect(() => {
    if (!uso || tipos) return;
    api.onedriveTipos(uso.webUrl).then(setTipos).catch(() => setTipos([]));
  }, [uso, tipos]);

  if (!uso) return null;
  const pct = uso.total > 0 ? Math.min(100, Math.round((uso.used / uso.total) * 100)) : 0;
  const estourou = uso.total > 0 && uso.used > uso.total;

  return (
    <Frame
      className="relative w-full max-w-md gap-5 overflow-visible pb-2"
      stacked
    >
      <FrameHeader className="flex flex-row items-center justify-between space-y-0">
        <FrameTitle className="text-sm font-medium">
          {t.meusArquivos.usoTitulo}
        </FrameTitle>
        <span className="text-xs text-muted-foreground">{pct}%</span>
      </FrameHeader>

      <FramePanel
        className={cn(
          "relative space-y-4 overflow-hidden transition-all duration-500 ease-in-out",
          aberto ? "max-h-[520px]" : "max-h-[128px]"
        )}
      >
        {/* Caixa de uso — sempre visivel */}
        <div className="space-y-2 rounded-lg bg-muted/60 p-4">
          <div className="flex justify-between text-xs font-medium text-muted-foreground">
            <span>{t.meusArquivos.usado}</span>
            <span>{t.meusArquivos.limite}</span>
          </div>
          <div className="flex justify-between text-lg font-bold">
            <span>{formatBytes(uso.used)}</span>
            <span>{formatBytes(uso.total)}</span>
          </div>
          <Progress value={pct} className={estourou ? "h-2 [&>div]:bg-destructive" : "h-2"} />
        </div>

        {/* Tipos de arquivo — revelados na expansao */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">{t.meusArquivos.tiposTitulo}</span>
            <span className="text-[11px] text-muted-foreground">{t.meusArquivos.tiposNota}</span>
          </div>
          {tipos == null ? (
            <div className="py-1">
              <Spinner className="size-4 text-muted-foreground" />
            </div>
          ) : tipos.length > 0 ? (
            <div className="flex flex-col gap-2">
              {tipos.map((tp) => (
                <div key={tp.tipo} className="flex justify-between text-sm">
                  <span className="font-medium uppercase">.{tp.tipo}</span>
                  <span className="text-muted-foreground">
                    {preencher(t.meusArquivos.tiposUnidade, { n: fmt(tp.quantidade, idioma) })}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-1 text-sm text-muted-foreground">—</p>
          )}
        </div>

        {/* Desvanecimento no estado fechado, cobrindo a espiada dos tipos */}
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-card to-transparent transition-opacity duration-300",
            aberto ? "opacity-0" : "opacity-100"
          )}
        />
      </FramePanel>

      {/* Botao circular que abre/fecha, na base do card */}
      <div className="absolute -bottom-4 left-1/2 -translate-x-1/2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              aria-label={t.meusArquivos.usoTitulo}
              className="size-8 rounded-full bg-background shadow-sm hover:bg-background"
              onClick={() => setAberto((v) => !v)}
            >
              <ChevronDown
                className={cn("size-4 transition-transform duration-300", aberto && "rotate-180")}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t.meusArquivos.usoTitulo}</TooltipContent>
        </Tooltip>
      </div>
    </Frame>
  );
}

export function MeusArquivosScreen() {
  const { idioma, t } = useIdioma();
  const [pastas, setPastas] = useState<PastaOD[]>([]);
  const [uso, setUso] = useState<UsoOneDrive | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  // trava para carregar só uma vez por montagem
  const carregou = useRef(false);

  // A trava carregou.current garante execucao unica (inclusive sob StrictMode,
  // que monta/desmonta/remonta em dev). NAO usar flag `vivo` com cleanup junto:
  // a limpeza do StrictMode zerava o flag e o resultado era descartado ->
  // loading infinito. Sem cleanup, o async completa e pinta o estado.
  useEffect(() => {
    if (carregou.current) return;
    carregou.current = true;

    api.onedriveQuota().then(setUso).catch(() => {});

    (async () => {
      try {
        const lista = await api.onedriveFolders();
        setPastas(lista.map((p) => ({ ...p, detalhes: "carregando" })));
        setCarregando(false);

        // detalhes por pasta, fila de 3 (sao 2 buscas por pasta -> 429 se tudo junto)
        let i = 0;
        const worker = async () => {
          while (i < lista.length) {
            const alvo = lista[i++];
            let det: Partial<PastaOD> = {};
            try {
              det = await api.onedriveFolderDetails(alvo.webUrl);
            } catch {
              /* sem numeros: o chip some */
            }
            setPastas((prev) =>
              prev.map((p) =>
                p.id === alvo.id ? { ...p, ...det, detalhes: "pronto" } : p
              )
            );
          }
        };
        await Promise.all([worker(), worker(), worker()]);
      } catch (e) {
        setErro(String(e));
        setCarregando(false);
      }
    })();
  }, []);

  return (
    <div className="w-full">
      {carregando && pastas.length === 0 ? (
        <div className="mt-16 flex flex-col items-center gap-3 text-muted-foreground">
          <Spinner className="size-6" />
          <p className="text-sm">{t.meusArquivos.carregando}</p>
        </div>
      ) : pastas.length === 0 ? (
        <div className="mt-16 text-center text-sm text-muted-foreground">
          {erro ?? t.meusArquivos.vazio}
        </div>
      ) : (
        <Frame className="w-full">
          <FrameHeader>
            <FrameTitle>{t.meusArquivos.titulo}</FrameTitle>
          </FrameHeader>

          {pastas.map((pasta) => {
            const carregandoDet = pasta.detalhes === "carregando";
            return (
              <FramePanel
                key={pasta.id}
                className="flex items-center justify-between gap-4"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Folder className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{pasta.name}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <MetricaChip
                        icone={<SquareActivityIcon size={13} />}
                        valor={formatBytes(pasta.bytes)}
                      />
                      <MetricaChip
                        icone={<FoldersIcon size={13} />}
                        valor={
                          pasta.folders != null
                            ? preencher(t.bibliotecas.pastas, { n: fmt(pasta.folders, idioma) })
                            : undefined
                        }
                        carregando={carregandoDet}
                      />
                      <MetricaChip
                        icone={<FileStackIcon size={13} />}
                        valor={
                          pasta.files != null
                            ? preencher(t.bibliotecas.arquivos, { n: fmt(pasta.files, idioma) })
                            : undefined
                        }
                        carregando={carregandoDet}
                      />
                    </div>
                  </div>
                </div>
              </FramePanel>
            );
          })}
        </Frame>
      )}

      {!carregando && pastas.length > 0 && (
        <div className="mt-6">
          <CardUso uso={uso} />
        </div>
      )}
    </div>
  );
}
