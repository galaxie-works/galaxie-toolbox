/**
 * Núcleo compartilhado de pré-visualização (#873).
 *
 * Extraído do `preview-anexo.tsx` do Bridge (#178 · #188 · #189 · #450 · #451 ·
 * #452 · #496 · #532 · #552) para ser REUSADO — não copiado — pelo Explorer de
 * Arquivos (#675). Renderiza **PDF** (pdf.js, canvas), **TXT** (`<pre>`), **docx**
 * (docx-preview → HTML sanitizado), **xlsx** (SheetJS → grid), **csv**, **imagem**
 * e **áudio/vídeo** direto no app, sem sair dele. Formatos fora do escopo e
 * arquivos grandes caem para a ação primária (Salvar no Bridge / Abrir no Files).
 *
 * A fonte dos bytes é parametrizada (`FontePreview`):
 *  - `anexo` → `cr_ler_anexo` / `cr_anexo_para_pdf` (Path C, alta fidelidade),
 *    o caminho EXATO e battle-tested do Bridge (inalterado);
 *  - `local` → `fs_read_file_bytes` (arquivo do disco), reusando os MESMOS
 *    decodificadores. Path C (Office→PDF) é Graph-ONLY: fonte local não converte.
 *
 * Segurança (spec §7 — o conteúdo é input hostil, seja anexo ou arquivo local):
 * - Os bytes vêm em memória (base64), sem handler de OS no caminho de preview.
 * - TXT e docx vão para um iframe **`sandbox=""`** (sem scripts, sem
 *   same-origin), o docx ainda com **CSP** (`default-src 'none'`). HTML
 *   sanitizado (DOMPurify) antes do `srcDoc` (nos módulos de render).
 * - PDF roda no pdf.js sem `PDFScriptingManager` e o v6 não usa `eval`
 *   (ver `lib/pdf-preview.ts`). xlsx nunca avalia fórmula. Sem rede.
 */
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  ChevronLeft,
  ChevronRight,
  FileWarning,
  Loader2,
  RotateCcw,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";

import * as api from "@/lib/api";
import {
  aceitaAltaFidelidade,
  classificarAnexo,
  classificarPorNome,
  type TipoPreview,
} from "@/lib/anexo-tipo";
import { renderDocxParaHtml } from "@/lib/docx-render";
import { preencher, useIdioma } from "@/lib/idioma";
import { carregarPdf, renderizarPagina } from "@/lib/pdf-preview";
import { renderXlsxParaHtml, type XlsxRender } from "@/lib/xlsx-render";
import { cn } from "@/lib/utils";
import { parseCsv, type CsvTabela } from "@/lib/csv-render";
import type { AnexoEmail } from "@/lib/types";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/reui/alert";
import { IconTile } from "@/components/reui/icon-tile";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";

/** Teto de tamanho para preview inline; acima disso, só a ação primária (spec §7.4). */
const LIMITE_PREVIEW_BYTES = 25 * 1024 * 1024;

/** Strings dos viewers (o Bridge define a copy em `t.controlRoom.preview*`). */
type PreviewStrings = ReturnType<typeof useIdioma>["t"]["controlRoom"];

/** Fonte dos bytes: anexo do Bridge (Graph) ou arquivo local do Explorer. */
export type FontePreview =
  | { kind: "anexo"; anexo: AnexoEmail; messageId: string; mailbox?: string }
  | {
      kind: "local";
      path: string;
      nome: string;
      tamanho: number;
      contentType?: string;
    };

/** Ação primária no cabeçalho + nos avisos (Salvar no Bridge, Abrir no Files). */
export interface AcaoPreview {
  onClick: () => void;
  rotulo: string;
  Icone: LucideIcon;
}

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

export interface PreviewArquivoProps {
  fonte: FontePreview;
  /** Ação primária (Salvar/Abrir). Ausente → cabeçalho/avisos sem o botão. */
  acaoPrimaria?: AcaoPreview;
  /** Botão de fechar (X). Ausente → cabeçalho sem o X (ex.: painel do Files). */
  onFechar?: () => void;
}

