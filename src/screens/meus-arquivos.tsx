import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Frame,
  FrameFooter,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@/components/reui/frame";
import { Spinner } from "@/components/ui/spinner";
import { FileStackIcon } from "@/components/ui/file-stack";
import { FoldersIcon } from "@/components/ui/folders";
import { SquareActivityIcon } from "@/components/ui/square-activity";
import { formatBytes } from "@/lib/utils";
import { preencher, useIdioma } from "@/lib/idioma";
import * as api from "@/lib/api";
import type { PastaOD, TipoArquivo, UsoOneDrive } from "@/lib/types";
import { ChevronDown, Folder } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const fmt = (n: number, i: string) => n.toLocaleString(i);

function Metrica({
  icone,
  valor,
  carregando,
}: {
  icone: React.ReactNode;
  valor?: string;
  carregando?: boolean;
}) {
  if (!valor) {
    if (!carregando) return null;
    return (
      <Badge variant="secondary" size="lg">
        <Spinner data-icon="inline-start" />
        {icone}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" size="lg">
      {icone}
      {valor}
    </Badge>
  );
}

/**
 * Card de uso do OneDrive (usado x limite), expansível — na expansão mostra os
 * tipos de arquivo mais comuns. Os tipos vêm por CONTAGEM (o Graph não dá peso
 * por tipo), buscados só quando a pessoa expande.
 */
function CardUso({ uso }: { uso: UsoOneDrive | null }) {
  const { idioma, t } = useIdioma();
  const [aberto, setAberto] = useState(false);
  const [tipos, setTipos] = useState<TipoArquivo[] | null>(null);
  const [carregandoTipos, setCarregandoTipos] = useState(false);

  useEffect(() => {
    if (!aberto || tipos || carregandoTipos || !uso) return;
    setCarregandoTipos(true);
    api
      .onedriveTipos(uso.webUrl)
      .then(setTipos)
      .catch(() => setTipos([]))
      .finally(() => setCarregandoTipos(false));
  }, [aberto, tipos, carregandoTipos, uso]);

  if (!uso) return null;
  const frac = uso.total > 0 ? uso.used / uso.total : 0;
  const estourou = uso.total > 0 && uso.used > uso.total;

  return (
    <Card className="relative w-full gap-4 overflow-visible border-0 bg-transparent p-0 shadow-none">
      <CardHeader className="flex items-center justify-between p-0">
        <CardTitle className="text-sm font-medium">{t.meusArquivos.usoTitulo}</CardTitle>
        <span className="text-sm text-muted-foreground">
          {preencher(t.meusArquivos.usoLinha, {
            u: formatBytes(uso.used),
            t: formatBytes(uso.total),
          })}
        </span>
      </CardHeader>

      <CardContent className="space-y-4 p-0">
        <Progress
          value={Math.min(100, Math.round(frac * 100))}
          className={estourou ? "h-2 [&>div]:bg-destructive" : "h-2"}
        />

        {aberto && (
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">{t.meusArquivos.tiposTitulo}</span>
              <span className="text-[11px] text-muted-foreground">
                {t.meusArquivos.tiposNota}
              </span>
            </div>
            {carregandoTipos ? (
              <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                <Spinner data-icon="inline-start" /> ...
              </div>
            ) : tipos && tipos.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                {tipos.map((tp) => (
                  <div key={tp.tipo} className="flex justify-between text-sm">
                    <span className="font-medium uppercase">.{tp.tipo}</span>
                    <span className="text-muted-foreground">
                      {preencher(t.meusArquivos.tiposUnidade, {
                        n: fmt(tp.quantidade, idioma),
                      })}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-1 text-sm text-muted-foreground">—</p>
            )}
          </div>
        )}
      </CardContent>

      <Button
        variant="outline"
        size="sm"
        className="w-full gap-1.5"
        onClick={() => setAberto((v) => !v)}
      >
        <ChevronDown
          className={"size-4 transition-transform duration-300 " + (aberto ? "rotate-180" : "")}
        />
      </Button>
    </Card>
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

  useEffect(() => {
    if (carregou.current) return;
    carregou.current = true;
    let vivo = true;

    api.onedriveQuota().then((u) => vivo && setUso(u)).catch(() => {});

    (async () => {
      try {
        const lista = await api.onedriveFolders();
        if (!vivo) return;
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
            if (!vivo) return;
            setPastas((prev) =>
              prev.map((p) =>
                p.id === alvo.id ? { ...p, ...det, detalhes: "pronto" } : p
              )
            );
          }
        };
        await Promise.all([worker(), worker(), worker()]);
      } catch (e) {
        if (vivo) {
          setErro(String(e));
          setCarregando(false);
        }
      }
    })();

    return () => {
      vivo = false;
    };
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
                      <Metrica
                        icone={<SquareActivityIcon size={13} />}
                        valor={formatBytes(pasta.bytes)}
                      />
                      <Metrica
                        icone={<FoldersIcon size={13} />}
                        valor={
                          pasta.folders != null
                            ? preencher(t.bibliotecas.pastas, { n: fmt(pasta.folders, idioma) })
                            : undefined
                        }
                        carregando={carregandoDet}
                      />
                      <Metrica
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

          <FrameFooter>
            <CardUso uso={uso} />
          </FrameFooter>
        </Frame>
      )}
    </div>
  );
}
