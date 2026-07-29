import { useRef, useState } from "react";
import { KEYS } from "platejs";
import { Plate, usePlateEditor } from "platejs/react";
import {
  BoldIcon,
  ChevronDownIcon,
  CheckIcon,
  ItalicIcon,
  PencilIcon,
  PlusIcon,
  SignatureIcon,
  StrikethroughIcon,
  Trash2Icon,
  UnderlineIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Field } from "@/components/ui/field";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { FramePanel } from "@/components/reui/frame";
import { Editor, EditorContainer } from "@/components/ui/editor";
import { FixedToolbar } from "@/components/ui/fixed-toolbar";
import { MarkToolbarButton } from "@/components/ui/mark-toolbar-button";
import { BulletedListToolbarButton } from "@/components/ui/list-toolbar-button";
import { LinkToolbarButton } from "@/components/ui/link-toolbar-button";
import { COMPOSE_KIT } from "@/components/compose/compose-kit";
import { useAppStore } from "@/store";
import type { Assinatura } from "@/store/bridge-slice";
import type { TemplateEmail } from "@/lib/templates";

/** Largura ~33% da Sheet (padrão dos painéis laterais da Settings do #135). */
const SHEET_33 = "flex w-[33%] flex-col gap-0 p-0 sm:max-w-[33vw]";

/**
 * Normaliza o HTML capturado do Plate via `innerHTML` (#144).
 *
 * Quando o editor está vazio, o `innerHTML` não é HTML de verdade: é a marcação
 * interna do Slate no estado vazio — o span do placeholder (`data-slate-placeholder`)
 * e os spans zero-width (`data-slate-zero-width`). Persistir isso e depois
 * desserializar de volta no `usePlateEditor` gera uma árvore de nós inválida que
 * quebra o render do Plate (erro `<Element>`), desmontando o app inteiro (tela
 * branca; só o F5 recupera).
 *
 * Aqui removemos esses artefatos internos: se não sobra conteúdo real (texto ou
 * mídia), devolvemos "" (vazio seguro, que o editor abre como `<p></p>`); caso
 * contrário, devolvemos o HTML já limpo desses resquícios, deixando o corpo
 * robusto para reabrir na edição mesmo se veio parcialmente sujo.
 */
