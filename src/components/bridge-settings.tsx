import { useRef, useState } from "react";
import { KEYS } from "platejs";
import type { Descendant, TElement, Value } from "platejs";
import { Plate, usePlateEditor } from "platejs/react";
import type { PlateEditor } from "platejs/react";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
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
import { ShortcutMarkToolbarButton } from "@/components/ui/shortcut-mark-toolbar-button";
import { BulletedListToolbarButton } from "@/components/ui/list-toolbar-button";
import { LinkToolbarButton } from "@/components/ui/link-toolbar-button";
import { COMPOSE_KIT } from "@/components/compose/compose-kit";
import { useAppStore } from "@/store";
import {
  UNDO_SEND_DELAYS_MS,
  SYNC_INTERVALS_MINUTES,
} from "@/store/bridge-slice";
import type { Assinatura } from "@/store/bridge-slice";
import type { MarcarLidoModo } from "@/store/ui-slice";
import type { TemplateEmail } from "@/lib/templates";
import { useIdioma, preencher } from "@/lib/idioma";

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
 * Constrói o Value inicial do editor a partir do `corpo` salvo (#147).
 *
 * O `corpo` é o `innerHTML` do próprio Plate (marcação interna do Slate), então
 * ao desserializar os `<div>` de bloco do Slate não viram parágrafo e o conteúdo
 * colapsa em nós de texto/inline soltos no topo do documento. Um Value do Slate
 * exige blocos no topo — nó de texto solto no nível de bloco não tem `children`
 * e quebra o render do Plate (`Array.from(node.children)`), derrubando o app.
 *
 * Desserializamos pelo mesmo caminho robusto do compose e depois garantimos
 * blocos válidos: todo nó de texto/inline solto no topo é embrulhado num
 * parágrafo (preservando o texto e as marcas); blocos já válidos passam intactos.
 * Documento vazio vira um único parágrafo em branco.
 */
function normalizarValorEditor(editor: PlateEditor, valorInicial: string): Value {
  const html = normalizarCorpo(valorInicial) || "<p></p>";
  const nodes = editor.api.html.deserialize({ element: html }) as Descendant[];
  const blocos: Value = nodes.map((no): TElement => {
    const ehBloco =
      "children" in no && Array.isArray(no.children) && !editor.api.isInline(no);
    return ehBloco ? (no as TElement) : { type: KEYS.p, children: [no] };
  });
  return blocos.length > 0 ? blocos : [{ type: KEYS.p, children: [{ text: "" }] }];
}

/**
 * Opção da #29 no mesmo padrão canônico de preferências booleanas do app
 * (`BackgroundSettings`): Field horizontal, label/description e Switch à
 * direita. Default ON vem da decisão final do PO na #133.
 */
export function ConversationViewPanel() {
  const { t } = useIdioma();
  const agruparConversas = useAppStore((state) => state.agruparConversas);
  const setAgruparConversas = useAppStore(
    (state) => state.setAgruparConversas
  );

  return (
    <FramePanel>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="bridge-conversation-view">
            {t.settings.bridgeAgruparConversasLabel}
          </FieldLabel>
          <FieldDescription>
            {t.settings.bridgeAgruparConversasDesc}
          </FieldDescription>
        </FieldContent>
        <Switch
          id="bridge-conversation-view"
          checked={agruparConversas}
          onCheckedChange={setAgruparConversas}
        />
      </Field>
    </FramePanel>
  );
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
  const { t } = useIdioma();
  const editor = usePlateEditor({
    plugins: COMPOSE_KIT,
    // #147: o `corpo` salvo é o `innerHTML` do próprio Plate — a marcação
    // interna do Slate (`<div data-slate-node>` + spans `data-slate-*`), não
    // HTML limpo. O desserializador do Plate só reconhece tags semânticas
    // (`<p>`, `<strong>`…): os `<div>` de bloco do Slate não viram parágrafo,
    // então o corpo colapsa em nós de texto soltos no topo (sem `type`/
    // `children`). Renderizar esses "blocos" quebra o Plate em
    // `Array.from(node.children)` e derruba o app (tela branca; só o F5
    // recupera). O guard do #144 (`normalizarCorpo`) não cobria isso: com texto
    // real ele devolve o HTML sujo intacto, então valia só p/ corpo vazio.
    // Aqui desserializamos e depois garantimos blocos válidos: todo nó de texto/
    // inline solto no topo entra num parágrafo. `<p></p>` do vazio abre em
    // branco; parágrafos limpos passam direto.
    value: (editor) => normalizarValorEditor(editor, valorInicial),
  });

  return (
    <Plate editor={editor}>
      <FixedToolbar className="justify-start rounded-none border-b bg-background">
        <ShortcutMarkToolbarButton
          nodeType={KEYS.bold}
          label={t.settings.bridgeEditorNegrito}
          shortcut={{ primary: true, key: "B" }}
        >
          <BoldIcon />
        </ShortcutMarkToolbarButton>
        <ShortcutMarkToolbarButton
          nodeType={KEYS.italic}
          label={t.settings.bridgeEditorItalico}
          shortcut={{ primary: true, key: "I" }}
        >
          <ItalicIcon />
        </ShortcutMarkToolbarButton>
        <ShortcutMarkToolbarButton
          nodeType={KEYS.underline}
          label={t.settings.bridgeEditorSublinhado}
          shortcut={{ primary: true, key: "U" }}
        >
          <UnderlineIcon />
        </ShortcutMarkToolbarButton>
        <ShortcutMarkToolbarButton
          nodeType={KEYS.strikethrough}
          label={t.settings.bridgeEditorTachado}
          shortcut={{ primary: true, shift: true, key: "M" }}
        >
          <StrikethroughIcon />
        </ShortcutMarkToolbarButton>
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

/**
 * Stacked card das assinaturas (#135). Label + descrição à esquerda; à direita
 * um ButtonGroup (c-button-group-7): dropdown listando as assinaturas com a
 * padrão marcada + "No default signature" ao final (separator acima), e os
 * botões + / editar / excluir. Add/editar abrem numa Sheet ~33% com nome, o
 * editor rico e o switch "Set as default signature".
 */
export function SignaturesPanel() {
  const { t } = useIdioma();
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
    toast.success(t.settings.bridgeAssinaturaSalva);
  }

  function excluir() {
    if (!excluindoId) return;
    removerAssinatura(excluindoId);
    if (edicao?.id === excluindoId) setEdicao(null);
    setExcluindoId(null);
    toast.success(t.settings.bridgeAssinaturaExcluida);
  }

  return (
    <FramePanel>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{t.settings.bridgeAssinaturasTitulo}</h3>
          <p className="text-sm text-muted-foreground">
            {t.settings.bridgeAssinaturasDesc}
          </p>
        </div>

        <ButtonGroup className="shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-56 justify-start gap-2">
                <SignatureIcon aria-hidden="true" className="size-4" />
                <span className="truncate">
                  {padrao ? padrao.nome : t.settings.bridgeSemAssinaturaPadrao}
                </span>
                <ChevronDownIcon
                  aria-hidden="true"
                  className="ml-auto size-3.5 opacity-60"
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t.settings.bridgeAssinaturaPadraoLabel}</DropdownMenuLabel>
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
                  <span>{t.settings.bridgeSemAssinaturaPadrao}</span>
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

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                aria-label={t.settings.bridgeAssinaturaAdd}
                onClick={abrirNova}
              >
                <PlusIcon aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t.settings.bridgeAssinaturaAdd}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                aria-label={t.settings.bridgeAssinaturaEditar}
                disabled={!padrao}
                onClick={() => padrao && abrirEdicao(padrao)}
              >
                <PencilIcon aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t.settings.bridgeAssinaturaEditar}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                aria-label={t.settings.bridgeAssinaturaExcluir}
                disabled={!padrao}
                onClick={() => padrao && setExcluindoId(padrao.id)}
              >
                <Trash2Icon aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t.settings.bridgeAssinaturaExcluir}</TooltipContent>
          </Tooltip>
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
              {edicao?.id
                ? t.settings.bridgeAssinaturaEditarTitulo
                : t.settings.bridgeAssinaturaNovaTitulo}
            </SheetTitle>
          </SheetHeader>

          {edicao && (
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
              <div className="grid gap-2">
                <Label htmlFor="assinatura-nome">{t.settings.bridgeCampoNome}</Label>
                <Input
                  id="assinatura-nome"
                  value={edicao.nome}
                  placeholder={t.settings.bridgeAssinaturaNomePlaceholder}
                  onChange={(e) =>
                    setEdicao((atual) =>
                      atual ? { ...atual, nome: e.target.value } : atual
                    )
                  }
                />
              </div>

              <div className="grid gap-2">
                <Label>{t.settings.bridgeAssinaturaCampo}</Label>
                <div className="overflow-hidden rounded-md border">
                  <EditorCorpo
                    key={edicao.id ?? "nova"}
                    refCorpo={corpoRef}
                    valorInicial={edicao.corpo}
                    placeholder={t.settings.bridgeAssinaturaCorpoPlaceholder}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{t.settings.bridgeAssinaturaSetPadrao}</p>
                  <p className="text-sm text-muted-foreground">
                    {t.settings.bridgeAssinaturaSetPadraoDesc}
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
                    {t.settings.bridgeAssinaturaRespostas}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t.settings.bridgeAssinaturaRespostasDesc}
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
                <Trash2Icon /> {t.settings.bridgeBtnExcluir}
              </Button>
            )}
            <Button variant="outline" onClick={() => setEdicao(null)}>
              {t.settings.bridgeBtnCancelar}
            </Button>
            <Button onClick={salvar} disabled={!edicao?.nome.trim()}>
              {t.settings.bridgeBtnSalvar}
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
            <AlertDialogTitle>{t.settings.bridgeExcluirAssinaturaTitulo}</AlertDialogTitle>
            <AlertDialogDescription>
              {preencher(t.settings.bridgeExcluirDesc, {
                nome: excluindo?.nome ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="ghost">{t.settings.bridgeBtnCancelar}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={excluir}>
              {t.settings.bridgeBtnExcluir}
            </AlertDialogAction>
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
  const { t: tr } = useIdioma();
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
    toast.success(tr.settings.bridgeTemplateSalvo);
  }

  function excluir() {
    if (!excluindoId) return;
    removerTemplate(excluindoId);
    if (edicao?.id === excluindoId) setEdicao(null);
    setExcluindoId(null);
    toast.success(tr.settings.bridgeTemplateExcluido);
  }

  return (
    <FramePanel>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{tr.settings.bridgeTemplatesTitulo}</h3>
          <p className="text-sm text-muted-foreground">
            {tr.settings.bridgeTemplatesDesc}
          </p>
        </div>
        <Button
          variant="outline"
          className="shrink-0"
          onClick={() => setSheetAberta(true)}
        >
          {tr.settings.bridgeTemplatesView}
        </Button>
      </div>

      <Sheet open={sheetAberta} onOpenChange={fecharSheet}>
        <SheetContent side="right" className={SHEET_33}>
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="text-left">{tr.settings.bridgeTemplatesTitulo}</SheetTitle>
            <SheetDescription className="text-left">
              {edicao
                ? tr.settings.bridgeTemplateEditDesc
                : tr.settings.bridgeTemplatePickDesc}
            </SheetDescription>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
            {edicao ? (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="template-nome">{tr.settings.bridgeCampoNome}</Label>
                  <Input
                    id="template-nome"
                    value={edicao.nome}
                    placeholder={tr.settings.bridgeTemplateNomePlaceholder}
                    onChange={(e) =>
                      setEdicao((atual) =>
                        atual ? { ...atual, nome: e.target.value } : atual
                      )
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="template-descricao">{tr.settings.bridgeTemplateDescricaoLabel}</Label>
                  <Input
                    id="template-descricao"
                    value={edicao.descricao}
                    placeholder={tr.settings.bridgeTemplateDescricaoPlaceholder}
                    onChange={(e) =>
                      setEdicao((atual) =>
                        atual ? { ...atual, descricao: e.target.value } : atual
                      )
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label>{tr.settings.bridgeTemplateBodyLabel}</Label>
                  <div className="overflow-hidden rounded-md border">
                    <EditorCorpo
                      key={edicao.id ?? "novo"}
                      refCorpo={corpoRef}
                      valorInicial={edicao.corpo}
                      placeholder={tr.settings.bridgeTemplateCorpoPlaceholder}
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
                  <EmptyTitle>{tr.settings.bridgeTemplatesVazioTitulo}</EmptyTitle>
                  <EmptyDescription>
                    {tr.settings.bridgeTemplatesVazioDesc}
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button onClick={abrirNovo}>
                    <PlusIcon /> {tr.settings.bridgeTemplateAdd}
                  </Button>
                </EmptyContent>
              </Empty>
            ) : (
              <Field>
                <Label>{tr.settings.bridgeTemplatesLabel}</Label>
                <Select value="" onValueChange={selecionar}>
                  <SelectTrigger className="h-auto! w-full">
                    <SelectValue placeholder={tr.settings.bridgeTemplateSelectPlaceholder} />
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
                        {tr.settings.bridgeTemplateAdd}
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
                  <Trash2Icon /> {tr.settings.bridgeBtnExcluir}
                </Button>
              )}
              <Button variant="outline" onClick={() => setEdicao(null)}>
                {tr.settings.bridgeBtnCancelar}
              </Button>
              <Button onClick={salvar} disabled={!edicao.nome.trim()}>
                {tr.settings.bridgeBtnSalvar}
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
            <AlertDialogTitle>{tr.settings.bridgeExcluirTemplateTitulo}</AlertDialogTitle>
            <AlertDialogDescription>
              {preencher(tr.settings.bridgeExcluirDesc, {
                nome: excluindo?.nome ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="ghost">{tr.settings.bridgeBtnCancelar}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={excluir}>
              {tr.settings.bridgeBtnExcluir}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FramePanel>
  );
}

// ===========================================================================
// Card 3 — Undo send delay (#150)
// ===========================================================================

/**
 * Stacked card do "Undo send" (#150). Mesmo padrão do Mood/Style: label +
 * descrição à esquerda; select à direita. Escolhe por quanto tempo o envio fica
 * cancelável no Outbox (5/10/30 s) — o valor alimenta o `atrasoMs` do
 * `agendarEnvio`. Persistido no useAppStore (`bridge.undoSendDelay`).
 */
export function UndoSendPanel() {
  const { t } = useIdioma();
  const undoSendDelayMs = useAppStore((s) => s.undoSendDelayMs);
  const setUndoSendDelay = useAppStore((s) => s.setUndoSendDelay);

  /** Rótulos das opções do atraso (segundos), na ordem de `UNDO_SEND_DELAYS_MS`. */
  const undoSendLabels: Record<number, string> = {
    5_000: t.settings.bridgeUndoSend5s,
    10_000: t.settings.bridgeUndoSend10s,
    30_000: t.settings.bridgeUndoSend30s,
  };

  return (
    <FramePanel>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{t.settings.bridgeUndoSendTitulo}</h3>
          <p className="text-sm text-muted-foreground">
            {t.settings.bridgeUndoSendDesc}
          </p>
        </div>
        <Select
          value={String(undoSendDelayMs)}
          onValueChange={(valor) => setUndoSendDelay(Number(valor))}
        >
          <SelectTrigger aria-label={t.settings.bridgeUndoSendTitulo} className="w-56 shrink-0">
            <SelectValue placeholder={t.settings.bridgeUndoSendPlaceholder} />
          </SelectTrigger>
          <SelectContent position="popper" align="end">
            <SelectGroup>
              {UNDO_SEND_DELAYS_MS.map((ms) => (
                <SelectItem key={ms} value={String(ms)}>
                  {undoSendLabels[ms]}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </FramePanel>
  );
}

// ===========================================================================
// Card — Mark as read (#227, migrado da toolbar do leitor)
// ===========================================================================

/** Atrasos (s) do modo "atraso" do marcar-lido — mesma escala do leitor (#95). */
const MARCAR_LIDO_ATRASOS = [2, 5, 10] as const;

/**
 * Preferência de leitura "marcar como lido" (#227). Antes vivia num dropdown
 * solto na toolbar da lista do control-room; migrada pra Settings > Bridge >
 * Reading. Lê/escreve o MESMO estado do store (`marcarLidoModo`/`marcarLidoAtraso`),
 * então o comportamento e os defaults ("imediato"/"Ao abrir") não mudam.
 *
 * Mesmo encoding do dropdown antigo: o modo "atraso" vira `atraso:<s>` no Select
 * pra unir modo + atraso num controle único (sem UI condicional).
 */
export function ReadingPreferencesPanel() {
  const { t } = useIdioma();
  const marcarLidoModo = useAppStore((s) => s.marcarLidoModo);
  const setMarcarLidoModo = useAppStore((s) => s.setMarcarLidoModo);
  const marcarLidoAtraso = useAppStore((s) => s.marcarLidoAtraso);
  const setMarcarLidoAtraso = useAppStore((s) => s.setMarcarLidoAtraso);

  const valor =
    marcarLidoModo === "atraso" ? `atraso:${marcarLidoAtraso}` : marcarLidoModo;

  function aoMudar(v: string) {
    if (v.startsWith("atraso:")) {
      setMarcarLidoAtraso(Number(v.slice("atraso:".length)));
      setMarcarLidoModo("atraso");
    } else {
      setMarcarLidoModo(v as MarcarLidoModo);
    }
  }

  return (
    <FramePanel>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{t.settings.bridgeMarkReadTitulo}</h3>
          <p className="text-sm text-muted-foreground">
            {t.settings.bridgeMarkReadDesc}
          </p>
        </div>
        <Select value={valor} onValueChange={aoMudar}>
          <SelectTrigger aria-label={t.settings.bridgeMarkReadTitulo} className="w-56 shrink-0">
            <SelectValue placeholder={t.settings.bridgeMarkReadPlaceholder} />
          </SelectTrigger>
          <SelectContent position="popper" align="end">
            <SelectGroup>
              <SelectItem value="imediato">{t.settings.bridgeMarkReadAberto}</SelectItem>
              {MARCAR_LIDO_ATRASOS.map((s) => (
                <SelectItem key={s} value={`atraso:${s}`}>
                  {preencher(t.settings.bridgeMarkReadAtraso, { s })}
                </SelectItem>
              ))}
            </SelectGroup>
            <SelectSeparator />
            <SelectItem value="manual">{t.settings.bridgeMarkReadManual}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </FramePanel>
  );
}

// ===========================================================================
// Card — Sync interval (#227, NOVO)
// ===========================================================================

/**
 * Preferência de sincronização (#227, NOVO): de quanto em quanto tempo o Bridge
 * busca mensagens novas na Inbox. Antes fixo em 15 min no control-room; agora o
 * usuário escolhe 5/15/30/60 min e o poll respeita o valor. Persistido no store
 * (`bridge.syncInterval`); padrão 15 min mantém o comportamento histórico.
 */
export function SyncPreferencesPanel() {
  const { t } = useIdioma();
  const syncIntervalMinutes = useAppStore((s) => s.syncIntervalMinutes);
  const setSyncInterval = useAppStore((s) => s.setSyncInterval);

  /** Rótulos das opções do intervalo de sincronização (minutos). */
  const syncIntervalLabels: Record<number, string> = {
    5: t.settings.bridgeSync5,
    15: t.settings.bridgeSync15,
    30: t.settings.bridgeSync30,
    60: t.settings.bridgeSync60,
  };

  return (
    <FramePanel>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{t.settings.bridgeSyncTitulo}</h3>
          <p className="text-sm text-muted-foreground">
            {t.settings.bridgeSyncDesc}
          </p>
        </div>
        <Select
          value={String(syncIntervalMinutes)}
          onValueChange={(valor) => setSyncInterval(Number(valor))}
        >
          <SelectTrigger
            aria-label={t.settings.bridgeSyncTitulo}
            className="w-56 shrink-0"
          >
            <SelectValue placeholder={t.settings.bridgeSyncPlaceholder} />
          </SelectTrigger>
          <SelectContent position="popper" align="end">
            <SelectGroup>
              {SYNC_INTERVALS_MINUTES.map((min) => (
                <SelectItem key={min} value={String(min)}>
                  {syncIntervalLabels[min]}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </FramePanel>
  );
}
