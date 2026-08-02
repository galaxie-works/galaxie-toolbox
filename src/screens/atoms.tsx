import { useCallback, useEffect, useState } from "react";
import {
  CalendarClock,
  CalendarDays,
  Flag,
  Mail,
  RefreshCw,
  Sparkles,
  Video,
} from "lucide-react";

import { Frame, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame";
import { Badge } from "@/components/reui/badge";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/reui/alert";
import { IconStack } from "@/components/reui/icon-stack";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import SoftBlurIn from "@/components/smoothui/soft-blur-in";
import { useIdioma, preencher } from "@/lib/idioma";
import type { Tela } from "@/lib/navegacao";
import type { AppUser, EventoAgenda } from "@/lib/types";
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
 * (Agenda via `crAgenda`, E-mail via `crEmail`/`crContadores`). Cada widget é
 * PORTA, não destino: clicar leva ao Bridge (`onNavegar("control-room")`).
 * Sem escopo/Rust novo, sem IA (o modelo de atenção em `lib/atoms.ts` é
 * determinístico e alimenta o feed unificado da Slice 3).
 */
export function AtomsScreen({
  user,
  onNavegar,
  onAbrirUrl,
}: {
  user: AppUser;
  onNavegar: (tela: Tela) => void;
  onAbrirUrl: (url: string) => void;
}) {
  const { idioma, t } = useIdioma();
  const primeiroNome = user.displayName.trim().split(/\s+/)[0] || user.displayName;

  const [agenda, setAgenda] = useState<Estado<EventoAgenda[]>>({
    fase: "carregando",
  });
  const [email, setEmail] = useState<
    Estado<{ naoLidos: number; sinalizados: number }>
  >({ fase: "carregando" });

  const carregarAgenda = useCallback(async () => {
    setAgenda({ fase: "carregando" });
    try {
      const { inicio, fim } = janela7Dias();
      const eventos = await api.crAgenda(inicio, fim);
      setAgenda({ fase: "ok", dados: eventos });
    } catch {
      setAgenda({ fase: "erro" });
    }
  }, []);

  const carregarEmail = useCallback(async () => {
    setEmail({ fase: "carregando" });
    try {
      const [caixa, contadores] = await Promise.all([
        api.crEmail(),
        api.crContadores("inbox"),
      ]);
      setEmail({
        fase: "ok",
        dados: { naoLidos: caixa.naoLidos, sinalizados: contadores.flagged },
      });
    } catch {
      setEmail({ fase: "erro" });
    }
  }, []);

  useEffect(() => {
    void carregarAgenda();
    void carregarEmail();
  }, [carregarAgenda, carregarEmail]);

  // "Tudo em dia" do dashboard inteiro: as duas fontes carregadas E sem nada
  // pendente (agenda sem eventos e caixa limpa). Só quando ambas resolveram ok.
  const agendaVazia = agenda.fase === "ok" && agenda.dados.length === 0;
  const emailVazio =
    email.fase === "ok" &&
    email.dados.naoLidos === 0 &&
    email.dados.sinalizados === 0;
  const tudoEmDia = agendaVazia && emailVazio;

  return (
    <div className="w-full space-y-6">
      {/* Header band — greeting + subtítulo, airy, sobre o starfield. */}
      <div className="px-1 pt-2">
        <SoftBlurIn className="text-2xl font-semibold tracking-tight">
          {preencher(t.atoms.saudacao, { nome: primeiroNome })}
        </SoftBlurIn>
        <p className="mt-1 text-sm text-muted-foreground">
          {tudoEmDia ? t.atoms.tudoEmDiaDesc : t.atoms.subtitulo}
        </p>
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
        <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-4">
          <AgendaWidget
            estado={agenda}
            idioma={idioma}
            t={t}
            onRetry={() => void carregarAgenda()}
            onNavegar={onNavegar}
            onAbrirUrl={onAbrirUrl}
          />
          <EmailWidget
            estado={email}
            t={t}
            onRetry={() => void carregarEmail()}
            onNavegar={onNavegar}
          />
        </div>
      )}
    </div>
  );
}

type Dic = ReturnType<typeof useIdioma>["t"];

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
}: {
  estado: Estado<EventoAgenda[]>;
  idioma: string;
  t: Dic;
  onRetry: () => void;
  onNavegar: (tela: Tela) => void;
  onAbrirUrl: (url: string) => void;
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
    <Frame className="w-full">
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
}: {
  estado: Estado<{ naoLidos: number; sinalizados: number }>;
  t: Dic;
  onRetry: () => void;
  onNavegar: (tela: Tela) => void;
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
    <Frame className="w-full">
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
