import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion, type Transition } from "motion/react";
import {
  CalendarClock,
  CalendarDays,
  CloudOff,
  Flag,
  Grip,
  LayoutGrid,
  ListTodo,
  Mail,
  MessageSquare,
  RefreshCw,
  Settings2,
  Sparkles,
  Video,
} from "lucide-react";
import { toast } from "sonner";

import { Frame, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame";
import { Badge } from "@/components/reui/badge";
import {
  Sortable,
  SortableItem,
  SortableItemHandle,
} from "@/components/reui/sortable";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  WIDGETS,
  type AtomsPrefs,
  type WidgetId,
} from "@/lib/atoms-prefs";
import { useAppStore } from "@/store";
import { APPS, urlIcone, type AppM365 } from "@/lib/apps";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/reui/alert";
import { IconStack } from "@/components/reui/icon-stack";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/animate-ui/primitives/radix/checkbox";
import SoftBlurIn from "@/components/smoothui/soft-blur-in";
import { useIdioma, preencher } from "@/lib/idioma";
import { logErro } from "@/lib/log";
import { ordenarAtoms, criarAtom, type AtomItem } from "@/lib/atoms";
import type { Tela } from "@/lib/navegacao";
import type { AppUser, EmailRecente, EventoAgenda, Tarefa } from "@/lib/types";
import * as api from "@/lib/api";

/** Início/fim (ISO) da janela "agora → +7 dias" pra próximo evento + hoje. */
function janela7Dias(): { inicio: string; fim: string } {
  const agora = new Date();
  const fim = new Date(agora.getTime() + 7 * 86_400_000);
  return { inicio: agora.toISOString(), fim: fim.toISOString() };
}

/** Reunião guarda ISO sem Z (#211); o front adiciona pra parsear. */
function comZ(iso: string): Date {
  return new Date(/Z$/.test(iso) ? iso : `${iso}Z`);
}

