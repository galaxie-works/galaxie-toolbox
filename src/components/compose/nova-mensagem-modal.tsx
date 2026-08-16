import { useEffect, useMemo, useRef } from "react";
import { Inbox, Mailbox, Send } from "lucide-react";
import { toast } from "sonner";

import {
  ComporMensagem,
  type ComporMensagemHandle,
} from "@/components/compose/compor-mensagem";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
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
import { Spinner } from "@/components/ui/spinner";
import { useUndoSend } from "@/hooks/use-undo-send";
import * as api from "@/lib/api";
import {
  CAIXA_PROPRIA,
  descricaoErroEnvio,
} from "@/lib/bridge-compose";
import { preencher, useIdioma } from "@/lib/idioma";
import { toastIcone } from "@/lib/toasts";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

/** Seletor canônico de remetente do compose (#114). */
function SeletorRemetente({
  caixas,
  valor,
  onChange,
  emailPessoal,
  sharedDisponivel,
  t,
}: {
  caixas: string[];
  valor: string;
  onChange: (v: string) => void;
  emailPessoal?: string | null;
  sharedDisponivel: boolean;
  t: ReturnType<typeof useIdioma>["t"];
}) {
  return (
    <div className="border-b px-3 py-2">
      <div className="flex items-center gap-3">
        <span className="w-16 shrink-0 text-xs text-muted-foreground">
          {t.controlRoom.enviarDe}
        </span>
        <Select value={valor} onValueChange={onChange}>
          <SelectTrigger
            className="h-9 min-w-0 flex-1"
            aria-label={t.controlRoom.enviarDe}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectGroup>
              <SelectItem value={CAIXA_PROPRIA}>
                <span className="flex items-center gap-2">
                  <Inbox className="size-4 shrink-0 text-muted-foreground" />
                  <span>{t.controlRoom.caixaMinha}</span>
                  {emailPessoal && (
                    <span className="truncate text-xs text-muted-foreground">
                      {emailPessoal}
                    </span>
                  )}
                </span>
              </SelectItem>
              {caixas.map((caixa) => (
                <SelectItem
                  key={caixa}
                  value={caixa}
                  disabled={!sharedDisponivel}
                >
                  <span className="flex items-center gap-2">
                    <Mailbox className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{caixa}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      {!sharedDisponivel && caixas.length > 0 && (
        <p className="mt-1 pl-19 text-xs text-muted-foreground">
          {t.controlRoom.caixaEnvioRelogin}
        </p>
      )}
    </div>
  );
}

export function NovaMensagemModal({
  caixas,
  emailPessoal,
  sharedEnvioDisponivel,
}: {
  caixas: string[];
  emailPessoal?: string | null;
  sharedEnvioDisponivel: boolean;
}) {
  const { t } = useIdioma();
  const aberto = useAppStore((s) => s.composeModo === "novo");
  const composeGeracao = useAppStore((s) => s.composeGeracao);
  const remetente = useAppStore((s) => s.composeRemetente);
  const setRemetente = useAppStore((s) => s.setComposeRemetente);
  const fecharCompose = useAppStore((s) => s.fecharCompose);
  const comporRef = useRef<ComporMensagemHandle>(null);
  const textosUndoSend = useMemo(
    () => ({
      tituloPendente: (segundos: number) =>
        preencher(t.controlRoom.envioPendente, { n: segundos }),
      descricaoPendente: t.controlRoom.envioPendenteDescricao,
      rotuloDesfazer: t.controlRoom.desfazerEnvio,
      envioCancelado: t.controlRoom.envioCancelado,
      enviando: t.controlRoom.enviandoAgora,
    }),
    [t],
  );
  const {
    agendar: agendarUndoSend,
    estado: estadoUndoSend,
    ocupado: envioOcupado,
  } = useUndoSend(textosUndoSend);

  useEffect(() => {
    if (!aberto) return;
    if (remetente !== CAIXA_PROPRIA && !sharedEnvioDisponivel) {
      setRemetente(CAIXA_PROPRIA);
    }
  }, [aberto, remetente, sharedEnvioDisponivel, setRemetente]);

  const textos = {
    para: t.controlRoom.para,
    cc: t.controlRoom.ccLabel,
    cco: t.controlRoom.ccoLabel,
    assunto: t.controlRoom.assunto,
    assuntoPlaceholder: t.controlRoom.assuntoPlaceholder,
    corpoPlaceholder: t.controlRoom.corpoPlaceholder,
    mostrarCcCco: t.controlRoom.mostrarCcCco,
  };

  function enviar() {
    if (envioOcupado) return;
    const c = comporRef.current;
    const para = [...(c?.getPara() ?? [])];
    const cc = [...(c?.getCc() ?? [])];
    const cco = [...(c?.getCco() ?? [])];
    if (para.length === 0) {
      toast.error(t.controlRoom.informeDestino);
      return;
    }
    const assunto = c?.getAssunto() ?? "";
    const corpo = c?.getHtml() ?? "";
    const anexos = c?.getAnexos() ?? [];
    const remetenteAgendado = remetente;

    agendarUndoSend({
      enviar: async () => {
        await api.crEnviarNovo(
          para,
          cc,
          cco,
          assunto,
          corpo,
          anexos,
          remetenteAgendado,
        );
        api
          .crSalvarContatos(
            [...para, ...cc, ...cco].map((email) => ({
              nome: email,
              email,
            })),
          )
          .catch(() => {});
      },
      onConcluido: () => {
        toastIcone(
          t.controlRoom.enviado,
          t.controlRoom.enviadoDescricao,
          "enviado",
        );
        fecharCompose();
      },
      onErro: (erro) => {
        toast.error(t.controlRoom.erroEnvio, {
          description: descricaoErroEnvio(erro, remetenteAgendado, t),
        });
      },
    });
  }

  return (
    <Sheet
      open={aberto}
      onOpenChange={(open) =>
        !open && !envioOcupado && fecharCompose()
      }
    >
      <SheetContent
        side="right"
        showCloseButton={!envioOcupado}
        className="flex w-1/2 flex-col gap-0 p-0 sm:max-w-[50vw]"
      >
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-left">
            {t.controlRoom.novaMensagem}
          </SheetTitle>
          <SheetDescription className="sr-only">
            {t.controlRoom.novaMensagemDescricao}
          </SheetDescription>
        </SheetHeader>
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col transition-opacity",
            envioOcupado && "opacity-60",
          )}
          aria-busy={envioOcupado}
          inert={envioOcupado ? true : undefined}
        >
          <SeletorRemetente
            caixas={caixas}
            valor={remetente}
            onChange={setRemetente}
            emailPessoal={emailPessoal}
            sharedDisponivel={sharedEnvioDisponivel}
            t={t}
          />
          <div className="min-h-0 flex-1 overflow-hidden">
            <ComporMensagem
              key={composeGeracao}
              ref={comporRef}
              mostrarAssunto
              contextoAssinatura="novo"
              textos={textos}
            />
          </div>
        </div>
        <SheetFooter className="flex-row justify-end gap-2 border-t px-4 py-3">
          <Button
            variant="ghost"
            onClick={fecharCompose}
            disabled={envioOcupado}
          >
            {t.controlRoom.cancelar}
          </Button>
          <Button onClick={enviar} disabled={envioOcupado}>
            {envioOcupado ? <Spinner className="size-4" /> : <Send />}
            {estadoUndoSend.fase === "pendente"
              ? preencher(t.controlRoom.envioPendente, {
                  n: estadoUndoSend.segundosRestantes,
                })
              : estadoUndoSend.fase === "enviando"
                ? t.controlRoom.enviandoAgora
                : t.controlRoom.enviar}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
