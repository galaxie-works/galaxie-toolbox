import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { KEYS, type TElement } from "platejs";
import { Plate, usePlateEditor } from "platejs/react";
import {
  BoldIcon,
  FileArchiveIcon,
  FileIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  HeadphonesIcon,
  ImageIcon,
  ItalicIcon,
  PaperclipIcon,
  PenLineIcon,
  StrikethroughIcon,
  Trash2Icon,
  UnderlineIcon,
  UploadCloudIcon,
  UploadIcon,
  VideoIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  formatBytes,
  useFileUpload,
  type FileMetadata,
  type FileWithPreview,
} from "@/hooks/use-file-upload";

import { Editor, EditorContainer } from "@/components/ui/editor";
import { FixedToolbar } from "@/components/ui/fixed-toolbar";
import { MarkToolbarButton } from "@/components/ui/mark-toolbar-button";
import { ToolbarButton } from "@/components/ui/toolbar";
import {
  BulletedListToolbarButton,
} from "@/components/ui/list-toolbar-button";
import { LinkToolbarButton } from "@/components/ui/link-toolbar-button";
import { BasicNodesKit } from "@/components/editor/plugins/basic-nodes-kit";
import { ListKit } from "@/components/editor/plugins/list-kit";
import { LinkKit } from "@/components/editor/plugins/link-kit";
import { AutoformatKit } from "@/components/editor/plugins/autoformat-kit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { crCompartilharOneDrive, type AnexoEnvio } from "@/lib/api";

import { CampoPessoas } from "./campo-pessoas";

/**
 * Compose completo de e-mail reutilizável: campos de destinatários com
 * autocomplete (Para/Cc/Cco), assunto opcional e corpo rico em Plate com uma
 * barra de formatação compacta. Usado no "Nova mensagem" e no responder/
 * encaminhar do cliente Bridge.
 *
 * O corpo sai como HTML lido direto do DOM editável (`[data-slate-editor]`),
 * mesmo padrão de `compor-email.tsx` — é o que o Graph espera em HTML.
 */
export interface ComporMensagemHandle {
  getPara: () => string[];
  getCc: () => string[];
  getCco: () => string[];
  getAssunto: () => string;
  getHtml: () => string;
  getTexto: () => string;
  /** Anexos acumulados (base64) para irem junto no envio. */
  getAnexos: () => AnexoEnvio[];
}

export interface ComporMensagemProps {
  mostrarAssunto?: boolean;
  /** Some com os campos Para/Cc/Cco (ex.: responder, onde o Graph define). */
  mostrarDestinatarios?: boolean;
  assuntoInicial?: string;
  textos: {
    para: string;
    cc: string;
    cco: string;
    assunto: string;
    assuntoPlaceholder: string;
    corpoPlaceholder: string;
    mostrarCcCco: string;
  };
}

const COMPOSE_KIT = [...BasicNodesKit, ...ListKit, ...LinkKit, ...AutoformatKit];

/** Chave do localStorage onde a assinatura fica guardada (editável em Settings). */
const ASSINATURA_KEY = "bridge.assinatura";

/** Assinatura salva pelo usuário; se vazia, um default simples. */
function lerAssinatura(): string {
  try {
    const v = localStorage.getItem(ASSINATURA_KEY);
    if (v && v.trim()) return v;
  } catch {
    // localStorage indisponível (modo privado etc.): usa o default.
  }
  return "--\nEnviado pelo GALAXIE Toolbox";
}

/** Converte bytes crus em base64 sem estourar a pilha em arquivos grandes. */
function bytesParaB64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** Extensão -> MIME mais comum. Fallback genérico quando não conhecemos. */
function tipoPorNome(nome: string): string {
  const ext = nome.split(".").pop()?.toLowerCase() ?? "";
  const mapa: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    txt: "text/plain",
    csv: "text/csv",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    zip: "application/zip",
  };
  return mapa[ext] ?? "application/octet-stream";
}

/** Nome do arquivo a partir de um caminho absoluto (Windows ou POSIX). */
function nomeDoCaminho(caminho: string): string {
  return caminho.split(/[\\/]/).pop() || caminho;
}

/** Limites do uploader (c-file-upload-9). Grandes o suficiente para e-mail. */
const MAX_ARQUIVOS = 20;
const MAX_TAMANHO = 25 * 1024 * 1024; // 25 MB

