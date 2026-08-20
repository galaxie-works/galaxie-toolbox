
import { BridgeHeaderIcon } from "@/components/ui/icons/marca-anim";

import { Button } from "@/components/ui/button";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { BridgeSplit } from "@/components/bridge/bridge-split";
import { PAGINA, useListaMensagens } from "@/hooks/use-lista-mensagens";
import { FolderSidebar } from "@/components/bridge/folder-sidebar";
import { MessageList, type FormatoSalvar } from "@/components/bridge/message-list";
import { MessageDetail, type MessageDetailHandle } from "@/components/bridge/message-detail";

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/reui/alert";

// #1060: catálogo declarativo dos atalhos do Bridge (fonte única) — os tooltips/
// aria-labels das ações icon-only leem daqui, a MESMA fonte da ajuda "?".

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { Spinner } from "@/components/ui/spinner";
import { NovaMensagemModal } from "@/components/compose/nova-mensagem-modal";
import { AgendaView } from "@/components/agenda/agenda-view";

import { PeopleView } from "@/components/people/people-view";
import { UniversalSearch } from "@/components/universal-search";

// Ícones animados das pastas de e-mail (#494) — lucide-animated via registry.

import { toast } from "sonner";
import { toastIcone, toastMensagem } from "@/lib/toasts";
import * as api from "@/lib/api";
import { surfaceSuportada } from "@/lib/capabilities-surface";
import { CAIXA_PROPRIA } from "@/lib/bridge-compose";
import { configurarDominioFotos, configurarEscopoFotos } from "@/lib/fotos";

import { preencher, useIdioma } from "@/lib/idioma";

import { recursoOrgDisponivel } from "@/lib/tier";
import { useAppStore } from "@/store";
import { escopoDeFiltros } from "@/store/filters-slice";
import { tocarSomEscopo } from "@/lib/sons-notificacao";
import { useDebounce } from "@/hooks/use-debounce";

import { EventoDialog } from "@/components/bridge/evento-dialog";
import { BotaoExcluir, IlustracaoCards, type PastaDestino } from "@/components/bridge/message-shared";
import { rotuloPasta } from "@/lib/pastas-email";
import { comLoginHint } from "@/lib/utils";
import type {
  AppUser,
  EmailItem,
  PastaEmail,
} from "@/lib/types";
import { TriangleAlert } from "lucide-react";
// #489: ícones de collapse do registry animate-ui (animados), por estado.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/** #109 removeu o esconder-escopo em 400; a coleção canônica permanece vazia. */
const FILTROS_OCULTOS = new Set<string>();

import { quandoCurto } from "@/lib/data-email";

// #640 (re-spec): a impressão saiu do front. O `window.print()` de um iframe cai
// no diálogo LEGADO do Windows (Win32); o PO quer o PREVIEW do Chromium. Isso só
// vem do COM nativo `ICoreWebView2_16::ShowPrintUI(BROWSER)`, feito no backend
// (`cr_imprimir_email`, reusa `compor_html` + a engine de janela do #639). O front
// agora só dispara o comando — ver `imprimir()` no ControlRoomScreen.

// --- empty states (reui c-empty-15 / c-empty-20) ---------------------------

function descricaoErroEscrita(
  erro: unknown,
  t: ReturnType<typeof useIdioma>["t"]
) {
  const detalhe = String(erro);
  return /\b403\b|sem permissão|permission/i.test(detalhe)
    ? t.controlRoom.caixaSemPermissaoEscrita
    : detalhe;
}

/** Contexto exibido no painel de detalhe quando há multi-seleção (c-empty-15). */
function MultiSelecaoContexto({
  n,
  onExcluir,
  onLimpar,
  t,
}: {
  n: number;
  onExcluir: () => void | Promise<void>;
  onLimpar: () => void;
  t: ReturnType<typeof useIdioma>["t"];
}) {
  return (
    <section className="flex h-full items-center justify-center rounded-xl border bg-card">
      <Empty className="py-10">
        <EmptyHeader>
          <EmptyMedia>
            <IlustracaoCards />
          </EmptyMedia>
          <EmptyTitle>
            {preencher(
              n === 1 ? t.controlRoom.conversaSelecionada : t.controlRoom.conversasSelecionadas,
              { n }
            )}
          </EmptyTitle>
          <EmptyDescription>{t.controlRoom.multiSelecaoDica}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onLimpar}>
              {t.controlRoom.limparSelecao}
            </Button>
            <BotaoExcluir
              size="medium"
              onExcluir={onExcluir}
              onConcluir={onLimpar}
              rotulo={t.controlRoom.excluirSelecionados}
              rotuloProcessando={t.controlRoom.excluindo}
              rotuloConcluido={t.controlRoom.excluidos}
            />
          </div>
        </EmptyContent>
      </Empty>
    </section>
  );
}


// ===========================================================================
// Painel 1 — pastas
// ===========================================================================

/** Achata a árvore de pastas em profundidade (pai antes dos filhos). */
function achatarPastas(
  raizes: PastaEmail[],
  subpastas: Record<string, PastaEmail[]>,
  t: ReturnType<typeof useIdioma>["t"],
  profundidade = 0,
  prefixo = ""
): PastaDestino[] {
  const out: PastaDestino[] = [];
  for (const p of raizes) {
    const rotulo = rotuloPasta(p.tipo, p.nome, t);
    const caminho = prefixo ? `${prefixo} / ${rotulo}` : rotulo;
    out.push({ id: p.id, rotulo, caminho, profundidade });
    const filhos = subpastas[p.id];
    if (filhos && filhos.length > 0) {
      out.push(...achatarPastas(filhos, subpastas, t, profundidade + 1, caminho));
    }
  }
  return out;
}

/**
 * Dialog "Adicionar caixa compartilhada" (#111). Valida o endereço na hora via
 * `api.crValidarCaixa` (GET /users/{addr}/mailFolders/inbox no backend): 200
 * adiciona; 403 → "você não tem acesso a essa caixa"; 404 → "endereço não
 * encontrado"; precisa_relogin → "faça login novamente" (escopo Mail.Read.Shared
 * novo na SCOPES, ainda fora do token da sessão atual).
 */
