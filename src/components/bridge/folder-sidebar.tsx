// #1019 (épico #1007) — o seam do FolderSidebar, tirado do `control-room.tsx`.
//
// Saiu inteiro: o componente e os nove helpers que só ELE usa (`ICONE_PASTA`,
// `GRUPO_MAIL`, os quatro `pode*`/`eh*`, `subarvoreIds`, `DialogNomePasta`,
// `SeletorCaixa` + `AvatarCaixa`/`CAIXA_ADICIONAR`, que vivem dentro do
// seletor). O critério é o do `Altair`, ratificado no card: vai pro enabler só o
// que cruza seams DIFERENTES — e desta fatia só o `rotuloPasta` cruzava.
//
// Dois helpers a contagem crua classificaria errado: `AvatarCaixa` e
// `CAIXA_ADICIONAR` marcam "0 usos no sidebar" porque os usos deles moram
// dentro do `SeletorCaixa`. Vieram por transitividade; sem isso o seam sairia
// quebrado. A tabela inteira está no card.

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";


import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { ScrollArea } from "@/components/ui/scroll-area";
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
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { shortcutAccessibleLabel } from "@/components/ui/shortcut";
import { ShortcutTooltip } from "@/components/ui/shortcut-tooltip";
// #1060: catálogo declarativo dos atalhos do Bridge (fonte única) — os tooltips/
// aria-labels das ações icon-only leem daqui, a MESMA fonte da ajuda "?".
import { shortcutBridge } from "@/components/atalhos-bridge";
import { rotuloPasta } from "@/lib/pastas-email";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";

import { AgendaCalendarSelector } from "@/components/agenda/agenda-calendar-selector";

// Ícones animados das pastas de e-mail (#494) — lucide-animated via registry.
import { MailboxIcon } from "@/components/ui/mailbox";
import { CalendarDaysIcon } from "@/components/ui/calendar-days";
import { UsersIcon } from "@/components/ui/users";
import { SquarePenIcon } from "@/components/ui/square-pen";
import { ChevronDownIcon } from "@/components/ui/chevron-down";
import { SendIcon } from "@/components/ui/send";
import { ArchiveIcon } from "@/components/ui/archive";
import { DeleteIcon } from "@/components/ui/delete";
import { BadgeAlertIcon } from "@/components/ui/badge-alert";
import { FolderOpenIcon } from "@/components/ui/folder-open";
import { toast } from "sonner";


import { CAIXA_PROPRIA } from "@/lib/bridge-compose";
import { useFotos } from "@/lib/fotos";

import { iniciais } from "@/lib/iniciais";
import { preencher, useIdioma } from "@/lib/idioma";
import { useTier } from "@/lib/tier-context";

import { useAppStore } from "@/store";
import type { BridgeView } from "@/store/ui-slice";


import { SubmenuMover, type PastaDestino } from "@/components/bridge/message-shared";
import { cn } from "@/lib/utils";
import type {
  PastaEmail,
} from "@/lib/types";
import {
  Building2,
  ChevronRight,
  FolderPlus,
  MailOpen,
  Plus,
  Pencil,
  Trash2,
  TriangleAlert,
  Users,
  Tag,
  UsersRound,
  Contact,
} from "lucide-react";
// #489: ícones de collapse do registry animate-ui (animados), por estado.
import { PanelLeftClose as PanelLeftCloseIcon } from "@/components/animate-ui/icons/panel-left-close";
import { PanelLeftOpen as PanelLeftOpenIcon } from "@/components/animate-ui/icons/panel-left-open";
import { useEffect, useState } from "react";


/** #109 removeu o esconder-escopo em 400; a coleção canônica permanece vazia. */

// #494: ícones ANIMADOS (lucide-animated) por tipo de well-known folder. Custom
// e subpastas caem no fallback FolderOpenIcon (ver `Ico` na Linha). Componentes
// do registry usados como vêm — animam no hover (stroke=currentColor herda a cor
// do container, tamanho pela prop `size`).
// #1019: o atalho de "compor" veio junto porque, depois da extração, o
// `control-room.tsx` ficou sem NENHUM uso dele — era exclusivo deste seam.
const ATALHO_COMPOR = shortcutBridge("compor");

const ICONE_PASTA: Record<
  string,
  React.ComponentType<{ className?: string; size?: number }>
> = {
  inbox: MailboxIcon,
  drafts: SquarePenIcon,
  sentitems: SendIcon,
  archive: ArchiveIcon,
  junkemail: BadgeAlertIcon,
  deleteditems: DeleteIcon,
};

const GRUPO_MAIL = ["inbox", "drafts", "sentitems"];

/**
 * Ações do menu de contexto de PASTA (#89), por TIPO de pasta. Escopo aprovado
 * pelo PO na #71/S3:
 *  - "Marcar todas como lidas": inbox, junkemail e subpastas (child). Fora de
 *    drafts/sentitems, onde "não-lido" não faz sentido (ali a contagem é o
 *    total, #56).
 *  - "Esvaziar pasta": SÓ deleteditems e junkemail — as duas pastas em que
 *    apagar tudo de uma vez é operação normal do usuário.
 */
function podeMarcarTodasLidas(tipo: string): boolean {
  return tipo === "inbox" || tipo === "junkemail" || tipo === "child";
}

function podeEsvaziar(tipo: string): boolean {
  return tipo === "deleteditems" || tipo === "junkemail";
}

/**
 * CRUD de subpastas (#90), por TIPO de pasta. Decisão do PO na #71/S4: em pasta
 * well-known as ações inválidas **não aparecem** (esconder, não desabilitar).
 *  - "Criar subpasta": inbox, archive e custom — as três onde criar filha faz
 *    sentido (não em enviados/rascunhos/lixeira/lixo).
 *  - Renomear / Mover / Excluir: SÓ custom (`tipo === "child"`). Well-known é
 *    pasta do sistema: renomear ou apagar quebraria o próprio Outlook.
 */
