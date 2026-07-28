import { useRef, useState } from "react";
import { KEYS } from "platejs";
import { Plate, usePlateEditor } from "platejs/react";
import {
  BoldIcon,
  FileTextIcon,
  ItalicIcon,
  PencilIcon,
  PlusIcon,
  StrikethroughIcon,
  Trash2Icon,
  UnderlineIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Editor, EditorContainer } from "@/components/ui/editor";
import { FixedToolbar } from "@/components/ui/fixed-toolbar";
import { MarkToolbarButton } from "@/components/ui/mark-toolbar-button";
import { BulletedListToolbarButton } from "@/components/ui/list-toolbar-button";
import { LinkToolbarButton } from "@/components/ui/link-toolbar-button";
import { COMPOSE_KIT } from "@/components/compose/compose-kit";
import { preencher, useIdioma } from "@/lib/idioma";
import {
  novoIdTemplate,
  useTemplates,
  type TemplateEmail,
} from "@/lib/templates";

/**
 * Corpo do template no mesmo Plate do compose. O HTML sai do próprio DOM
 * editável (`innerHTML`), igual ao `getHtml()` do compose — é o formato que o
 * Graph espera e o que a inserção no compose desserializa de volta.
 *
 * O `usePlateEditor` memoriza o editor, então o valor inicial só vale na
 * montagem: quem usa este componente precisa dar um `key` diferente por
 * template para ele remontar ao trocar de edição.
 */
function CorpoTemplate({
  valorInicial,
  placeholder,
  refCorpo,
}: {
  valorInicial: string;
  placeholder: string;
  /** Ref do contenteditable: é dele que sai o HTML na hora de salvar. */
  refCorpo: React.RefObject<HTMLDivElement | null>;
}) {
  // String = HTML: o Plate desserializa sozinho na inicialização.
  const editor = usePlateEditor({
    plugins: COMPOSE_KIT,
    value: valorInicial.trim() || "<p></p>",
  });

  return (
    <Plate editor={editor}>
      <FixedToolbar className="justify-start rounded-none border-b bg-background">
        <MarkToolbarButton nodeType={KEYS.bold} tooltip="Negrito (⌘+B)">
          <BoldIcon />
        </MarkToolbarButton>
        <MarkToolbarButton nodeType={KEYS.italic} tooltip="Itálico (⌘+I)">
          <ItalicIcon />
        </MarkToolbarButton>
        <MarkToolbarButton nodeType={KEYS.underline} tooltip="Sublinhado (⌘+U)">
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

      <EditorContainer className="max-h-72 min-h-0 overflow-auto">
        <Editor
          ref={refCorpo}
          variant="none"
          placeholder={placeholder}
          className="min-h-40 px-3 py-2 text-sm"
        />
      </EditorContainer>
    </Plate>
  );
}

/** Estado do diálogo de edição: `null` = fechado. */
interface Edicao {
  /** `null` quando é um template novo (ainda sem id). */
  id: string | null;
  nome: string;
  corpo: string;
}

/**
 * CRUD dos templates de e-mail (Configurações). Tudo local, em localStorage,
 * no mesmo espírito da assinatura — não há backend envolvido.
 */
export function TemplatesEmail({ bare = false }: { bare?: boolean } = {}) {
  const { t } = useIdioma();
  const [templates, setTemplates] = useTemplates();
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const [excluindo, setExcluindo] = useState<TemplateEmail | null>(null);
  const corpoRef = useRef<HTMLDivElement>(null);

  function abrirNovo() {
    setEdicao({ id: null, nome: "", corpo: "" });
  }

  function abrirEdicao(tpl: TemplateEmail) {
    setEdicao({ id: tpl.id, nome: tpl.nome, corpo: tpl.corpo });
  }

  function salvar() {
    if (!edicao) return;
    const nome = edicao.nome.trim();
    if (!nome) return;
    const corpo = corpoRef.current?.innerHTML ?? "";

    setTemplates((atuais) =>
      edicao.id
        ? atuais.map((tpl) =>
            tpl.id === edicao.id ? { ...tpl, nome, corpo } : tpl
          )
        : [...atuais, { id: novoIdTemplate(), nome, corpo }]
    );
    setEdicao(null);
    toast.success(t.templates.salvo);
  }

  function excluir() {
    if (!excluindo) return;
    setTemplates((atuais) => atuais.filter((tpl) => tpl.id !== excluindo.id));
    setExcluindo(null);
    toast.success(t.templates.excluido);
  }

  const corpo = (
    <>
      <div
        className={
          bare
            ? "flex items-start justify-end gap-4"
            : "flex items-start justify-between gap-4"
        }
      >
        {!bare && (
          <div>
            <h2 className="text-lg font-semibold">{t.templates.titulo}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t.templates.descricao}
            </p>
          </div>
        )}
        <Button onClick={abrirNovo}>
          <PlusIcon /> {t.templates.novo}
        </Button>
      </div>

      {templates.length === 0 ? (
        <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-dashed border-border bg-muted/40 p-3.5">
          <FileTextIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            {t.templates.vazio}
          </p>
        </div>
      ) : (
        <ul className="mt-5 grid gap-2">
          {templates.map((tpl) => (
            <li
              key={tpl.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5"
            >
              <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {tpl.nome}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => abrirEdicao(tpl)}
                aria-label={`${t.templates.editar}: ${tpl.nome}`}
              >
                <PencilIcon /> {t.templates.editar}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExcluindo(tpl)}
                aria-label={`${t.templates.excluir}: ${tpl.nome}`}
              >
                <Trash2Icon /> {t.templates.excluir}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* Criar/editar. `key` por template para o Plate remontar com o corpo certo. */}
      <Dialog
        open={edicao !== null}
        onOpenChange={(aberto) => !aberto && setEdicao(null)}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {edicao?.id ? t.templates.editarTitulo : t.templates.novoTitulo}
            </DialogTitle>
            <DialogDescription>{t.templates.descricao}</DialogDescription>
          </DialogHeader>

          {edicao && (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="template-nome">{t.templates.nome}</Label>
                <Input
                  id="template-nome"
                  value={edicao.nome}
                  placeholder={t.templates.nomePlaceholder}
                  onChange={(e) =>
                    setEdicao((atual) =>
                      atual ? { ...atual, nome: e.target.value } : atual
                    )
                  }
                />
              </div>

              <div className="grid gap-2">
                <Label>{t.templates.corpo}</Label>
                <div className="overflow-hidden rounded-md border">
                  <CorpoTemplate
                    key={edicao.id ?? "novo"}
                    refCorpo={corpoRef}
                    valorInicial={edicao.corpo}
                    placeholder={t.templates.corpoPlaceholder}
                  />
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEdicao(null)}>
              {t.templates.cancelar}
            </Button>
            <Button onClick={salvar} disabled={!edicao?.nome.trim()}>
              {t.templates.salvar}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Exclusão é destrutiva e não tem desfazer: confirma no AlertDialog. */}
      <AlertDialog
        open={excluindo !== null}
        onOpenChange={(aberto) => !aberto && setExcluindo(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.templates.excluirTitulo}</AlertDialogTitle>
            <AlertDialogDescription>
              {preencher(t.templates.excluirDescricao, {
                nome: excluindo?.nome ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="ghost">
              {t.templates.cancelar}
            </AlertDialogCancel>
            <AlertDialogAction onClick={excluir}>
              {t.templates.excluir}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  return bare ? (
    corpo
  ) : (
    <div className="rounded-xl border border-border bg-card p-6">{corpo}</div>
  );
}
