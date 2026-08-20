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
import type { Update } from "@tauri-apps/plugin-updater";
import { telUpdateVerificado } from "@/lib/telemetria";
import { deveOferecerAtualizacao, formatarDataFeed } from "@/lib/versao-update";
import { inTauri } from "@/lib/tauri";

interface Disponivel {
  versao: string;
  data?: string;
  notas?: string;
}

type Estado = "oculto" | "disponivel" | "baixando" | "pronto";

// #1033: ponto único em `@/lib/tauri`. Segue sendo FUNÇÃO — este módulo
// pergunta em runtime, não no import.
const estaNoTauri = inTauri;

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
  // #1037 (FE15): era `useState<any>` com um `eslint-disable` por cima. `any` no
  // fluxo de atualização é caro de um jeito específico: erro de shape aqui não
  // quebra a tela, vira "o update não instala" — sem hotfix possível, porque o
  // caminho do hotfix É o updater. O tipo vem do próprio plugin, por
  // `import type` (custo zero de bundle: some na compilação).
  const [pacote, setPacote] = useState<Update | null>(null);

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
            {/* #1334: quando a data do feed é ausente/ilegível, `formatarDataFeed`
                devolve "" — e o `.trim()` que estava aqui NÃO resolvia: ele só
                corta as pontas, então sobrava "Versão X.Y.Z ()" na cara do
                usuário (medido pela `iris` em produção). Agora a escolha é de
                MODELO: sem data, outra chave de i18n, sem parêntese nenhum. */}
            {(() => {
              const data = formatarDataFeed(info.data, idioma);
              return data
                ? preencher(t.atualizacao.versao, { v: info.versao, d: data })
                : preencher(t.atualizacao.versaoSemData, { v: info.versao });
            })()}
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
