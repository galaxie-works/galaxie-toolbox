import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { KEYS, type TElement } from "platejs";
import { Plate, usePlateEditor } from "platejs/react";
import {
  BoldIcon,
  ItalicIcon,
  PaperclipIcon,
  PenLineIcon,
  StrikethroughIcon,
  UnderlineIcon,
  UploadCloudIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

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

  /** Anexa um arquivo local (fileAttachment): lê os bytes e guarda em base64. */
  async function anexarArquivo() {
    try {
      const arqs = await escolherArquivos();
      if (arqs.length === 0) return;
      const novos: AnexoEnvio[] = arqs.map((arq) => ({
        nome: arq.nome,
        tipo: tipoPorNome(arq.nome),
        conteudoB64: bytesParaB64(arq.bytes),
      }));
      setAnexos((atual) => [...atual, ...novos]);
      toast.success(
        novos.length > 1 ? `${novos.length} arquivos anexados` : `Anexado: ${novos[0].nome}`
      );
    } catch (e) {
      toast.error("Falha ao anexar o arquivo", { description: String(e) });
    }
  }

  function removerAnexo(indice: number) {
    setAnexos((atual) => atual.filter((_, i) => i !== indice));
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

        {/* Chips dos anexos, removíveis. Só aparece quando há algum. */}
        {anexos.length > 0 && (
          <div className="flex flex-wrap gap-2 border-b px-3 py-2">
            {anexos.map((a, i) => (
              <span
                key={`${a.nome}-${i}`}
                className="inline-flex items-center gap-1.5 rounded-md border bg-muted/50 px-2 py-1 text-xs"
              >
                <PaperclipIcon className="size-3 shrink-0 text-muted-foreground" />
                <span className="max-w-40 truncate">{a.nome}</span>
                <button
                  type="button"
                  aria-label={`Remover ${a.nome}`}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() => removerAnexo(i)}
                >
                  <XIcon className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <EditorContainer className={cn("min-h-0 flex-1 overflow-auto")}>
          <Editor
            ref={edRef}
            variant="none"
            placeholder={textos.corpoPlaceholder}
            className="min-h-40 px-3 py-2 text-sm"
          />
        </EditorContainer>
      </Plate>
    </div>
  );
});