export function PreviewArquivo({
  fonte,
  acaoPrimaria,
  onFechar,
}: PreviewArquivoProps) {
  const { t } = useIdioma();
  const tp = t.controlRoom;

  // Valores normalizados da fonte (o resto do componente não olha `kind`).
  const isAnexo = fonte.kind === "anexo";
  const nome = fonte.kind === "anexo" ? fonte.anexo.nome : fonte.nome;
  const tamanho = fonte.kind === "anexo" ? fonte.anexo.tamanho : fonte.tamanho;
  const ctypeFonte =
    fonte.kind === "anexo" ? fonte.anexo.contentType : fonte.contentType;
  // Identidade da busca (deps do efeito) — vazio no ramo que não se aplica.
  const messageId = fonte.kind === "anexo" ? fonte.messageId : "";
  const anexoId = fonte.kind === "anexo" ? fonte.anexo.id : "";
  const mailbox = fonte.kind === "anexo" ? fonte.mailbox : undefined;
  const localPath = fonte.kind === "local" ? fonte.path : "";

  const tipoBruto =
    fonte.kind === "anexo"
      ? classificarAnexo(fonte.anexo)
      : classificarPorNome(fonte.nome, fonte.contentType);
  // Path C (Office→PDF em alta fidelidade) é Graph-ONLY: fonte local não tem como
  // converter. pptx local (que só rende via Path C) cai graciosamente no aviso de
  // não-suportado — sem forkar o enum de tipo.
  const pathCDisponivel = isAnexo;
  const tipo: TipoPreview =
    tipoBruto === "pptx" && !pathCDisponivel ? "nao-suportado" : tipoBruto;

  const grande = tamanho > LIMITE_PREVIEW_BYTES;

  // pptx sempre via Path C (Graph→PDF); docx/xlsx opcionalmente, via o toggle.
  const [altaFidelidade, setAltaFidelidade] = useState(false);
  const usarPathC =
    pathCDisponivel &&
    (tipo === "pptx" || (aceitaAltaFidelidade(tipo) && altaFidelidade));

  const [carregando, setCarregando] = useState(tipo !== "nao-suportado");
  const [erro, setErro] = useState<string | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [txt, setTxt] = useState<string | null>(null);
  const [docxHtml, setDocxHtml] = useState<string | null>(null);
  const [xlsxDados, setXlsxDados] = useState<XlsxRender | null>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [csv, setCsv] = useState<CsvTabela | null>(null);
  const [midiaUrl, setMidiaUrl] = useState<string | null>(null);
  // Contador de tentativas: o botão "Tentar de novo" incrementa → re-busca (#450).
  const [tentativa, setTentativa] = useState(0);

  // Busca e decodifica os bytes uma vez (a menos que seja não-suportado/grande).
  // `usarPathC` nas deps: alternar alta fidelidade re-busca (converte no OneDrive).
  // `tentativa` nas deps: retry após erro sem trocar de fonte.
  useEffect(() => {
    if (tipo === "nao-suportado" || grande) {
      setCarregando(false);
      return;
    }
    let vivo = true;
    let doc: PDFDocumentProxy | null = null;
    let objUrl: string | null = null;
    setCarregando(true);
    setErro(null);
    setPdf(null); // limpa render anterior ao trocar de modo (client ↔ Path C)
    setImgUrl(null);
    setMidiaUrl(null);
    (async () => {
      try {
        if (usarPathC) {
          // Path C: converte para PDF no OneDrive e renderiza no mesmo pdf.js.
          const conv = await api.crAnexoParaPdf(messageId, anexoId, mailbox);
          doc = await carregarPdf(base64ParaBytes(conv.bytesB64));
          if (vivo) setPdf(doc);
          else void doc.loadingTask.destroy();
          return;
        }
        const conteudo = isAnexo
          ? await api.crLerAnexo(messageId, anexoId, mailbox)
          : await api.lerArquivoBytes(localPath, LIMITE_PREVIEW_BYTES);
        const bytes = base64ParaBytes(conteudo.bytesB64);
        if (tipo === "txt") {
          if (vivo) setTxt(new TextDecoder("utf-8").decode(bytes));
        } else if (tipo === "docx") {
          const html = await renderDocxParaHtml(bytes);
          if (vivo) setDocxHtml(html);
        } else if (tipo === "xlsx") {
          const dados = await renderXlsxParaHtml(bytes);
          if (vivo) setXlsxDados(dados);
        } else if (tipo === "csv") {
          if (vivo) setCsv(parseCsv(new TextDecoder("utf-8").decode(bytes)));
        } else if (tipo === "imagem") {
          // Object URL do blob (não data URL gigante). SVG entra como `<img>`,
          // que roda a imagem em "modo imagem" — scripts embutidos NÃO executam.
          const blob = new Blob([bytes as BlobPart], {
            type: conteudo.contentType || ctypeFonte || "image/*",
          });
          objUrl = URL.createObjectURL(blob);
          if (vivo) setImgUrl(objUrl);
          else URL.revokeObjectURL(objUrl);
        } else if (tipo === "audio" || tipo === "video") {
          // Object URL → o <audio>/<video> streama por range, não carrega tudo.
          const blob = new Blob([bytes as BlobPart], {
            type: conteudo.contentType || ctypeFonte || "",
          });
          objUrl = URL.createObjectURL(blob);
          if (vivo) setMidiaUrl(objUrl);
          else URL.revokeObjectURL(objUrl);
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
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [
    isAnexo,
    messageId,
    anexoId,
    mailbox,
    localPath,
    tipo,
    grande,
    usarPathC,
    tentativa,
    ctypeFonte,
  ]);

  return (
    <div
      // #496: preview vive num card (painel resizable), então preenche a altura
      // do painel — cabeçalho fixo + corpo rolável.
      className="flex h-full flex-col overflow-hidden rounded-lg border bg-card"
      role="region"
      aria-label={preencher(tp.previewTitulo, { nome })}
    >
      {/* Cabeçalho: nome + ações explícitas */}
      <div className="flex shrink-0 items-center gap-2 border-b bg-muted/30 px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {nome}
        </span>
        {/* Alta fidelidade (Path C) só existe para anexo (Graph-only). */}
        {isAnexo && aceitaAltaFidelidade(tipo) && (
          <Button
            variant={altaFidelidade ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setAltaFidelidade((v) => !v)}
            aria-pressed={altaFidelidade}
          >
            <Sparkles className="size-3.5" /> {tp.previewAltaFidelidade}
          </Button>
        )}
        {acaoPrimaria && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={acaoPrimaria.onClick}
          >
            <acaoPrimaria.Icone className="size-3.5" /> {acaoPrimaria.rotulo}
          </Button>
        )}
        {onFechar && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onFechar}
            aria-label={tp.previewFechar}
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>

      {/* Corpo: estados + renderer. #532: COLUNA flex que preenche o card; cada
          viewer é `flex-1 min-h-0` e rola/escala DENTRO. Responsivo ao resize. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {grande ? (
          <PreviewAviso
            titulo={tp.previewGrande}
            descricao={preencher(tp.previewGrandeDesc, {
              tam: formatarTamanho(tamanho),
            })}
            acao={acaoPrimaria}
          />
        ) : tipo === "nao-suportado" ? (
          <PreviewAviso
            titulo={tp.previewNaoSuportado}
            descricao={tp.previewNaoSuportadoDesc}
            acao={acaoPrimaria}
          />
        ) : carregando ? (
          <div className="space-y-2 p-4">
            {usarPathC && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                {tp.previewConvertendo}
              </p>
            )}
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : erro ? (
          <div className="p-4">
            <Alert variant="destructive">
              <FileWarning className="size-4" />
              <AlertTitle>{tp.previewErro}</AlertTitle>
              <AlertDescription>{erro}</AlertDescription>
              <AlertAction>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setTentativa((n) => n + 1)}
                >
                  <RotateCcw className="size-3.5" /> {tp.previewTentarNovo}
                </Button>
              </AlertAction>
            </Alert>
          </div>
        ) : usarPathC ? (
          pdf ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <PdfViewer doc={pdf} tp={tp} />
              {/* Egress consciente (§7.3): converteu no OneDrive do usuário. */}
              <p className="shrink-0 border-t px-3 py-1.5 text-[11px] text-muted-foreground">
                {tp.previewConvertido}
              </p>
            </div>
          ) : null
        ) : tipo === "txt" && txt !== null ? (
          <TxtViewer texto={txt} rotulo={nome} />
        ) : tipo === "pdf" && pdf ? (
          <PdfViewer doc={pdf} tp={tp} />
        ) : tipo === "docx" && docxHtml !== null ? (
          <HtmlSandboxViewer
            html={docxHtml}
            rotulo={nome}
            vazioTexto={tp.previewVazio}
          />
        ) : tipo === "xlsx" && xlsxDados !== null ? (
          <XlsxViewer
            dados={xlsxDados}
            rotulo={nome}
            vazioTexto={tp.previewVazio}
          />
        ) : tipo === "imagem" && imgUrl ? (
          <ImagemViewer url={imgUrl} rotulo={nome} tp={tp} />
        ) : tipo === "csv" && csv ? (
          <CsvViewer tabela={csv} vazioTexto={tp.previewVazio} tp={tp} />
        ) : (tipo === "audio" || tipo === "video") && midiaUrl ? (
          <MidiaViewer
            url={midiaUrl}
            tipo={tipo}
            rotulo={nome}
            acao={acaoPrimaria}
            tp={tp}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Áudio/vídeo via `<audio>`/`<video controls>` com object URL (streama por
 * range, sem carregar tudo). **Sem autoplay** (respeita reduced-motion). Se o
 * codec não tocar (ex.: `.mov` que passe pela classificação), o `onError` cai
 * no aviso de não-suportado com CTA da ação primária — nunca um player quebrado
 * (#452).
 */
function MidiaViewer({
  url,
  tipo,
  rotulo,
  acao,
  tp,
}: {
  url: string;
  tipo: "audio" | "video";
  rotulo: string;
  acao?: AcaoPreview;
  tp: PreviewStrings;
}) {
  const [semSuporte, setSemSuporte] = useState(false);
  if (semSuporte) {
    return (
      <PreviewAviso
        titulo={tp.previewNaoSuportado}
        descricao={tp.previewNaoSuportadoDesc}
        acao={acao}
      />
    );
  }
  if (tipo === "audio") {
    return (
      <div className="p-4">
        <audio
          controls
          src={url}
          title={rotulo}
          className="w-full"
          onError={() => setSemSuporte(true)}
        />
      </div>
    );
  }
  return (
    <div className="flex justify-center bg-black/90 p-2">
      <video
        controls
        src={url}
        title={rotulo}
        className="max-h-96 max-w-full"
        onError={() => setSemSuporte(true)}
      />
    </div>
  );
}

/** CSV: tabela com header fixo + scroll H/V. Header = 1ª linha; cap com aviso
 *  "mostrando N de M". Valores como texto (sem HTML) — seguro (#451). */
function CsvViewer({
  tabela,
  vazioTexto,
  tp,
}: {
  tabela: CsvTabela;
  vazioTexto: string;
  tp: PreviewStrings;
}) {
  if (tabela.linhas.length === 0) return <PreviewVazio texto={vazioTexto} />;
  const [cabecalho, ...corpo] = tabela.linhas;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {tabela.truncado && (
        <p className="border-b bg-muted/30 px-3 py-1 text-[11px] text-muted-foreground">
          {preencher(tp.previewCsvTruncado, {
            n: tabela.linhas.length,
            m: tabela.total,
          })}
        </p>
      )}
      <ScrollArea className="min-h-0 w-full flex-1">
        <table className="w-max border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr>
              <th className="border px-2 py-1" />
              {(cabecalho ?? []).map((celula, j) => (
                <th
                  key={j}
                  className="whitespace-nowrap border px-2 py-1 text-left font-medium"
                >
                  {celula}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {corpo.map((linha, i) => (
              <tr key={i}>
                <td className="sticky left-0 z-10 border bg-muted/60 px-2 py-1 text-right tabular-nums text-muted-foreground">
                  {i + 1}
                </td>
                {linha.map((celula, j) => (
                  <td key={j} className="whitespace-nowrap border px-2 py-1">
                    {celula}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}

/** Imagem: `<img>` com fit-to-frame + zoom. SVG entra por src (modo imagem →
 *  script embutido não executa); nunca injetamos o markup inline no DOM (#450). */
function ImagemViewer({
  url,
  rotulo,
  tp,
}: {
  url: string;
  rotulo: string;
  tp: PreviewStrings;
}) {
  const [escala, setEscala] = useState(1);
  const ajustarZoom = (delta: number) =>
    setEscala((e) => Math.min(5, Math.max(0.25, +(e + delta).toFixed(2))));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b px-2 py-1">
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => ajustarZoom(-0.25)}
          aria-label={tp.previewMenosZoom}
        >
          <ZoomOut className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => setEscala(1)}
          aria-label={tp.previewZoomReset}
        >
          <RotateCcw className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => ajustarZoom(0.25)}
          aria-label={tp.previewMaisZoom}
        >
          <ZoomIn className="size-4" />
        </Button>
      </div>
      <ScrollArea className="min-h-0 w-full flex-1 bg-muted/20">
        <div className="flex min-h-full items-center justify-center p-3">
          <img
            src={url}
            alt={rotulo}
            className="max-h-full max-w-full object-contain shadow-sm"
            style={{ transform: `scale(${escala})`, transformOrigin: "center" }}
          />
        </div>
      </ScrollArea>
    </div>
  );
}

/** Aviso (não-suportado / grande) com a ação primária, quando houver. */
function PreviewAviso({
  titulo,
  descricao,
  acao,
}: {
  titulo: string;
  descricao: string;
  acao?: AcaoPreview;
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
      {acao && (
        <Button variant="outline" size="sm" onClick={acao.onClick}>
          <acao.Icone className="size-3.5" /> {acao.rotulo}
        </Button>
      )}
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
      className="min-h-0 w-full flex-1 border-0 bg-white"
    />
  );
}

/** Viewer de PDF: canvas do pdf.js + paginação + zoom. */
function PdfViewer({ doc, tp }: { doc: PDFDocumentProxy; tp: PreviewStrings }) {
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
    <div className="flex min-h-0 flex-1 flex-col">
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
      <ScrollArea className="min-h-0 w-full flex-1 bg-muted/20">
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
 * Viewer de HTML não-confiável (docx e xlsx) — injeta o HTML **já sanitizado**
 * (DOMPurify, nos módulos `docx-render`/`xlsx-render`) num `<iframe sandbox="">`
 * com **CSP** estrita: `default-src 'none'` mata rede/script; `img-src data:`
 * deixa só as imagens embutidas (base64); `style-src 'unsafe-inline'` mantém a
 * folha do docx-preview / xlsx-preview. Nenhum script do documento executa.
 */
function HtmlSandboxViewer({
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
      className="min-h-0 w-full flex-1 border-0 bg-white"
    />
  );
}

/**
 * Preview de xlsx (#552): as ABAS de planilha ficam em React (fora do iframe) e
 * só a planilha ATIVA é injetada como HTML estático no `HtmlSandboxViewer`.
 * Evita o modo multi-sheet do xlsx-preview (`<object data=blob:>` + `<script>`),
 * que o `iframe sandbox=""` + CSP `default-src 'none'` BLOQUEIA (grid em branco).
 * Barra de abas embaixo (estilo Excel); some quando há só uma planilha.
 */
function XlsxViewer({
  dados,
  rotulo,
  vazioTexto,
}: {
  dados: XlsxRender;
  rotulo: string;
  vazioTexto: string;
}) {
  const [aba, setAba] = useState(0);
  // Novo arquivo (dados troca) → volta pra 1ª planilha.
  useEffect(() => setAba(0), [dados]);
  if (dados.sheets.length === 0) return <PreviewVazio texto={vazioTexto} />;
  const idx = Math.min(aba, dados.sheets.length - 1);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <HtmlSandboxViewer
        html={dados.sheets[idx]}
        rotulo={`${rotulo} — ${dados.nomes[idx] ?? ""}`}
        vazioTexto={vazioTexto}
      />
      {dados.sheets.length > 1 && (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-t bg-muted/30 px-2 py-1">
          {dados.nomes.map((nome, i) => (
            <button
              key={`${nome}-${i}`}
              type="button"
              onClick={() => setAba(i)}
              aria-current={i === idx ? "true" : undefined}
              className={cn(
                "shrink-0 rounded px-2 py-0.5 text-xs transition-colors",
                i === idx
                  ? "bg-background font-medium shadow-sm"
                  : "text-muted-foreground hover:bg-background/60"
              )}
            >
              {nome}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
