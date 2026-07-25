import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { KEYS } from "platejs";
import { Plate, usePlateEditor } from "platejs/react";
import {
  BoldIcon,
  ItalicIcon,
  StrikethroughIcon,
  UnderlineIcon,
} from "lucide-react";

import { Editor, EditorContainer } from "@/components/ui/editor";
import { FixedToolbar } from "@/components/ui/fixed-toolbar";
import { MarkToolbarButton } from "@/components/ui/mark-toolbar-button";
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
  }));

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
        </FixedToolbar>

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