function podeCriarSubpasta(tipo: string): boolean {
  return tipo === "inbox" || tipo === "archive" || tipo === "child";
}

function ehPastaCustom(tipo: string): boolean {
  return tipo === "child";
}

/**
 * A pasta + TODAS as descendentes já conhecidas. É o conjunto de destinos
 * PROIBIDOS do "Mover pasta…" (#90): mover uma pasta para dentro de si mesma ou
 * de uma filha criaria um ciclo — o Graph recusaria, mas barrar na UI evita a
 * viagem e não oferece uma opção que nunca vai funcionar.
 */
function subarvoreIds(
  id: string,
  subpastas: Record<string, PastaEmail[]>
): Set<string> {
  const out = new Set<string>([id]);
  const fila = [id];
  while (fila.length > 0) {
    const atual = fila.pop()!;
    for (const f of subpastas[atual] ?? []) {
      if (!out.has(f.id)) {
        out.add(f.id);
        fila.push(f.id);
      }
    }
  }
  return out;
}

/**
 * Dialog de NOME de pasta (#90) — serve tanto "Criar subpasta" quanto
 * "Renomear": os dois pedem exatamente um texto, então é o mesmo `Dialog` do
 * registry (Radix) com títulos/rótulos diferentes, em vez de dois componentes
 * quase idênticos. Não é `AlertDialog` de propósito: AlertDialog é pra decisão
 * destrutiva (o "Excluir pasta" usa), não pra formulário.
 *
 * Validação, derivada no render (sem efeito): nome vazio e nome duplicado entre
 * as IRMÃS bloqueiam o botão de confirmar. `irmas` já vem sem a própria pasta no
 * caso do renomear — manter o nome atual não é "duplicado".
 *
 * O componente é montado só quando o dialog abre (`key` no chamador), então o
 * `useState` inicial já entra com o valor certo e sai limpo na próxima abertura.
 */
