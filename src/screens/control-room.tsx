import { Badge } from "@/components/reui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import * as api from "@/lib/api";
import { preencher, useIdioma } from "@/lib/idioma";
import { formatBytes } from "@/lib/utils";
import type {
  AppUser,
  CaixaEntrada,
  Reuniao,
  Tarefa,
  UsoOneDrive,
} from "@/lib/types";
import {
  CalendarClock,
  CircleCheck,
  HardDrive,
  ListTodo,
  Mail,
  MapPin,
  Video,
} from "lucide-react";
import { useEffect, useState } from "react";

/** Hook simples: roda uma promise uma vez e devolve {dado, carregando}. */
function useCarga<T>(fn: () => Promise<T>): { dado: T | null; carregando: boolean } {
  const [dado, setDado] = useState<T | null>(null);
  const [carregando, setCarregando] = useState(true);
  useEffect(() => {
    let vivo = true;
    fn()
      .then((d) => vivo && setDado(d))
      .catch(() => {})
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { dado, carregando };
}

function CardBase({
  icone,
  titulo,
  children,
}: {
  icone: React.ReactNode;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="gap-3">
      <CardHeader className="flex flex-row items-center gap-2 space-y-0">
        <span className="text-muted-foreground">{icone}</span>
        <CardTitle className="text-sm font-medium">{titulo}</CardTitle>
      </CardHeader>
      <CardContent className="min-h-16">{children}</CardContent>
    </Card>
  );
}

function Vazio({ texto }: { texto: string }) {
  return <p className="text-sm text-muted-foreground">{texto}</p>;
}

function Carregando() {
  return <Spinner className="size-5 text-muted-foreground" />;
}

/** Formata o horario de uma reuniao no idioma ativo; mostra o dia se nao for hoje. */
function horario(iso: string, idioma: string): string {
  const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
  if (Number.isNaN(d.getTime())) return "";
  const hoje = new Date();
  const mesmoDia = d.toDateString() === hoje.toDateString();
  const hora = d.toLocaleTimeString(idioma, { hour: "2-digit", minute: "2-digit" });
  if (mesmoDia) return hora;
  const dia = d.toLocaleDateString(idioma, { weekday: "short" });
  return `${dia} ${hora}`;
}

export function ControlRoomScreen({ user }: { user: AppUser }) {
  const { idioma, t } = useIdioma();
  const reunioes = useCarga<Reuniao[]>(api.crReunioes);
  const email = useCarga<CaixaEntrada>(api.crEmail);
  const tarefas = useCarga<Tarefa[]>(api.crTarefas);
  const uso = useCarga<UsoOneDrive>(api.onedriveQuota);

  const primeiroNome = user.displayName.split(" ")[0];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          {preencher(t.controlRoom.saudacao, { nome: primeiroNome })}
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{t.controlRoom.subtitulo}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Reuniões */}
        <CardBase icone={<CalendarClock className="size-4" />} titulo={t.controlRoom.reunioes}>
          {reunioes.carregando ? (
            <Carregando />
          ) : reunioes.dado && reunioes.dado.length > 0 ? (
            <ul className="space-y-2.5">
              {reunioes.dado.map((r, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="mt-0.5 w-14 shrink-0 text-right text-xs font-medium text-muted-foreground">
                    {horario(r.inicio, idioma)}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{r.assunto}</div>
                    {(r.local || r.online) && (
                      <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        {r.online ? <Video className="size-3" /> : <MapPin className="size-3" />}
                        <span className="truncate">
                          {r.online ? t.controlRoom.online : r.local}
                        </span>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Vazio texto={t.controlRoom.semReunioes} />
          )}
        </CardBase>

        {/* Caixa de entrada */}
        <CardBase icone={<Mail className="size-4" />} titulo={t.controlRoom.caixaEntrada}>
          {email.carregando ? (
            <Carregando />
          ) : email.dado ? (
            <div className="space-y-3">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold">{email.dado.naoLidos}</span>
                <span className="text-sm text-muted-foreground">{t.controlRoom.naoLidos}</span>
              </div>
              {email.dado.recentes.length > 0 ? (
                <ul className="space-y-1.5">
                  {email.dado.recentes.slice(0, 4).map((m, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <span className="w-24 shrink-0 truncate text-muted-foreground">{m.de}</span>
                      <span className="min-w-0 flex-1 truncate">{m.assunto}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Vazio texto={t.controlRoom.semEmail} />
              )}
            </div>
          ) : (
            <Vazio texto={t.controlRoom.semEmail} />
          )}
        </CardBase>

        {/* Tarefas */}
        <CardBase icone={<ListTodo className="size-4" />} titulo={t.controlRoom.tarefas}>
          {tarefas.carregando ? (
            <Carregando />
          ) : tarefas.dado && tarefas.dado.length > 0 ? (
            <ul className="space-y-2">
              {tarefas.dado.map((tf, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <CircleCheck className="size-4 shrink-0 text-muted-foreground/60" />
                  <span className="min-w-0 flex-1 truncate">{tf.titulo}</span>
                  {tf.lista && (
                    <Badge variant="secondary" size="sm" className="shrink-0">
                      {tf.lista}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <Vazio texto={t.controlRoom.semTarefas} />
          )}
        </CardBase>

        {/* Armazenamento */}
        <CardBase icone={<HardDrive className="size-4" />} titulo={t.controlRoom.armazenamento}>
          {uso.carregando ? (
            <Carregando />
          ) : uso.dado ? (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                {preencher(t.controlRoom.usoLinha, {
                  u: formatBytes(uso.dado.used),
                  t: formatBytes(uso.dado.total),
                })}
              </div>
              <Progress
                value={
                  uso.dado.total > 0
                    ? Math.min(100, Math.round((uso.dado.used / uso.dado.total) * 100))
                    : 0
                }
                className={
                  uso.dado.total > 0 && uso.dado.used > uso.dado.total
                    ? "h-2 [&>div]:bg-destructive"
                    : "h-2"
                }
              />
            </div>
          ) : (
            <Vazio texto="—" />
          )}
        </CardBase>
      </div>
    </div>
  );
}