function normalizarCorpo(html: string): string {
  if (!html || !html.trim()) return "";
  // Fora do browser (SSR/teste) não há DOM p/ inspecionar; devolve como veio.
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
 * Editor rico compartilhado (assinaturas e templates). Mesmo Plate do compose:
 * o HTML sai do próprio DOM editável (`innerHTML`), formato que o Graph espera.
 * O `usePlateEditor` memoriza o editor, então quem usa precisa de `key` por
 * item para remontar com o corpo certo ao trocar de edição.
 */
function EditorCorpo({
  valorInicial,
  placeholder,
  refCorpo,
}: {
  valorInicial: string;
  placeholder: string;
  refCorpo: React.RefObject<HTMLDivElement | null>;
}) {
  const editor = usePlateEditor({
    plugins: COMPOSE_KIT,
    // Guarda de compat (#144): corpos já salvos com a marcação vazia do Slate
    // quebrariam o Plate ao reabrir. Normaliza antes de desserializar; vazio
    // vira `<p></p>`, o que o editor abre em branco sem crashar.
    value: normalizarCorpo(valorInicial) || "<p></p>",
  });

  return (
    <Plate editor={editor}>
      <FixedToolbar className="justify-start rounded-none border-b bg-background">
        <MarkToolbarButton nodeType={KEYS.bold} tooltip="Bold (⌘+B)">
          <BoldIcon />
        </MarkToolbarButton>
        <MarkToolbarButton nodeType={KEYS.italic} tooltip="Italic (⌘+I)">
          <ItalicIcon />
        </MarkToolbarButton>
        <MarkToolbarButton nodeType={KEYS.underline} tooltip="Underline (⌘+U)">
          <UnderlineIcon />
        </MarkToolbarButton>
        <MarkToolbarButton
          nodeType={KEYS.strikethrough}
          tooltip="Strikethrough (⌘+⇧+M)"
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

// ===========================================================================
// Card 1 — Signatures
// ===========================================================================

/** Edição em curso de uma assinatura; `id: null` = nova. */
interface EdicaoAssinatura {
  id: string | null;
  nome: string;
  corpo: string;
  padrao: boolean;
  usarEmRespostas: boolean;
}

const ROTULO_SEM_PADRAO = "No default signature";

/**
 * Stacked card das assinaturas (#135). Label + descrição à esquerda; à direita
 * um ButtonGroup (c-button-group-7): dropdown listando as assinaturas com a
 * padrão marcada + "No default signature" ao final (separator acima), e os
 * botões + / editar / excluir. Add/editar abrem numa Sheet ~33% com nome, o
 * editor rico e o switch "Set as default signature".
 */
export function SignaturesPanel() {
  const assinaturas = useAppStore((s) => s.assinaturas);
  const assinaturaPadraoId = useAppStore((s) => s.assinaturaPadraoId);
  const adicionarAssinatura = useAppStore((s) => s.adicionarAssinatura);
  const atualizarAssinatura = useAppStore((s) => s.atualizarAssinatura);
  const removerAssinatura = useAppStore((s) => s.removerAssinatura);
  const definirAssinaturaPadrao = useAppStore((s) => s.definirAssinaturaPadrao);

  const [edicao, setEdicao] = useState<EdicaoAssinatura | null>(null);
  const [excluindoId, setExcluindoId] = useState<string | null>(null);
  const corpoRef = useRef<HTMLDivElement>(null);

  const padrao = assinaturas.find((a) => a.id === assinaturaPadraoId) ?? null;
  const excluindo = assinaturas.find((a) => a.id === excluindoId) ?? null;

  function abrirNova() {
    setEdicao({
      id: null,
      nome: "",
      corpo: "",
      // Primeira assinatura já entra como padrão; as demais, opcionais.
      padrao: assinaturas.length === 0,
      usarEmRespostas: false,
    });
  }

  function abrirEdicao(a: Assinatura) {
    setEdicao({
      id: a.id,
      nome: a.nome,
      corpo: a.corpo,
      padrao: a.id === assinaturaPadraoId,
      usarEmRespostas: a.usarEmRespostas,
    });
  }

  function salvar() {
    if (!edicao) return;
    const nome = edicao.nome.trim();
    if (!nome) return;
    // Normaliza o corpo (#144): editor vazio captura só a marcação interna do
    // Slate; persistir isso derruba o app ao reabrir. Vazio → "".
    const corpo = normalizarCorpo(corpoRef.current?.innerHTML ?? "");
    if (edicao.id) {
      atualizarAssinatura(edicao.id, {
        nome,
        corpo,
        padrao: edicao.padrao,
        usarEmRespostas: edicao.usarEmRespostas,
      });
    } else {
      adicionarAssinatura({
        nome,
        corpo,
        padrao: edicao.padrao,
        usarEmRespostas: edicao.usarEmRespostas,
      });
    }
    setEdicao(null);
    toast.success("Signature saved");
  }

  function excluir() {
    if (!excluindoId) return;
    removerAssinatura(excluindoId);
    if (edicao?.id === excluindoId) setEdicao(null);
    setExcluindoId(null);
    toast.success("Signature deleted");
  }

  return (
    <FramePanel>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Signatures</h3>
          <p className="text-sm text-muted-foreground">
            Manage your email signatures and pick the default used in Bridge.
          </p>
        </div>

        <ButtonGroup className="shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-56 justify-start gap-2">
                <SignatureIcon aria-hidden="true" className="size-4" />
                <span className="truncate">
                  {padrao ? padrao.nome : ROTULO_SEM_PADRAO}
                </span>
                <ChevronDownIcon
                  aria-hidden="true"
                  className="ml-auto size-3.5 opacity-60"
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Default signature</DropdownMenuLabel>
                {assinaturas.map((a) => (
                  <DropdownMenuItem
                    key={a.id}
                    onSelect={() => definirAssinaturaPadrao(a.id)}
                  >
                    <SignatureIcon aria-hidden="true" className="size-4" />
                    <span className="truncate">{a.nome}</span>
                    {a.id === assinaturaPadraoId && (
                      <CheckIcon
                        aria-hidden="true"
                        className="ml-auto size-3.5 text-primary"
                      />
                    )}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => definirAssinaturaPadrao(null)}>
                  <span>{ROTULO_SEM_PADRAO}</span>
                  {assinaturaPadraoId === null && (
                    <CheckIcon
                      aria-hidden="true"
                      className="ml-auto size-3.5 text-primary"
                    />
                  )}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="outline"
            size="icon"
            aria-label="Add signature"
            onClick={abrirNova}
          >
            <PlusIcon aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Edit signature"
            disabled={!padrao}
            onClick={() => padrao && abrirEdicao(padrao)}
          >
            <PencilIcon aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Delete signature"
            disabled={!padrao}
            onClick={() => padrao && setExcluindoId(padrao.id)}
          >
            <Trash2Icon aria-hidden="true" />
          </Button>
        </ButtonGroup>
      </div>

      {/* Add/editar assinatura numa Sheet ~33%. `key` por assinatura para o
          Plate remontar com o corpo certo. */}
      <Sheet
        open={edicao !== null}
        onOpenChange={(aberto) => !aberto && setEdicao(null)}
      >
        <SheetContent side="right" className={SHEET_33}>
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="text-left">
              {edicao?.id ? "Edit signature" : "New signature"}
            </SheetTitle>
          </SheetHeader>

          {edicao && (
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
              <div className="grid gap-2">
                <Label htmlFor="assinatura-nome">Name</Label>
                <Input
                  id="assinatura-nome"
                  value={edicao.nome}
                  placeholder="e.g. Work signature"
                  onChange={(e) =>
                    setEdicao((atual) =>
                      atual ? { ...atual, nome: e.target.value } : atual
                    )
                  }
                />
              </div>

              <div className="grid gap-2">
                <Label>Signature</Label>
                <div className="overflow-hidden rounded-md border">
                  <EditorCorpo
                    key={edicao.id ?? "nova"}
                    refCorpo={corpoRef}
                    valorInicial={edicao.corpo}
                    placeholder="Write your signature..."
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Set as default signature</p>
                  <p className="text-sm text-muted-foreground">
                    Use this signature in Bridge emails.
                  </p>
                </div>
                <Switch
                  checked={edicao.padrao}
                  onCheckedChange={(checked) =>
                    setEdicao((atual) =>
                      atual ? { ...atual, padrao: checked } : atual
                    )
                  }
                />
              </div>

              <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    Use for replies and forwardings
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Auto insert this signature in replies and forwardings.
                  </p>
                </div>
                <Switch
                  checked={edicao.usarEmRespostas}
                  onCheckedChange={(checked) =>
                    setEdicao((atual) =>
                      atual ? { ...atual, usarEmRespostas: checked } : atual
                    )
                  }
                />
              </div>
            </div>
          )}

          <SheetFooter className="flex-row justify-end gap-2 border-t px-4 py-3">
            {edicao?.id && (
              <Button
                variant="ghost"
                className="mr-auto text-destructive hover:text-destructive"
                onClick={() => setExcluindoId(edicao.id)}
              >
                <Trash2Icon /> Delete
              </Button>
            )}
            <Button variant="outline" onClick={() => setEdicao(null)}>
              Cancel
            </Button>
            <Button onClick={salvar} disabled={!edicao?.nome.trim()}>
              Save
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Exclusão destrutiva, sem desfazer: confirma no AlertDialog. */}
      <AlertDialog
        open={excluindoId !== null}
        onOpenChange={(aberto) => !aberto && setExcluindoId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete signature?</AlertDialogTitle>
            <AlertDialogDescription>
              “{excluindo?.nome ?? ""}” will be removed from this computer. This
              can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="ghost">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={excluir}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FramePanel>
  );
}

// ===========================================================================
// Card 2 — Email templates
// ===========================================================================

/** Edição em curso de um template; `id: null` = novo. */
interface EdicaoTemplate {
  id: string | null;
  nome: string;
  descricao: string;
  corpo: string;
}

/** Valor sentinela do item "Add new template" no seletor. */
const ADD_TEMPLATE = "__add_template__";

/** Ilustração do estado vazio (c-empty-15 literal). */
function StackedCardsIllustration() {
  return (
    <div className="relative h-24 w-52" aria-hidden="true">
      <div className="bg-muted/60 dark:bg-muted/30 border-border/50 absolute inset-x-6 top-0 h-6 rounded-t-lg border" />
      <div className="bg-muted/80 dark:bg-muted/50 border-border/60 absolute inset-x-3 top-3 h-6 rounded-t-lg border" />
      <div className="bg-background border-border absolute inset-x-0 top-6 flex h-16 items-center gap-3 rounded-lg border px-4 shadow-sm">
        <div className="bg-muted size-8 shrink-0 rounded" />
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="bg-muted h-2.5 w-3/4 rounded" />
          <div className="bg-muted/60 h-2 w-1/2 rounded" />
        </div>
      </div>
      <div className="from-background/0 via-background/60 to-background pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-b" />
    </div>
  );
}

/**
 * Stacked card dos templates (#135). Label + descrição à esquerda; à direita um
 * botão "View" que abre uma Sheet ~33%. Dentro: sem templates → c-empty-15 +
 * "Add new template"; com templates → seletor c-select-6 (título+descrição, sem
 * check) + "Add new template" (separator acima). Selecionar abre o editor na
 * mesma Sheet: nome, descrição, editor rico, Save/Cancel/Delete.
 */
export function EmailTemplatesPanel() {
  const templates = useAppStore((s) => s.templates);
  const adicionarTemplate = useAppStore((s) => s.adicionarTemplate);
  const atualizarTemplate = useAppStore((s) => s.atualizarTemplate);
  const removerTemplate = useAppStore((s) => s.removerTemplate);

  const [sheetAberta, setSheetAberta] = useState(false);
  const [edicao, setEdicao] = useState<EdicaoTemplate | null>(null);
  const [excluindoId, setExcluindoId] = useState<string | null>(null);
  const corpoRef = useRef<HTMLDivElement>(null);

  const excluindo = templates.find((t) => t.id === excluindoId) ?? null;

  function fecharSheet(aberto: boolean) {
    setSheetAberta(aberto);
    if (!aberto) setEdicao(null);
  }

  function abrirNovo() {
    setEdicao({ id: null, nome: "", descricao: "", corpo: "" });
  }

  function abrirEdicao(tpl: TemplateEmail) {
    setEdicao({
      id: tpl.id,
      nome: tpl.nome,
      descricao: tpl.descricao,
      corpo: tpl.corpo,
    });
  }

  function selecionar(valor: string) {
    if (valor === ADD_TEMPLATE) {
      abrirNovo();
      return;
    }
    const tpl = templates.find((t) => t.id === valor);
    if (tpl) abrirEdicao(tpl);
  }

  function salvar() {
    if (!edicao) return;
    const nome = edicao.nome.trim();
    if (!nome) return;
    const descricao = edicao.descricao.trim();
    // Mesmo tratamento das assinaturas (#144): normaliza o corpo vazio do Plate.
    const corpo = normalizarCorpo(corpoRef.current?.innerHTML ?? "");
    if (edicao.id) {
      atualizarTemplate(edicao.id, { nome, descricao, corpo });
    } else {
      adicionarTemplate({ nome, descricao, corpo });
    }
    setEdicao(null);
    toast.success("Template saved");
  }

  function excluir() {
    if (!excluindoId) return;
    removerTemplate(excluindoId);
    if (edicao?.id === excluindoId) setEdicao(null);
    setExcluindoId(null);
    toast.success("Template deleted");
  }

  return (
    <FramePanel>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Email templates</h3>
          <p className="text-sm text-muted-foreground">
            Reusable message templates you can insert while composing in Bridge.
          </p>
        </div>
        <Button
          variant="outline"
          className="shrink-0"
          onClick={() => setSheetAberta(true)}
        >
          View
        </Button>
      </div>

      <Sheet open={sheetAberta} onOpenChange={fecharSheet}>
        <SheetContent side="right" className={SHEET_33}>
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="text-left">Email templates</SheetTitle>
            <SheetDescription className="text-left">
              {edicao
                ? "Edit the template name, description and body."
                : "Pick a template to edit, or add a new one."}
            </SheetDescription>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
            {edicao ? (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="template-nome">Name</Label>
                  <Input
                    id="template-nome"
                    value={edicao.nome}
                    placeholder="e.g. Support reply"
                    onChange={(e) =>
                      setEdicao((atual) =>
                        atual ? { ...atual, nome: e.target.value } : atual
                      )
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="template-descricao">Description</Label>
                  <Input
                    id="template-descricao"
                    value={edicao.descricao}
                    placeholder="Short summary shown in the picker"
                    onChange={(e) =>
                      setEdicao((atual) =>
                        atual ? { ...atual, descricao: e.target.value } : atual
                      )
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Body</Label>
                  <div className="overflow-hidden rounded-md border">
                    <EditorCorpo
                      key={edicao.id ?? "novo"}
                      refCorpo={corpoRef}
                      valorInicial={edicao.corpo}
                      placeholder="Write the template content..."
                    />
                  </div>
                </div>
              </>
            ) : templates.length === 0 ? (
              <Empty className="py-12">
                <EmptyHeader>
                  <EmptyMedia>
                    <StackedCardsIllustration />
                  </EmptyMedia>
                  <EmptyTitle>No templates</EmptyTitle>
                  <EmptyDescription>
                    You don’t have any templates yet. Create one to reuse the
                    messages you send often.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button onClick={abrirNovo}>
                    <PlusIcon /> Add new template
                  </Button>
                </EmptyContent>
              </Empty>
            ) : (
              <Field>
                <Label>Templates</Label>
                <Select value="" onValueChange={selecionar}>
                  <SelectTrigger className="h-auto! w-full">
                    <SelectValue placeholder="Select a template" />
                  </SelectTrigger>
                  <SelectContent position="popper" align="end">
                    <SelectGroup>
                      {templates.map((tpl) => (
                        <SelectItem key={tpl.id} value={tpl.id}>
                          <Item size="xs" className="w-full p-0">
                            <ItemContent className="gap-0">
                              <ItemTitle>{tpl.nome}</ItemTitle>
                              {tpl.descricao && (
                                <ItemDescription className="text-xs">
                                  {tpl.descricao}
                                </ItemDescription>
                              )}
                            </ItemContent>
                          </Item>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                    <SelectSeparator />
                    <SelectItem value={ADD_TEMPLATE}>
                      <span className="flex items-center gap-2">
                        <PlusIcon aria-hidden="true" className="size-4" />
                        Add new template
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            )}
          </div>

          {edicao && (
            <SheetFooter className="flex-row justify-end gap-2 border-t px-4 py-3">
              {edicao.id && (
                <Button
                  variant="ghost"
                  className="mr-auto text-destructive hover:text-destructive"
                  onClick={() => setExcluindoId(edicao.id)}
                >
                  <Trash2Icon /> Delete
                </Button>
              )}
              <Button variant="outline" onClick={() => setEdicao(null)}>
                Cancel
              </Button>
              <Button onClick={salvar} disabled={!edicao.nome.trim()}>
                Save
              </Button>
            </SheetFooter>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={excluindoId !== null}
        onOpenChange={(aberto) => !aberto && setExcluindoId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template?</AlertDialogTitle>
            <AlertDialogDescription>
              “{excluindo?.nome ?? ""}” will be removed from this computer. This
              can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="ghost">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={excluir}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FramePanel>
  );
}