function mesmoDia(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function horaCurta(d: Date, idioma: string): string {
  return d.toLocaleTimeString(idioma, { hour: "2-digit", minute: "2-digit" });
}

type Estado<T> =
  | { fase: "carregando" }
  | { fase: "erro" }
  | { fase: "ok"; dados: T };

/**
 * Atoms — a nova tela inicial (épico #181, Slice 1 / #183). Greeting + grade
 * bento sobre o starfield, com dois widgets sobre dados que JÁ rodam
 * (Agenda via `crAgenda`, E-mail via `crContadores`). Cada widget é
 * PORTA, não destino: clicar leva ao Bridge (`onNavegar("control-room")`).
 * Sem escopo/Rust novo, sem IA (o modelo de atenção em `lib/atoms.ts` é
 * determinístico e alimenta o feed unificado da Slice 3).
 */
export function AtomsScreen({
  user,
  onNavegar,
  onAbrirUrl,
  onAbrirApp,
}: {
  user: AppUser;
  onNavegar: (tela: Tela) => void;
  onAbrirUrl: (url: string) => void;
  /** #187: abre um app do speed-dial como aba do Navigator (reusa abrirAppAqui). */
  onAbrirApp: (app: AppM365) => void;
}) {
  const { idioma, t } = useIdioma();
  // #187: personalização — ordem/visibilidade/densidade, persistidas.
  const prefs = useAppStore((state) => state.atomsPrefs);
  const setAtomsPrefs = useAppStore((state) => state.setAtomsPrefs);
  const atualizarPrefs = useCallback(
    (patch: Partial<AtomsPrefs>) => setAtomsPrefs(patch),
    [setAtomsPrefs],
  );
  const denso = prefs.densidade === "compacta";
  const primeiroNome = user.displayName.trim().split(/\s+/)[0] || user.displayName;

  const [agenda, setAgenda] = useState<Estado<EventoAgenda[]>>({
    fase: "carregando",
  });
  const [email, setEmail] = useState<
    Estado<{
      naoLidos: number;
      sinalizados: number;
      recentes: EmailRecente[];
    }>
  >({ fase: "carregando" });
  const [todos, setTodos] = useState<Estado<Tarefa[]>>({ fase: "carregando" });
  // #186 (S4): sonda local do OneDrive + gate do Teams. Silenciosos: só
  // aparecem quando há problema (OneDrive) ou como affordance gated (Teams).
  const [onedrive, setOnedrive] = useState<api.OneDriveSync | null>(null);
  const [teamsOk, setTeamsOk] = useState<boolean | null>(null);

  const carregarAgenda = useCallback(async () => {
    setAgenda({ fase: "carregando" });
    try {
      const { inicio, fim } = janela7Dias();
      const eventos = await api.crAgenda(inicio, fim);
      setAgenda({ fase: "ok", dados: eventos });
    } catch (e) {
      // #441 (A2): erro NÃO é mais silencioso — vai pro log do backend com
      // contexto, pra dar pra diagnosticar em produção ("como o Delphero faria").
      logErro("atoms:agenda", e);
      setAgenda({ fase: "erro" });
    }
  }, []);

  const carregarEmail = useCallback(async () => {
    setEmail({ fase: "carregando" });
    try {
      // #440 (A1): um único $batch (não-lidos + sinalizados + recentes). Substitui
      // o Promise.all de duas leituras, que rejeitava tudo quando só o
      // contador falhava e derrubava o widget mesmo com o não-lido resolvido (#187).
      const email = await api.crAtomsEmail();
      setEmail({
        fase: "ok",
        dados: {
          naoLidos: email.naoLidos,
          sinalizados: email.sinalizados,
          recentes: email.recentes,
        },
      });
    } catch (e) {
      logErro("atoms:email", e);
      setEmail({ fase: "erro" });
    }
  }, []);

  const carregarTodos = useCallback(async () => {
    setTodos({ fase: "carregando" });
    try {
      const tarefas = await api.crTarefas();
      setTodos({ fase: "ok", dados: tarefas });
    } catch (e) {
      logErro("atoms:tarefas", e);
      setTodos({ fase: "erro" });
    }
  }, []);

  useEffect(() => {
    // #440 (A1): boot SEQUENCIADO pra matar o "thundering herd" (6 chamadas Graph
    // juntas competindo com o keep-alive do Bridge → 429). Prioriza agenda+e-mail
    // (o que o usuário olha primeiro), depois tarefas, e só então as fontes duras
    // best-effort. O pool + single-flight do Rust deduplicam com o Bridge.
    let vivo = true;
    void (async () => {
      await Promise.allSettled([carregarAgenda(), carregarEmail()]);
      if (!vivo) return;
      await carregarTodos();
      if (!vivo) return;
      // #186: fontes duras — best-effort, atrasadas, fora do pico do boot.
      void api
        .atomsOnedriveSync()
        .then((v) => vivo && setOnedrive(v))
        .catch(() => vivo && setOnedrive(null));
      void api
        .crTeamsDisponivel()
        .then((v) => vivo && setTeamsOk(v))
        .catch(() => vivo && setTeamsOk(false));
    })();
    return () => {
      vivo = false;
    };
  }, [carregarAgenda, carregarEmail, carregarTodos]);

  // Remove uma tarefa da lista após concluí-la (otimista; o widget faz o write).
  const removerTarefa = useCallback((id: string) => {
    setTodos((atual) =>
      atual.fase === "ok"
        ? { fase: "ok", dados: atual.dados.filter((tf) => tf.id !== id) }
        : atual,
    );
  }, []);

  // "Tudo em dia" do dashboard inteiro: as três fontes carregadas E sem nada
  // pendente. Só quando todas resolveram ok.
  const agendaVazia = agenda.fase === "ok" && agenda.dados.length === 0;
  const emailVazio =
    email.fase === "ok" &&
    email.dados.naoLidos === 0 &&
    email.dados.sinalizados === 0;
  const todosVazio = todos.fase === "ok" && todos.dados.length === 0;
  const tudoEmDia = agendaVazia && emailVazio && todosVazio;

  // #187: widgets customizáveis visíveis, na ordem do usuário.
  const visiveis = prefs.ordem.filter((id) => !prefs.ocultos.includes(id));

  const reordenar = (nova: WidgetId[]) => {
    // O Sortable devolve só os VISÍVEIS reordenados; recompõe a ordem completa
    // (visíveis na nova ordem + ocultos preservados na ordem anterior).
    const ocultosEmOrdem = prefs.ordem.filter((id) =>
      prefs.ocultos.includes(id),
    );
    atualizarPrefs({ ordem: [...nova, ...ocultosEmOrdem] });
  };

  const alternarWidget = (id: WidgetId) => {
    const ocultos = prefs.ocultos.includes(id)
      ? prefs.ocultos.filter((x) => x !== id)
      : [...prefs.ocultos, id];
    atualizarPrefs({ ocultos });
  };

  const renderWidget = (id: WidgetId) => {
    switch (id) {
      case "agenda":
        return (
          <AgendaWidget
            estado={agenda}
            idioma={idioma}
            t={t}
            denso={denso}
            onRetry={() => void carregarAgenda()}
            onNavegar={onNavegar}
            onAbrirUrl={onAbrirUrl}
          />
        );
      case "email":
        return (
          <EmailWidget
            estado={email}
            t={t}
            denso={denso}
            onRetry={() => void carregarEmail()}
            onNavegar={onNavegar}
          />
        );
      case "todos":
        return (
          <TodosWidget
            estado={todos}
            t={t}
            denso={denso}
            onRetry={() => void carregarTodos()}
            onConcluida={removerTarefa}
          />
        );
      case "speeddial":
        return <SpeedDialWidget t={t} denso={denso} onAbrirApp={onAbrirApp} />;
    }
  };

  const nomeWidget: Record<WidgetId, string> = {
    agenda: t.atoms.agendaTitulo,
    email: t.atoms.emailTitulo,
    todos: t.atoms.todosTitulo,
    speeddial: t.atoms.speedDialTitulo,
  };

  return (
    <div className="w-full space-y-6">
      {/* Header band — greeting + subtítulo, airy, sobre o starfield. */}
      <div className="flex items-start justify-between gap-3 px-1 pt-2">
        <div className="min-w-0">
          <SoftBlurIn className="text-2xl font-semibold tracking-tight">
            {preencher(t.atoms.saudacao, { nome: primeiroNome })}
          </SoftBlurIn>
          <p className="mt-1 text-sm text-muted-foreground">
            {tudoEmDia ? t.atoms.tudoEmDiaDesc : t.atoms.subtitulo}
          </p>
        </div>
        {/* #187: Personalizar — ligar/desligar widgets + densidade. */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 gap-1.5 text-muted-foreground"
              aria-label={t.atoms.personalizar}
            >
              <Settings2 className="size-4" />
              <span className="hidden sm:inline">{t.atoms.personalizar}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64">
            <p className="mb-2 text-sm font-medium">{t.atoms.widgetsTitulo}</p>
            <div className="space-y-2.5">
              {WIDGETS.map((id) => (
                <div key={id} className="flex items-center justify-between gap-3">
                  <span className="text-sm">{nomeWidget[id]}</span>
                  <Switch
                    checked={!prefs.ocultos.includes(id)}
                    onCheckedChange={() => alternarWidget(id)}
                    aria-label={nomeWidget[id]}
                  />
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
              <span className="text-sm">{t.atoms.densidadeCompacta}</span>
              <Switch
                checked={denso}
                onCheckedChange={(v) =>
                  atualizarPrefs({ densidade: v ? "compacta" : "confortavel" })
                }
                aria-label={t.atoms.densidadeCompacta}
              />
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {tudoEmDia ? (
        <Frame className="w-full">
          <FramePanel>
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <IconStack>
                <Sparkles className="size-5 text-muted-foreground" />
              </IconStack>
              <p className="text-sm font-medium">{t.atoms.tudoEmDia}</p>
              <p className="text-sm text-muted-foreground">
                {t.atoms.tudoEmDiaDesc}
              </p>
            </div>
          </FramePanel>
        </Frame>
      ) : (
        <div className="space-y-4">
        {/* #185: "Atenção agora" — o feed unificado ranqueado (diferenciador),
            âncora acima da grade. Composição das 3 fontes via o score da S1. */}
        <FeedAtencao
          agenda={agenda}
          email={email}
          todos={todos}
          idioma={idioma}
          t={t}
          onNavegar={onNavegar}
        />
        {/* #187: bento REORDENÁVEL (drag pela alça) + visibilidade, persistido. */}
        <Sortable
          value={visiveis}
          onValueChange={reordenar}
          getItemValue={(id) => id}
          strategy="grid"
          className={cn(
            "grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))]",
            denso ? "gap-2" : "gap-4",
          )}
        >
          {visiveis.map((id) => (
            <SortableItem key={id} value={id} className="group/atom relative">
              {/* Alça de arraste discreta (canto), pra não roubar o clique do card. */}
              <SortableItemHandle
                aria-label={t.atoms.reordenar}
                className="absolute right-1.5 top-1.5 z-10 grid size-6 cursor-grab place-items-center rounded-md text-muted-foreground/50 opacity-0 transition-opacity hover:bg-accent/50 focus-visible:opacity-100 group-hover/atom:opacity-100 active:cursor-grabbing [[data-dragging=true]_&]:opacity-100"
              >
                <Grip className="size-3.5" />
              </SortableItemHandle>
              <div className="h-full">{renderWidget(id)}</div>
            </SortableItem>
          ))}
        </Sortable>
        {/* #186 S4: cards de sistema (não customizáveis) — só quando relevantes. */}
        {(onedrive?.estado === "pausado" || teamsOk === false) && (
          <div
            className={cn(
              "grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))]",
              denso ? "gap-2" : "gap-4",
            )}
          >
            {onedrive?.estado === "pausado" && <OneDriveWidget t={t} />}
            {teamsOk === false && <TeamsWidget t={t} />}
          </div>
        )}
        </div>
      )}
    </div>
  );
}

type Dic = ReturnType<typeof useIdioma>["t"];

/** Motivo (§3) → string localizada, mostrada no item do feed (self-explaining). */
function motivoTexto(item: AtomItem, t: Dic): string {
  switch (item.motivo) {
    case "iminente":
      return preencher(t.atoms.motivoIminente, { min: item.minutos ?? 0 });
    case "vencido":
      return t.atoms.motivoVencido;
    case "prazoHoje":
      return t.atoms.motivoPrazoHoje;
    case "sinalizado":
      return t.atoms.motivoSinalizado;
    case "naoLido":
      return t.atoms.motivoNaoLido;
    case "hoje":
      return t.atoms.motivoHoje;
    default:
      return "";
  }
}

const ICONE_ORIGEM = {
  agenda: CalendarClock,
  email: Mail,
  todo: ListTodo,
} as const;

/**
 * #185 — "Atenção agora": UM feed ranqueado (agenda ≤30min + e-mail não-lido
 * envelhecendo/sinalizado + To Do vencida) pelo score determinístico da S1
 * (lib/atoms, SEM IA). Sem nova fonte — compõe as 3 já cabeadas. Cada item é
 * porta (clica → destino). Reusa o visual do seed `notification-list`
 * (cards motion) num layout legível/acessível. Recalcula a cada 60s + no focus.
 */
function FeedAtencao({
  agenda,
  email,
  todos,
  idioma,
  t,
  onNavegar,
}: {
  agenda: Estado<EventoAgenda[]>;
  email: Estado<{ naoLidos: number; sinalizados: number; recentes: EmailRecente[] }>;
  todos: Estado<Tarefa[]>;
  idioma: string;
  t: Dic;
  onNavegar: (tela: Tela) => void;
}) {
  // #187 self-QA: respeita prefers-reduced-motion no layout animation do feed
  // (o ranking recompõe a cada 60s; sem isto as linhas deslizariam mesmo com
  // reduced-motion). O SoftBlurIn/starfield já respeitam por conta própria.
  const reduzirMovimento = useReducedMotion();
  // O score depende do "agora" — recalcula em intervalo leve + ao voltar o foco
  // (barato: aritmética sobre dados já buscados, sem chamada Graph nova).
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    const aoFocar = () => setTick((n) => n + 1);
    window.addEventListener("focus", aoFocar);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", aoFocar);
    };
  }, []);

  const itens = useMemo(() => {
    const agora = Date.now();
    const irBridge = () => onNavegar("control-room");
    const out: AtomItem[] = [];
    if (agenda.fase === "ok") {
      for (const ev of agenda.dados) {
        if (comZ(ev.fim).getTime() < agora) continue;
        out.push(
          criarAtom(
            `ag-${ev.id}`,
            "agenda",
            ev.assunto,
            {
              origem: "agenda",
              quando: comZ(ev.inicio).getTime(),
              hoje: mesmoDia(comZ(ev.inicio), new Date()),
            },
            agora,
            irBridge,
          ),
        );
      }
    }
    if (email.fase === "ok") {
      email.dados.recentes.forEach((m, i) => {
        out.push(
          criarAtom(
            `mail-${i}`,
            "email",
            m.assunto,
            { origem: "email", naoLido: true, quando: comZ(m.recebido).getTime() },
            agora,
            irBridge,
          ),
        );
      });
      if (email.dados.sinalizados > 0) {
        out.push(
          criarAtom(
            "mail-flag",
            "email",
            preencher(t.atoms.feedSinalizados, { n: email.dados.sinalizados }),
            { origem: "email", flagged: true },
            agora,
            irBridge,
          ),
        );
      }
    }
    if (todos.fase === "ok") {
      for (const tf of todos.dados) {
        out.push(criarAtom(`td-${tf.id}`, "todo", tf.titulo, sinalTarefa(tf), agora));
      }
    }
    // Só o que "exige agora": corta o ruído de baseline muito baixo (futuro/hoje
    // fraco) e mostra o topo ranqueado.
    return ordenarAtoms(out)
      .filter((i) => i.score >= 0.3)
      .slice(0, 6);
    // `tick` força o recompute periódico; as fases são as fontes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agenda, email, todos, t, onNavegar, tick]);

  const carregando =
    agenda.fase === "carregando" ||
    email.fase === "carregando" ||
    todos.fase === "carregando";

  const corpo = () => {
    if (itens.length === 0 && carregando) return <SkeletonLinhas />;
    if (itens.length === 0) {
      return (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <IconStack>
            <Sparkles className="size-5 text-muted-foreground" />
          </IconStack>
          <p className="text-sm text-muted-foreground">{t.atoms.feedVazio}</p>
        </div>
      );
    }
    return (
      <ul aria-live="polite" className="space-y-2">
        {itens.map((item) => {
          const Icone = ICONE_ORIGEM[item.origem];
          const conteudo = (
            <>
              <Icone className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {item.titulo}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {motivoTexto(item, t)}
                </span>
              </span>
              {item.quando != null && (
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {horaCurta(new Date(item.quando), idioma)}
                </span>
              )}
            </>
          );
          return (
            <motion.li
              key={item.id}
              layout={!reduzirMovimento}
              transition={
                reduzirMovimento
                  ? { duration: 0 }
                  : { type: "spring", stiffness: 300, damping: 26 }
              }
            >
              {item.acao ? (
                <button
                  type="button"
                  onClick={item.acao}
                  className="flex w-full items-start gap-2.5 rounded-lg border border-border bg-background/50 p-2.5 text-left transition-colors hover:bg-accent/50"
                >
                  {conteudo}
                </button>
              ) : (
                <div className="flex items-start gap-2.5 rounded-lg border border-border bg-background/50 p-2.5">
                  {conteudo}
                </div>
              )}
            </motion.li>
          );
        })}
      </ul>
    );
  };

  return (
    <Frame className="w-full">
      <FrameHeader>
        <FrameTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-muted-foreground" />
          {t.atoms.feedTitulo}
        </FrameTitle>
      </FrameHeader>
      <FramePanel>{corpo()}</FramePanel>
    </Frame>
  );
}

/** Cabeçalho de erro por-card: isola a falha, mantém os outros cards de pé. */
function ErroCard({ t, onRetry }: { t: Dic; onRetry: () => void }) {
  return (
    <Alert variant="warning">
      <AlertTitle>{t.atoms.erroCarregar}</AlertTitle>
      <AlertDescription>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw /> {t.atoms.tentarNovamente}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function SkeletonLinhas() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  );
}

function AgendaWidget({
  estado,
  idioma,
  t,
  onRetry,
  onNavegar,
  onAbrirUrl,
  denso,
}: {
  estado: Estado<EventoAgenda[]>;
  idioma: string;
  t: Dic;
  onRetry: () => void;
  onNavegar: (tela: Tela) => void;
  onAbrirUrl: (url: string) => void;
  denso: boolean;
}) {
  const agora = Date.now();

  // Entrar numa reunião online: resolve o joinUrl (lazy) e abre; se não houver,
  // cai pro Bridge (agenda). Widget é porta.
  const entrar = async (ev: EventoAgenda) => {
    try {
      const det = await api.crEventoCorpo(ev.id);
      if (det.joinUrl) {
        onAbrirUrl(det.joinUrl);
        return;
      }
    } catch {
      /* cai pro Bridge abaixo */
    }
    onNavegar("control-room");
  };

  const corpo = () => {
    if (estado.fase === "carregando") return <SkeletonLinhas />;
    if (estado.fase === "erro") return <ErroCard t={t} onRetry={onRetry} />;

    const futuros = estado.dados
      .filter((e) => comZ(e.fim).getTime() >= agora)
      .sort((a, b) => comZ(a.inicio).getTime() - comZ(b.inicio).getTime());
    if (futuros.length === 0) {
      return (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <IconStack>
            <CalendarDays className="size-5 text-muted-foreground" />
          </IconStack>
          <p className="text-sm text-muted-foreground">{t.atoms.agendaLivre}</p>
        </div>
      );
    }

    const proximo = futuros[0]!;
    const inicioProx = comZ(proximo.inicio);
    const hoje = futuros.filter((e) => mesmoDia(comZ(e.inicio), new Date()));

    return (
      <div className="space-y-3">
        {/* Próximo evento (destaque). */}
        <button
          type="button"
          onClick={() => onNavegar("control-room")}
          className="w-full rounded-lg border border-border bg-background/50 p-3 text-left transition-colors hover:bg-accent/50"
        >
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarClock className="size-3.5" /> {t.atoms.agendaProximo}
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="min-w-0 flex-1 truncate font-medium">
              {proximo.assunto}
            </span>
            <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
              {horaCurta(inicioProx, idioma)}
            </span>
          </div>
          {proximo.online && (
            <span className="mt-2 inline-flex">
              <Button
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  void entrar(proximo);
                }}
              >
                <Video className="size-3" /> {t.atoms.agendaEntrar}
              </Button>
            </span>
          )}
        </button>

        {/* Hoje (resumo). */}
        {hoje.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <CalendarDays className="size-3.5" /> {t.atoms.agendaHoje}
              <Badge variant="secondary" size="sm">
                {hoje.length}
              </Badge>
            </div>
            <ul className="space-y-1">
              {hoje.slice(0, 4).map((e) => (
                <li
                  key={e.id}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {e.assunto}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {horaCurta(comZ(e.inicio), idioma)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  };

  return (
    <Frame className="w-full" dense={denso}>
      <FrameHeader>
        <FrameTitle className="flex items-center gap-2">
          <CalendarDays className="size-4 text-muted-foreground" />
          {t.atoms.agendaTitulo}
        </FrameTitle>
      </FrameHeader>
      <FramePanel>{corpo()}</FramePanel>
    </Frame>
  );
}

function EmailWidget({
  estado,
  t,
  onRetry,
  onNavegar,
  denso,
}: {
  estado: Estado<{ naoLidos: number; sinalizados: number }>;
  t: Dic;
  onRetry: () => void;
  onNavegar: (tela: Tela) => void;
  denso: boolean;
}) {
  const corpo = () => {
    if (estado.fase === "carregando") return <SkeletonLinhas />;
    if (estado.fase === "erro") return <ErroCard t={t} onRetry={onRetry} />;

    const { naoLidos, sinalizados } = estado.dados;
    if (naoLidos === 0 && sinalizados === 0) {
      return (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <IconStack>
            <Mail className="size-5 text-muted-foreground" />
          </IconStack>
          <p className="text-sm text-muted-foreground">{t.atoms.emailZero}</p>
        </div>
      );
    }

    return (
      <button
        type="button"
        onClick={() => onNavegar("control-room")}
        className="w-full rounded-lg border border-border bg-background/50 p-3 text-left transition-colors hover:bg-accent/50"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="gap-1.5">
            <Mail className="size-3" /> {naoLidos} {t.atoms.emailNaoLidos}
          </Badge>
          {sinalizados > 0 && (
            <Badge variant="outline" className="gap-1.5">
              <Flag className="size-3" /> {sinalizados} {t.atoms.emailSinalizados}
            </Badge>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t.atoms.emailAbrir}</p>
      </button>
    );
  };

  return (
    <Frame className="w-full" dense={denso}>
      <FrameHeader>
        <FrameTitle className="flex items-center gap-2">
          <Mail className="size-4 text-muted-foreground" />
          {t.atoms.emailTitulo}
        </FrameTitle>
      </FrameHeader>
      <FramePanel>{corpo()}</FramePanel>
    </Frame>
  );
}

// Strike-through do check-off — reusa a animação do seed `playful-todolist`.
const getPathAnimate = (marcada: boolean) => ({
  pathLength: marcada ? 1 : 0,
  opacity: marcada ? 1 : 0,
});
const getPathTransition = (marcada: boolean): Transition => ({
  pathLength: { duration: 0.6, ease: "easeInOut" },
  opacity: { duration: 0.01, delay: marcada ? 0 : 0.6 },
});

/** Fatos de atenção de uma tarefa: prazo vencido (antes de hoje) × vence hoje. */
function sinalTarefa(tf: Tarefa) {
  if (!tf.prazo) return { origem: "todo" as const };
  const q = new Date(/Z$/.test(tf.prazo) ? tf.prazo : `${tf.prazo}Z`).getTime();
  const inicioHoje = new Date();
  inicioHoje.setHours(0, 0, 0, 0);
  const hoje = mesmoDia(new Date(q), new Date());
  return {
    origem: "todo" as const,
    quando: q,
    vencido: q < inicioHoje.getTime() && !hoje,
    hoje,
  };
}

function TodosWidget({
  estado,
  t,
  onRetry,
  onConcluida,
  denso,
}: {
  estado: Estado<Tarefa[]>;
  t: Dic;
  onRetry: () => void;
  onConcluida: (id: string) => void;
  denso: boolean;
}) {
  // ids em transição de conclusão (tocando o strike antes de sumir).
  const [concluindo, setConcluindo] = useState<Set<string>>(new Set());

  const concluir = async (tf: Tarefa) => {
    setConcluindo((s) => new Set(s).add(tf.id));
    try {
      await api.crTarefaConcluir(tf.listaId, tf.id);
      // Deixa o strike tocar, depois remove da lista (otimista pós-write ok).
      setTimeout(() => onConcluida(tf.id), 600);
    } catch {
      setConcluindo((s) => {
        const n = new Set(s);
        n.delete(tf.id);
        return n;
      });
      toast.error(t.atoms.todosErroConcluir);
    }
  };

  const corpo = () => {
    if (estado.fase === "carregando") return <SkeletonLinhas />;
    if (estado.fase === "erro") return <ErroCard t={t} onRetry={onRetry} />;
    if (estado.dados.length === 0) {
      return (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <IconStack>
            <ListTodo className="size-5 text-muted-foreground" />
          </IconStack>
          <p className="text-sm text-muted-foreground">{t.atoms.todosVazio}</p>
        </div>
      );
    }

    // Ordena pelo score de atenção (vencidas/prazo primeiro), reusa lib/atoms.
    const agora = Date.now();
    const ordenadas = ordenarAtoms(
      estado.dados.map((tf) =>
        criarAtom(tf.id, "todo", tf.titulo, sinalTarefa(tf), agora),
      ),
    );
    const porId = new Map(estado.dados.map((tf) => [tf.id, tf]));

    return (
      <ul className="space-y-3.5">
        {ordenadas.map((item) => {
          const tf = porId.get(item.id)!;
          const marcada = concluindo.has(tf.id);
          return (
            <li key={tf.id} className="flex items-center gap-2.5">
              <Checkbox
                checked={marcada}
                onCheckedChange={(v) => {
                  if (v === true && !marcada) void concluir(tf);
                }}
                id={`atom-todo-${tf.id}`}
              />
              <div className="relative min-w-0 flex-1">
                <Label
                  htmlFor={`atom-todo-${tf.id}`}
                  className="block truncate font-normal"
                >
                  {tf.titulo}
                </Label>
                <motion.svg
                  width="340"
                  height="32"
                  viewBox="0 0 340 32"
                  className="pointer-events-none absolute left-0 top-1/2 z-20 h-8 w-full -translate-y-1/2"
                >
                  <motion.path
                    d="M 10 16.91 s 79.8 -11.36 98.1 -11.34 c 22.2 0.02 -47.82 14.25 -33.39 22.02 c 12.61 6.77 124.18 -27.98 133.31 -17.28 c 7.52 8.38 -26.8 20.02 4.61 22.05 c 24.55 1.93 113.37 -20.36 113.37 -20.36"
                    vectorEffect="non-scaling-stroke"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeMiterlimit={10}
                    fill="none"
                    initial={false}
                    animate={getPathAnimate(marcada)}
                    transition={getPathTransition(marcada)}
                    className="stroke-muted-foreground"
                  />
                </motion.svg>
              </div>
              {item.motivo === "vencido" && (
                <Badge variant="destructive" size="sm" className="shrink-0">
                  {t.atoms.motivoVencido}
                </Badge>
              )}
              {item.motivo === "prazoHoje" && (
                <Badge variant="secondary" size="sm" className="shrink-0">
                  {t.atoms.motivoPrazoHoje}
                </Badge>
              )}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <Frame className="w-full" dense={denso}>
      <FrameHeader>
        <FrameTitle className="flex items-center gap-2">
          <ListTodo className="size-4 text-muted-foreground" />
          {t.atoms.todosTitulo}
        </FrameTitle>
      </FrameHeader>
      <FramePanel>{corpo()}</FramePanel>
    </Frame>
  );
}

/**
 * #186 S4: card do OneDrive — só renderizado quando a sonda local acusa
 * PROBLEMA (estado "pausado": cliente fora do ar). Nunca finge verde.
 */
function OneDriveWidget({ t }: { t: Dic }) {
  return (
    <Frame className="w-full">
      <FrameHeader>
        <FrameTitle className="flex items-center gap-2">
          <CloudOff className="size-4 text-muted-foreground" />
          {t.atoms.odTitulo}
        </FrameTitle>
      </FrameHeader>
      <FramePanel>
        <Alert variant="warning">
          <AlertTitle>{t.atoms.odPausado}</AlertTitle>
          <AlertDescription>{t.atoms.odPausadoDesc}</AlertDescription>
        </Alert>
      </FramePanel>
    </Frame>
  );
}

/**
 * #186 S4: card do Teams — GATED por escopo (Chat.Read). Sem o escopo, mostra só
 * o affordance de conectar (consent explícito é responsabilidade do fluxo de
 * login/settings); nunca dispara consent silencioso nem quebra. A leitura real
 * de /me/chats entra quando o Chat.Read for concedido + entrar no SCOPES.
 */
function TeamsWidget({ t }: { t: Dic }) {
  return (
    <Frame className="w-full">
      <FrameHeader>
        <FrameTitle className="flex items-center gap-2">
          <MessageSquare className="size-4 text-muted-foreground" />
          {t.atoms.teamsTitulo}
        </FrameTitle>
      </FrameHeader>
      <FramePanel>
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <IconStack>
            <MessageSquare className="size-5 text-muted-foreground" />
          </IconStack>
          <p className="text-sm text-muted-foreground">{t.atoms.teamsGatedDesc}</p>
        </div>
      </FramePanel>
    </Frame>
  );
}

/**
 * #187 S5: speed-dial de apps rápidos (widget opcional). Reusa o catálogo APPS
 * + `abrirAppAqui` (via onAbrirApp) — clicar abre o app como aba do Navigator.
 */
function SpeedDialWidget({
  t,
  denso,
  onAbrirApp,
}: {
  t: Dic;
  denso: boolean;
  onAbrirApp: (app: AppM365) => void;
}) {
  const apps = APPS.slice(0, 8);
  return (
    <Frame className="w-full" dense={denso}>
      <FrameHeader>
        <FrameTitle className="flex items-center gap-2">
          <LayoutGrid className="size-4 text-muted-foreground" />
          {t.atoms.speedDialTitulo}
        </FrameTitle>
      </FrameHeader>
      <FramePanel>
        <div className="grid grid-cols-4 gap-2">
          {apps.map((app) => (
            <button
              key={app.id}
              type="button"
              onClick={() => onAbrirApp(app)}
              className="flex flex-col items-center gap-1.5 rounded-lg p-2 text-center transition-colors hover:bg-accent/50"
              title={app.nome}
            >
              <img src={urlIcone(app)} alt="" className="size-7" />
              <span className="w-full truncate text-[11px] text-muted-foreground">
                {app.nome}
              </span>
            </button>
          ))}
        </div>
      </FramePanel>
    </Frame>
  );
}
