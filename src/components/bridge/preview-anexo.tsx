/**
 * Pré-visualização de anexos do Bridge (épico #178 · #188 PDF/TXT · #189
 * docx/xlsx).
 *
 * Renderiza **PDF** (pdf.js, canvas), **TXT** (`<pre>`), **docx** (docx-preview
 * → HTML sanitizado) e **xlsx** (SheetJS → grid) direto no leitor, sem sair do
 * app. Formatos fora do escopo e arquivos grandes caem para as ações explícitas
 * Salvar / Abrir no Windows.
 *
 * Segurança (spec §7 — anexo é input hostil):
 * - Os bytes vêm do `cr_ler_anexo` (em memória, sem tocar o disco); nada de
 *   handler de OS no caminho de preview.
 * - TXT e docx vão para um iframe **`sandbox=""`** (sem scripts, sem
 *   same-origin), o docx ainda com **CSP** (`default-src 'none'`) — mais estrito
 *   que o corpo do e-mail, que só ganha `allow-scripts` no escuro. HTML
 *   sanitizado (DOMPurify) antes do `srcDoc`.
 * - PDF roda no pdf.js sem `PDFScriptingManager` e o v6 não usa `eval`
 *   (ver `lib/pdf-preview.ts`). xlsx nunca avalia fórmula. Sem rede.
 */
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileWarning,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import * as api from "@/lib/api";
import { classificarAnexo } from "@/lib/anexo-tipo";
import { renderDocxParaHtml } from "@/lib/docx-render";
import { preencher, useIdioma } from "@/lib/idioma";
import { carregarPdf, renderizarPagina } from "@/lib/pdf-preview";
import { lerXlsx, type Planilha } from "@/lib/xlsx-render";
import type { AnexoEmail } from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { IconTile } from "@/components/reui/icon-tile";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

/** Teto de tamanho para preview inline; acima disso, só Salvar/Abrir (spec §7.4). */
const LIMITE_PREVIEW_BYTES = 25 * 1024 * 1024;

/** base64 → bytes (mesmo padrão de `conversas-email.ts`). */
function base64ParaBytes(b64: string): Uint8Array {
  const binario = atob(b64);
  return Uint8Array.from(binario, (c) => c.charCodeAt(0));
}

function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface PreviewAnexoProps {
  anexo: AnexoEmail;
  messageId: string;
  mailbox?: string;
  /** Ação explícita "Salvar" (Downloads) — reusa o fluxo do control-room. */
  onSalvar: () => void;
  onFechar: () => void;
}