/** Ícone por tipo MIME, no espírito do getFileIcon do c-file-upload-9. */
function getFileIcon(file: File | FileMetadata) {
  const type = file.type ?? "";
  const cls = "size-6";
  if (type.startsWith("image/")) return <ImageIcon className={cls} />;
  if (type.startsWith("video/")) return <VideoIcon className={cls} />;
  if (type.startsWith("audio/")) return <HeadphonesIcon className={cls} />;
  if (type.includes("pdf")) return <FileTextIcon className={cls} />;
  if (type.includes("word") || type.includes("doc"))
    return <FileTextIcon className={cls} />;
  if (type.includes("excel") || type.includes("sheet"))
    return <FileSpreadsheetIcon className={cls} />;
  if (type.includes("zip") || type.includes("rar"))
    return <FileArchiveIcon className={cls} />;
  return <FileIcon className={cls} />;
}

/**
 * Abre o seletor de arquivo do sistema e devolve `{nome, bytes}` do que foi
 * escolhido, ou `null` se o usuário cancelou. Usa os plugins JS do Tauri
 * (dialog/fs), então só funciona dentro do app.
 */
async function escolherArquivos(): Promise<{ nome: string; bytes: Uint8Array }[]> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const { readFile } = await import("@tauri-apps/plugin-fs");
  const escolhido = await open({ multiple: true, directory: false });
  if (!escolhido) return [];
  const caminhos = Array.isArray(escolhido) ? escolhido : [escolhido];
  const arquivos: { nome: string; bytes: Uint8Array }[] = [];
  for (const c of caminhos) {
    if (typeof c !== "string") continue;
    arquivos.push({ nome: nomeDoCaminho(c), bytes: await readFile(c) });
  }
  return arquivos;
}

export const ComporMensagem = forwardRef<
  ComporMensagemHandle,
  ComporMensagemProps