function DialogNomePasta({
  titulo,
  descricao,
  valorInicial,
  irmas,
  rotuloConfirmar,
  onConfirmar,
  onFechar,
  t,
}: {
  titulo: string;
  descricao: string;
  valorInicial: string;
  irmas: string[];
  rotuloConfirmar: string;
  onConfirmar: (nome: string) => void;
  onFechar: () => void;
  t: ReturnType<typeof useIdioma>["t"];
}) {
  const [nome, setNome] = useState(valorInicial);
  const [tocado, setTocado] = useState(false);

  const limpo = nome.trim();
  const duplicado =
    limpo !== "" &&
    irmas.some((n) => n.trim().toLowerCase() === limpo.toLowerCase());
  const podeConfirmar = limpo !== "" && !duplicado;
  const erro = duplicado
    ? t.controlRoom.nomePastaDuplicado
    : tocado && limpo === ""
      ? t.controlRoom.nomePastaVazio
      : null;

  return (
    <Dialog
      open
      onOpenChange={(aberto) => {
        if (!aberto) onFechar();
      }}
    >
      <DialogContent className="max-w-sm!">
        <form
          onSubmit={(e) => {
            // Enter confirma (é um formulário de um campo só) — sem isso o
            // usuário teria que ir de mouse até o botão.
            e.preventDefault();
            if (podeConfirmar) onConfirmar(limpo);
          }}
        >
          <DialogHeader>
            <DialogTitle>{titulo}</DialogTitle>
            <DialogDescription>{descricao}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-4">
            <Label htmlFor="nome-pasta">{t.controlRoom.nomePastaRotulo}</Label>
            <Input
              id="nome-pasta"
              autoFocus
              value={nome}
              onChange={(e) => {
                setNome(e.target.value);
                setTocado(true);
              }}
              placeholder={t.controlRoom.nomePastaPlaceholder}
              aria-invalid={erro !== null}
              aria-describedby={erro ? "nome-pasta-erro" : undefined}
            />
            {erro !== null ? (
              <p id="nome-pasta-erro" className="text-sm text-destructive">
                {erro}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onFechar}>
              {t.controlRoom.cancelar}
            </Button>
            <Button type="submit" disabled={!podeConfirmar}>
              {rotuloConfirmar}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ===========================================================================
// Caixas compartilhadas (#111) — seletor + dialog "Adicionar caixa…"
// ===========================================================================

/** Sentinela do item "Adicionar caixa…": nunca vira caixa ativa — só abre o
 *  dialog (o Select do Radix precisa de um `value` não-vazio no item). */
const CAIXA_ADICIONAR = "__adicionar__";

/**
 * Seletor de caixa no TOPO do sidebar do Bridge (#111). "Minha caixa" (/me) é o
 * padrão; abaixo, as caixas compartilhadas adicionadas; por fim "Adicionar
 * caixa…". Selecionar troca a caixa ativa; escolher "Adicionar…" abre o dialog.
 *
 * Nesta issue selecionar uma caixa compartilhada só TROCA o estado de caixa
 * ativa e a sinaliza (o próprio trigger mostra qual está ativa) — a listagem do
 * conteúdo dela é a #112. Colapsado, vira um ícone que abre o dialog direto.
 */
/** Avatar da caixa: foto do Graph (via cache de fotos #39) com fallback de
 *  iniciais. Sem foto / 404 / sem permissão → iniciais, sem erro visível (#493). */
function AvatarCaixa({
  email,
  foto,
  className,
}: {
  email: string;
  foto?: string | null;
  className?: string;
}) {
  return (
    <Avatar className={cn("size-5 shrink-0", className)}>
      {foto && <AvatarImage src={foto} alt="" />}
      <AvatarFallback className="text-[9px]">
        {iniciais(undefined, email)}
      </AvatarFallback>
    </Avatar>
  );
}

function SeletorCaixa({
  caixas,
  ativa,
  emailProprio,
  onSelecionar,
  onAdicionar,
  colapsada,
  t,
}: {
  caixas: string[];
  ativa: string;
  emailProprio: string;
  onSelecionar: (v: string) => void;
  onAdicionar: () => void;
  colapsada: boolean;
  t: ReturnType<typeof useIdioma>["t"];
}) {
  // #493: foto das caixas (própria + compartilhadas) via o cache de fotos (#39).
  // Só e-mails internos viram request; 404/sem permissão degrada pra iniciais.
  const { getFoto, pedirFotos } = useFotos();
  useEffect(() => {
    pedirFotos([emailProprio, ...caixas]);
  }, [emailProprio, caixas, pedirFotos]);

  const emailAtivo = ativa === CAIXA_PROPRIA ? emailProprio : ativa;

  if (colapsada) {
    // Colapsada, o rótulo textual some: o e-mail da caixa ativa aparece por
    // tooltip canônico (#158). A `aria-label` (ação "Adicionar caixa…", o clique
    // abre o dialog) fica intacta; ring no avatar sinaliza caixa não-própria.
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            onClick={onAdicionar}
            aria-label={t.controlRoom.caixaAdicionarItem}
          >
            <AvatarCaixa
              email={emailAtivo}
              foto={getFoto(emailAtivo)}
              className={cn(
                ativa !== CAIXA_PROPRIA && "ring-2 ring-primary ring-offset-1"
              )}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right" align="center">
          {emailAtivo}
        </TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Select
      value={ativa}
      onValueChange={(v) => {
        if (v === CAIXA_ADICIONAR) onAdicionar();
        else onSelecionar(v);
      }}
    >
      <SelectTrigger className="w-full" aria-label={t.controlRoom.caixaSeletor}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value={CAIXA_PROPRIA}>
            <span className="flex items-center gap-2">
              <AvatarCaixa email={emailProprio} foto={getFoto(emailProprio)} />
              <span className="truncate">{emailProprio}</span>
            </span>
          </SelectItem>
          {caixas.map((c) => (
            <SelectItem key={c} value={c}>
              <span className="flex items-center gap-2">
                <AvatarCaixa email={c} foto={getFoto(c)} />
                <span className="truncate">{c}</span>
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
        <SelectSeparator />
        <SelectItem value={CAIXA_ADICIONAR}>
          <span className="flex items-center gap-2 text-muted-foreground">
            <Plus className="size-4 shrink-0" />
            <span>{t.controlRoom.caixaAdicionarItem}</span>
          </span>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

export function FolderSidebar({
  pastas,
  subpastas,
  onCarregarSubpastas,
  sel,
  onSel,
  onNovo,
  onComposeOutlook,
  onMarcarTodasLidas,
  onEsvaziarPasta,
  arvore,
  arvoreCarregando,
  onAbrirArvore,
  onCriarSubpasta,
  onRenomearPasta,
  onExcluirPasta,
  onMoverPasta,
  caixas,
  caixaAtiva,
  emailProprio,
  onSelecionarCaixa,
  onAbrirAdicionarCaixa,
  caixaCompartilhada,
  colapsada,
  onToggleSidebar,
  bridgeView,
  onSelectModule,
  t,
}: {
  pastas: PastaEmail[] | null;
  subpastas: Record<string, PastaEmail[]>;
  onCarregarSubpastas: (id: string) => void;
  sel: string;
  onSel: (id: string) => void;
  onNovo: () => void;
  onComposeOutlook: () => void;
  onMarcarTodasLidas: (folderId: string) => void;
  onEsvaziarPasta: (folderId: string) => void;
  /** Árvore achatada COMPLETA (#88), reusada como destino do "Mover pasta…". */
  arvore: PastaDestino[];
  arvoreCarregando: boolean;
  onAbrirArvore: () => void;
  onCriarSubpasta: (paiId: string, nome: string) => void;
  onRenomearPasta: (id: string, nome: string, paiId?: string) => void;
  onExcluirPasta: (id: string, rotulo: string, paiId?: string) => void;
  onMoverPasta: (
    id: string,
    destino: string,
    rotuloDestino: string,
    paiId?: string
  ) => void;
  /** Caixas compartilhadas adicionadas (#111), por endereço. */
  caixas: string[];
  /** Caixa ativa: CAIXA_PROPRIA (/me) ou um endereço de `caixas`. */
  caixaAtiva: string;
  /** E-mail da caixa própria (/me) — mostrado no lugar de "Minha caixa" (#493). */
  emailProprio: string;
  onSelecionarCaixa: (v: string) => void;
  onAbrirAdicionarCaixa: () => void;
  caixaCompartilhada: boolean;
  colapsada: boolean;
  onToggleSidebar: () => void;
  bridgeView: BridgeView;
  onSelectModule: (view: BridgeView) => void;
  t: ReturnType<typeof useIdioma>["t"];
}) {
  // #712 (PS6 follow-on): caixa compartilhada é feature de ORG — no tier pessoal/
  // uncontracted o seletor de caixa some (só a caixa própria vale).
  const { recursoOrgDisponivel } = useTier();
  const peopleTab = useAppStore((state) => state.peopleTab);
  const setPeopleTab = useAppStore((state) => state.setPeopleTab);
  // #578: os grupos M365 seguem carregados aqui (loadPeopleGroups no mount do
  // módulo People), mas o RENDER deles migrou pro GroupsView (grid no painel) —
  // o bloco "My organization" + o dump de grupos no sidebar foram removidos.
  const peopleGroupsLoading = useAppStore(
    (state) => state.peopleGroupsLoading,
  );
  const peopleGroupsLoaded = useAppStore((state) => state.peopleGroupsLoaded);
  const loadPeopleGroups = useAppStore((state) => state.loadPeopleGroups);
  // #406: categorias do Outlook no sidebar de Contacts.
  const peopleCategorias = useAppStore((state) => state.peopleCategorias);
  const peopleSelectedCategory = useAppStore(
    (state) => state.peopleSelectedCategory,
  );
  const selectPeopleCategory = useAppStore(
    (state) => state.selectPeopleCategory,
  );
  useEffect(() => {
    if (
      bridgeView === "people" &&
      !peopleGroupsLoaded &&
      !peopleGroupsLoading
    ) {
      void loadPeopleGroups();
    }
  }, [
    bridgeView,
    loadPeopleGroups,
    peopleGroupsLoaded,
    peopleGroupsLoading,
  ]);
  // Pasta pendente de confirmação do "Esvaziar" — ação destrutiva nunca sai
  // direto do menu: passa pelo AlertDialog (DoD + padrão do app).
  const [aEsvaziar, setAEsvaziar] = useState<{ id: string; rotulo: string } | null>(
    null
  );
  // Mesma regra pro "Excluir pasta" (#90): destrutivo → AlertDialog.
  const [aExcluir, setAExcluir] = useState<{
    id: string;
    rotulo: string;
    paiId?: string;
  } | null>(null);
  // Dialog de nome, compartilhado por "Criar subpasta" e "Renomear" (#90).
  const [dialogNome, setDialogNome] = useState<
    | { modo: "criar"; paiId: string; rotulo: string; irmas: string[] }
    | { modo: "renomear"; id: string; rotulo: string; paiId?: string; irmas: string[] }
    | null
  >(null);
  const mail = (pastas ?? []).filter((p) => GRUPO_MAIL.includes(p.tipo));
  const outras = (pastas ?? []).filter((p) => !GRUPO_MAIL.includes(p.tipo));
  const Modulo = ({
    view,
    rotulo,
    icon: Icon,
  }: {
    view: BridgeView;
    rotulo: string;
    // #491: ícones ANIMADOS (lucide-animated) — componente div-based com prop
    // `size` (não `className` p/ tamanho) e `stroke=currentColor`; animam no hover.
    icon: React.ComponentType<{ size?: number; className?: string }>;
  }) => {
    const ativo = bridgeView === view;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={ativo ? "secondary" : "ghost"}
            onClick={() => onSelectModule(view)}
            aria-label={rotulo}
            aria-current={ativo ? "page" : undefined}
            className={cn(
              "shrink-0",
              colapsada ? "size-9 justify-center p-0" : "w-full justify-start gap-2.5",
              ativo
                ? "bg-secondary font-medium text-secondary-foreground"
                : "text-muted-foreground hover:bg-accent/50"
            )}
          >
            <Icon size={16} className="shrink-0" />
            {!colapsada && <span>{rotulo}</span>}
          </Button>
        </TooltipTrigger>
        {colapsada && (
          <TooltipContent side="right" align="center">
            {rotulo}
          </TooltipContent>
        )}
      </Tooltip>
    );
  };

  // Subpastas (childFolders): carregadas sob demanda ao expandir. O CACHE mora
  // no pai (#88) porque o submenu "Mover para pasta…" precisa da mesma árvore —
  // assim expandir no sidebar e abrir o submenu não buscam a mesma subpasta
  // duas vezes, e o que já foi carregado num lado aparece no outro.
  const filhos = subpastas;
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set());
  const alternarExpandir = (id: string) => {
    setExpandidas((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
    onCarregarSubpastas(id);
  };

  // `paiId` (só nas subpastas) é o que permite ao menu de contexto saber quais
  // são as IRMÃS (validação de nome duplicado) e qual cache invalidar depois da
  // mutação (#90). Nas raízes é `undefined`.
  const Linha = (p: PastaEmail, paiId?: string) => {
    const ehFilho = paiId !== undefined;
    // Custom/subpasta (tipo desconhecido) → folder-open animado (#494).
    const Ico = ICONE_PASTA[p.tipo] ?? FolderOpenIcon;
    const ativo = p.id === sel;
    // `contagem` é NÃO-LIDOS para inbox/junk/lixeira/custom; para drafts/sentitems
    // é o TOTAL de itens (não-lido não faz sentido em enviados/rascunhos).
    const contagemEhNaoLidos = p.tipo !== "drafts" && p.tipo !== "sentitems";
    const contagem = contagemEhNaoLidos ? p.naoLidos : p.total;
    // #1075 RB46-b: `acessoNegado: boolean` virou `leitura` de 3 estados. Um 500
    // ou queda de rede davam `false` + 0/0, e a pasta era desenhada VAZIA.
    const semAcesso = p.leitura === "negado";
    // Só `ok` autoriza exibir contador como fato. Em `indisponivel` a contagem
    // existe na struct (é 0), mas 0 aqui significa "não sei", não "vazio".
    const contagemEhFato = p.leitura === "ok";
    const rotulo = rotuloPasta(p.tipo, p.nome, t);
    const linhaBtn = (
      <button
        type="button"
        onClick={() => {
          if (semAcesso) {
            toast.warning(t.controlRoom.caixaAcessoParcial);
            return;
          }
          onSel(p.id);
        }}
        aria-disabled={semAcesso || undefined}
        aria-label={colapsada ? rotulo : undefined}
        // Colapsada: o nome vem pelo tooltip canônico (#100), não mais por
        // `title` nativo. `title` fica só para o aviso de acesso parcial.
        title={
          semAcesso
            ? t.controlRoom.caixaAcessoParcial
            : p.leitura === "indisponivel"
              ? t.controlRoom.pastaContagemIndisponivel
              : undefined
        }
        className={cn(
          "flex items-center rounded-md text-sm transition-colors",
          colapsada ? "relative size-9 justify-center" : "flex-1 gap-2.5 px-2.5 py-2",
          ativo ? "bg-secondary font-medium text-secondary-foreground" : "hover:bg-accent/50",
          semAcesso && "cursor-not-allowed opacity-50"
        )}
      >
        {colapsada ? (
          // Dot ancorado ao ÍCONE (não ao botão): com o ring na cor do card ele
          // fica dentro dos limites e o ScrollArea não corta (#37). O dot é
          // indicador de NÃO-LIDO: só aparece onde `contagem` são não-lidos —
          // nunca em drafts/sentitems (ali é o total, #56); Lixeira/Junk são
          // ruído → também sem dot.
          <span className="relative">
            <Ico size={16} className="shrink-0 text-muted-foreground" />
            {contagem > 0 &&
              contagemEhNaoLidos &&
              p.tipo !== "deleteditems" &&
              p.tipo !== "junkemail" && (
                <span className="absolute -top-1 -right-1 size-2 rounded-full bg-primary ring-2 ring-card" />
              )}
          </span>
        ) : (
          <>
            <Ico size={16} className="shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-left">{rotulo}</span>
            {(semAcesso || p.leitura === "indisponivel") && (
              <TriangleAlert className="size-3.5 shrink-0 text-warning" />
            )}
            {contagemEhFato && contagem > 0 && (
              <span className="shrink-0 text-xs text-muted-foreground">{contagem}</span>
            )}
          </>
        )}
      </button>
    );
    // Menu de contexto da PASTA (#89). Itens condicionais ao tipo; se a pasta
    // não oferece nenhuma ação (drafts/sentitems/archive), o trigger fica
    // desabilitado — nada abre, nem menu vazio (mesmo padrão do menu da ÁREA da
    // lista, #86). O ContextMenuTrigger do Radix já suprime o menu nativo.
    const marcarLidas = podeMarcarTodasLidas(p.tipo);
    const esvaziar = podeEsvaziar(p.tipo);
    // CRUD (#90): criar subpasta em inbox/archive/custom; renomear/mover/excluir
    // SÓ em custom — em well-known essas ações nem aparecem (decisão do PO).
    const criarSub = podeCriarSubpasta(p.tipo);
    const custom = ehPastaCustom(p.tipo);
    const semAcoes =
      semAcesso || (!marcarLidas && !esvaziar && !criarSub && !custom);

    // Irmãs da pasta (para barrar nome duplicado antes de ir ao Graph): as
    // filhas do pai. Nas raízes, as próprias raízes.
    const irmas = (paiId ? (filhos[paiId] ?? []) : (pastas ?? [])).map((f) => f.nome);
    // Destinos válidos do "Mover pasta…": a árvore inteira MENOS a própria
    // pasta e suas descendentes (mover pra dentro de si mesma = ciclo).
    const proibidos = subarvoreIds(p.id, subpastas);
    const destinos = arvore.filter((d) => !proibidos.has(d.id));

    // `dica` (só na sidebar colapsada, #100): quando o rótulo textual está
    // oculto, o nome da pasta aparece por tooltip canônico. Mesmo aninhamento de
    // gatilhos do app-sidebar (Tooltip > TooltipTrigger asChild > MenuTrigger
    // asChild > botão); sem `dica` a árvore é idêntica à de antes.
    const comMenu = (conteudo: React.ReactNode, dica?: string) => (
      <ContextMenu>
        {dica ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <ContextMenuTrigger asChild disabled={semAcoes}>
                {conteudo}
              </ContextMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right" align="center">
              {dica}
            </TooltipContent>
          </Tooltip>
        ) : (
          <ContextMenuTrigger asChild disabled={semAcoes}>
            {conteudo}
          </ContextMenuTrigger>
        )}
        <ContextMenuContent className="w-56">
          {marcarLidas && (
            <ContextMenuItem className="gap-2" onClick={() => onMarcarTodasLidas(p.id)}>
              <MailOpen />
              {t.controlRoom.marcarTodasLidas}
            </ContextMenuItem>
          )}
          {marcarLidas && (criarSub || custom || esvaziar) && <ContextMenuSeparator />}
          {criarSub && (
            <ContextMenuItem
              className="gap-2"
              onClick={() => {
                // Garante as filhas em cache: sem elas não dá pra validar o
                // nome duplicado no cliente (o 409 do Graph é a rede embaixo).
                onCarregarSubpastas(p.id);
                setDialogNome({
                  modo: "criar",
                  paiId: p.id,
                  rotulo,
                  irmas: (filhos[p.id] ?? []).map((f) => f.nome),
                });
              }}
            >
              <FolderPlus />
              {t.controlRoom.criarSubpasta}
            </ContextMenuItem>
          )}
          {custom && (
            <ContextMenuItem
              className="gap-2"
              onClick={() =>
                setDialogNome({
                  modo: "renomear",
                  id: p.id,
                  rotulo,
                  paiId,
                  // Sem a própria pasta: manter o nome atual não é duplicata.
                  irmas: irmas.filter((n) => n !== p.nome),
                })
              }
            >
              <Pencil />
              {t.controlRoom.renomearPasta}
            </ContextMenuItem>
          )}
          {custom && (
            // Mesmo submenu do "Mover para pasta…" do #88 (árvore achatada +
            // busca), só com outro rótulo e outro alvo — não é uma segunda
            // implementação.
            <SubmenuMover
              alvos={[p.id]}
              pastas={destinos}
              carregando={arvoreCarregando}
              rotulo={t.controlRoom.moverPasta}
              onAbrir={onAbrirArvore}
              onMover={(ids, destino, rotuloDestino) =>
                onMoverPasta(ids[0], destino, rotuloDestino, paiId)
              }
              t={t}
            />
          )}
          {custom && <ContextMenuSeparator />}
          {custom && (
            <ContextMenuItem
              variant="destructive"
              className="gap-2"
              onClick={() => setAExcluir({ id: p.id, rotulo, paiId })}
            >
              <Trash2 />
              {t.controlRoom.excluirPasta}
            </ContextMenuItem>
          )}
          {/* "Esvaziar" só existe em deleted/junk, que nunca têm criar/custom —
              o separador de cima (depois de "Marcar todas") já dá conta. */}
          {esvaziar && (
            <ContextMenuItem
              variant="destructive"
              className="gap-2"
              onClick={() => setAEsvaziar({ id: p.id, rotulo })}
            >
              <Trash2 />
              {t.controlRoom.esvaziarPasta}
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
    );

    if (colapsada) return <div key={p.id}>{comMenu(linhaBtn, rotulo)}</div>;
    return (
      <div key={p.id}>
        {comMenu(
          <div className={cn("flex items-center", ehFilho && "pl-5")}>
            {/* chevron só quando a pasta realmente tem subpastas (childFolderCount > 0) */}
            {p.filhos > 0 ? (
              (() => {
                // Nome e tooltip do chevron comunicam o ESTADO (expandir vs
                // recolher), não só a pasta (#100) — a mesma string alimenta
                // `aria-label` e o tooltip canônico.
                const rotuloChevron = preencher(
                  expandidas.has(p.id)
                    ? t.controlRoom.recolherPasta
                    : t.controlRoom.expandirPasta,
                  { pasta: rotulo }
                );
                return (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => alternarExpandir(p.id)}
                        aria-label={rotuloChevron}
                        className="grid size-5 shrink-0 place-items-center text-muted-foreground hover:text-foreground"
                      >
                        <ChevronRight
                          className={cn(
                            "size-3.5 transition-transform",
                            expandidas.has(p.id) && "rotate-90"
                          )}
                        />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" align="center">
                      {rotuloChevron}
                    </TooltipContent>
                  </Tooltip>
                );
              })()
            ) : (
              <span className="size-5 shrink-0" />
            )}
            {linhaBtn}
          </div>
        )}
        {expandidas.has(p.id) &&
          (filhos[p.id] ?? []).map((c) => Linha({ ...c, tipo: "child" }, p.id))}
      </div>
    );
  };

  return (
    <aside
      className={cn(
        // #912: borderless — sai o "card" (rounded-xl border bg-card) e entra a
        // divisória SÓ à direita (border-r) + o fundo de chrome do app (bg-muted/30,
        // o mesmo padrão in-content das rails do Navigator), destacando o sidebar do
        // content area. Splitter (resize) = follow-up (interage com o colapsar).
        // #912: a largura agora e do PAINEL (splitter), nao do `aside`. O que
        // era `w-64`/`w-16` virou `defaultSize`/`collapsedSize` no `BridgeSplit`
        // — a largura de 256px que o #466 escolheu a dedo (cabe "Caixa de
        // entrada" em pt sem truncar) esta la, em px, convertida na fatia do
        // grupo. Duas fontes de verdade pra mesma largura era o que fazia o
        // splitter brigar com o colapsar, e por isso ele tinha ficado de fora.
        "flex h-full w-full min-w-0 flex-col gap-3 border-r border-border bg-muted/30 p-3",
        colapsada && "items-center"
      )}
    >
      <div
        className={cn(
          "flex w-full shrink-0 items-center",
          colapsada ? "justify-center" : "justify-between"
        )}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onToggleSidebar}
              aria-label={colapsada ? t.sidebar.expand : t.sidebar.collapse}
            >
              {colapsada ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" align="center">
            {t.nav.alternarMenu}
          </TooltipContent>
        </Tooltip>
        {/* #492: "Novo e-mail" vira button-group (c-button-group-4) na MESMA
            linha do toggle, alinhado à direita. Só no módulo Mailbox e expandido
            (no colapsado o w-16 não cabe os dois → ícone empilhado abaixo). */}
        {!colapsada && bridgeView === "mail" && (
          <ButtonGroup>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  onClick={onNovo}
                  aria-label={shortcutAccessibleLabel(
                    t.controlRoom.novoEmail,
                    ATALHO_COMPOR
                  )}
                >
                  <SquarePenIcon size={16} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {/* #538: New Mail é icon-only COM atalho (c) → ShortcutTooltip. */}
                <ShortcutTooltip
                  label={t.controlRoom.novoEmail}
                  shortcut={ATALHO_COMPOR}
                />
              </TooltipContent>
            </Tooltip>
            <DropdownMenu>
              {/* Tooltip > DropdownMenu: dois gatilhos asChild no mesmo botão. */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon"
                      aria-label={t.controlRoom.composeOutlook}
                    >
                      <ChevronDownIcon size={16} />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>{t.controlRoom.composeOutlook}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={onComposeOutlook}>
                  {t.controlRoom.composeOutlook}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </ButtonGroup>
        )}
      </div>
      <Separator className={cn("shrink-0", colapsada && "w-6")} />

      {bridgeView === "mail" ? (
        <>
          {/* Seletor de caixa (#111): contexto do módulo Mailbox. Minha caixa
              (/me) é o padrão; caixas compartilhadas ficam abaixo.
              #712: só no tier org — feature de organização. */}
          {recursoOrgDisponivel && (
            <SeletorCaixa
              caixas={caixas}
              ativa={caixaAtiva}
              emailProprio={emailProprio}
              onSelecionar={onSelecionarCaixa}
              onAdicionar={onAbrirAdicionarCaixa}
              colapsada={colapsada}
              t={t}
            />
          )}
          {caixaCompartilhada && !colapsada ? (
            <p className="px-1 text-xs text-muted-foreground">
              {t.controlRoom.caixaCompartilhadaDesc}
            </p>
          ) : null}

          {/* #492: no colapsado (w-16), só o ícone primário (square-pen) empilhado
              — o button-group completo com chevron mora no header quando expandido.
              A opção "Escrever no Outlook" fica acessível ao expandir. */}
          {colapsada && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  onClick={onNovo}
                  aria-label={shortcutAccessibleLabel(
                    t.controlRoom.novoEmail,
                    ATALHO_COMPOR
                  )}
                >
                  <SquarePenIcon size={16} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" align="center">
                {/* #538: New Mail icon-only COM atalho (c) → ShortcutTooltip. */}
                <ShortcutTooltip
                  label={t.controlRoom.novoEmail}
                  shortcut={ATALHO_COMPOR}
                />
              </TooltipContent>
            </Tooltip>
          )}

          {!pastas ? (
            <div className="flex justify-center py-6">
              <Spinner className="size-4 text-muted-foreground" />
            </div>
          ) : (
            <ScrollArea className="min-h-0 w-full flex-1">
              <div
                className={cn(colapsada ? "flex flex-col items-center gap-0.5" : "pr-2")}
              >
                {!colapsada && (
                  <p className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">
                    {t.controlRoom.grupoMail}
                  </p>
                )}
                <div className={cn("flex flex-col gap-0.5", colapsada && "items-center")}>
                  {mail.map((p) => Linha(p))}
                </div>

                {outras.length > 0 && (
                  <>
                    {colapsada ? (
                      <Separator className="my-1.5 w-6" />
                    ) : (
                      <p className="px-2.5 pt-4 pb-1 text-xs font-medium text-muted-foreground">
                        {t.controlRoom.grupoOutras}
                      </p>
                    )}
                    <div
                      className={cn("flex flex-col gap-0.5", colapsada && "items-center")}
                    >
                      {outras.map((p) => Linha(p))}
                    </div>
                  </>
                )}
              </div>
            </ScrollArea>
          )}
        </>
      ) : bridgeView === "people" ? (
        <ScrollArea className="min-h-0 w-full flex-1">
          <div className="flex w-full flex-col gap-3">
            <nav
              aria-label={t.controlRoom.peopleTitulo}
              className={cn(
                "flex w-full flex-col gap-0.5",
                colapsada && "items-center"
              )}
            >
              {(
                [
                  {
                    value: "contacts",
                    label: t.controlRoom.peopleContactsTab,
                    Icon: Users,
                  },
                  // #578: Groups vira item único de nav (não mais o dump de
                  // grupos no sidebar) — clicar abre o grid de grupos no painel.
                  {
                    value: "groups",
                    label: t.controlRoom.peopleGroupsSection,
                    Icon: UsersRound,
                  },
                  {
                    value: "organizations",
                    label: t.controlRoom.peopleOrganizationsTab,
                    Icon: Building2,
                  },
                ] as const
              ).map(({ value, label, Icon }) => {
                const ativo = peopleTab === value;
                return (
                  <Tooltip key={value}>
                    <TooltipTrigger asChild>
                      <Button
                        variant={ativo ? "secondary" : "ghost"}
                        onClick={() => setPeopleTab(value)}
                        aria-label={label}
                        aria-current={ativo ? "page" : undefined}
                        className={cn(
                          "shrink-0",
                          colapsada
                            ? "size-9 justify-center p-0"
                            : "w-full justify-start gap-2.5",
                          ativo
                            ? "bg-secondary font-medium text-secondary-foreground"
                            : "text-muted-foreground hover:bg-accent/50"
                        )}
                      >
                        <Icon className="size-4 shrink-0" />
                        {!colapsada && <span>{label}</span>}
                      </Button>
                    </TooltipTrigger>
                    {colapsada && (
                      <TooltipContent side="right" align="center">
                        {label}
                      </TooltipContent>
                    )}
                  </Tooltip>
                );
              })}
            </nav>

            {/* #562: grupos de contato PESSOAIS (contactFolders) — seção SEPARADA
                dos grupos M365 compartilhados (nav primária acima) pra não
                confundir compartilhado × pessoal. Item único → grid de pastas
                editáveis no painel. */}
            <nav
              aria-label={t.controlRoom.personalGroupsSection}
              className={cn(
                "flex w-full flex-col gap-0.5",
                colapsada && "items-center"
              )}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={
                      peopleTab === "personalGroups" ? "secondary" : "ghost"
                    }
                    onClick={() => setPeopleTab("personalGroups")}
                    aria-label={t.controlRoom.personalGroupsSection}
                    aria-current={
                      peopleTab === "personalGroups" ? "page" : undefined
                    }
                    className={cn(
                      "shrink-0",
                      colapsada
                        ? "size-9 justify-center p-0"
                        : "w-full justify-start gap-2.5",
                      peopleTab === "personalGroups"
                        ? "bg-secondary font-medium text-secondary-foreground"
                        : "text-muted-foreground hover:bg-accent/50"
                    )}
                  >
                    <Contact className="size-4 shrink-0" />
                    {!colapsada && (
                      <span>{t.controlRoom.personalGroupsSection}</span>
                    )}
                  </Button>
                </TooltipTrigger>
                {colapsada && (
                  <TooltipContent side="right" align="center">
                    {t.controlRoom.personalGroupsSection}
                  </TooltipContent>
                )}
              </Tooltip>
            </nav>

            {/* #578: bloco redundante "My organization / VOAZ / People"
                (que duplicava o People de cima) + o dump de grupos no sidebar
                REMOVIDOS. Groups virou item da nav primária (grid no painel).
                As Categorias do Outlook (#406) seguem como nav própria. */}
            {peopleCategorias.size > 0 && (
            <nav
              aria-label={t.controlRoom.peopleCategoriesSection}
              className={cn(
                "flex w-full flex-col gap-0.5",
                colapsada && "items-center"
              )}
            >
              {/* #406: Categorias do Outlook — grupo customizável portável
                  (opção b). Clicar filtra os contatos pela categoria. */}
              {!colapsada && (
                <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">
                  {t.controlRoom.peopleCategoriesSection}
                </p>
              )}
              {[...peopleCategorias.entries()].map(([nome, cor]) => {
                const ativo =
                  peopleTab === "category" && peopleSelectedCategory === nome;
                return (
                  <Tooltip key={nome}>
                    <TooltipTrigger asChild>
                      <Button
                        variant={ativo ? "secondary" : "ghost"}
                        onClick={() => selectPeopleCategory(nome)}
                        aria-label={nome}
                        aria-current={ativo ? "page" : undefined}
                        className={cn(
                          "shrink-0",
                          colapsada
                            ? "size-9 justify-center p-0"
                            : "w-full justify-start gap-2.5",
                          ativo
                            ? "bg-secondary font-medium text-secondary-foreground"
                            : "text-muted-foreground hover:bg-accent/50"
                        )}
                      >
                        {cor ? (
                          <span
                            className="size-2.5 shrink-0 rounded-full"
                            style={{ background: cor }}
                          />
                        ) : (
                          <Tag className="size-4 shrink-0" />
                        )}
                        {!colapsada && (
                          <span className="min-w-0 flex-1 truncate text-left">
                            {nome}
                          </span>
                        )}
                      </Button>
                    </TooltipTrigger>
                    {colapsada && (
                      <TooltipContent side="right" align="center">
                        {nome}
                      </TooltipContent>
                    )}
                  </Tooltip>
                );
              })}
            </nav>
            )}
          </div>
        </ScrollArea>
      ) : (
        <ScrollArea className="min-h-0 w-full flex-1">
          <AgendaCalendarSelector colapsada={colapsada} />
        </ScrollArea>
      )}

      <Separator className={cn("shrink-0", colapsada && "w-6")} />
      <nav
        aria-label={t.nav.controlRoom}
        className={cn("flex w-full flex-col gap-0.5", colapsada && "items-center")}
      >
        {/* #491: ordem Mailbox → Calendar → Contacts + ícones animados (lucide-animated). */}
        <Modulo view="mail" rotulo={t.controlRoom.mailboxTitulo} icon={MailboxIcon} />
        <Modulo view="agenda" rotulo={t.controlRoom.agendaTitulo} icon={CalendarDaysIcon} />
        <Modulo view="people" rotulo={t.controlRoom.peopleTitulo} icon={UsersIcon} />
      </nav>

      {/* Confirmação do "Esvaziar pasta": destrutiva e não desfazível, então
          nunca dispara direto do menu de contexto (#89). */}
      <AlertDialog
        open={aEsvaziar !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setAEsvaziar(null);
        }}
      >
        <AlertDialogContent className="max-w-sm!">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {preencher(t.controlRoom.esvaziarPastaTitulo, {
                pasta: aEsvaziar?.rotulo ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t.controlRoom.esvaziarPastaDesc}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.controlRoom.cancelar}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (aEsvaziar) onEsvaziarPasta(aEsvaziar.id);
                setAEsvaziar(null);
              }}
            >
              {t.controlRoom.esvaziarPastaConfirmar}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmação do "Excluir pasta" (#90). Destrutiva, então AlertDialog —
          mas REVERSÍVEL: o texto diz que a pasta vai pra Lixeira (decisão do PO
          na #71/D3), não que some pra sempre. */}
      <AlertDialog
        open={aExcluir !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setAExcluir(null);
        }}
      >
        <AlertDialogContent className="max-w-sm!">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {preencher(t.controlRoom.excluirPastaTitulo, {
                pasta: aExcluir?.rotulo ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t.controlRoom.excluirPastaDesc}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.controlRoom.cancelar}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (aExcluir)
                  onExcluirPasta(aExcluir.id, aExcluir.rotulo, aExcluir.paiId);
                setAExcluir(null);
              }}
            >
              {t.controlRoom.excluirPastaConfirmar}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialog de nome — "Criar subpasta" e "Renomear" (#90). Montado só quando
          abre (e com `key`), então o campo já nasce com o valor certo e não
          carrega o texto da abertura anterior. */}
      {dialogNome !== null ? (
        dialogNome.modo === "criar" ? (
          <DialogNomePasta
            key={`criar-${dialogNome.paiId}`}
            titulo={preencher(t.controlRoom.criarSubpastaTitulo, {
              pasta: dialogNome.rotulo,
            })}
            descricao={t.controlRoom.criarSubpastaDesc}
            valorInicial=""
            irmas={dialogNome.irmas}
            rotuloConfirmar={t.controlRoom.criar}
            onConfirmar={(nome) => {
              onCriarSubpasta(dialogNome.paiId, nome);
              setDialogNome(null);
            }}
            onFechar={() => setDialogNome(null)}
            t={t}
          />
        ) : (
          <DialogNomePasta
            key={`renomear-${dialogNome.id}`}
            titulo={preencher(t.controlRoom.renomearPastaTitulo, {
              pasta: dialogNome.rotulo,
            })}
            descricao={t.controlRoom.renomearPastaDesc}
            valorInicial={dialogNome.rotulo}
            irmas={dialogNome.irmas}
            rotuloConfirmar={t.controlRoom.salvar}
            onConfirmar={(nome) => {
              onRenomearPasta(dialogNome.id, nome, dialogNome.paiId);
              setDialogNome(null);
            }}
            onFechar={() => setDialogNome(null)}
            t={t}
          />
        )
      ) : null}
    </aside>
  );
}

// ===========================================================================
// Painel 2 — lista de mensagens
// ===========================================================================

// --- Filtro de intervalo de datas (#110) -----------------------------------
// Serialização, resolução do intervalo e predicado client-side agora vivem no
// filters slice (#129); a UI abaixo mantém somente o registry DateSelector.

// #1058: a tradução do DateSelector agora vive no namespace `dateSelector` do
// strings.ts (pt E en), montada por `montarDateSelectorI18n`. Trimestres (Q1–Q4)
// e semestres (H1–H2) seguem iguais nos dois idiomas — notação de negócio que
// bate com o parser de linguagem natural do input.
