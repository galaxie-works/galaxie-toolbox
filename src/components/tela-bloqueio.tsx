import { useEffect, useState } from "react";
import { LockKeyhole, LogOut, RotateCcw } from "lucide-react";
import * as api from "@/lib/api";
import type { Identidade } from "@/lib/types";
import { preencher, useIdioma } from "@/lib/idioma";
import { BarraJanela, FaixaArrasto } from "@/components/barra-janela";
import { Estrelas } from "@/components/estrelas";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

interface TelaBloqueioProps {
  identidade: Identidade | null;
  statusIndisponivel?: boolean;
  onDesbloquear: () => void;
  onRecuperar: () => Promise<void>;
  onTentarStatusNovamente: () => void;
}

/**
 * Gate de boot do #122.
 *
 * O Dialog replica o padrão já usado pelo app para entrada de dados. Ele é
 * controlado, não tem botão de fechar e bloqueia Escape/clique externo. O app
 * protegido ainda não foi montado atrás dele: só o fundo neutro do boot.
 */
export function TelaBloqueio({
  identidade,
  statusIndisponivel = false,
  onDesbloquear,
  onRecuperar,
  onTentarStatusNovamente,
}: TelaBloqueioProps) {
  const { t } = useIdioma();
  const [pin, setPin] = useState("");
  const [validando, setValidando] = useState(false);
  const [recuperando, setRecuperando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativas, setTentativas] = useState<number | null>(null);
  const [espera, setEspera] = useState(0);

  useEffect(() => {
    if (espera <= 0) return;
    const timer = window.setInterval(
      () => setEspera((atual) => Math.max(0, atual - 1)),
      1000
    );
    return () => window.clearInterval(timer);
  }, [espera]);

  async function conferir(e: React.FormEvent) {
    e.preventDefault();
    if (validando || espera > 0 || !/^\d{4,8}$/.test(pin)) return;

    setValidando(true);
    setErro(null);
    try {
      const resultado = await api.lockVerifyPin(pin);
      if (resultado.ok) {
        onDesbloquear();
        return;
      }
      setPin("");
      setTentativas(resultado.remainingAttempts);
      setEspera(resultado.retryAfterSeconds);
      setErro(
        resultado.retryAfterSeconds > 0
          ? t.lockScreen.muitasTentativas
          : preencher(t.lockScreen.pinIncorreto, {
              n: resultado.remainingAttempts,
            })
      );
    } catch {
      setErro(t.lockScreen.erroValidacao);
    } finally {
      setValidando(false);
    }
  }

  async function recuperar() {
    setRecuperando(true);
    setErro(null);
    try {
      await onRecuperar();
    } catch {
      setErro(t.lockScreen.erroRecuperacao);
      setRecuperando(false);
    }
  }

  const bloqueado = validando || recuperando || espera > 0;

  return (
    <div className="relative grid h-full place-items-center overflow-hidden">
      <FaixaArrasto />
      <BarraJanela />
      <Estrelas />
      <Dialog open>
        <DialogContent
          className="gap-0 overflow-hidden p-0 sm:max-w-sm"
          showCloseButton={false}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <form onSubmit={conferir}>
            <DialogHeader className="items-center gap-3 p-8 text-center sm:text-center">
              <Avatar className="size-14 ring-2 ring-border">
                {identidade?.photo && (
                  <AvatarImage src={identidade.photo} alt="" />
                )}
                <AvatarFallback>
                  {identidade?.initials ?? <LockKeyhole className="size-5" />}
                </AvatarFallback>
              </Avatar>
              <div className="space-y-1.5">
                <DialogTitle>{t.lockScreen.titulo}</DialogTitle>
                <DialogDescription>
                  {statusIndisponivel
                    ? t.lockScreen.statusIndisponivel
                    : identidade?.displayName
                      ? preencher(t.lockScreen.descricaoComNome, {
                          nome: identidade.displayName,
                        })
                      : t.lockScreen.descricao}
                </DialogDescription>
              </div>
            </DialogHeader>

            <div className="space-y-4 bg-muted/60 p-6">
              {!statusIndisponivel && (
                <div className="space-y-1.5">
                  <label
                    htmlFor="boot-pin"
                    className="block text-sm font-medium"
                  >
                    {t.lockScreen.rotuloPin}
                  </label>
                  <Input
                    id="boot-pin"
                    type="password"
                    inputMode="numeric"
                    autoComplete="current-password"
                    autoFocus
                    pattern="[0-9]*"
                    minLength={4}
                    maxLength={8}
                    value={pin}
                    onChange={(e) =>
                      setPin(e.target.value.replace(/\D/g, "").slice(0, 8))
                    }
                    placeholder={t.lockScreen.placeholderPin}
                    disabled={bloqueado}
                    aria-invalid={erro ? true : undefined}
                    aria-describedby={erro ? "boot-pin-error" : undefined}
                  />
                </div>
              )}

              {erro && (
                <p
                  id="boot-pin-error"
                  role="alert"
                  className="text-sm text-destructive"
                >
                  {espera > 0
                    ? preencher(t.lockScreen.tenteEm, { s: espera })
                    : erro}
                </p>
              )}

              <DialogFooter className="flex-col-reverse sm:flex-col-reverse">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={recuperar}
                  disabled={validando || recuperando}
                >
                  {recuperando ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <LogOut />
                  )}
                  {t.lockScreen.recuperar}
                </Button>
                {statusIndisponivel ? (
                  <Button
                    type="button"
                    onClick={onTentarStatusNovamente}
                    disabled={recuperando}
                  >
                    <RotateCcw />
                    {t.lockScreen.tentarNovamente}
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    disabled={bloqueado || !/^\d{4,8}$/.test(pin)}
                  >
                    {validando && <Spinner data-icon="inline-start" />}
                    {validando
                      ? t.lockScreen.verificando
                      : t.lockScreen.desbloquear}
                  </Button>
                )}
              </DialogFooter>

              {!statusIndisponivel && tentativas === null && (
                <p className="text-center text-xs text-muted-foreground">
                  {t.lockScreen.ajuda}
                </p>
              )}
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
