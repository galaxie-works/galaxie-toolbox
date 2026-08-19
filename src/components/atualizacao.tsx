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
import { ScrollArea } from "@/components/ui/scroll-area";
import { NotasRelease } from "@/components/notas-release";
import { Spinner } from "@/components/ui/spinner";
import { useIdioma } from "@/lib/idioma";
import { preencher } from "@/lib/idioma";
import { ShieldAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { telUpdateVerificado } from "@/lib/telemetria";
import { deveOferecerAtualizacao, formatarDataFeed } from "@/lib/versao-update";

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
  const { t, idioma } = useIdioma();
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
        const { getVersion } = await import("@tauri-apps/api/app");
        const [novo, instalada] = await Promise.all([check(), getVersion()]);
        if (!vivo) return;
        // #1264: o `check()` ja devolveu pacote para a versao JA INSTALADA
        // (feed republicado com data nova). Quem decide se o modal aparece e
        // o compare de versao aqui — nunca a existencia do pacote.
        const oferecer = deveOferecerAtualizacao(instalada, novo?.version);
        // Telemetria (#390): resultado da verificação de update (sem PII).
        telUpdateVerificado(oferecer ? "disponivel" : "sem-atualizacao");
        if (!novo || !oferecer) return;
        setPacote(novo);
        setInfo({
          versao: novo.version,
          // #1258: guarda a data CRUA do feed; quem formata e o badge, no
          // render — assim trocar o idioma do app reformata sem novo `check()`.
          // O `split(" ")` que morava aqui pressupunha data com espaco e
          // devolvia o ISO inteiro (`2026-08-19T06:11:36Z`) pro usuario ver.
          data: novo.date,
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
              // #1258: data legivel no idioma do app (funil unico em
              // `formatarDataFeed`); ilegivel/ausente vira "" e o `.trim()`
              // deixa o badge so com a versao.
              d: formatarDataFeed(info.data, idioma),
            }).trim()}
          </Badge>
        </div>

        <div className="flex flex-col items-center justify-center gap-5 rounded-b-2xl bg-muted/60 p-6">
          <AlertDialogDescription className="text-center text-muted-foreground">
            {baixando
              ? preencher(t.atualizacao.baixando, { p: String(progresso) })
              : t.atualizacao.descricao}
          </AlertDialogDescription>

          {/* #1258: as notas do feed (changelog do Atlas) chegavam ate aqui e
              morriam sem render. Some no download para a barra de progresso
              ficar sozinha na tela. */}
          {!baixando && info.notas && (
            <section className="w-full self-stretch">
              <h2 className="mb-1.5 text-xs font-medium text-foreground">
                {t.atualizacao.notas}
              </h2>
              {/* #1321: a altura vai no VIEWPORT, não no Root. O Root do Radix
                  é só `relative`; quem tem overflow é o viewport, que é
                  `size-full` — de um Root sem altura resolvida ele cresce com o
                  conteúdo e nada clipa (foi assim que as notas vazaram do modal
                  na v0.46.0). Padrão-ouro da casa: `campo-pessoas.tsx:400`. */}
              <ScrollArea className="w-full rounded-lg border bg-background/60 p-3 **:data-[slot=scroll-area-viewport]:max-h-40">
                <NotasRelease markdown={info.notas} />
              </ScrollArea>
            </section>
          )}

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
