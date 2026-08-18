import { useEffect, useId, useState } from "react";
import {
  CalendarClock,
  CalendarX2,
  Check,
  CircleHelp,
  ExternalLink,
  MapPin,
  Pencil,
  Repeat,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";

import * as api from "@/lib/api";
import { useAppStore } from "@/store";
import { preencher, useIdioma } from "@/lib/idioma";
import { useFotos } from "@/lib/fotos";
import { comLoginHint } from "@/lib/utils";
import { podeGerenciarEvento } from "@/lib/agenda-permissions";
import { faixaHora } from "@/lib/data-email";
import type { AcaoRsvp, Participante, RespostaConvite } from "@/lib/types";
import { CorpoMensagem } from "@/components/bridge/corpo-html";
import { PersonHoverCard } from "@/components/people/person-hover-card";
import { Badge, type BadgeProps } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

/**
 * #1019 (S6, movimento puro): o DIÁLOGO de evento de agenda — extraído do
 * control-room.tsx sem mudança de comportamento. `EventoDialog` (Sheet lateral
 * com detalhe/edição/RSVP do evento) é a superficie publica; `badgeResposta` e
 * `EventoParticipantePill` sao privados do seam. Datas via @/lib/data-email
 * (faixaHora), iniciais via @/lib/iniciais, corpo via @/components/bridge/corpo-html.
 */
/** Badge semântica do estado de resposta a um convite (#287). Devolve o
 *  variant do Badge (reui) e o rótulo i18n; `null` para eventos sem semântica de
 *  convite (ex.: sem resposta requisitada e ainda `none`). */
function badgeResposta(
  resposta: RespostaConvite,
  souOrganizador: boolean,
  t: ReturnType<typeof useIdioma>["t"],
): { variant: BadgeProps["variant"]; label: string } | null {
  if (souOrganizador || resposta === "organizer") {
    return { variant: "primary-light", label: t.controlRoom.rsvpStatusOrganizador };
  }
  switch (resposta) {
    case "accepted":
      return { variant: "success-light", label: t.controlRoom.rsvpStatusAceito };
    case "tentativelyAccepted":
      return { variant: "warning-light", label: t.controlRoom.rsvpStatusTalvez };
    case "declined":
      return { variant: "destructive-light", label: t.controlRoom.rsvpStatusRecusado };
    case "notResponded":
      return { variant: "secondary", label: t.controlRoom.rsvpStatusPendente };
    default:
      return null;
  }
}

function EventoParticipantePill({
  participante,
  foto,
  mostrarTooltip = true,
}: {
  participante: Participante;
  foto?: string | null;
  mostrarTooltip?: boolean;
}) {
  const nome = participante.nome.trim() || participante.email;
  const email = participante.email.trim();
  const rotuloCompleto =
    email && email.toLocaleLowerCase() !== nome.toLocaleLowerCase()
      ? `${nome} · ${email}`
      : nome;

  const pill = (
    <span
      tabIndex={mostrarTooltip ? 0 : undefined}
      // #478 rework: com email o PersonHoverCard cobre o hover — o title nativo
      // duplicaria; mantido só no fallback sem email.
      title={email ? undefined : rotuloCompleto}
      aria-label={mostrarTooltip ? rotuloCompleto : undefined}
      className="inline-flex w-fit min-w-0 max-w-full items-center gap-2 rounded-full bg-muted/60 py-1 pr-3 pl-1 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <Avatar size="sm" className="shrink-0">
        {foto && <AvatarImage src={foto} alt="" />}
        <AvatarFallback>{participante.iniciais}</AvatarFallback>
      </Avatar>
      <span className="min-w-0 max-w-40 truncate text-xs">{nome}</span>
    </span>
  );

  // #478 rework: participante com email → PersonHoverCard (avatar/nome/ações),
  // substitui o Tooltip simples em TODOS os locais com pessoa (detalhe do evento,
  // lista compacta e popover "ver todos"). Sem email cai no Tooltip/plain de antes.
  if (email) {
    return (
      <PersonHoverCard email={email} fallback={{ nome, email, foto }}>
        {pill}
      </PersonHoverCard>
    );
  }

  return mostrarTooltip ? (
    <Tooltip>
      <TooltipTrigger asChild>{pill}</TooltipTrigger>
      <TooltipContent className="max-w-xs break-words">{rotuloCompleto}</TooltipContent>
    </Tooltip>
  ) : (
    pill
  );
}

export function EventoDialog({ userEmail }: { userEmail?: string | null }) {
  const { idioma, t } = useIdioma();
  const id = useAppStore((s) => s.agendaEventoId);
  const det = useAppStore((s) => s.agendaEventoDetalhe);
  const fecharEventoAgenda = useAppStore((s) => s.fecharEventoAgenda);
  const abrirFormEditar = useAppStore((s) => s.abrirFormEditar);
  const excluirEvento = useAppStore((s) => s.excluirEvento);
  const recarregarAgenda = useAppStore((s) => s.recarregarAgenda);
  const cancelarEvento = useAppStore((s) => s.cancelarEvento);
  const responderEvento = useAppStore((s) => s.responderEvento);
  const eventosMes = useAppStore((s) => s.agendaEventosMes);
  const participantesPopoverTituloId = useId();
  // #399: badge "recorrente". O detalhe (EventoDetalhe) não traz o `type`, mas o
  // evento da lista (EventoAgenda, #397) sim — casa pelo id selecionado.
  const eventoLista = eventosMes?.find((e) => e.id === id);
  const recorrente =
    !!eventoLista &&
    (eventoLista.tipo === "occurrence" ||
      eventoLista.tipo === "exception" ||
      eventoLista.tipo === "seriesMaster");
  // Avatares dos participantes internos (#39).
  const { getFoto, pedirFotos } = useFotos();

  // RSVP a convites (#287): só quando o usuário é CONVIDADO (não organiza) — o
  // organizador vê os status dos convidados, não RSVP. `respostaSolicitada`
  // false = convite informativo: mostramos o badge, sem as ações.
  const podeGerenciar = podeGerenciarEvento(det);
  const ehConvite = !!det && !podeGerenciar;
  const podeResponder = ehConvite && (det?.respostaSolicitada ?? true);
  const badge = det ? badgeResposta(det.resposta, det.souOrganizador, t) : null;
  const [comentarioRsvp, setComentarioRsvp] = useState("");
  const [enviarResposta, setEnviarResposta] = useState(true);
  const [rsvpEmVoo, setRsvpEmVoo] = useState<AcaoRsvp | null>(null);

  // Envia o RSVP (#287): otimista no store (badge/lista atualizam na hora);
  // toasta o resultado. Mantém o Sheet aberto — o usuário pode trocar a resposta.
  const responder = async (acao: AcaoRsvp) => {
    if (!id) return;
    setRsvpEmVoo(acao);
    try {
      await responderEvento(id, acao, enviarResposta, comentarioRsvp.trim());
      toast.success(t.controlRoom.rsvpEnviado);
    } catch {
      toast.error(t.controlRoom.rsvpErro);
    } finally {
      setRsvpEmVoo(null);
    }
  };

  // Cancelar evento (#260): só faz sentido pra quem ORGANIZA um evento COM
  // convidados — aí o cancelamento os notifica. Sem isso, resta só o Excluir
  // (silencioso). Confirmação em AlertDialog com comentário opcional.
  const podeCancelar = podeGerenciar && (det?.participantes.length ?? 0) > 0;
  const [confirmarCancelar, setConfirmarCancelar] = useState(false);
  const [comentarioCancel, setComentarioCancel] = useState("");
  const [cancelando, setCancelando] = useState(false);

  // Abre o formulário de edição com o evento clicado (vindo da lista do mês).
  // #397: recorrente passa o escopo (ocorrência × série) já escolhido aqui.
  const editar = (escopo?: "ocorrencia" | "serie") => {
    if (!id || !podeGerenciar) return;
    const ev = eventosMes?.find((e) => e.id === id);
    if (ev) {
      abrirFormEditar(ev, escopo);
      fecharEventoAgenda();
    }
  };

  // #398: excluir um recorrente pergunta ocorrência × série (guarda o alvo do
  // prompt); único é direto. Otimista no store; fecha o Sheet e toasta.
  const [excluirRecAberto, setExcluirRecAberto] = useState(false);
  const [excluindoRec, setExcluindoRec] = useState(false);

  const excluir = async () => {
    if (!id || !podeGerenciar) return;
    // #398: recorrente escolhe o escopo antes de apagar (não apaga direto).
    if (recorrente) {
      setExcluirRecAberto(true);
      return;
    }
    fecharEventoAgenda();
    try {
      await excluirEvento(id);
      toast.success(t.controlRoom.agendaExcluido);
    } catch {
      toast.error(t.controlRoom.agendaErroExcluir);
    }
  };

  // #398: aplica a escolha do prompt de exclusão do detalhe. "Série" apaga o
  // seriesMaster (some tudo) + recarrega; "ocorrência" apaga só o id dela.
  const confirmarExcluirRec = async (alvo: "ocorrencia" | "serie") => {
    if (!id) return;
    const alvoId =
      alvo === "serie" && eventoLista?.seriesMasterId
        ? eventoLista.seriesMasterId
        : id;
    setExcluindoRec(true);
    try {
      await excluirEvento(alvoId);
      if (alvo === "serie") recarregarAgenda();
      setExcluirRecAberto(false);
      fecharEventoAgenda();
      toast.success(t.controlRoom.agendaExcluido);
    } catch {
      toast.error(t.controlRoom.agendaErroExcluir);
    } finally {
      setExcluindoRec(false);
    }
  };

  // Cancela (#260): POST /events/{id}/cancel com comentário opcional — notifica
  // os convidados. Otimista no store; fecha confirmação + Sheet e toasta.
  const cancelar = async () => {
    if (!id || !podeCancelar) return;
    const comentario = comentarioCancel.trim();
    setCancelando(true);
    try {
      await cancelarEvento(id, comentario);
      setConfirmarCancelar(false);
      setComentarioCancel("");
      fecharEventoAgenda();
      toast.success(t.controlRoom.agendaCancelado);
    } catch {
      toast.error(t.controlRoom.agendaErroCancelar);
    } finally {
      setCancelando(false);
    }
  };

  // Pede as fotos dos participantes quando o detalhe carrega.
  useEffect(() => {
    if (det?.participantes.length) pedirFotos(det.participantes.map((p) => p.email));
  }, [det, pedirFotos]);

  // Zera o rascunho de RSVP ao trocar de evento (#287).
  useEffect(() => {
    setComentarioRsvp("");
    setEnviarResposta(true);
    setRsvpEmVoo(null);
  }, [id]);

  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && fecharEventoAgenda()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        {!det ? (
          <div className="flex flex-1 items-center justify-center py-10">
            <Spinner className="size-6 text-muted-foreground" />
          </div>
        ) : (
          <>
            <SheetHeader className="border-b px-4 py-3">
              <SheetTitle className="pr-6 text-left">{det.assunto}</SheetTitle>
              <SheetDescription className="sr-only">
                {t.controlRoom.agendaEventoDetalheDescricao}
              </SheetDescription>
              {recorrente && (
                <Badge
                  variant="secondary"
                  size="sm"
                  className="mt-1 w-fit gap-1"
                >
                  <Repeat className="size-3" />
                  {t.controlRoom.agendaRecorrenteBadge}
                </Badge>
              )}
            </SheetHeader>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto scrollbar-fina px-4 py-4 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <CalendarClock className="size-4 shrink-0" />
                <span>{faixaHora(det.inicio, det.fim, idioma)}</span>
              </div>
              {/* Semântica do convite (#287): badge do estado da resposta. */}
              {badge && (
                <Badge variant={badge.variant} size="lg">
                  {badge.label}
                </Badge>
              )}
              {(det.online || det.local) && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  {det.online ? (
                    <Video className="size-4 shrink-0" />
                  ) : (
                    <MapPin className="size-4 shrink-0" />
                  )}
                  <span>{det.online ? t.controlRoom.online : det.local}</span>
                </div>
              )}
              {det.organizador && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">{t.controlRoom.organizador}:</span>{" "}
                  {/* #515: com email real → PersonHoverCard no organizador;
                      sem email cai no texto simples de antes. */}
                  {det.organizadorEmail ? (
                    <PersonHoverCard
                      email={det.organizadorEmail}
                      fallback={{ nome: det.organizador, email: det.organizadorEmail }}
                    >
                      <span
                        tabIndex={0}
                        className="cursor-default rounded-sm underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {det.organizador}
                      </span>
                    </PersonHoverCard>
                  ) : (
                    det.organizador
                  )}
                </p>
              )}
              {det.participantes.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium">{t.controlRoom.convidadosTitulo}</p>
                  <div className="max-h-[8.5rem] overflow-hidden">
                    <div className="flex flex-wrap gap-2">
                      {det.participantes.slice(0, 3).map((p) => (
                        <EventoParticipantePill
                          key={p.email || p.nome}
                          participante={p}
                          foto={p.foto ?? getFoto(p.email)}
                        />
                      ))}
                    </div>
                  </div>
                  {det.participantes.length > 3 && (
                    <Popover>
                      <PopoverTrigger
                        type="button"
                        className="mt-1 cursor-pointer truncate rounded-sm px-1.5 py-1 text-start text-xs text-muted-foreground hover:text-foreground"
                      >
                        {preencher(t.controlRoom.agendaMostrarTodosConvidados, {
                          count: det.participantes.length,
                        })}
                      </PopoverTrigger>
                      <PopoverContent
                        align="start"
                        aria-labelledby={participantesPopoverTituloId}
                        className="w-80 gap-2 p-2"
                      >
                        <p
                          id={participantesPopoverTituloId}
                          className="px-1 text-xs font-medium"
                        >
                          {t.controlRoom.agendaTodosConvidados}
                        </p>
                        <div className="flex max-h-64 flex-wrap gap-2 overflow-y-auto p-1 scrollbar-fina">
                          {det.participantes.map((p) => (
                            <EventoParticipantePill
                              key={p.email || p.nome}
                              participante={p}
                              foto={p.foto ?? getFoto(p.email)}
                              mostrarTooltip={false}
                            />
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
              )}
              {/* RSVP a convites (#287): Aceitar/Talvez/Recusar. Só para
                  convidados; o botão do estado atual fica destacado (permite
                  trocar). Convite informativo (responseRequested=false) mostra
                  só o aviso, sem ações. */}
              {ehConvite && (
                <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                  <p className="text-xs font-medium">{t.controlRoom.rsvpTitulo}</p>
                  {podeResponder ? (
                    <>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant={det.resposta === "accepted" ? "default" : "outline"}
                          size="sm"
                          disabled={!!rsvpEmVoo}
                          onClick={() => void responder("accept")}
                        >
                          {rsvpEmVoo === "accept" ? (
                            <Spinner className="size-4" />
                          ) : (
                            <Check />
                          )}
                          {t.controlRoom.rsvpAceitar}
                        </Button>
                        <Button
                          variant={
                            det.resposta === "tentativelyAccepted" ? "default" : "outline"
                          }
                          size="sm"
                          disabled={!!rsvpEmVoo}
                          onClick={() => void responder("tentativelyAccept")}
                        >
                          {rsvpEmVoo === "tentativelyAccept" ? (
                            <Spinner className="size-4" />
                          ) : (
                            <CircleHelp />
                          )}
                          {t.controlRoom.rsvpTalvez}
                        </Button>
                        <Button
                          variant={det.resposta === "declined" ? "default" : "outline"}
                          size="sm"
                          disabled={!!rsvpEmVoo}
                          onClick={() => void responder("decline")}
                        >
                          {rsvpEmVoo === "decline" ? (
                            <Spinner className="size-4" />
                          ) : (
                            <X />
                          )}
                          {t.controlRoom.rsvpRecusar}
                        </Button>
                      </div>
                      <Textarea
                        value={comentarioRsvp}
                        onChange={(e) => setComentarioRsvp(e.target.value)}
                        placeholder={t.controlRoom.rsvpComentarioPlaceholder}
                        rows={2}
                        disabled={!!rsvpEmVoo}
                      />
                      <div className="flex items-center gap-2">
                        <Switch
                          id="agenda-rsvp-enviar"
                          checked={enviarResposta}
                          onCheckedChange={setEnviarResposta}
                          disabled={!!rsvpEmVoo}
                        />
                        <Label htmlFor="agenda-rsvp-enviar" className="text-xs font-normal">
                          {t.controlRoom.rsvpEnviarResposta}
                        </Label>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {t.controlRoom.rsvpInfoSemResposta}
                    </p>
                  )}
                </div>
              )}
              {det.corpo.trim() && (
                <>
                  <Separator />
                  <CorpoMensagem corpo={det.corpo} tipo={det.corpoTipo} />
                </>
              )}
            </div>
            <SheetFooter className="flex-row items-center gap-2 border-t px-4 py-3">
              {podeGerenciar && (
                <>
                  {recorrente ? (
                    // #397: recorrente escolhe o escopo no próprio Edit.
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!eventosMes?.some((e) => e.id === id)}
                        >
                          <Pencil /> {t.controlRoom.agendaEditar}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem onClick={() => editar("ocorrencia")}>
                          {t.controlRoom.agendaEditarEstaOcorrencia}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => editar("serie")}>
                          {t.controlRoom.agendaEditarSerie}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => editar()}
                      disabled={!eventosMes?.some((e) => e.id === id)}
                    >
                      <Pencil /> {t.controlRoom.agendaEditar}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => void excluir()}
                  >
                    <Trash2 /> {t.controlRoom.agendaExcluir}
                  </Button>
                </>
              )}
              {podeCancelar && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setConfirmarCancelar(true)}
                >
                  <CalendarX2 /> {t.controlRoom.agendaCancelar}
                </Button>
              )}
              <div className="grow" />
              {det.webLink && (
                <Button
                  variant="outline"
                  onClick={() => api.openUrl(comLoginHint(det.webLink, userEmail))}
                >
                  <ExternalLink /> {t.controlRoom.abrirOutlook}
                </Button>
              )}
              {det.online && det.joinUrl && (
                <Button onClick={() => api.openUrl(det.joinUrl!)}>
                  <Video /> {t.controlRoom.entrarReuniao}
                </Button>
              )}
            </SheetFooter>
          </>
        )}
      </SheetContent>

      {/* Confirmação do "Cancelar evento" (#260). Destrutiva → AlertDialog (mesmo
          padrão do "Excluir pasta" #90), mas com campo de comentário opcional
          que segue aos convidados junto do cancelamento. */}
      <AlertDialog
        open={confirmarCancelar}
        onOpenChange={(aberto) => {
          if (!aberto && !cancelando) {
            setConfirmarCancelar(false);
            setComentarioCancel("");
          }
        }}
      >
        <AlertDialogContent className="max-w-md!">
          <AlertDialogHeader>
            <AlertDialogTitle>{t.controlRoom.agendaCancelarTitulo}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.controlRoom.agendaCancelarDesc}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="agenda-cancelar-comentario">
              {t.controlRoom.agendaCancelarComentario}
            </Label>
            <Textarea
              id="agenda-cancelar-comentario"
              value={comentarioCancel}
              onChange={(e) => setComentarioCancel(e.target.value)}
              placeholder={t.controlRoom.agendaCancelarComentarioPlaceholder}
              rows={3}
              disabled={cancelando}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelando}>
              {t.controlRoom.agendaCancelarVoltar}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={cancelando}
              onClick={(e) => {
                // Impede o fechamento automático do AlertDialog até a chamada
                // resolver (mostramos o spinner enquanto o Graph notifica).
                e.preventDefault();
                void cancelar();
              }}
            >
              {cancelando && <Spinner className="size-4" />}
              {t.controlRoom.agendaCancelarConfirmar}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* #398: excluir recorrente pelo detalhe — ocorrência × série. Antes o
          Delete do detalhe apagava a ocorrência direto, sem perguntar. */}
      <AlertDialog
        open={excluirRecAberto}
        onOpenChange={(o) => {
          if (!o && !excluindoRec) setExcluirRecAberto(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t.controlRoom.agendaExcluirRecorrenteTitulo}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t.controlRoom.agendaExcluirRecorrenteDesc}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluindoRec}>
              {t.controlRoom.agendaEditarCancelar}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={excluindoRec}
              onClick={(e) => {
                e.preventDefault();
                void confirmarExcluirRec("ocorrencia");
              }}
            >
              {t.controlRoom.agendaEditarEstaOcorrencia}
            </AlertDialogAction>
            <AlertDialogAction
              variant="destructive"
              disabled={excluindoRec}
              onClick={(e) => {
                e.preventDefault();
                void confirmarExcluirRec("serie");
              }}
            >
              {t.controlRoom.agendaEditarSerie}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}

