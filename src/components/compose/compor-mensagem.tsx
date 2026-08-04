import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { KEYS, type Descendant, type TElement, type Value } from "platejs";
import {
  Plate,
  usePlateEditor,
  type PlateEditor,
} from "platejs/react";
import {
  FileArchiveIcon,
  FileIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FileType2Icon,
  HeadphonesIcon,
  ImageIcon,
  StrikethroughIcon,
  Trash2Icon,
  UploadCloudIcon,
  UploadIcon,
  VideoIcon,
  XIcon,
} from "lucide-react";
// #500/#499: ícones animados da toolbar do composer (registry) + marca OneDrive.
import { BoldIcon } from "@/components/ui/bold";
import { ItalicIcon } from "@/components/ui/italic";
import { UnderlineIcon } from "@/components/ui/underline";
import { AttachFileIcon } from "@/components/ui/attach-file";
import { PenToolIcon } from "@/components/ui/pen-tool";
import { OneDriveIcon } from "@/components/ui/icons/marca/onedrive";
import { toast } from "sonner";

import {
  formatBytes,
  useFileUpload,
  type FileMetadata,
  type FileWithPreview,
} from "@/hooks/use-file-upload";

import { Editor, EditorContainer } from "@/components/ui/editor";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FixedToolbar } from "@/components/ui/fixed-toolbar";
import { ShortcutMarkToolbarButton } from "@/components/ui/shortcut-mark-toolbar-button";
import { ToolbarButton } from "@/components/ui/toolbar";
import {
  BulletedListToolbarButton,
} from "@/components/ui/list-toolbar-button";
import { LinkToolbarButton } from "@/components/ui/link-toolbar-button";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { crCompartilharOneDrive, type AnexoEnvio } from "@/lib/api";
import { preencher, useIdioma } from "@/lib/idioma";
import { type TemplateEmail } from "@/lib/templates";
import { useAppStore } from "@/store";

import { CampoPessoas } from "./campo-pessoas";
import { COMPOSE_KIT } from "./compose-kit";
import { MENCAO_KIT, MencionaveisProvider } from "./mencao-kit";
import type { Pessoa } from "@/lib/types";

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
  /**
   * Define quando a assinatura padrão entra no valor inicial (#141).
   * Em respostas/encaminhamentos, a própria assinatura precisa autorizar o uso.
   */
  contextoAssinatura?: "novo" | "resposta";
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

/** Assinatura simples usada quando não há assinatura padrão definida (#135). */
const ASSINATURA_FALLBACK = "--\nEnviado pelo GALAXIE Toolbox";

/**
 * Mesmo saneamento usado pelo editor de assinaturas/templates (#147): remove
 * artefatos internos do Slate antes de desserializar o HTML salvo.
 */
function normalizarCorpoPlate(html: string): string {
  if (!html || !html.trim()) return "";
  if (typeof document === "undefined") return html;
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  tmp
    .querySelectorAll("[data-slate-placeholder], [data-slate-zero-width]")
    .forEach((el) => el.remove());
  const temMidia = tmp.querySelector("img, table, hr") !== null;
  const texto = (tmp.textContent ?? "").replace(/[\s\u200B\uFEFF]+/g, "");
  if (!temMidia && texto.length === 0) return "";
  return tmp.innerHTML;
}

/**
 * Desserializa o HTML persistido e garante que o topo do Value contenha apenas
 * blocos válidos. É a mesma proteção estrutural do #147 contra texto/inline
 * solto, que derrubava o Plate com tela branca.
 */
function desserializarBlocosPlate(
  editor: PlateEditor,
  htmlPersistido: string
): Value {
  const html = normalizarCorpoPlate(htmlPersistido);
  if (!html) return [];
  const nodes = editor.api.html.deserialize({ element: html }) as Descendant[];
  return nodes.map((no): TElement => {
    const ehBloco =
      "children" in no && Array.isArray(no.children) && !editor.api.isInline(no);
    return ehBloco ? (no as TElement) : { type: KEYS.p, children: [no] };
  });
}

/**
 * Corpo inicial sempre começa com um parágrafo editável. Quando aplicável, a
 * assinatura vem depois dele, portanto o usuário digita acima e ela é inserida
 * exatamente uma vez na criação do editor.
 */