export function PreviewAnexo({
  anexo,
  messageId,
  mailbox,
  onSalvar,
  onFechar,
}: PreviewAnexoProps) {
  const { t } = useIdioma();
  const tp = t.controlRoom;
  const tipo = classificarAnexo(anexo);
  const grande = anexo.tamanho > LIMITE_PREVIEW_BYTES;

  const [carregando, setCarregando] = useState(tipo !== "nao-suportado");
  const [erro, setErro] = useState<string | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [txt, setTxt] = useState<string | null>(null);
  const [docxHtml, setDocxHtml] = useState<string | null>(null);
  const [planilhas, setPlanilhas] = useState<Planilha[] | null>(null);

  // Busca e decodifica os bytes uma vez (a menos que seja não-suportado/grande).
  useEffect(() => {
    if (tipo === "nao-suportado" || grande) {
      setCarregando(false);
      return;
    }
    let vivo = true;
    let doc: PDFDocumentProxy | null = null;
    setCarregando(true);
    setErro(null);
    (async () => {
      try {
        const conteudo = await api.crLerAnexo(messageId, anexo.id, mailbox);
        const bytes = base64ParaBytes(conteudo.bytesB64);
        if (tipo === "txt") {
          if (vivo) setTxt(new TextDecoder("utf-8").decode(bytes));
        } else if (tipo === "docx") {
          const html = await renderDocxParaHtml(bytes);
          if (vivo) setDocxHtml(html);
        } else if (tipo === "xlsx") {
          const p = await lerXlsx(bytes);
          if (vivo) setPlanilhas(p);
        } else {
          doc = await carregarPdf(bytes);
          if (vivo) setPdf(doc);
          else void doc.loadingTask.destroy();
        }
      } catch (e) {
        if (vivo) setErro(String(e));
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => {
      vivo = false;
      if (doc) void doc.loadingTask.destroy();
    };
  }, [messageId, anexo.id, mailbox, tipo, grande]);

  return (
    <div
      className="mt-3 overflow-hidden rounded-lg border bg-card"
      role="region"
      aria-label={preencher(tp.previewTitulo, { nome: anexo.nome })}
    >
      {/* Cabeçalho: nome + ações explícitas */}
      <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {anexo.nome}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={onSalvar}
        >
          <Download className="size-3.5" /> {tp.previewSalvar}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onFechar}
          aria-label={tp.previewFechar}
        >
          <X className="size-3.5" />
        </Button>
      </div>

      {/* Corpo: estados + renderer */}
      <div className="min-h-24">
        {grande ? (
          <PreviewAviso
            titulo={tp.previewGrande}
            descricao={preencher(tp.previewGrandeDesc, {
              tam: formatarTamanho(anexo.tamanho),
            })}
            onSalvar={onSalvar}
            rotuloSalvar={tp.previewSalvar}
          />
        ) : tipo === "nao-suportado" ? (
          <PreviewAviso
            titulo={tp.previewNaoSuportado}
            descricao={tp.previewNaoSuportadoDesc}
            onSalvar={onSalvar}
            rotuloSalvar={tp.previewSalvar}
          />
        ) : carregando ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : erro ? (
          <div className="p-4">
            <Alert variant="destructive">
              <FileWarning className="size-4" />
              <AlertTitle>{tp.previewErro}</AlertTitle>
              <AlertDescription>{erro}</AlertDescription>
            </Alert>
          </div>
        ) : tipo === "txt" && txt !== null ? (
          <TxtViewer texto={txt} rotulo={anexo.nome} />
        ) : tipo === "pdf" && pdf ? (
          <PdfViewer doc={pdf} tp={tp} />
        ) : tipo === "docx" && docxHtml !== null ? (
          <DocxViewer html={docxHtml} rotulo={anexo.nome} vazioTexto={tp.previewVazio} />
        ) : tipo === "xlsx" && planilhas ? (
          <XlsxViewer planilhas={planilhas} vazioTexto={tp.previewVazio} />
        ) : null}
      </div>
    </div>
  );
}

/** Aviso (não-suportado / grande) com a ação de Salvar. */
function PreviewAviso({
  titulo,
  descricao,
  onSalvar,
  rotuloSalvar,
}: {
  titulo: string;
  descricao: string;
  onSalvar: () => void;
  rotuloSalvar: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 p-6 text-center">
      <IconTile variant="soft" size="lg">
        <FileWarning className="size-5" />
      </IconTile>
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{titulo}</p>
        <p className="text-xs text-muted-foreground">{descricao}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onSalvar}>
        <Download className="size-3.5" /> {rotuloSalvar}
      </Button>
    </div>
  );
}

/** TXT num iframe `sandbox=""` (inerte: sem scripts, sem same-origin). */
function TxtViewer({ texto, rotulo }: { texto: string; rotulo: string }) {
  const escapado = texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;padding:12px;background:#fff;color:#111}
    pre{margin:0;white-space:pre-wrap;word-break:break-word;
        font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
  </style></head><body><pre>${escapado}</pre></body></html>`;
  return (
    <iframe
      // sandbox="" é o mais estrito possível: nenhum script do arquivo roda.
      sandbox=""
      srcDoc={srcDoc}
      title={rotulo}
      className="h-80 w-full border-0 bg-white"
    />
  );
}

/** Viewer de PDF: canvas do pdf.js + paginação + zoom. */
function PdfViewer({
  doc,
  tp,
}: {
  doc: PDFDocumentProxy;
  tp: ReturnType<typeof useIdioma>["t"]["controlRoom"];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pagina, setPagina] = useState(1);
  const [escala, setEscala] = useState(1.2);
  const total = doc.numPages;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelado = false;
    (async () => {
      try {
        if (!cancelado) await renderizarPagina(doc, pagina, canvas, escala);
      } catch {
        /* render cancelado/troca de página — ignora */
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [doc, pagina, escala]);

  const irPara = (n: number) => setPagina(Math.min(total, Math.max(1, n)));
  const ajustarZoom = (delta: number) =>
    setEscala((e) => Math.min(3, Math.max(0.5, +(e + delta).toFixed(2))));

  return (
    <div className="flex flex-col">
      {/* Barra de controles */}
      <div className="flex items-center gap-1 border-b px-2 py-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => irPara(pagina - 1)}
          disabled={pagina <= 1}
          aria-label={tp.previewPaginaAnterior}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className="min-w-24 text-center text-xs tabular-nums text-muted-foreground">
          {preencher(tp.previewPaginaDe, { n: pagina, total })}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => irPara(pagina + 1)}
          disabled={pagina >= total}
          aria-label={tp.previewProximaPagina}
        >
          <ChevronRight className="size-4" />
        </Button>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => ajustarZoom(-0.2)}
          aria-label={tp.previewMenosZoom}
        >
          <ZoomOut className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => setEscala(1.2)}
          aria-label={tp.previewZoomReset}
        >
          <RotateCcw className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => ajustarZoom(0.2)}
          aria-label={tp.previewMaisZoom}
        >
          <ZoomIn className="size-4" />
        </Button>
      </div>
      {/* Página */}
      <ScrollArea className="h-96 w-full bg-muted/20">
        <div className="flex min-h-full justify-center p-3">
          <canvas ref={canvasRef} className="h-fit shadow-sm" />
        </div>
      </ScrollArea>
    </div>
  );
}

/** Estado vazio (docx/xlsx sem conteúdo renderável). */
function PreviewVazio({ texto }: { texto: string }) {
  return (
    <div className="p-6 text-center text-xs text-muted-foreground">{texto}</div>
  );
}

/**
 * docx: HTML sanitizado num `<iframe sandbox="">` com **CSP** estrito —
 * `default-src 'none'` mata rede/script; `img-src data:` deixa só as imagens
 * embutidas (base64); `style-src 'unsafe-inline'` mantém a folha do docx-preview.
 */
function DocxViewer({
  html,
  rotulo,
  vazioTexto,
}: {
  html: string;
  rotulo: string;
  vazioTexto: string;
}) {
  if (!html.trim()) return <PreviewVazio texto={vazioTexto} />;
  const srcDoc = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">
<style>body{margin:0;padding:16px;background:#fff;color:#111;font:14px/1.6 system-ui,'Segoe UI',sans-serif}</style>
</head><body>${html}</body></html>`;
  return (
    <iframe
      sandbox=""
      srcDoc={srcDoc}
      title={rotulo}
      className="h-[32rem] w-full border-0 bg-white"
    />
  );
}

/** xlsx: abas por planilha + grid read-only de valores (em cache, sem fórmula). */
function XlsxViewer({
  planilhas,
  vazioTexto,
}: {
  planilhas: Planilha[];
  vazioTexto: string;
}) {
  const temConteudo = planilhas.some((p) => p.linhas.length > 0);
  if (!temConteudo) return <PreviewVazio texto={vazioTexto} />;

  return (
    <Tabs defaultValue={planilhas[0]?.nome ?? ""} className="w-full gap-0">
      {planilhas.length > 1 && (
        <TabsList className="m-2 flex h-auto w-auto flex-wrap justify-start">
          {planilhas.map((p) => (
            <TabsTrigger key={p.nome} value={p.nome} className="text-xs">
              {p.nome}
            </TabsTrigger>
          ))}
        </TabsList>
      )}
      {planilhas.map((p) => (
        <TabsContent key={p.nome} value={p.nome} className="mt-0">
          <ScrollArea className="h-96 w-full">
            <table className="w-max border-collapse text-xs">
              <tbody>
                {p.linhas.map((linha, i) => (
                  <tr key={i}>
                    <td className="sticky left-0 z-10 border bg-muted/60 px-2 py-1 text-right tabular-nums text-muted-foreground">
                      {i + 1}
                    </td>
                    {linha.map((celula, j) => (
                      <td
                        key={j}
                        className="whitespace-nowrap border px-2 py-1"
                      >
                        {celula}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        </TabsContent>
      ))}
    </Tabs>
  );
}
