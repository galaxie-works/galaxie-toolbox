import { forwardRef, useImperativeHandle, useRef } from "react";
import { Plate, usePlateEditor } from "platejs/react";

import { Editor, EditorContainer } from "@/components/ui/editor";
import { BasicNodesKit } from "@/components/editor/plugins/basic-nodes-kit";
import { ListKit } from "@/components/editor/plugins/list-kit";
import { LinkKit } from "@/components/editor/plugins/link-kit";
import { AutoformatKit } from "@/components/editor/plugins/autoformat-kit";
import { cn } from "@/lib/utils";

/**
 * Editor de compose do e-mail — usa o componente Plate (do bloco @plate/editor-ai)
 * com um conjunto enxuto de plugins: formatação básica, listas, links e
 * autoformat (atalhos markdown). Sem IA/upload/tabela — que exigiriam backend e
 * são exagero para responder um e-mail.
 *
 * O corpo sai como HTML lido direto do DOM editável (`[data-slate-editor]`), que
 * é o que o Graph espera em `body.contentType = HTML`.
 */
export interface ComporHandle {
  getHtml: () => string;
  getTexto: () => string;
}

const COMPOSE_KIT = [...BasicNodesKit, ...ListKit, ...LinkKit, ...AutoformatKit];

export const ComporEmail = forwardRef<
  ComporHandle,
  { className?: string; placeholder?: string }
>(function ComporEmail({ className, placeholder }, ref) {
  const editor = usePlateEditor({
    plugins: COMPOSE_KIT,
    value: [{ type: "p", children: [{ text: "" }] }],
  });
  const edRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    getHtml: () => edRef.current?.innerHTML ?? "",
    getTexto: () => edRef.current?.textContent ?? "",
  }));

  return (
    <Plate editor={editor}>
      <EditorContainer className={cn("rounded-md border", className)}>
        <Editor
          ref={edRef}
          variant="none"
          placeholder={placeholder}
          className="max-h-64 min-h-32 overflow-auto px-3 py-2 text-sm"
        />
      </EditorContainer>
    </Plate>
  );
});