function valorInicialCompose(
  editor: PlateEditor,
  assinaturaHtml: string | null
): Value {
  const paragrafoVazio: TElement = {
    type: KEYS.p,
    children: [{ text: "" }],
  };
  if (!assinaturaHtml) return [paragrafoVazio];
  const assinatura = desserializarBlocosPlate(editor, assinaturaHtml);
  return assinatura.length > 0
    ? [paragrafoVazio, ...assinatura]
    : [paragrafoVazio];
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
  {
    mostrarAssunto = false,
    mostrarDestinatarios = true,
    contextoAssinatura = "novo",
    textos,
  },
  ref
) {
  const { t } = useIdioma();
  // Valores de domínio do rascunho pertencem ao compose-slice (#132). O Plate
  // e a mecânica visual do uploader continuam locais, conforme o contrato.
  const para = useAppStore((s) => s.composePara);
  const setPara = useAppStore((s) => s.setComposePara);
  const cc = useAppStore((s) => s.composeCc);
  const setCc = useAppStore((s) => s.setComposeCc);
  const cco = useAppStore((s) => s.composeCco);
  const setCco = useAppStore((s) => s.setComposeCco);
  const assunto = useAppStore((s) => s.composeAssunto);
  const setAssunto = useAppStore((s) => s.setComposeAssunto);
  const setComposeAnexos = useAppStore((s) => s.setComposeAnexos);
  // Templates saem do store único (#135): fonte da verdade compartilhada com a
  // Settings, sempre em dia sem cópia local que envelheceria.
  const templates = useAppStore((s) => s.templates);
  const assinaturaPadrao = useAppStore((s) =>
    s.assinaturas.find((assinatura) => assinatura.id === s.assinaturaPadraoId)
  );
  const assinaturaInicial =
    assinaturaPadrao &&
    (contextoAssinatura === "novo" || assinaturaPadrao.usarEmRespostas)
      ? assinaturaPadrao.corpo
      : null;
  // Destinatários como `Pessoa` (nome/foto), reportados pelos campos, para
  // alimentar o autocomplete de menção @ no corpo (#106).
  const [pessoasPara, setPessoasPara] = useState<Pessoa[]>([]);
  const [pessoasCc, setPessoasCc] = useState<Pessoa[]>([]);
  const [pessoasCco, setPessoasCco] = useState<Pessoa[]>([]);
  const [mostrarCcCco, setMostrarCcCco] = useState(false);
  const [compartilhando, setCompartilhando] = useState(false);

  // O uploader (c-file-upload-9) é a fonte da lista visível; `anexos` (o que vai
  // no envio) é DERIVADO de forma síncrona a partir de `arquivos` (o estado do
  // uploader, fonte da verdade de ordem/pertencimento) casado com um cache
  // estável por id de arquivo. Como o base64 é assíncrono, cada conversão grava
  // no cache por id e bumpa `cacheVersao` para reprojetar `anexos` na próxima
  // renderização — sem depender de nenhum ref de lista possivelmente defasado,
  // que era a fonte da corrida entre o picker do Tauri e a sincronização.
  const anexosCacheRef = useRef<Map<string, AnexoEnvio>>(new Map());
  const [cacheVersao, setCacheVersao] = useState(0);

  /** Converte cada `File` novo para base64 e grava no cache, indexado por id. */
  const aoAdicionarArquivos = useCallback(
    async (adicionados: FileWithPreview[]) => {
      await Promise.all(
        adicionados.map(async (item) => {
          // Só arquivos reais (do drop/browse/picker) têm bytes para converter.
          if (item.file instanceof File) {
            const bytes = new Uint8Array(await item.file.arrayBuffer());
            anexosCacheRef.current.set(item.id, {
              nome: item.file.name,
              tipo: item.file.type || tipoPorNome(item.file.name),
              conteudoB64: bytesParaB64(bytes),
            });
          }
        })
      );
      // Novos base64 no cache: força reprojetar `anexos` na próxima renderização.
      setCacheVersao((v) => v + 1);
    },
    []
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
  });

  // `anexos` sai sempre da lista atual do uploader (`arquivos`) casada com o
  // cache por id. Todo arquivo já convertido entra assim que sua renderização
  // ocorre — nunca omitido por leitura de ref defasada — e remover/limpar some
  // do envio na hora, porque some de `arquivos`.
  const anexos = useMemo(() => {
    // A versão invalida a projeção quando a conversão base64 termina; os bytes
    // vivem no ref para não duplicar arquivos grandes no estado do uploader.
    void cacheVersao;
    return arquivos
      .map((f) => anexosCacheRef.current.get(f.id))
      .filter((a): a is AnexoEnvio => Boolean(a));
  }, [arquivos, cacheVersao]);

  // A lista pronta para envio é domínio do rascunho; drag/drop, previews,
  // erros e o cache base64 continuam internos ao uploader.
  useEffect(() => {
    setComposeAnexos(anexos);
  }, [anexos, setComposeAnexos]);

  // Poda o cache de arquivos removidos (remover/limpar) para não vazar memória.
  useEffect(() => {
    const ids = new Set(arquivos.map((f) => f.id));
    for (const id of [...anexosCacheRef.current.keys()]) {
      if (!ids.has(id)) anexosCacheRef.current.delete(id);
    }
  }, [arquivos]);

  // Destinatários mencionáveis: união (sem repetir e-mail) de Para/Cc/Cco. É a
  // fonte dos itens do autocomplete de menção @ no corpo (#106).
  const mencionaveis = useMemo<Pessoa[]>(() => {
    const vistos = new Set<string>();
    const out: Pessoa[] = [];
    for (const p of [...pessoasPara, ...pessoasCc, ...pessoasCco]) {
      const chave = p.email.trim().toLowerCase();
      if (!chave || vistos.has(chave)) continue;
      vistos.add(chave);
      out.push(p);
    }
    return out;
  }, [pessoasPara, pessoasCc, pessoasCco]);

  const editor = usePlateEditor({
    plugins: [...COMPOSE_KIT, ...MENCAO_KIT],
    value: (editor) => valorInicialCompose(editor, assinaturaInicial),
  });
  const edRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    getPara: () => para,
    getCc: () => cc,
    getCco: () => cco,
    getAssunto: () => assunto,
    getHtml: () => edRef.current?.innerHTML ?? "",
    getTexto: () => edRef.current?.textContent ?? "",
    getAnexos: () => useAppStore.getState().composeAnexos,
  }));

  /** Insere blocos novos no fim do corpo (assinatura, link etc.). */
  function inserirNoFim(nodes: TElement[]) {
    editor.tf.insertNodes(nodes, { at: [editor.children.length] });
  }

  /**
   * Insere a assinatura padrão ao final do corpo. A padrão vive no store (#135)
   * como HTML do próprio Plate — basta desserializar de volta, igual ao
   * template. Sem padrão definida, cai numa assinatura simples em texto.
   */
  function inserirAssinatura() {
    const { assinaturas, assinaturaPadraoId } = useAppStore.getState();
    const padrao = assinaturas.find((a) => a.id === assinaturaPadraoId);
    if (padrao && padrao.corpo.trim()) {
      const nodes = desserializarBlocosPlate(editor, padrao.corpo);
      if (nodes.length > 0) {
        inserirNoFim(nodes);
        return;
      }
    }
    const linhas = ASSINATURA_FALLBACK.split(/\r?\n/);
    inserirNoFim(
      linhas.map((linha) => ({ type: "p", children: [{ text: linha }] }))
    );
  }

  /**
   * Insere o corpo de um template ao final da mensagem. O template é salvo como
   * HTML do próprio Plate, então basta desserializar de volta pelos mesmos
   * plugins (COMPOSE_KIT) — os blocos voltam formatados, não como texto cru.
   */
  function inserirTemplate(tpl: TemplateEmail) {
    // O corpo sai sempre do editor de templates, que é um Plate: o nível de
    // cima é sempre bloco, nunca texto solto.
    const nodes = editor.api.html.deserialize({
      element: tpl.corpo,
    }) as TElement[];
    if (nodes.length === 0) return;
    inserirNoFim(nodes);
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
      toast.error(t.compose.falhaAnexar, { description: String(e) });
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
        arqs.length > 1
          ? preencher(t.compose.linksInseridos, { n: arqs.length })
          : preencher(t.compose.linkInserido, { nome: arqs[0]?.nome ?? "" })
      );
    } catch (e) {
      toast.error(t.compose.falhaOneDrive, {
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
              <CampoPessoas
                rotulo={textos.para}
                valor={para}
                onChange={setPara}
                onPessoas={setPessoasPara}
              />
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
                <CampoPessoas
                  rotulo={textos.cc}
                  valor={cc}
                  onChange={setCc}
                  onPessoas={setPessoasCc}
                />
              </div>
              <div className="border-b">
                <CampoPessoas
                  rotulo={textos.cco}
                  valor={cco}
                  onChange={setCco}
                  onPessoas={setPessoasCco}
                />
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

      {/* Toolbar + corpo dentro do Plate para os botões mirarem o editor.
          O provider expõe os destinatários atuais (Para/Cc/Cco) ao autocomplete
          de menção @ do corpo (#106). */}
      <MencionaveisProvider pessoas={mencionaveis}>
      <Plate editor={editor}>
        <FixedToolbar className="justify-start rounded-none border-b bg-background">
          <ShortcutMarkToolbarButton
            nodeType={KEYS.bold}
            label={t.compose.negrito}
            shortcut={{ primary: true, key: "B" }}
          >
            <BoldIcon />
          </ShortcutMarkToolbarButton>
          <ShortcutMarkToolbarButton
            nodeType={KEYS.italic}
            label={t.compose.italico}
            shortcut={{ primary: true, key: "I" }}
          >
            <ItalicIcon />
          </ShortcutMarkToolbarButton>
          <ShortcutMarkToolbarButton
            nodeType={KEYS.underline}
            label={t.compose.sublinhado}
            shortcut={{ primary: true, key: "U" }}
          >
            <UnderlineIcon />
          </ShortcutMarkToolbarButton>
          <ShortcutMarkToolbarButton
            nodeType={KEYS.strikethrough}
            label={t.compose.tachado}
            shortcut={{ primary: true, shift: true, key: "M" }}
          >
            <StrikethroughIcon />
          </ShortcutMarkToolbarButton>
          <BulletedListToolbarButton />
          <LinkToolbarButton />
          <ToolbarButton
            tooltip={t.compose.inserirAssinatura}
            aria-label={t.compose.inserirAssinatura}
            onClick={inserirAssinatura}
          >
            <PenToolIcon />
          </ToolbarButton>
          {/* Templates: lista o que está salvo em Configurações e insere no fim. */}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <ToolbarButton
                tooltip={t.templates.inserir}
                aria-label={t.templates.inserir}
                isDropdown
              >
                <FileType2Icon />
              </ToolbarButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="ignore-click-outside/toolbar min-w-48"
              align="start"
            >
              {templates.length === 0 ? (
                <DropdownMenuItem disabled>
                  {t.templates.semTemplates}
                </DropdownMenuItem>
              ) : (
                templates.map((tpl) => (
                  <DropdownMenuItem
                    key={tpl.id}
                    onSelect={() => inserirTemplate(tpl)}
                  >
                    <span className="truncate">{tpl.nome}</span>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <ToolbarButton
            tooltip={t.compose.anexarArquivo}
            aria-label={t.compose.anexarArquivo}
            onClick={anexarArquivo}
          >
            <AttachFileIcon />
          </ToolbarButton>
          <ToolbarButton
            tooltip={t.compose.compartilharOneDrive}
            aria-label={t.compose.compartilharOneDrive}
            onClick={compartilharOneDrive}
            disabled={compartilhando}
          >
            <OneDriveIcon />
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
                  {t.compose.arrasteArquivos}{" "}
                  <button
                    type="button"
                    onClick={openFileDialog}
                    className="text-primary cursor-pointer underline-offset-4 hover:underline"
                  >
                    {t.compose.selecione}
                  </button>
                </p>
                <p className="text-muted-foreground text-xs">
                  {preencher(t.compose.limites, {
                    tam: formatBytes(MAX_TAMANHO),
                    max: MAX_ARQUIVOS,
                  })}
                </p>
              </div>
            </div>
          </div>

          {/* Grid de arquivos */}
          {arquivos.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">
                  {preencher(t.compose.anexosTitulo, { n: arquivos.length })}
                </h3>
                <div className="flex gap-2">
                  <Button onClick={openFileDialog} variant="outline" size="sm">
                    <UploadCloudIcon />
                    {t.compose.adicionar}
                  </Button>
                  <Button onClick={clearFiles} variant="outline" size="sm">
                    <Trash2Icon />
                    {t.compose.removerTodos}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-4 lg:grid-cols-6">
                {arquivos.map((fileItem) => (
                  <div key={fileItem.id} className="group/item relative">
                    {/* Botão remover (#103): tooltip canônico; o nome acessível
                        (aria-label com o arquivo) já existia — só faltava a dica
                        visual. Mesmo texto nos dois, sem inventar cópia nova. */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          onClick={() => removeFile(fileItem.id)}
                          variant="outline"
                          size="icon"
                          aria-label={preencher(t.compose.remover, {
                            nome: fileItem.file.name,
                          })}
                          className="absolute -end-2 -top-2 z-10 size-6 rounded-full opacity-0 transition-opacity group-hover/item:opacity-100 dark:bg-zinc-800 hover:dark:bg-zinc-700"
                        >
                          <XIcon className="size-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {preencher(t.compose.remover, {
                          nome: fileItem.file.name,
                        })}
                      </TooltipContent>
                    </Tooltip>

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
      </MencionaveisProvider>
    </div>
  );
});