>(function ComporMensagem(
  { mostrarAssunto = false, mostrarDestinatarios = true, assuntoInicial = "", textos },
  ref
) {
  const [para, setPara] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [cco, setCco] = useState<string[]>([]);
  const [assunto, setAssunto] = useState(assuntoInicial);
  const [mostrarCcCco, setMostrarCcCco] = useState(false);
  const [anexos, setAnexos] = useState<AnexoEnvio[]>([]);
  const [compartilhando, setCompartilhando] = useState(false);

  // O uploader (c-file-upload-9) é a fonte da lista visível; `anexos` (o que vai
  // no envio) é derivado dele. Como base64 é assíncrono, guardamos cada anexo já
  // convertido num cache por id de arquivo e reconstruímos `anexos` na ordem dos
  // arquivos sempre que a lista muda (adicionar/remover/limpar).
  const arquivosRef = useRef<FileWithPreview[]>([]);
  const anexosCacheRef = useRef<Map<string, AnexoEnvio>>(new Map());

  const sincronizarAnexos = useCallback((lista: FileWithPreview[]) => {
    const ids = new Set(lista.map((f) => f.id));
    for (const id of [...anexosCacheRef.current.keys()]) {
      if (!ids.has(id)) anexosCacheRef.current.delete(id);
    }
    setAnexos(
      lista
        .map((f) => anexosCacheRef.current.get(f.id))
        .filter((a): a is AnexoEnvio => Boolean(a))
    );
  }, []);

  /** Converte cada `File` novo para base64 e realimenta `anexos`. */
  const aoAdicionarArquivos = useCallback(
    async (adicionados: FileWithPreview[]) => {
      for (const item of adicionados) {
        // Só arquivos reais (do drop/browse/picker) têm bytes para converter.
        if (item.file instanceof File) {
          const bytes = new Uint8Array(await item.file.arrayBuffer());
          anexosCacheRef.current.set(item.id, {
            nome: item.file.name,
            tipo: item.file.type || tipoPorNome(item.file.name),
            conteudoB64: bytesParaB64(bytes),
          });
        }
      }
      sincronizarAnexos(arquivosRef.current);
    },
    [sincronizarAnexos]
  );

  const [
    { files: arquivos, isDragging, errors },
    {
      addFiles,
      removeFile,
      clearFiles,
      handleDragEnter,
      handleDragLeave,
      handleDragOver,
      handleDrop,
      openFileDialog,
      getInputProps,
    },
  ] = useFileUpload({
    multiple: true,
    maxFiles: MAX_ARQUIVOS,
    maxSize: MAX_TAMANHO,
    onFilesAdded: aoAdicionarArquivos,
    onFilesChange: sincronizarAnexos,
  });
  // Espelho síncrono da lista de arquivos, para o callback assíncrono de conversão.
  arquivosRef.current = arquivos;

  const editor = usePlateEditor({
    plugins: COMPOSE_KIT,
    value: [{ type: "p", children: [{ text: "" }] }],
  });
  const edRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    getPara: () => para,
    getCc: () => cc,
    getCco: () => cco,
    getAssunto: () => assunto,
    getHtml: () => edRef.current?.innerHTML ?? "",
    getTexto: () => edRef.current?.textContent ?? "",
    getAnexos: () => anexos,
  }));

  /** Insere blocos novos no fim do corpo (assinatura, link etc.). */
  function inserirNoFim(nodes: TElement[]) {
    editor.tf.insertNodes(nodes, { at: [editor.children.length] });
  }

  /** Insere a assinatura (uma linha por parágrafo) ao final do corpo. */
  function inserirAssinatura() {
    const linhas = lerAssinatura().split(/\r?\n/);
    inserirNoFim(
      linhas.map((linha) => ({ type: "p", children: [{ text: linha }] }))
    );
  }

  /**
   * Atalho da toolbar: abre o picker do Tauri e injeta os arquivos escolhidos no
   * mesmo uploader (c-file-upload-9), que cuida da conversão para base64/anexo.
   */
  async function anexarArquivo() {
    try {
      const arqs = await escolherArquivos();
      if (arqs.length === 0) return;
      const novos = arqs.map((arq) => {
        // Cópia para um ArrayBuffer "puro" (o Uint8Array do Tauri não casa com
        // BlobPart por causa da união com SharedArrayBuffer).
        const buffer = new ArrayBuffer(arq.bytes.byteLength);
        new Uint8Array(buffer).set(arq.bytes);
        return new File([buffer], arq.nome, { type: tipoPorNome(arq.nome) });
      });
      addFiles(novos);
    } catch (e) {
      toast.error("Falha ao anexar o arquivo", { description: String(e) });
    }
  }

  /**
   * Sobe um arquivo para o OneDrive e insere um link de compartilhamento no
   * corpo (em vez de anexar o binário). Bom para arquivos grandes.
   */
  async function compartilharOneDrive() {
    if (compartilhando) return;
    setCompartilhando(true);
    try {
      const arqs = await escolherArquivos();
      if (arqs.length === 0) return;
      for (const arq of arqs) {
        const webUrl = await crCompartilharOneDrive(arq.nome, bytesParaB64(arq.bytes));
        inserirNoFim([
          {
            type: "p",
            children: [
              { text: "" },
              { type: KEYS.link, url: webUrl, children: [{ text: arq.nome }] },
              { text: "" },
            ],
          },
        ]);
      }
      toast.success(
        arqs.length > 1 ? `${arqs.length} links inseridos` : `Link inserido: ${arqs[0].nome}`
      );
    } catch (e) {
      toast.error("Falha ao compartilhar pelo OneDrive", {
        description: String(e),
      });
    } finally {
      setCompartilhando(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {mostrarDestinatarios && (
        <>
          {/* Linha "Para" com o toggle de Cc/Cco à direita. */}
          <div className="flex items-start border-b">
            <div className="flex-1">
              <CampoPessoas rotulo={textos.para} valor={para} onChange={setPara} />
            </div>
            {!mostrarCcCco && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-1.5 mr-2 shrink-0 text-xs text-muted-foreground"
                onClick={() => setMostrarCcCco(true)}
              >
                {textos.mostrarCcCco}
              </Button>
            )}
          </div>

          {mostrarCcCco && (
            <>
              <div className="border-b">
                <CampoPessoas rotulo={textos.cc} valor={cc} onChange={setCc} />
              </div>
              <div className="border-b">
                <CampoPessoas rotulo={textos.cco} valor={cco} onChange={setCco} />
              </div>
            </>
          )}
        </>
      )}

      {mostrarAssunto && (
        <div className="border-b px-3 py-2">
          <input
            type="text"
            value={assunto}
            aria-label={textos.assunto}
            placeholder={textos.assuntoPlaceholder}
            onChange={(e) => setAssunto(e.target.value)}
            className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </div>
      )}

      {/* Toolbar + corpo dentro do Plate para os botões mirarem o editor. */}
      <Plate editor={editor}>
        <FixedToolbar className="justify-start rounded-none border-b bg-background">
          <MarkToolbarButton nodeType={KEYS.bold} tooltip="Negrito (⌘+B)">
            <BoldIcon />
          </MarkToolbarButton>
          <MarkToolbarButton nodeType={KEYS.italic} tooltip="Itálico (⌘+I)">
            <ItalicIcon />
          </MarkToolbarButton>
          <MarkToolbarButton
            nodeType={KEYS.underline}
            tooltip="Sublinhado (⌘+U)"
          >
            <UnderlineIcon />
          </MarkToolbarButton>
          <MarkToolbarButton
            nodeType={KEYS.strikethrough}
            tooltip="Tachado (⌘+⇧+M)"
          >
            <StrikethroughIcon />
          </MarkToolbarButton>
          <BulletedListToolbarButton />
          <LinkToolbarButton />
          <ToolbarButton
            tooltip="Inserir assinatura"
            onClick={inserirAssinatura}
          >
            <PenLineIcon />
          </ToolbarButton>
          <ToolbarButton tooltip="Anexar arquivo" onClick={anexarArquivo}>
            <PaperclipIcon />
          </ToolbarButton>
          <ToolbarButton
            tooltip="Compartilhar via OneDrive"
            onClick={compartilharOneDrive}
            disabled={compartilhando}
          >
            <UploadCloudIcon />
          </ToolbarButton>
        </FixedToolbar>

        <EditorContainer className={cn("min-h-0 flex-1 overflow-auto")}>
          <Editor
            ref={edRef}
            variant="none"
            placeholder={textos.corpoPlaceholder}
            className="min-h-40 px-3 py-2 text-sm"
          />
        </EditorContainer>

        {/*
          Rodapé: uploader c-file-upload-9 (markup literal do registry, sem o
          mock de progresso/simulateUpload e sem defaultFiles). O drop nativo
          pode ser interceptado pelo Tauri; o "selecione"/browse via <input
          type=file> sempre funciona e entrega File com .arrayBuffer().
        */}
        <div className="w-full space-y-4 border-t p-3">
          {/* Área de upload */}
          <div
            className={cn(
              "rounded-lg relative border border-dashed p-6 text-center transition-colors",
              isDragging
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-muted-foreground/50"
            )}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <input {...getInputProps()} className="sr-only" />

            <div className="flex flex-col items-center gap-4">
              <div
                className={cn(
                  "bg-muted flex h-12 w-12 items-center justify-center rounded-full transition-colors",
                  isDragging
                    ? "border-primary bg-primary/10"
                    : "border-muted-foreground/25"
                )}
              >
                <UploadIcon className="text-muted-foreground h-5 w-5" />
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">
                  Arraste arquivos aqui ou{" "}
                  <button
                    type="button"
                    onClick={openFileDialog}
                    className="text-primary cursor-pointer underline-offset-4 hover:underline"
                  >
                    selecione
                  </button>
                </p>
                <p className="text-muted-foreground text-xs">
                  Tamanho máximo: {formatBytes(MAX_TAMANHO)} • Máximo de
                  arquivos: {MAX_ARQUIVOS}
                </p>
              </div>
            </div>
          </div>

          {/* Grid de arquivos */}
          {arquivos.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">
                  Anexos ({arquivos.length})
                </h3>
                <div className="flex gap-2">
                  <Button onClick={openFileDialog} variant="outline" size="sm">
                    <UploadCloudIcon />
                    Adicionar
                  </Button>
                  <Button onClick={clearFiles} variant="outline" size="sm">
                    <Trash2Icon />
                    Remover todos
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-4 lg:grid-cols-6">
                {arquivos.map((fileItem) => (
                  <div key={fileItem.id} className="group/item relative">
                    {/* Botão remover */}
                    <Button
                      onClick={() => removeFile(fileItem.id)}
                      variant="outline"
                      size="icon"
                      aria-label={`Remover ${fileItem.file.name}`}
                      className="absolute -end-2 -top-2 z-10 size-6 rounded-full opacity-0 transition-opacity group-hover/item:opacity-100 dark:bg-zinc-800 hover:dark:bg-zinc-700"
                    >
                      <XIcon className="size-3.5" />
                    </Button>

                    {/* Wrapper */}
                    <div className="bg-card rounded-lg relative overflow-hidden border transition-colors">
                      {/* Preview de imagem ou ícone do arquivo */}
                      <div className="bg-muted border-border relative aspect-square border-b">
                        {fileItem.file.type.startsWith("image/") &&
                        fileItem.preview ? (
                          <img
                            src={fileItem.preview}
                            alt={fileItem.file.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="text-muted-foreground/80 flex h-full items-center justify-center">
                            <div className="text-4xl">
                              {getFileIcon(fileItem.file)}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Rodapé com nome e tamanho */}
                      <div className="p-3">
                        <div className="space-y-1">
                          <p className="truncate text-sm font-medium">
                            {fileItem.file.name}
                          </p>
                          <span className="text-muted-foreground text-xs">
                            {formatBytes(fileItem.file.size)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Mensagens de erro do uploader */}
          {errors.length > 0 && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {errors.map((error, index) => (
                <p key={index}>{error}</p>
              ))}
            </div>
          )}
        </div>
      </Plate>
    </div>
  );
});
