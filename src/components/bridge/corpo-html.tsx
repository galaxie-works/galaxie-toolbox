import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, RotateCcw, ShieldCheck, TriangleAlert } from "lucide-react";

import * as api from "@/lib/api";
import { useAppStore } from "@/store";
import { useTemaEscuro } from "@/lib/tema";
import { useIdioma } from "@/lib/idioma";
import { montarDocEmail, SANDBOX_LEITOR } from "@/lib/corpo-email-doc";
import {
  analisarLink,
  type AnaliseLink,
  type AvisoLink,
} from "@/lib/seguranca-leitor";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * #1019 (S1, movimento puro): o LEITOR de corpo de e-mail — extraído do
 * control-room.tsx sem mudança de comportamento. Renderiza o HTML do e-mail num
 * iframe opaque-origin (#1034), o texto puro, o modal de link seguro (#91) e o
 * zoom manual (#76). `CorpoMensagem` é a superfície pública (usada pelo detalhe
 * de mensagem e pelo preview de anexo .eml); o resto é privado deste seam.
 *
 * O corpo do e-mail entra num iframe SEM allow-same-origin (#1034): não executa
 * script embutido nem alcança a origem do app. O `srcDoc` é montado por
 * `montarDocEmail`. Como o pai não enxerga o `contentDocument`, a medição de
 * altura/zoom roda DENTRO do iframe e conversa por `postMessage`.
 */

// Zoom MANUAL do leitor (#76) — camada por cima do auto-fit do #57.
// O fator do usuário (1 = auto-fit puro) multiplica o zoom que o app calculou:
// `efetivo = base(auto-fit) × fator`. Piso/teto e passo consistentes entre
// teclado (CTRL +/−) e roda (CTRL+scroll). CTRL+0 volta ao auto-fit (fator 1).
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3.0;
const ZOOM_PASSO = 0.1;
/** Clampa e arredonda pra 2 casas (evita drift de float ao somar 0.1). */
const clampZoom = (v: number) =>
  Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(v * 100) / 100));

