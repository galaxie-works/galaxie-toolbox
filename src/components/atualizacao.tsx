import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/reui/badge";
import { Spinner } from "@/components/ui/spinner";
import { useIdioma } from "@/lib/idioma";
import { preencher } from "@/lib/idioma";
import { ShieldAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { telUpdateVerificado } from "@/lib/telemetria";

interface Disponivel {
  versao: string;
  data?: string;
  notas?: string;
}

type Estado = "oculto" | "disponivel" | "baixando" | "pronto";

const estaNoTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Verifica se ha versao nova e conduz a atualizacao.
 *
 * A verificacao roda uma vez, na abertura, e em silencio: se a rede falhar ou
 * o endpoint nao existir ainda, nao aparece nada. Atualizacao e conveniencia —
 * nao pode virar mensagem de erro no rosto de quem so queria trabalhar.
 */
export function Atualizacao() {
  const { t } = useIdioma();
  const [estado, setEstado] = useState<Estado>("oculto");
  const [info, setInfo] = useState<Disponivel | null>(null);
  const [progresso, setProgresso] = useState(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [pacote, setPacote] = useState<any>(null);

  useEffect(() => {
    if (!estaNoTauri()) return;
    let vivo = true;
    (async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const novo = await check();
        if (!vivo) return;
        // Telemetria (#390): resultado da verificação de update (sem PII).
        telUpdateVerificado(novo ? "disponivel" : "sem-atualizacao");
        if (!novo) return;
        setPacote(novo);
        setInfo({
          versao: novo.version,
          data: novo.date?.split(" ")[0],
          notas: novo.body || undefined,
        });
        setEstado("disponivel");
      } catch {
        // sem endpoint, sem rede ou assinatura invalida: segue a vida
        if (vivo) telUpdateVerificado("erro");
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  async function atualizar() {
    if (!pacote) return;
    setEstado("baixando");
    try {
      let total = 0;
      let baixado = 0;
      await pacote.downloadAndInstall((ev: { event: string; data?: { contentLength?: number; chunkLength?: number } }) => {
        if (ev.event === "Started") total = ev.data?.contentLength ?? 0;
        if (ev.event === "Progress") {
          baixado += ev.data?.chunkLength ?? 0;
          if (total > 0) setProgresso(Math.round((baixado / total) * 100));
        }
      });
      setEstado("pronto");
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch {
      // Falhou no meio: fecha e tenta na proxima abertura, sem travar o app.
      setEstado("oculto");
    }
  }

  if (estado === "oculto" || !info) return null;
  const baixando = estado === "baixando" || estado === "pronto";

  return (
    <AlertDialog
      open
      onOpenChange={(o) => {
        // Durante o download nao deixa fechar: fechar no meio deixaria o
        // instalador pela metade.
        if (!o && !baixando) setEstado("oculto");
      }}
    >
      <AlertDialogContent className="gap-0 p-0 sm:max-w-sm">
        <div className="mx-auto flex flex-col items-center justify-center gap-2 p-8">
          <AlertDialogMedia className="size-12 rounded-full bg-info/10 text-info dark:bg-info/20">
            <ShieldAlertIcon className="size-6" />
          </AlertDialogMedia>
          <AlertDialogTitle className="text-center">
            {t.atualizacao.titulo}
          </AlertDialogTitle>
          <Badge variant="success-light">
            {preencher(t.atualizacao.versao, {
              v: info.versao,
              d: info.data ?? "",
            }).trim()}
          </Badge>
        </div>

        <div className="flex flex-col items-center justify-center gap-5 rounded-b-2xl bg-muted/60 p-6">
          <AlertDialogDescription className="text-center text-muted-foreground">
            {baixando
              ? preencher(t.atualizacao.baixando, { p: String(progresso) })
              : t.atualizacao.descricao}
          </AlertDialogDescription>

          {/* O rodape mora dentro deste bloco com p-6, entao o breakout precisa
              cancelar ESSE padding para encostar nas bordas. self-stretch e
              obrigatorio porque a secao e items-center, que senao encolheria a
              barra ate o tamanho do conteudo. */}
          <AlertDialogFooter className="-mx-6 -mb-6 gap-4 self-stretch rounded-b-2xl p-6">
            {!baixando && (
              <AlertDialogCancel>{t.atualizacao.depois}</AlertDialogCancel>
            )}
            <AlertDialogAction
              onClick={(e) => {
                // Sem isso o Radix fecha o dialogo no clique e o download
                // acontece sem nada na tela.
                e.preventDefault();
                atualizar();
              }}
              disabled={baixando}
            >
              {baixando && <Spinner data-icon="inline-start" />}
              {baixando ? t.atualizacao.atualizando : t.atualizacao.agora}
            </AlertDialogAction>
          </AlertDialogFooter>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