function DialogAdicionarCaixa({
  existentes,
  avisoRelogin,
  onAdicionada,
  onFechar,
  t,
}: {
  existentes: string[];
  /** Token atual sem Mail.Read.Shared: mostra o aviso de relogin já ao abrir. */
  avisoRelogin: boolean;
  onAdicionada: (endereco: string) => void;
  onFechar: () => void;
  t: ReturnType<typeof useIdioma>["t"];
}) {
  const [endereco, setEndereco] = useState("");
  const [validando, setValidando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const limpo = endereco.trim().toLowerCase();
  // Validação de forma no cliente (o backend revalida): reduz idas ao Graph.
  const pareceEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpo);

  async function confirmar() {
    if (!pareceEmail) {
      setErro(t.controlRoom.caixaEnderecoInvalido);
      return;
    }
    if (existentes.includes(limpo)) {
      setErro(t.controlRoom.caixaJaAdicionada);
      return;
    }
    setValidando(true);
    setErro(null);
    try {
      const r = await api.crValidarCaixa(limpo);
      if (r.status === "ok") {
        onAdicionada(r.endereco);
        toast.success(preencher(t.controlRoom.caixaAdicionada, { addr: r.endereco }));
        onFechar();
      } else if (r.status === "sem_acesso") {
        setErro(t.controlRoom.caixaSemAcesso);
      } else if (r.status === "nao_encontrado") {
        setErro(t.controlRoom.caixaNaoEncontrada);
      } else {
        setErro(t.controlRoom.caixaRelogin);
      }
    } catch {
      setErro(t.controlRoom.caixaErro);
    } finally {
      setValidando(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(aberto) => {
        if (!aberto && !validando) onFechar();
      }}
    >
      <DialogContent className="max-w-sm!">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!validando) confirmar();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t.controlRoom.caixaDialogTitulo}</DialogTitle>
            <DialogDescription>{t.controlRoom.caixaDialogDesc}</DialogDescription>
          </DialogHeader>
          {avisoRelogin ? (
            <Alert variant="warning" className="mt-2">
              <TriangleAlert />
              <AlertDescription>{t.controlRoom.caixaRelogin}</AlertDescription>
            </Alert>
          ) : null}
          <div className="grid gap-2 py-4">
            <Label htmlFor="caixa-endereco">{t.controlRoom.caixaEnderecoRotulo}</Label>
            <Input
              id="caixa-endereco"
              type="email"
              autoFocus
              value={endereco}
              onChange={(e) => {
                setEndereco(e.target.value);
                setErro(null);
              }}
              placeholder={t.controlRoom.caixaEnderecoPlaceholder}
              disabled={validando}
              aria-invalid={erro !== null}
              aria-describedby={erro ? "caixa-endereco-erro" : undefined}
            />
            {erro !== null ? (
              <p id="caixa-endereco-erro" className="text-sm text-destructive">
                {erro}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onFechar}
              disabled={validando}
            >
              {t.controlRoom.cancelar}
            </Button>
            <Button type="submit" disabled={!pareceEmail || validando}>
              {validando ? (
                <>
                  <Spinner className="size-4" /> {t.controlRoom.caixaValidando}
                </>
              ) : (
                t.controlRoom.caixaAdicionarConfirmar
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Quando a mensagem aberta é marcada como lida (#95). Espelha as três opções do
// BehaviorSettings do MailVault: imediato (default, o comportamento histórico),
// após um atraso configurável, ou só manualmente pela ação de marcar lido.
type MarcarLidoModo = "imediato" | "atraso" | "manual";
const MARCAR_LIDO_MODOS: readonly MarcarLidoModo[] = ["imediato", "atraso", "manual"];
/**
 * Atrasos oferecidos no modo "após um atraso" (segundos). Poucos presets em vez
 * do slider 1-10s do MailVault: dentro de um DropdownMenu o Radix já usa as
 * setas pro roving focus (slider ficaria inoperável no teclado), e ninguém tem
 * opinião sobre 7s vs 8s — as três intenções reais são "rápido", "só se eu
 * ficar" e "nunca". (Recomendação da pesquisa de UX da #95.)
 */
const MARCAR_LIDO_ATRASOS = [2, 5, 10] as const;
const MARCAR_LIDO_ATRASO_PADRAO = 2;

export function ControlRoomScreen({
  user,
  onAbrirLink,
  onGrantPeopleAccess,
  onReauthenticate,
  ativo = true,
  emAba = false,
}: {
  user: AppUser;
  onAbrirLink: (url: string) => void;
  onGrantPeopleAccess: () => void;
  onReauthenticate: () => void;
  /** #454: Bridge é a tela ATIVA? Repassado ao MessageList pra só instalar o
   * atalho global de teclado quando o Bridge está em primeiro plano (ele fica
   * montado/escondido em keep-alive). */
  ativo?: boolean;
  /** #868: hospedada numa ABA interna do Navigator? A aba já dá a identidade
   * (ícone + nome "Bridge"), então o hero redundante (ícone + título + subtítulo)
   * do content area some — regra do host de aba, generaliza o que o #854 fez no
   * Files. Render standalone (default `false`) mantém o hero do #490. */
  emAba?: boolean;
}) {
  const { idioma, t } = useIdioma();
  // Fotos de contatos (#39): só buscamos avatar de remetente do MESMO domínio do
  // tenant (o do usuário logado). Configura o domínio do cache aqui.
  // #712 (PS6 follow-on): fotos de remetentes internos são feature de ORG — no
  // tier pessoal/uncontracted desliga o domínio (null) → tudo cai nas iniciais.
  useEffect(() => {
    configurarDominioFotos(recursoOrgDisponivel(user) ? user.email : null);
  }, [user]);
  const bridgeView = useAppStore((s) => s.bridgeView);
  const setBridgeView = useAppStore((s) => s.setBridgeView);
  // Caixas compartilhadas (#111): lista de endereços adicionados (persistida) +
  // qual está ativa. A #112 usa este endereço em todas as leituras do Graph;
  // `me` continua sendo o default e a seleção ativa segue só nesta sessão.
  // Caixas compartilhadas migradas pro mailbox slice (#125). Chave
  // `bridge.caixasCompartilhadas` preservada; seletor assina só este campo.
  const caixasCompartilhadas = useAppStore((s) => s.caixasCompartilhadas);
  const setCaixasCompartilhadas = useAppStore((s) => s.setCaixasCompartilhadas);
  // Cache de sessão por pasta (#108): restaurar mensagens+paginação ao voltar
  // pra uma pasta em vez de refetch. Ações são estáveis (Zustand); a leitura do
  // cache é feita via getState() dentro do efeito pra NÃO re-disparar a carga a
  // cada escrita no cache (não entra nas deps do efeito).
  const setCachePasta = useAppStore((s) => s.setCachePasta);
  const atualizarCachePasta = useAppStore((s) => s.atualizarCachePasta);
  const limparCachePasta = useAppStore((s) => s.limparCachePasta);
  // Carga de mailbox/lista (#155): estado de sessão nas slices canônicas. Só a
  // lista de caixas compartilhadas persiste; os dados abaixo ficam fora do
  // partialize e não duplicam fonte no root do control-room.
  const caixaAtiva = useAppStore((s) => s.caixaAtiva);
  const setCaixaAtiva = useAppStore((s) => s.setCaixaAtiva);
  const pastas = useAppStore((s) => s.pastas);
  const setPastas = useAppStore((s) => s.setPastas);
  const subpastas = useAppStore((s) => s.subpastas);
  const setSubpastas = useAppStore((s) => s.setSubpastas);
  const recargaPastas = useAppStore((s) => s.recargaPastas);
  const setRecargaPastas = useAppStore((s) => s.setRecargaPastas);
  const pastaSel = useAppStore((s) => s.pastaSel);
  const setPastaSel = useAppStore((s) => s.setPastaSel);
  const mensagens = useAppStore((s) => s.mensagens);
  const setMensagens = useAppStore((s) => s.setMensagens);
  const caixaDados = useAppStore((s) => s.caixaDados);
  const setCaixaDados = useAppStore((s) => s.setCaixaDados);
  const recarga = useAppStore((s) => s.listaRecarga);
  const setRecarga = useAppStore((s) => s.setListaRecarga);
  const temMais = useAppStore((s) => s.temMais);
  const setTemMais = useAppStore((s) => s.setTemMais);
  const carregandoMais = useAppStore((s) => s.carregandoMais);
  const setCarregandoMais = useAppStore((s) => s.setCarregandoMais);
  const [adicionarCaixaAberto, setAdicionarCaixaAberto] = useState(false);
  // O token atual traz Mail.Read.Shared? Falso ⇒ sinaliza relogin (escopo novo
  // na SCOPES; sem consent admin — já concedido, ver AGENTS.md §1.1).
  const [sharedEscopoOk, setSharedEscopoOk] = useState(true);
  const [sharedEnvioEscopoOk, setSharedEnvioEscopoOk] = useState(false);
  useEffect(() => {
    let vivo = true;
    api
      .crMailSharedDisponivel()
      .then((ok) => {
        if (vivo) setSharedEscopoOk(ok);
      })
      .catch(() => {
        /* falha ao checar leitura/escrita: não trava a UI, assume ok */
      });
    api
      .crMailSendSharedDisponivel()
      .then((ok) => {
        if (vivo) setSharedEnvioEscopoOk(ok);
      })
      .catch(() => {
        /* envio compartilhado permanece bloqueado sem confirmação do escopo */
      });
    return () => {
      vivo = false;
    };
  }, []);
  const caixaCompartilhadaAtiva = caixaAtiva !== CAIXA_PROPRIA;
  // Coalescing da troca de pasta (#87): a SELEÇÃO (`pastaSel`) muda na hora — o
  // sidebar já destaca a pasta clicada e o cabeçalho troca de nome —, mas as
  // CARGAS de rede (mensagens + contadores) seguem `pastaCarga`, a versão
  // debounced. Clicar 5 pastas em 1s NÃO dispara 5 cargas: só a pasta em que o
  // usuário parou é buscada. Debounce curto (180ms) pra não pesar ao navegar
  // rápido sem atrasar perceptivelmente uma troca isolada.
  const DEBOUNCE_PASTA_MS = 180;
  const pastaCarga = useDebounce(pastaSel, DEBOUNCE_PASTA_MS);
  // Seleção/ativa/âncora migradas para o selection slice (#128). São estado de
  // sessão e permanecem fora da persistência.
  const msgSel = useAppStore((s) => s.msgSel);
  const setMsgSel = useAppStore((s) => s.setMensagemAtiva);
  // #604: caminho canônico de abrir mensagem (mesmo do clique na lista — seta
  // msgSel + ancoraSelecao). Usado pelo clique no corpo do toast de e-mail novo.
  const selecionarMensagem = useAppStore((s) => s.selecionarMensagem);
  const selecionados = useAppStore((s) => s.selecionados);
  const limparSelecao = useAppStore((s) => s.limparSelecao);
  const removerDaSelecao = useAppStore((s) => s.removerDaSelecao);
  // Colapsos persistem (o app guarda o estado que o usuário deixa).
  // Sidebar migrada pro ui slice (#126). Chave `bridge.sidebar` preservada.
  const sidebarAberta = useAppStore((s) => s.sidebarAberta);
  const setSidebarAberta = useAppStore((s) => s.setSidebarAberta);

  // Filters slice (#129): ordenação/filtros persistem nas chaves legadas; busca,
  // resultados e cursores são somente de sessão.
  const ordenar = useAppStore((s) => s.ordenar);
  const setOrdenar = useAppStore((s) => s.setOrdenar);
  const ordemDesc = useAppStore((s) => s.ordemDesc);
  const filtros = useAppStore((s) => s.filtros);
  const setFiltros = useAppStore((s) => s.setFiltros);
  const busca = useAppStore((s) => s.busca);
  const setBusca = useAppStore((s) => s.setBusca);
  const resultadosBusca = useAppStore((s) => s.resultadosBusca);
  const temMaisBusca = useAppStore((s) => s.temMaisBusca);
  const resultadosFiltro = useAppStore((s) => s.resultadosFiltro);
  const temMaisFiltro = useAppStore((s) => s.temMaisFiltro);
  const cancelarBusca = useAppStore((s) => s.cancelarBusca);
  const cancelarFiltroGraph = useAppStore((s) => s.cancelarFiltroGraph);
  const limparConsultas = useAppStore((s) => s.limparConsultas);
  const buscarMensagens = useAppStore((s) => s.buscarMensagens);
  const filtrarMensagens = useAppStore((s) => s.filtrarMensagens);
  const carregarMaisBuscaStore = useAppStore((s) => s.carregarMaisBusca);
  const carregarMaisFiltroStore = useAppStore((s) => s.carregarMaisFiltro);
  const mutarResultados = useAppStore((s) => s.mutarResultados);
  const removerDosResultados = useAppStore((s) => s.removerDosResultados);
  // Migração: sorts removidos do escopo (tamanho/importancia/flag — #60) que
  // ficaram no localStorage voltam pra "data", evitando estado inconsistente.
  useEffect(() => {
    if (!["data", "remetente", "assunto"].includes(ordenar as string)) setOrdenar("data");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Preferência de "marcar como lido" (#95), persistida: o app sempre guarda o
  // estado que o usuário deixa. Default = "imediato" (comportamento histórico).
  // Marcar-lido (#95) migrado pro ui slice (#126). Chaves `bridge.marcarLidoModo`
  // e `bridge.marcarLidoAtraso` preservadas; validação de valores fora-da-faixa
  // segue no efeito abaixo (localStorage é editável por fora).
  const marcarLidoModo = useAppStore((s) => s.marcarLidoModo);
  const setMarcarLidoModo = useAppStore((s) => s.setMarcarLidoModo);
  const marcarLidoAtraso = useAppStore((s) => s.marcarLidoAtraso);
  const setMarcarLidoAtraso = useAppStore((s) => s.setMarcarLidoAtraso);
  // localStorage é editável por fora (e pode ter sobra de versões antigas):
  // valor inválido volta ao padrão em vez de virar um timer NaN/eterno.
  useEffect(() => {
    if (!MARCAR_LIDO_MODOS.includes(marcarLidoModo)) setMarcarLidoModo("imediato");
    if (!MARCAR_LIDO_ATRASOS.includes(marcarLidoAtraso as (typeof MARCAR_LIDO_ATRASOS)[number]))
      setMarcarLidoAtraso(MARCAR_LIDO_ATRASO_PADRAO);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const abrirCompose = useAppStore((s) => s.abrirCompose);
  const setComposePara = useAppStore((s) => s.setComposePara);
  // Handle do leitor para os atalhos r/a/f (#28) abrirem o Sheet de resposta.
  const detalheRef = useRef<MessageDetailHandle>(null);
  const filtroServidor = escopoDeFiltros(filtros);
  const filtroGraph = filtroServidor !== null;
  const carregandoMaisRef = useRef(false);
  // #1019: os espelhos, a chave de cache e a junção de páginas vivem no
  // `useListaMensagens`. Ele devolve só FUNÇÕES — nenhum `.current` chega
  // aqui, que é o que o AC pede ("não vazam pro componente que consome").
  const {
    chaveCache,
    juntar,
    atual: atualLista,
    marcarDeletadas,
    desmarcarDeletadas,
    limparDeletadas,
    naoDeletada,
    idsDeletadas,
  } = useListaMensagens({
    pastaSel,
    caixaAtiva,
    ordenar,
    ordemDesc,
    mensagens,
  });
  // Âncora de paginação: nº já buscado do servidor (skip). NÃO é
  // `mensagens.length` — a lista encolhe ao excluir, mas o skip do Graph
  // continua avançando. Vai pro hook na fatia 4b, junto com os efeitos que o
  // usam; sozinho aqui ele ainda é lido por 7 pontos.
  const carregadosRef = useRef(0);
  // Detecta se o efeito de carga foi disparado por refresh (recarga mudou) —
  // nesse caso invalida o cache e refaz o fetch em vez de restaurar (#108).
  const recargaAnteriorRef = useRef(recarga);


  // pastas (recarrega as contagens junto com as ações e no refresh manual)
  useEffect(() => {
    let vivo = true;
    setPastas(null);
    // #803: conta sem Outlook mail (ex.: Google) NÃO bate no MS Graph — mostra
    // vazio limpo em vez de martelar /me/mailFolders e tomar 401 em toda pasta.
    if (!surfaceSuportada(user, "mail")) {
      setPastas([]);
      return () => {
        vivo = false;
      };
    }
    api
      .crMailFolders(caixaAtiva)
      .then((p) => vivo && setPastas(p))
      .catch(() => vivo && setPastas([]));
    return () => {
      vivo = false;
    };
  }, [caixaAtiva, recarga, recargaPastas, setPastas, user]);

  // Cache de SUBPASTAS (childFolders), compartilhado pelo sidebar (expandir) e
  // pelo submenu "Mover para pasta…" (#88). Carrega sob demanda e memoriza; o
  // ref evita pedir duas vezes a mesma pasta (o sidebar e o submenu podem pedir
  // quase ao mesmo tempo).
  const subpastasPedidasRef = useRef<Set<string>>(new Set());
  const carregarSubpastas = useCallback(
    (id: string) => {
      if (subpastasPedidasRef.current.has(id)) return;
      subpastasPedidasRef.current.add(id);
      const caixaPedido = caixaAtiva;
      api
        .crSubpastas(id, caixaAtiva)
        .then((cs) => {
          if (atualLista().caixaAtiva !== caixaPedido) return;
          setSubpastas((f) => ({ ...f, [id]: cs }));
        })
        .catch((e) => {
          if (atualLista().caixaAtiva !== caixaPedido) return;
          setSubpastas((f) => ({ ...f, [id]: [] }));
          if (String(e).toLowerCase().includes("acesso parcial")) {
            toast.warning(t.controlRoom.caixaAcessoParcial);
          }
        });
    },
    [caixaAtiva, setSubpastas, t]
  );

  // Trocar de caixa é uma fronteira de dados: nenhuma seleção, paginação,
  // subpasta, busca ou cache de foto da caixa anterior pode aparecer na nova.
  useEffect(() => {
    configurarEscopoFotos(caixaAtiva);
    setSubpastas({});
    subpastasPedidasRef.current.clear();
    setPedirArvore(false);
    setPastaSel("inbox");
    setMensagens(null);
    setMsgSel(null);
    limparSelecao();
    limparConsultas();
    setTemMais(false);
    carregadosRef.current = 0;
    limparDeletadas();
    ultimoVistoRef.current = null;
  }, [
    caixaAtiva,
    limparConsultas,
    limparSelecao,
    setMensagens,
    setMsgSel,
    setPastaSel,
    setSubpastas,
    setTemMais,
  ]);

  // O submenu "Mover para…" precisa da árvore INTEIRA (não só do que o usuário
  // expandiu no sidebar). Ao abrir pela primeira vez, `pedirArvore` liga e este
  // efeito pede as subpastas que faltam; como ele depende de `subpastas`, cada
  // lote que chega dispara o nível seguinte — a árvore se completa sozinha, sem
  // recursão manual e sem buscar nada antes do usuário precisar.
  const [pedirArvore, setPedirArvore] = useState(false);
  const conhecidas = useMemo(
    () => [...(pastas ?? []), ...Object.values(subpastas).flat()],
    [pastas, subpastas]
  );
  // Pastas que declaram filhos (childFolderCount > 0) mas ainda não voltaram.
  const arvorePendentes = useMemo(
    () => conhecidas.filter((p) => p.filhos > 0 && subpastas[p.id] === undefined),
    [conhecidas, subpastas]
  );
  useEffect(() => {
    if (!pedirArvore) return;
    for (const p of arvorePendentes) carregarSubpastas(p.id);
  }, [pedirArvore, arvorePendentes, carregarSubpastas]);

  // Árvore achatada COMPLETA: base dos dois "mover". O de MENSAGENS (#88) tira
  // a pasta atual (mover pra onde a mensagem já está não é opção); o de PASTA
  // (#90) tira a própria pasta e as descendentes, mas isso depende de qual pasta
  // foi clicada — quem filtra é o sidebar.
  const arvorePastas = useMemo(
    () => achatarPastas(pastas ?? [], subpastas, t),
    [pastas, subpastas, t]
  );
  const pastasDestino = useMemo(
    () => arvorePastas.filter((p) => p.id !== pastaSel),
    [arvorePastas, pastaSel]
  );
  const pastaCargaAcessoNegado =
    pastas?.some((p) => p.id === pastaCarga && p.leitura === "negado") ?? false;

  // Detecção central de e-mails novos na Inbox: compara o topo da lista com o
  // último visto e dispara o toast rico (c-sonner-9). Chamada tanto pelo poll
  // (usuário parado) QUANTO ao recarregar a lista da inbox (refresh manual).
  // Antes o refresh só resetava o baseline sem avisar — por isso o toast "não
  // aparecia" ao dar refresh depois de receber um e-mail (#43).
  const ultimoVistoRef = useRef<string | null>(null);
  const notificarNovos = useCallback(
    // Retorna quantos e-mails novos detectou (0 no baseline) — o poll usa isso
    // pra invalidar o cache da inbox só quando de fato chegou algo (#108).
    (ms: EmailItem[]): number => {
      if (ms.length === 0) return 0;
      // Baseline = o MAIOR recebido da lista, não ms[0]: com a inbox ordenável
      // (#32) o topo pode não ser o mais recente (ordem ≠ data / ascendente),
      // o que geraria toast espúrio/ausente no poll seguinte (#54).
      const maxRecebido = ms.reduce(
        (mx, m) => (m.recebido > mx ? m.recebido : mx),
        ms[0].recebido
      );
      const anterior = ultimoVistoRef.current;
      ultimoVistoRef.current = maxRecebido;
      if (anterior === null) return 0; // baseline: não avisa no 1º carregamento
      const novos = ms.filter((m) => m.recebido > anterior && !m.lido);
      // #48: toca o som configurado para "E-mails recebidos" uma vez por lote
      // (nada se o usuário escolheu "Não tocar nada").
      if (novos.length > 0) tocarSomEscopo("emailRecebido");
      for (const m of novos.slice(0, 3)) {
        toastMensagem({
          nome: m.de,
          iniciais: m.iniciais,
          texto: `${m.assunto} — ${m.preview}`,
          quando: quandoCurto(m.recebido, idioma),
          rotuloResponder: t.controlRoom.responder,
          rotuloDispensar: t.controlRoom.dispensar,
          onResponder: () => {
            setPastaSel("inbox");
            setMsgSel(m.id);
          },
          // #604: clicar no corpo do toast abre o e-mail no leitor, pelo mesmo
          // caminho do clique na lista (seleção + reader).
          onAbrir: () => {
            setPastaSel("inbox");
            selecionarMensagem(m.id);
          },
        });
      }
      return novos.length;
    },
    // idioma/t só mudam ao trocar idioma; as ações do store são estáveis.
    [idioma, selecionarMensagem, setMsgSel, setPastaSel, t]
  );

  // Poll leve da Inbox (pega e-mail novo enquanto o usuário está parado). O
  // intervalo é configurável em Settings > Bridge > Sync (#227); padrão 15 min
  // (comportamento histórico). Mudar a preferência remonta o efeito com o novo
  // intervalo. No mount NÃO chamamos — o efeito de mensagens já busca a inbox e
  // semeia o baseline; um fetch duplo aqui competia e o Graph estrangulava (429).
  const syncIntervalMinutes = useAppStore((s) => s.syncIntervalMinutes);
  useEffect(() => {
    let vivo = true;
    const INTERVALO = Math.max(1, syncIntervalMinutes) * 60 * 1000;
    const iv = setInterval(async () => {
      try {
        const msgs = await api.crFolderMensagens("inbox", 0, "data", true, "me");
        if (!vivo) return;
        const novos = notificarNovos(msgs);
        // #603: chegou e-mail novo enquanto o usuário estava parado. Antes só
        // invalidávamos o cache (#108) — mas a LISTA exibida não re-renderizava,
        // então o novo só aparecia ao clicar Refresh. Agora, se o usuário está
        // vendo justamente a inbox própria em data-desc sem busca/filtro (= o
        // que o poll buscou), PREPENDAMOS os novos na lista exibida + no cache,
        // sem resetar seleção/scroll (o MessageList reancora o scroll). Fora
        // desse caso, mantém o comportamento antigo: só invalida.
        if (novos > 0) {
          const st = useAppStore.getState();
          const espelhaInbox =
            atualLista().pastaSel === "inbox" &&
            atualLista().caixaAtiva === CAIXA_PROPRIA &&
            atualLista().ordenar === "data" &&
            atualLista().ordemDesc === true &&
            st.caixaDados === CAIXA_PROPRIA &&
            st.busca.trim() === "" &&
            st.filtros.length === 0;
          const atuais = atualLista().mensagens ?? [];
          const vistos = new Set(atuais.map((m) => m.id));
          const aPrepender = espelhaInbox
            ? msgs.filter(
                (m) => !vistos.has(m.id) && naoDeletada(m.id)
              )
            : [];
          if (aPrepender.length > 0) {
            // Prepend na lista exibida (setter aceita Updater; preserva msgSel e
            // seleção, que são por id) e no cache da pasta (não invalida).
            setMensagens((prev) => [...aPrepender, ...(prev ?? [])]);
            atualizarCachePasta(chaveCache("inbox", "me"), (e) => ({
              mensagens: [...aPrepender, ...e.mensagens],
              carregados: e.carregados,
              temMais: e.temMais,
            }));
          } else if (!espelhaInbox) {
            // Usuário está noutra pasta/caixa/ordem/busca: só invalida pra
            // rebuscar ao voltar (comportamento #108).
            limparCachePasta(chaveCache("inbox", "me"));
          }
        }
      } catch {
        /* silencioso: é só o aviso de novos e-mails */
      }
    }, INTERVALO);
    return () => {
      vivo = false;
      clearInterval(iv);
    };
    // setMensagens/atualizarCachePasta são ações estáveis do store (#603); os
    // refs de pasta/caixa/ordem/mensagens são lidos por .current, fora das deps.
  }, [
    syncIntervalMinutes,
    notificarNovos,
    limparCachePasta,
    chaveCache,
    setMensagens,
    atualizarCachePasta,
  ]);

  // Recarrega o que a mutação de uma PASTA invalidou: as contagens do sidebar
  // sempre; a LISTA só quando a pasta mexida é a que está aberta (senão a lista
  // perderia scroll/páginas à toa).
  function recarregarAposPasta(folderId: string) {
    if (folderId === atualLista().pastaSel) setRecarga((x) => x + 1);
    else setRecargaPastas((x) => x + 1);
  }

  // Esvazia uma pasta (Lixeira / Lixo Eletrônico). Chamado pelo botão do
  // cabeçalho da lista e pelo menu de contexto da pasta (#89) — este último já
  // passou pelo AlertDialog de confirmação.
  async function esvaziarPasta(folderId: string) {
    const aviso = toast.loading(t.controlRoom.esvaziandoPasta);
    try {
      const n = await api.crEsvaziarPasta(folderId, caixaAtiva);
      // #788: INVALIDA o cache da pasta esvaziada — senão a lista serve as
      // mensagens velhas (não atualiza) e, ao revisitar a pasta com IDs de
      // mensagens já deletadas, uma request falha e cai no toast de erro
      // ("That didn't go through"). Mesmo caminho que o Refresh manual usa; agora
      // a lista fica vazia na hora e a revisita rebusca do zero, sem erro.
      limparCachePasta(chaveCache(folderId));
      toast.success(preencher(t.controlRoom.pastaEsvaziada, { n }), { id: aviso });
      recarregarAposPasta(folderId);
    } catch (e) {
      toast.error(t.controlRoom.erroAcao, {
        id: aviso,
        description: descricaoErroEscrita(e, t),
      });
    }
  }

  // Marca como lidas todas as não lidas de uma pasta (#89). Pode demorar (loop
  // de PATCH no Graph), então mostra toast de progresso.
  async function marcarPastaLida(folderId: string) {
    const aviso = toast.loading(t.controlRoom.marcandoTodasLidas);
    try {
      const n = await api.crMarcarPastaLida(folderId, caixaAtiva);
      if (n === 0) toast.info(t.controlRoom.nenhumaNaoLida, { id: aviso });
      else toast.success(preencher(t.controlRoom.todasMarcadasLidas, { n }), { id: aviso });
      recarregarAposPasta(folderId);
    } catch (e) {
      toast.error(t.controlRoom.erroAcao, {
        id: aviso,
        description: descricaoErroEscrita(e, t),
      });
    }
  }

  // ---- CRUD de subpastas (#90) --------------------------------------------
  // Toda mutação de pasta invalida DUAS coisas: as contagens/lista de raízes
  // (`recargaPastas` → refaz `crMailFolders`) e o cache de subpastas do(s) pai(s)
  // afetado(s) — que é memoizado e não voltaria sozinho.
  const recarregarSubpastas = useCallback(
    (...ids: (string | undefined)[]) => {
      for (const id of ids) {
        if (!id) continue;
        // Solta a trava de "já pedi" e limpa o cache, senão `carregarSubpastas`
        // devolveria a lista velha (sem a pasta nova / com a que saiu).
        subpastasPedidasRef.current.delete(id);
        setSubpastas((f) => {
          const n = { ...f };
          delete n[id];
          return n;
        });
        carregarSubpastas(id);
      }
      setRecargaPastas((x) => x + 1);
    },
    [carregarSubpastas, setRecargaPastas, setSubpastas]
  );

  async function criarSubpasta(paiId: string, nome: string) {
    const aviso = toast.loading(t.controlRoom.criandoSubpasta);
    try {
      const nova = await api.crCriarSubpasta(paiId, nome, caixaAtiva);
      toast.success(preencher(t.controlRoom.subpastaCriada, { pasta: nova.nome }), {
        id: aviso,
      });
      recarregarSubpastas(paiId);
    } catch (e) {
      toast.error(t.controlRoom.erroAcao, {
        id: aviso,
        description: descricaoErroEscrita(e, t),
      });
    }
  }

  async function renomearPasta(id: string, nome: string, paiId?: string) {
    const aviso = toast.loading(t.controlRoom.renomeandoPasta);
    try {
      const nova = await api.crRenomearPasta(id, nome, caixaAtiva);
      toast.success(preencher(t.controlRoom.pastaRenomeada, { pasta: nova.nome }), {
        id: aviso,
      });
      recarregarSubpastas(paiId);
    } catch (e) {
      toast.error(t.controlRoom.erroAcao, {
        id: aviso,
        description: descricaoErroEscrita(e, t),
      });
    }
  }

  async function excluirPasta(id: string, rotulo: string, paiId?: string) {
    const aviso = toast.loading(t.controlRoom.excluindoPasta);
    try {
      // `true` = foi pra Lixeira (reversível, o caminho normal); `false` = o
      // backend teve que cair no DELETE definitivo. O toast diz qual foi.
      const paraLixeira = await api.crExcluirPasta(id, caixaAtiva);
      toast.success(
        preencher(
          paraLixeira
            ? t.controlRoom.pastaExcluida
            : t.controlRoom.pastaExcluidaDefinitiva,
          { pasta: rotulo }
        ),
        { id: aviso }
      );
      // A pasta saiu do pai e (quando vai pra lixeira) virou filha de
      // deleteditems — os dois caches precisam voltar do Graph.
      recarregarSubpastas(paiId, "deleteditems");
      // Estava aberta? O id morreu junto: cai na inbox em vez de ficar numa
      // pasta fantasma com a lista vazia.
      if (atualLista().pastaSel === id) setPastaSel("inbox");
    } catch (e) {
      toast.error(t.controlRoom.erroAcao, {
        id: aviso,
        description: descricaoErroEscrita(e, t),
      });
    }
  }

  async function moverPasta(
    id: string,
    destino: string,
    rotuloDestino: string,
    paiId?: string
  ) {
    const aviso = toast.loading(t.controlRoom.movendoPasta);
    try {
      const nova = await api.crMoverPasta(id, destino, caixaAtiva);
      toast.success(preencher(t.controlRoom.pastaMovida, { pasta: rotuloDestino }), {
        id: aviso,
      });
      recarregarSubpastas(paiId, destino);
      // O move do Graph devolve a pasta com id NOVO: se ela estava selecionada,
      // seguir com o id antigo deixaria a lista quebrada.
      if (atualLista().pastaSel === id) setPastaSel(nova.id);
    } catch (e) {
      toast.error(t.controlRoom.erroAcao, {
        id: aviso,
        description: descricaoErroEscrita(e, t),
      });
    }
  }

  // Ações rápidas da LISTA (sinalizar/excluir por linha ou em lote).
  // Atualizam a lista NO LUGAR (nada de recarregar tudo e perder scroll/páginas).
  //
  // Aplicam a AMBAS as listas (pasta + resultados de busca) — quando a busca
  // está ativa o que aparece é `resultadosBusca`, então mutar só `mensagens`
  // não refletia na tela (QA #1).
  const mutarNasListas = (fn: (m: EmailItem) => EmailItem) => {
    setMensagens((prev) => prev?.map(fn) ?? prev);
    mutarResultados(fn);
    // Espelha no cache da pasta atual (#108): flag/lido não "voltam" ao retornar.
    atualizarCachePasta(chaveCache(pastaCarga), (e) => ({
      ...e,
      mensagens: e.mensagens.map(fn),
    }));
  };
  const removerNasListas = (ids: Set<string>) => {
    setMensagens((prev) => prev?.filter((m) => !ids.has(m.id)) ?? prev);
    removerDosResultados(ids);
    // Espelha a remoção no cache (#108): o item excluído/movido não reaparece ao
    // voltar. `carregados` (skip do Graph) é preservado de propósito.
    atualizarCachePasta(chaveCache(pastaCarga), (e) => ({
      ...e,
      mensagens: e.mensagens.filter((m) => !ids.has(m.id)),
    }));
  };

  // Marca lido/não-lido (otimista, nos dois sentidos): ajusta o ponto de
  // não-lido e a contagem da pasta na hora; PATCH isRead em background com
  // rollback. Usado pelo auto-mark ao abrir e pela ação manual de "não-lido".
  function acaoMarcarLido(id: string, lido: boolean) {
    const m =
      mensagens?.find((x) => x.id === id) ??
      resultadosBusca?.find((x) => x.id === id) ??
      resultadosFiltro?.find((x) => x.id === id);
    if (!m || m.lido === lido) return;
    const delta = lido ? -1 : 1; // lido → menos 1 não-lido; não-lido → mais 1
    mutarNasListas((x) => (x.id === id ? { ...x, lido } : x));
    setPastas((prev) =>
      prev?.map((p) =>
        p.id === pastaSel ? { ...p, naoLidos: Math.max(0, p.naoLidos + delta) } : p
      ) ?? prev
    );
    api.crMarcarLido(id, lido, caixaAtiva).catch((e) => {
      mutarNasListas((x) => (x.id === id ? { ...x, lido: !lido } : x));
      setPastas((prev) =>
        prev?.map((p) =>
          p.id === pastaSel ? { ...p, naoLidos: Math.max(0, p.naoLidos - delta) } : p
        ) ?? prev
      );
      toast.error(t.controlRoom.erroAcao, {
        description: descricaoErroEscrita(e, t),
      });
    });
  }

  // `acaoMarcarLido` é recriada a cada render (fecha sobre mensagens/pastas). O
  // timer do modo "atraso" dispara MUITO depois do render que o agendou, então
  // guardamos sempre a versão mais nova num ref: o callback atrasado lê o estado
  // atual (inclusive o guard `m.lido === lido`, que evita contar duas vezes se o
  // usuário marcou lido na mão antes do tempo).
  const marcarLidoRef = useRef(acaoMarcarLido);
  useEffect(() => {
    marcarLidoRef.current = acaoMarcarLido;
  });

  // Previewar a mensagem = lê-la (como em qualquer leitor) — mas AGORA conforme
  // a preferência do usuário (#95):
  //  - "imediato": marca lido assim que a mensagem é selecionada (default);
  //  - "atraso":   marca lido depois de N segundos DE LEITURA. O cleanup do
  //                efeito cancela o timer quando o usuário troca de mensagem
  //                antes do tempo (ou sai da tela / muda a preferência), então
  //                passar por cima de várias mensagens não marca nenhuma;
  //  - "manual":   não marca nada — só a ação explícita de marcar lido marca.
  useEffect(() => {
    if (!msgSel || marcarLidoModo === "manual") return;
    if (marcarLidoModo === "imediato") {
      marcarLidoRef.current(msgSel, true);
      return;
    }
    const timer = window.setTimeout(
      () => marcarLidoRef.current(msgSel, true),
      Math.max(1, marcarLidoAtraso) * 1000
    );
    return () => window.clearTimeout(timer);
  }, [msgSel, marcarLidoModo, marcarLidoAtraso]);

  async function acaoFlag(id: string, novo: boolean) {
    // otimista: pinta o item já nas duas listas.
    mutarNasListas((m) => (m.id === id ? { ...m, sinalizado: novo } : m));
    try {
      await api.crMarcarEmail(id, novo, caixaAtiva);
      toastIcone(
        novo ? t.controlRoom.flagAdicionada : t.controlRoom.flagRemovida,
        "",
        novo ? "marcado" : "desmarcado"
      );
    } catch (e) {
      // desfaz
      mutarNasListas((m) => (m.id === id ? { ...m, sinalizado: !novo } : m));
      toast.error(t.controlRoom.erroAcao, {
        description: descricaoErroEscrita(e, t),
      });
    }
  }

  async function acaoExcluir(ids: string[]) {
    if (ids.length === 0) return;
    const idsSet = new Set(ids);
    // Fonte = lista atualmente visível (pasta ou resultados de busca), pra
    // contar não-lidos certo e remover de onde o item de fato está (QA #1).
    const fonte =
      (filtroGraph
        ? resultadosFiltro
        : busca.trim() !== ""
          ? resultadosBusca
          : mensagens) ?? [];
    const removidas = fonte.filter((m) => idsSet.has(m.id));
    const naoLidosFora = removidas.filter((m) => !m.lido).length;

    // 1) OTIMISTA: tira da tela na hora (das duas listas) + marca como
    //    "deletada" (pro backfill não trazê-las de volta) + toast imediato.
    marcarDeletadas(ids);
    removerNasListas(idsSet);
    if (msgSel && idsSet.has(msgSel)) setMsgSel(null);
    // NÃO limpamos a seleção aqui: o BotaoExcluir precisa ficar montado pra
    // completar a animação (processando → sucesso) e só então limpa via
    // onConcluir. Os outros gatilhos (atalho Delete) limpam explicitamente (#23).

    // 2) Contagens do sidebar já refletem: pasta atual −N (e −não lidos),
    //    Lixeira +N (a menos que a exclusão seja dentro da própria Lixeira).
    setPastas((prev) =>
      prev?.map((p) => {
        if (p.id === pastaSel && p.tipo !== "deleteditems") {
          return {
            ...p,
            total: Math.max(0, p.total - ids.length),
            naoLidos: Math.max(0, p.naoLidos - naoLidosFora),
          };
        }
        if (p.tipo === "deleteditems" && pastaSel !== "deleteditems") {
          return { ...p, total: p.total + ids.length };
        }
        return p;
      }) ?? prev
    );

    // 3) Toast imediato de confirmação.
    toast.success(
      ids.length > 1
        ? preencher(t.controlRoom.selecionadosExcluidos, { n: ids.length })
        : t.controlRoom.emailExcluido
    );

    // (o backfill acontece sozinho pelo efeito de buffer quando a lista encurta)

    // 4) Exclusão real em background + reconcile. Se algum falhar, avisa e
    //    recarrega a pasta pra ressincronizar (o item volta se não saiu).
    (async () => {
      // Enquanto a exclusão roda, vai atualizando as contagens (a Lixeira
      // "preenchendo") — e a lista da Lixeira se o usuário estiver vendo ela —
      // pra não ficar parado até o fim (o move é sequencial e pode demorar).
      const pulso = setInterval(() => {
        setRecargaPastas((x) => x + 1);
        if (atualLista().pastaSel === "deleteditems") setRecarga((x) => x + 1);
      }, 2500);
      let ok: string[] = [];
      let erro: unknown = null;
      try {
        // Dentro da própria Lixeira = exclusão definitiva; senão move pra Lixeira.
        ok = await api.crExcluirEmails(ids, pastaSel === "deleteditems", caixaAtiva);
      } catch (e) {
        erro = e;
        ok = [];
      } finally {
        clearInterval(pulso);
      }
      const falharam = ids.filter((id) => !ok.includes(id));
      if (falharam.length > 0) {
        desmarcarDeletadas(falharam);
        toast.error(t.controlRoom.erroAcao, {
          description: erro ? descricaoErroEscrita(erro, t) : undefined,
        });
        setRecarga((n) => n + 1); // ressincroniza lista + contagens do zero
      } else {
        setRecargaPastas((x) => x + 1); // reconcilia contagens reais
        if (atualLista().pastaSel === "deleteditems") setRecarga((x) => x + 1);
      }
    })();
  }

  /**
   * #636 (épico #635): "Salvar como…" — abre o seletor de pasta do sistema e
   * chama o backend POR FORMATO (contrato do #637: `SalvarEmailResultado` com
   * `salvos`/`falhas`). `.eml` já é real (#637); PDF/.msg são stub em S1 (#639/
   * #638). Sucesso → toast com "Abrir pasta"; falha parcial → um toast por item.
   */
  async function salvarComo(ids: string[], formato: FormatoSalvar) {
    if (ids.length === 0) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const pasta = await open({
        directory: true,
        title: t.controlRoom.escolherPasta,
      });
      if (typeof pasta !== "string") return; // cancelou o diálogo
      const res =
        formato === "eml"
          ? await api.crSalvarEmailEml(ids, pasta, caixaAtiva)
          : await api.crSalvarEmailPdf(ids, pasta, caixaAtiva);
      if (res.salvos.length > 0) {
        toast.success(
          preencher(t.controlRoom.salvarSucesso, {
            n: res.salvos.length,
            pasta,
          }),
          {
            action: {
              // Alinhado com o #637 (Confucius): revela o 1º arquivo salvo no
              // Explorer (mesmo padrão do toastDownload), não só abre a pasta.
              label: t.controlRoom.abrirPasta,
              onClick: () => void api.revelarNoExplorer(res.salvos[0]),
            },
          }
        );
      }
      // Falha parcial (#637): um toast de erro por item que não salvou.
      res.falhas.forEach((f) =>
        toast.error(preencher(t.controlRoom.salvarErroItem, { assunto: f.assunto }), {
          description: f.erro,
        })
      );
    } catch (e) {
      toast.error(t.controlRoom.erroAcao, { description: String(e) });
    }
  }

  /**
   * #640 (re-spec): "Imprimir" — abre o PREVIEW do Chromium (não o diálogo legado
   * Win32) sobre o e-mail ABERTO no leitor. O backend `cr_imprimir_email` reusa o
   * `compor_html` + a engine de janela do #639 e chama o COM `ShowPrintUI(BROWSER)`
   * numa janela visível com só o e-mail. Escopo = e-mail em leitura (`msgSel`);
   * sem e-mail aberto não faz nada (o item do menu já fica desabilitado).
   */
  async function imprimir() {
    const msgSel = useAppStore.getState().msgSel;
    if (!msgSel) return;
    try {
      await api.crImprimirEmail([msgSel], caixaAtiva);
    } catch (e) {
      toast.error(t.controlRoom.erroAcao, { description: String(e) });
    }
  }

  /**
   * Move e-mails para outra pasta (#88) — mesmo desenho otimista do
   * `acaoExcluir` (que também é um move, pra Lixeira): some da lista na hora,
   * contadores das pastas ORIGEM e DESTINO ajustados, toast imediato e, no
   * fundo, o POST /messages/{id}/move em série. Se algum falhar, avisa e
   * recarrega a pasta pra ressincronizar (o item volta se não saiu).
   */
  async function acaoMover(ids: string[], destino: string, rotuloDestino: string) {
    if (ids.length === 0 || !destino || destino === pastaSel) return;
    const idsSet = new Set(ids);
    // Fonte = lista visível (pasta, busca ou filtro Graph), como no excluir.
    const fonte =
      (filtroGraph
        ? resultadosFiltro
        : busca.trim() !== ""
          ? resultadosBusca
          : mensagens) ?? [];
    const movidas = fonte.filter((m) => idsSet.has(m.id));
    const naoLidosFora = movidas.filter((m) => !m.lido).length;

    // 1) OTIMISTA: tira da tela e marca como "saiu daqui" (mesmo registro que o
    //    excluir usa) pra o backfill/paginação não trazer as mensagens de volta.
    marcarDeletadas(ids);
    removerNasListas(idsSet);
    // Invalida o cache do DESTINO (#108): a lista de lá agora está desatualizada
    // (ganhou estes itens) — força rebusca na próxima visita em vez de servir stale.
    limparCachePasta(chaveCache(destino));
    removerDaSelecao(ids);

    // 2) Contadores do sidebar: origem −N, destino +N (só se o destino for uma
    //    pasta do sidebar — subpasta não aparece lá e não tem o que ajustar).
    setPastas((prev) =>
      prev?.map((p) => {
        if (p.id === pastaSel) {
          return {
            ...p,
            total: Math.max(0, p.total - ids.length),
            naoLidos: Math.max(0, p.naoLidos - naoLidosFora),
          };
        }
        if (p.id === destino) {
          return { ...p, total: p.total + ids.length, naoLidos: p.naoLidos + naoLidosFora };
        }
        return p;
      }) ?? prev
    );

    // 3) Toast imediato de confirmação.
    toast.success(
      ids.length > 1
        ? preencher(t.controlRoom.selecionadosMovidos, {
            n: ids.length,
            pasta: rotuloDestino,
          })
        : preencher(t.controlRoom.emailMovido, { pasta: rotuloDestino })
    );

    // 4) Move de verdade em background + reconcile.
    let ok: string[] = [];
    let erro: unknown = null;
    try {
      ok = await api.crMoverEmails(ids, destino, caixaAtiva);
    } catch (e) {
      erro = e;
      ok = [];
    }
    const falharam = ids.filter((id) => !ok.includes(id));
    if (falharam.length > 0) {
      desmarcarDeletadas(falharam);
      toast.error(t.controlRoom.erroAcao, {
        description: erro ? descricaoErroEscrita(erro, t) : undefined,
      });
      setRecarga((n) => n + 1); // ressincroniza lista + contagens do zero
    } else {
      setRecargaPastas((x) => x + 1); // reconcilia as contagens reais
    }
  }

  // mensagens da pasta (1ª página); auto-seleciona a primeira e semeia o
  // baseline do polling quando é a inbox.
  //
  // #108: cache de sessão por pasta. Ao VOLTAR pra uma pasta já carregada
  // (troca de pasta, sem refresh), RESTAURA mensagens + paginação do cache SEM
  // refetch — preserva as páginas roladas e não repete requests ao Graph. Um
  // refresh (recarga muda) invalida o cache e refaz o fetch (dados frescos).
  useEffect(() => {
    if (pastaCarga !== pastaSel) return;
    let vivo = true;
    const chave = chaveCache(pastaCarga);
    // Refresh manual/ressincronização mudou `recarga`: invalida e refaz o fetch.
    const refreshForcado = recargaAnteriorRef.current !== recarga;
    recargaAnteriorRef.current = recarga;
    const store = useAppStore.getState();
    if (refreshForcado) store.limparCachePasta(chave);
    const cacheEntry = refreshForcado ? undefined : store.cachePastas[chave];

    // Comum às duas vias: troca de pasta zera seleção e busca.
    limparSelecao();
    setBusca("");
    carregandoMaisRef.current = false;
    limparDeletadas();

    // A pasta continua visível no sidebar para explicar o acesso parcial, mas
    // não insistimos em novos requests que o Graph já informou que serão 403.
    if (pastaCargaAcessoNegado) {
      carregadosRef.current = 0;
      setMensagens([]);
      setCaixaDados(caixaAtiva);
      setTemMais(false);
      setMsgSel(null);
      return () => {
        vivo = false;
      };
    }

    // VIA RESTAURAÇÃO: cache tem a pasta → repõe sem null-flash e sem rede.
    if (cacheEntry) {
      carregadosRef.current = cacheEntry.carregados;
      setMensagens(cacheEntry.mensagens);
      setCaixaDados(caixaAtiva);
      setTemMais(cacheEntry.temMais);
      const ativa = store.msgSel;
      store.setMensagemAtiva(
        ativa && cacheEntry.mensagens.some((m) => m.id === ativa)
          ? ativa
          : (cacheEntry.mensagens[0]?.id ?? null)
      );
      return () => {
        vivo = false;
      };
    }

    // VIA FETCH: cache vazio (1ª visita ou invalidado) → busca página 0 e semeia.
    setMensagens(null);
    setTemMais(false);
    carregadosRef.current = 0;
    api
      .crFolderMensagens(pastaCarga, 0, ordenar, ordemDesc, caixaAtiva)
      .then((ms) => {
        if (!vivo) return;
        carregadosRef.current = ms.length;
        setMensagens(ms);
        setCaixaDados(caixaAtiva);
        // mantém a mensagem já selecionada se ela existir na lista nova (ex.:
        // clicar "Responder" num toast já selecionou a msg antes do fetch);
        // senão pega a primeira.
        const selecao = useAppStore.getState();
        selecao.setMensagemAtiva(
          selecao.msgSel && ms.some((m) => m.id === selecao.msgSel)
            ? selecao.msgSel
            : (ms[0]?.id ?? null)
        );
        const tem = ms.length === PAGINA;
        setTemMais(tem);
        // Semeia o cache da pasta com a 1ª página (#108).
        setCachePasta(chave, { mensagens: ms, carregados: ms.length, temMais: tem });
        // Inbox: detecta e avisa e-mails novos (também no refresh manual). SÓ
        // quando a lista está em DATA-DESC — aí `ms` está com o mais novo no
        // topo e o baseline (max recebido) é confiável. Em outra ordem (ex.:
        // data-asc), a 1ª página não contém o mais novo, o baseline ficaria
        // baixo e o poll seguinte dispararia toast espúrio (#54). Nesses casos
        // o poll (que SEMPRE busca date-desc) mantém o baseline sozinho. #43
        if (pastaCarga === "inbox" && ordenar === "data" && ordemDesc) notificarNovos(ms);
      })
      .catch(() => {
        if (!vivo) return;
        setMensagens([]);
        setCaixaDados(caixaAtiva);
      });
    return () => {
      vivo = false;
    };
    // notificarNovos é estável (useCallback [idioma,t]); fora das deps de
    // propósito pra não recarregar a lista ao trocar idioma. ordenar/ordemDesc
    // ENTRAM: trocar a ordenação re-busca a lista já ordenada pelo Graph (#32).
    // pastaCarga (debounced) no lugar de pastaSel: coalesce a troca rápida (#87).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    caixaAtiva,
    pastaCarga,
    pastaSel,
    pastaCargaAcessoNegado,
    recarga,
    ordenar,
    ordemDesc,
  ]);

  // Pré-carga: busca a próxima página do servidor pela âncora (skip = já
  // buscado, não o tamanho da lista) e concatena deduplicando. Serve tanto pro
  // scroll (90%) quanto pro backfill pós-exclusão.
  async function carregarMais() {
    if (carregandoMaisRef.current || !temMais) return;
    carregandoMaisRef.current = true;
    setCarregandoMais(true);
    const caixaPedido = caixaAtiva;
    try {
      const pagina = await api.crFolderMensagens(
        pastaCarga,
        carregadosRef.current,
        ordenar,
        ordemDesc,
        caixaAtiva
      );
      if (atualLista().caixaAtiva !== caixaPedido) return;
      carregadosRef.current += pagina.length; // avança pelo offset do servidor
      const proximo = juntar(atualLista().mensagens ?? [], pagina);
      const tem = pagina.length === PAGINA;
      setMensagens(proximo);
      setTemMais(tem);
      // Persiste a página no cache da pasta (#108): ao voltar, a lista rolada
      // volta inteira sem refetch. Usa a chave da pasta que ESTÁ carregada.
      setCachePasta(chaveCache(pastaCarga), {
        mensagens: proximo,
        carregados: carregadosRef.current,
        temMais: tem,
      });
    } catch {
      /* silencioso */
    } finally {
      carregandoMaisRef.current = false;
      setCarregandoMais(false);
    }
  }

  // Buffer: se a lista ficou curta (ex.: excluiu uma página inteira) e ainda há
  // mais no servidor, repõe automaticamente — o usuário nunca vê a lista vazia
  // com mensagens sobrando na pasta.
  useEffect(() => {
    if (mensagens && mensagens.length < PAGINA && temMais && !carregandoMaisRef.current) {
      carregarMais();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mensagens, temMais]);

  // Busca server-side com debounce (300ms). Vazio = mostra a pasta normal.
  const buscaAtiva = busca.trim() !== "";
  useEffect(() => {
    const termo = busca.trim();
    // Com um filtro Graph ativo NÃO fazemos $search no servidor: o texto é
    // aplicado client-side por cima do resultado do filtro (D2).
    if (!termo || filtroGraph || pastaCargaAcessoNegado) {
      cancelarBusca();
      return;
    }
    const id = setTimeout(() => {
      void buscarMensagens({
        pastaId: pastaSel,
        termo,
        caixa: caixaAtiva,
        ignorarIds: idsDeletadas(),
      });
    }, 300);
    return () => {
      clearTimeout(id);
      cancelarBusca();
    };
  }, [
    busca,
    buscarMensagens,
    caixaAtiva,
    cancelarBusca,
    filtroGraph,
    pastaCargaAcessoNegado,
    pastaSel,
  ]);

  // Reset visual do filtro ao TROCAR de pasta (#31 / D3): um filtro Graph da
  // Inbox não faz sentido carregar pra Enviados. Só reseta em troca REAL — no
  // 1º render mantém o valor persistido (não zera o que veio do localStorage).
  const filtroPastaRef = useRef(pastaSel);
  useEffect(() => {
    if (filtroPastaRef.current !== pastaSel) {
      filtroPastaRef.current = pastaSel;
      setFiltros([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastaSel]);

  // Filtros que EXIGEM o servidor (tome/mentions/invites): busca via cr_filtrar
  // e pagina pela continuação no filters slice. Fora deles, invalida a consulta.
  useEffect(() => {
    if (!filtroServidor || pastaCargaAcessoNegado) {
      cancelarFiltroGraph();
      return;
    }
    void filtrarMensagens({
      pastaId: pastaSel,
      escopo: filtroServidor,
      caixa: caixaAtiva,
      ignorarIds: idsDeletadas(),
    });
    return cancelarFiltroGraph;
  }, [
    caixaAtiva,
    cancelarFiltroGraph,
    filtrarMensagens,
    filtroServidor,
    pastaSel,
    pastaCargaAcessoNegado,
    recarga,
  ]);

  // Paginação do filtro Graph via @odata.nextLink; dedup igual à busca.
  async function carregarMaisFiltro() {
    if (
      carregandoMaisRef.current ||
      !filtroServidor ||
      !temMaisFiltro ||
      pastaCargaAcessoNegado
    ) {
      return;
    }
    carregandoMaisRef.current = true;
    setCarregandoMais(true);
    try {
      await carregarMaisFiltroStore({
        pastaId: pastaSel,
        escopo: filtroServidor,
        caixa: caixaAtiva,
        ignorarIds: idsDeletadas(),
      });
    } finally {
      carregandoMaisRef.current = false;
      setCarregandoMais(false);
    }
  }

  // Paginação dos resultados de busca via @odata.nextLink (o Graph não aceita
  // $skip com $search); dedup igual à pasta.
  async function carregarMaisBusca() {
    const termo = busca.trim();
    if (
      carregandoMaisRef.current ||
      !termo ||
      !temMaisBusca ||
      pastaCargaAcessoNegado
    ) {
      return;
    }
    carregandoMaisRef.current = true;
    setCarregandoMais(true);
    try {
      await carregarMaisBuscaStore({
        pastaId: pastaSel,
        termo,
        caixa: caixaAtiva,
        ignorarIds: idsDeletadas(),
      });
    } finally {
      carregandoMaisRef.current = false;
      setCarregandoMais(false);
    }
  }

  // Fonte da lista mostrada, por precedência: filtro Graph (com o texto da busca
  // aplicado client-side por cima — D2) > busca de texto server-side > pasta.
  const textoBuscaLower = busca.trim().toLowerCase();
  const fonteLista = useMemo<EmailItem[] | null>(() => {
    if (filtroGraph) {
      if (!resultadosFiltro) return null; // spinner enquanto o filtro carrega
      if (!textoBuscaLower) return resultadosFiltro;
      return resultadosFiltro.filter(
        (m) =>
          m.assunto.toLowerCase().includes(textoBuscaLower) ||
          m.de.toLowerCase().includes(textoBuscaLower) ||
          m.preview.toLowerCase().includes(textoBuscaLower)
      );
    }
    return buscaAtiva ? resultadosBusca : mensagens;
  }, [filtroGraph, resultadosFiltro, textoBuscaLower, buscaAtiva, resultadosBusca, mensagens]);
  const dadosDaCaixaAtiva = caixaDados === caixaAtiva;
  const fonteListaAtiva = dadosDaCaixaAtiva ? fonteLista : null;
  const onCarregarMaisLista = filtroGraph
    ? carregarMaisFiltro
    : buscaAtiva
      ? carregarMaisBusca
      : carregarMais;
  const temMaisLista = filtroGraph ? temMaisFiltro : buscaAtiva ? temMaisBusca : temMais;

  const pastaAtual = pastas?.find((p) => p.id === pastaSel);
  const tituloLista = pastaAtual ? rotuloPasta(pastaAtual.tipo, pastaAtual.nome, t) : "";
  const msgAtual =
    fonteListaAtiva?.find((m) => m.id === msgSel) ??
    (dadosDaCaixaAtiva ? mensagens?.find((m) => m.id === msgSel) : undefined);

  // "Compose in Outlook" — comportamento atual (abre o Outlook interno).
  const composeOutlook = () =>
    api.abrirAppInterno(
      "outlook",
      comLoginHint("https://outlook.office.com/mail/deeplink/compose", user.email),
      "Outlook"
    );
  // "New mail" — abre o nosso composer em modal.
  const novoEmailModal = () => abrirCompose("novo", caixaAtiva);

  // #490 (rework após feedback do PO): o header do conteúdo do Bridge é
  // CONSTANTE nos 3 módulos — sempre título "Bridge" (nav.controlRoom) +
  // subtítulo fixo. O que muda ao alternar E-mail/Contatos/Calendário é o
  // BREADCRUMB, não este header. (Antes o header trocava por módulo e o mail
  // ficou sem subtítulo — o PO rejeitou os dois: quer o header fixo e o
  // subtítulo de volta com copy melhor.)
  const tituloModulo = t.nav.controlRoom;
  const subtituloModulo = t.controlRoom.bridgeSubtitulo;

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Cabeçalho — ícone animado do Bridge + título do módulo ativo (#231).
          #868: escondido quando hospedado em aba interna (a própria aba já
          identifica o Bridge com ícone + nome) → o content area começa direto no
          conteúdo. Standalone (fora de aba) mantém o hero pedido pelo PO no #490. */}
      {!emAba && (
        <div className="flex shrink-0 items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
            <BridgeHeaderIcon className="size-6" />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{tituloModulo}</h1>
            <p className="text-sm text-muted-foreground">{subtituloModulo}</p>
          </div>
        </div>
      )}

      {/* #912: sidebar e conteudo agora sao PAINEIS, com splitter entre eles.
          O `gap-4` saiu de proposito: com folga no meio, a `border-r` do
          sidebar ficava solta no vao em vez de ser a divisoria que o card
          pede. O botao de colapsar continua sendo o mesmo, mandando na store;
          o painel obedece — e avisa de volta se quem colapsar for o arrasto. */}
      <BridgeSplit
        colapsada={!sidebarAberta}
        onColapsadaMudou={(c) => setSidebarAberta(!c)}
        sidebar={
          <FolderSidebar
          pastas={pastas}
          subpastas={subpastas}
          onCarregarSubpastas={carregarSubpastas}
          sel={pastaSel}
          onSel={(id) => {
            setBridgeView("mail");
            setPastaSel(id);
          }}
          onNovo={novoEmailModal}
          onComposeOutlook={composeOutlook}
          onMarcarTodasLidas={marcarPastaLida}
          onEsvaziarPasta={esvaziarPasta}
          arvore={arvorePastas}
          arvoreCarregando={arvorePendentes.length > 0}
          onAbrirArvore={() => setPedirArvore(true)}
          onCriarSubpasta={criarSubpasta}
          onRenomearPasta={renomearPasta}
          onExcluirPasta={excluirPasta}
          onMoverPasta={moverPasta}
          caixas={caixasCompartilhadas}
          caixaAtiva={caixaAtiva}
          emailProprio={user.email}
          onSelecionarCaixa={(caixa) => {
            setBridgeView("mail");
            setCaixaAtiva(caixa);
          }}
          onAbrirAdicionarCaixa={() => setAdicionarCaixaAberto(true)}
          caixaCompartilhada={caixaCompartilhadaAtiva}
          colapsada={!sidebarAberta}
          onToggleSidebar={() => setSidebarAberta((aberta) => !aberta)}
          bridgeView={bridgeView}
          onSelectModule={(view) => {
            setBridgeView(view);
          }}
          t={t}
        />
        }
      >

        {/* #1065: busca do Bridge REMONTADA no toolbar do conteúdo (OPÇÃO A).
            O #876 orfanou o UniversalSearch ao tirar o mount da title bar; aqui
            ele volta como topo da coluna de conteúdo, ao lado do FolderSidebar.
            O atalho "/" (que já mira [data-universal-search-input]) e o Esc
            round-trip passam a funcionar. A coluna é flex-col/flex-1 e o
            view-switch abaixo mantém min-h-0/flex-1 pra preencher a altura. */}
        <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden">
          <div className="shrink-0">
            <UniversalSearch
              tela="control-room"
              screenLabel={t.nav.controlRoom}
              bridgeView={bridgeView}
            />
          </div>
          {bridgeView === "people" ? (
          <PeopleView
            userEmail={user.email}
            onGrantAccess={onGrantPeopleAccess}
            onReauthenticate={onReauthenticate}
            onCompose={(email) => {
              abrirCompose("novo", caixaAtiva);
              setComposePara([email]);
            }}
          />
        ) : bridgeView === "agenda" ? (
          <AgendaView />
        ) : (
          <ResizablePanelGroup
            autoSaveId="bridge.layout"
            direction="horizontal"
            className="min-w-0 flex-1 overflow-hidden"
          >
          <ResizablePanel defaultSize={38} minSize={24} maxSize={55} className="overflow-hidden">
            <MessageList
              ativo={ativo}
              titulo={tituloLista}
              mensagens={fonteListaAtiva}
              erroLeitura={
                pastaAtual?.leitura === "negado"
                  ? t.controlRoom.caixaAcessoParcial
                  : undefined
              }
              onRefresh={() => setRecarga((n) => n + 1)}
              pastaId={pastaSel}
              pastaTipo={pastaAtual?.tipo ?? ""}
              onEsvaziar={() => esvaziarPasta(pastaSel)}
              onCarregarMais={onCarregarMaisLista}
              carregandoMais={carregandoMais}
              temMais={temMaisLista}
              onFlag={acaoFlag}
              onExcluir={acaoExcluir}
              onMarcarLido={acaoMarcarLido}
              onSalvarComo={salvarComo}
              onImprimir={imprimir}
              onAbrirMaisAcoes={() => detalheRef.current?.abrirMaisAcoes()}
              pastasDestino={pastasDestino}
              pastasCarregando={arvorePendentes.length > 0}
              onAbrirMover={() => setPedirArvore(true)}
              onMover={acaoMover}
              filtrosOcultos={FILTROS_OCULTOS}
              onResponder={() => detalheRef.current?.responder()}
              onResponderTodos={() => detalheRef.current?.responderTodos()}
              onEncaminhar={() => detalheRef.current?.encaminhar()}
              onCompor={novoEmailModal}
              envioBloqueado={caixaCompartilhadaAtiva && !sharedEnvioEscopoOk}
              t={t}
              idioma={idioma}
            />
          </ResizablePanel>
          <ResizableHandle withHandle className="mx-1.5 bg-transparent hover:bg-border" />
          <ResizablePanel defaultSize={62} minSize={35} className="overflow-hidden">
            {dadosDaCaixaAtiva && selecionados.size > 0 ? (
              <MultiSelecaoContexto
                n={selecionados.size}
                onExcluir={() => acaoExcluir([...selecionados])}
                onLimpar={limparSelecao}
                t={t}
              />
            ) : (
              <MessageDetail
                ref={detalheRef}
                id={dadosDaCaixaAtiva ? msgSel : null}
                userEmail={user.email}
                mailbox={caixaAtiva}
                envioBloqueado={caixaCompartilhadaAtiva && !sharedEnvioEscopoOk}
                sinalizado={msgAtual?.sinalizado ?? false}
                lido={msgAtual?.lido ?? false}
                onFlag={acaoFlag}
                onExcluir={acaoExcluir}
                onMarcarLido={acaoMarcarLido}
                onSalvarComo={salvarComo}
                onImprimir={imprimir}
                onAbrirLink={onAbrirLink}
                onMudou={() => setRecargaPastas((n) => n + 1)}
                t={t}
                idioma={idioma}
              />
            )}
          </ResizablePanel>
          </ResizablePanelGroup>
        )}
        </div>
      </BridgeSplit>

      <EventoDialog userEmail={user.email} />
      <NovaMensagemModal
        caixas={caixasCompartilhadas}
        emailPessoal={user.email}
        sharedEnvioDisponivel={sharedEnvioEscopoOk}
      />

      {/* Dialog "Adicionar caixa compartilhada" (#111). Montado só quando abre
          (com `key`) pra nascer limpo. Se o token não traz Mail.Read.Shared,
          sinaliza relogin já ao abrir — sem travar (o backend também revalida). */}
      {adicionarCaixaAberto && (
        <DialogAdicionarCaixa
          key="adicionar-caixa"
          existentes={caixasCompartilhadas}
          avisoRelogin={!sharedEscopoOk}
          onAdicionada={(addr) => {
            setCaixasCompartilhadas((atual) =>
              atual.includes(addr) ? atual : [...atual, addr]
            );
            setCaixaAtiva(addr);
            if (!sharedEscopoOk) toast.warning(t.controlRoom.caixaRelogin);
          }}
          onFechar={() => setAdicionarCaixaAberto(false)}
          t={t}
        />
      )}
    </div>
  );
}