function CorpoHtml({
  corpo,
  onAbrirLink,
}: {
  corpo: string;
  onAbrirLink?: (url: string) => void;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [altura, setAltura] = useState(120);
  // Link-safety (#91): clique num link do corpo abre um modal de confirmação
  // com o DESTINO REAL + avisos, em vez de abrir direto. `null` = modal fechado.
  const [linkPendente, setLinkPendente] = useState<AnaliseLink | null>(null);
  // Zoom manual (#76): fator do USUÁRIO aplicado POR CIMA do auto-fit do #57.
  // GLOBAL e persistido (não por-mensagem): a preferência sobrevive a fechar/
  // reabrir o app e a trocar de mensagem e voltar (decisão da issue #76 — o
  // leitor tem UM nível de zoom, como o zoom de página de um navegador).
  // Zoom migrado pro ui slice do store (#126). Seletor evita re-render amplo;
  // a chave localStorage `bridge.leitorZoom` é preservada pelo persist.
  const fator = useAppStore((s) => s.zoom);
  const setFator = useAppStore((s) => s.setZoom);
  // Ref pro fator: o 1º render EMBUTE o fator no srcDoc (a ponte de medição usa
  // como valor inicial); depois disso o pai empurra novos fatores por postMessage
  // (sem recarregar o iframe). Sem `fator` nas deps do `doc` de propósito.
  const fatorRef = useRef(fator);
  // Render ciente do tema do app (como leitores modernos). O baseline é SEMPRE
  // claro; o tema escuro nasce da inversão por CSS (`estiloInversaoEscuro`, sem
  // script) injetada por `montarDocEmail` (#1034).
  const escuro = useTemaEscuro();
  const { t } = useIdioma();
  const rotuloAparado = t.controlRoom.conteudoAparado;

  // Nonce único por documento: casa com o `<script>` da ponte na CSP do srcDoc.
  // Regenera junto com o `doc` (mesmas deps) — cada srcDoc tem o seu.
  const doc = useMemo(
    () =>
      montarDocEmail({
        corpo,
        escuro,
        rotulo: rotuloAparado,
        nonce: crypto.randomUUID(),
        fator: fatorRef.current,
      }),
    [corpo, escuro, rotuloAparado],
  );

  // Ponte de medição por postMessage (#1034): o iframe é opaque origin, o pai
  // não lê mais `contentDocument`. A altura/zoom vêm de DENTRO do iframe; aqui só
  // validamos a origem (`e.source === iframe.contentWindow`) e o `tipo`, e:
  //  - altura → aplica no elemento;
  //  - zoom (#76) → o PAI é o dono do clamp (ZOOM_MIN/MAX), então recalcula o
  //    fator e devolve por postMessage; preserva o piso #57 (que roda no iframe);
  //  - link (#91) → http vira modal de confirmação; outros esquemas vão pro SO.
  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;
    const onMsg = (e: MessageEvent) => {
      if (e.source !== iframe.contentWindow) return; // só do NOSSO iframe
      const d = e.data as
        | { tipo?: string; altura?: number; direcao?: number; href?: string; texto?: string }
        | null;
      if (!d || typeof d !== "object") return;
      switch (d.tipo) {
        case "gt-reader-altura":
          if (typeof d.altura === "number") {
            const h = d.altura;
            setAltura((a) => (Math.abs(a - h) > 1 ? h : a));
          }
          break;
        case "gt-reader-zoom":
          setFator((f) => clampZoom(f + (d.direcao && d.direcao > 0 ? ZOOM_PASSO : -ZOOM_PASSO)));
          break;
        case "gt-reader-zoom-reset":
          setFator(1); // volta ao auto-fit do #57
          break;
        case "gt-reader-link":
          if (typeof d.href === "string") {
            if (/^https?:/i.test(d.href)) {
              // `href` é a URL RESOLVIDA; `texto` é o texto visível — base do
              // teste de mismatch texto × destino (#91).
              setLinkPendente(analisarLink(d.texto ?? "", d.href));
            } else {
              api.openUrl(d.href).catch(() => {});
            }
          }
          break;
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [doc, setFator]);

  // Empurra o fator pro iframe quando ele muda (teclado/roda/reset/persistido).
  // O 1º valor já foi embutido no srcDoc; daqui pra frente é só postMessage — sem
  // recarregar o iframe. O script lá dentro re-mede aplicando o piso #57.
  useEffect(() => {
    fatorRef.current = fator;
    ref.current?.contentWindow?.postMessage({ tipo: "gt-reader-set-fator", fator }, "*");
  }, [fator]);

  const zoomAlterado = fator !== 1;

  return (
    <div className="relative w-full">
      <iframe
        // Remonta o iframe ao trocar de tema: a inversão do escuro é um `<style>`
        // no srcDoc, então um `key` por tema garante um documento novo e limpo
        // (sem resíduo de filtro) desde o início (#73/#1034).
        key={escuro ? "dark" : "light"}
        ref={ref}
        srcDoc={doc}
        // OPAQUE ORIGIN (#1034, SEC1): SEM allow-same-origin nos DOIS temas — o
        // e-mail não alcança a origem do app. `allow-scripts` fica só pela ponte
        // de medição (a CSP do srcDoc só libera o nosso script, via nonce).
        sandbox={SANDBOX_LEITOR}
        title={t.controlRoom.corpoEmail}
        className="w-full border-0 bg-white"
        style={{ height: altura }}
      />
      {/* Indicador do nível de zoom manual (#76) + reset via UI. Só aparece
          quando o usuário mudou o zoom (fator ≠ auto-fit); some ao resetar.
          O % é relativo ao auto-fit (100% = o que o app calculou), como o zoom
          de página de um navegador. Fica sobreposto ao canto do leitor, sem
          empurrar o layout do e-mail. */}
      {zoomAlterado && (
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded-full border bg-background/90 py-0.5 pr-0.5 pl-2 shadow-sm backdrop-blur">
          <span className="text-xs font-medium tabular-nums text-muted-foreground">
            {Math.round(fator * 100)}%
          </span>
          {/* Restaurar zoom (#102): sem atalho dedicado no cluster, Tooltip
              simples; o texto já traz o Ctrl+0. Substitui o `title` nativo. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="rounded-full text-muted-foreground"
                onClick={() => setFator(1)}
                aria-label={t.controlRoom.zoomResetar}
              >
                <RotateCcw />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t.controlRoom.zoomResetar}</TooltipContent>
          </Tooltip>
        </div>
      )}
      <ModalLinkSeguro
        analise={linkPendente}
        onFechar={() => setLinkPendente(null)}
        onAbrir={(url) => {
          setLinkPendente(null);
          onAbrirLink?.(url);
        }}
        t={t}
      />
    </div>
  );
}

/** Texto localizado de cada aviso de link (#91). */
function textoAviso(t: ReturnType<typeof useIdioma>["t"], a: AvisoLink): string {
  switch (a) {
    case "mismatch":
      return t.controlRoom.segAvisoMismatch;
    case "encurtador":
      return t.controlRoom.segAvisoEncurtador;
    case "ip":
      return t.controlRoom.segAvisoIp;
    case "punycode":
      return t.controlRoom.segAvisoPunycode;
    case "inseguro":
      return t.controlRoom.segAvisoInseguro;
    case "redirecionamento":
      return t.controlRoom.segAvisoRedirecionamento;
  }
}

/**
 * Modal de confirmação de link (#91, parte a). Mostra o DESTINO REAL antes de
 * abrir e, quando há sinais de risco (mismatch/encurtador/IP/punycode/redirect/
 * http), lista os avisos num Alert. O botão de abrir fica destrutivo quando o
 * link é suspeito, pra o usuário pensar duas vezes.
 */
function ModalLinkSeguro({
  analise,
  onFechar,
  onAbrir,
  t,
}: {
  analise: AnaliseLink | null;
  onFechar: () => void;
  onAbrir: (url: string) => void;
  t: ReturnType<typeof useIdioma>["t"];
}) {
  const suspeito = analise?.suspeito ?? false;
  return (
    <Dialog open={analise !== null} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {suspeito ? (
              <TriangleAlert className="size-4 text-[color:var(--destructive)]" />
            ) : (
              <ShieldCheck className="size-4 text-[color:var(--success)]" />
            )}
            {t.controlRoom.segLinkTitulo}
          </DialogTitle>
          <DialogDescription>{t.controlRoom.segLinkDescricao}</DialogDescription>
        </DialogHeader>
        {analise && (
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                {t.controlRoom.segLinkDestino}
              </p>
              <p className="rounded-md border bg-muted/40 px-2 py-1.5 font-mono text-xs break-all">
                {analise.href}
              </p>
            </div>
            {analise.textoLink && analise.textoLink !== analise.href && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  {t.controlRoom.segLinkTexto}
                </p>
                <p className="text-sm break-all">{analise.textoLink}</p>
              </div>
            )}
            {analise.avisos.length > 0 ? (
              <Alert variant={suspeito ? "destructive" : "warning"}>
                <TriangleAlert />
                <AlertTitle>{t.controlRoom.segLinkSuspeito}</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4">
                    {analise.avisos.map((a) => (
                      <li key={a}>{textoAviso(t, a)}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="size-3.5 text-[color:var(--success)]" />
                {t.controlRoom.segLinkVerificado}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>
            {t.controlRoom.segLinkCancelar}
          </Button>
          <Button
            variant={suspeito ? "destructive" : "default"}
            onClick={() => analise && onAbrir(analise.href)}
          >
            <ExternalLink /> {t.controlRoom.segLinkAbrir}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CorpoMensagem({
  corpo,
  tipo,
  onAbrirLink,
}: {
  corpo: string;
  tipo: "html" | "text";
  onAbrirLink?: (url: string) => void;
}) {
  const { t } = useIdioma();
  if (!corpo.trim()) {
    return <p className="text-sm text-muted-foreground">{t.controlRoom.semCorpo}</p>;
  }
  if (tipo === "html") return <CorpoHtml corpo={corpo} onAbrirLink={onAbrirLink} />;
  return (
    <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{corpo}</p>
  );
}
