import { useEffect, useState } from "react";
import { KeyRound, LockKeyhole } from "lucide-react";
import { toast } from "sonner";

import * as api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { FramePanel } from "@/components/reui/frame";

/** PIN numérico de 4 a 8 dígitos — mesma faixa da tela de unlock (#122). */
const PIN_REGEX = /^\d{4,8}$/;
const sanitizarPin = (v: string) => v.replace(/\D/g, "").slice(0, 8);

/** Campo de PIN reutilizado pelos diálogos (numérico, mascarado). */
function PinField({
  id,
  label,
  value,
  onChange,
  autoFocus,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (valor: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={autoFocus}
        pattern="[0-9]*"
        minLength={4}
        maxLength={8}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(sanitizarPin(e.target.value))}
        placeholder="••••"
      />
    </div>
  );
}

type ModoDialogo = "set" | "change";

/**
 * Settings > Personalization > Lock screen (#122, frontend).
 *
 * Renderiza os controles DIRETO dentro do frame colapsável (a moldura vem da
 * tela de Settings), no mesmo padrão stacked-card dos irmãos (Appearance,
 * Signatures): rótulo + descrição à esquerda, ação(ões) à direita.
 *
 * - Sem PIN: botão "Set PIN" → diálogo com novo + confirmar.
 * - Com PIN: "Change PIN" (atual + novo + confirmar) e "Remove PIN"
 *   (destrutivo, confirma o PIN atual num AlertDialog).
 *
 * O estado real vem de `lockStatus()` na montagem e é relido após cada
 * operação. Toda a persistência é o backend Rust via `@/lib/api`.
 */
export function LockScreenSettings() {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  const [modo, setModo] = useState<ModoDialogo | null>(null);
  const [removendo, setRemovendo] = useState(false);

  const [pinAtual, setPinAtual] = useState("");
  const [pinNovo, setPinNovo] = useState("");
  const [pinConfirmar, setPinConfirmar] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function recarregar() {
    try {
      const status = await api.lockStatus();
      setEnabled(status.enabled);
    } catch {
      setEnabled(false);
    }
  }

  useEffect(() => {
    void recarregar();
  }, []);

  function limparCampos() {
    setPinAtual("");
    setPinNovo("");
    setPinConfirmar("");
    setErro(null);
    setSalvando(false);
  }

  function abrirDialogo(novoModo: ModoDialogo) {
    limparCampos();
    setModo(novoModo);
  }

  function fecharDialogo(aberto: boolean) {
    if (aberto || salvando) return;
    setModo(null);
    limparCampos();
  }

  async function salvarPin(e: React.FormEvent) {
    e.preventDefault();
    if (salvando || modo === null) return;

    if (!PIN_REGEX.test(pinNovo)) {
      setErro("The PIN must be 4 to 8 digits.");
      return;
    }
    if (pinNovo !== pinConfirmar) {
      setErro("The PINs don’t match.");
      return;
    }

    setSalvando(true);
    setErro(null);
    try {
      await api.lockSetPin(pinNovo, modo === "change" ? pinAtual : undefined);
      await recarregar();
      setModo(null);
      limparCampos();
      toast.success(modo === "change" ? "PIN changed" : "PIN set");
    } catch {
      // Erro mais provável no "change": PIN atual incorreto.
      setErro(
        modo === "change"
          ? "Couldn’t change the PIN. Check your current PIN and try again."
          : "Couldn’t set the PIN. Please try again."
      );
      setSalvando(false);
    }
  }

  function fecharRemocao(aberto: boolean) {
    if (aberto || salvando) return;
    setRemovendo(false);
    limparCampos();
  }

  async function removerPin(e: React.FormEvent) {
    e.preventDefault();
    if (salvando) return;
    if (!PIN_REGEX.test(pinAtual)) {
      setErro("The PIN must be 4 to 8 digits.");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      await api.lockDisablePin(pinAtual);
      await recarregar();
      setRemovendo(false);
      limparCampos();
      toast.success("PIN removed");
    } catch {
      setErro("Couldn’t remove the PIN. Check your PIN and try again.");
      setSalvando(false);
    }
  }

  return (
    <FramePanel>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">App lock</h3>
          <p className="text-sm text-muted-foreground">
            {enabled
              ? "A PIN is required to open GALAXIE Toolbox."
              : "Require a PIN each time GALAXIE Toolbox opens."}
          </p>
        </div>

        {enabled === null ? (
          <Spinner className="shrink-0" />
        ) : enabled ? (
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" onClick={() => abrirDialogo("change")}>
              <KeyRound aria-hidden="true" />
              Change PIN
            </Button>
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                limparCampos();
                setRemovendo(true);
              }}
            >
              Remove PIN
            </Button>
          </div>
        ) : (
          <Button className="shrink-0" onClick={() => abrirDialogo("set")}>
            <LockKeyhole aria-hidden="true" />
            Set PIN
          </Button>
        )}
      </div>

      {/* Set / Change PIN */}
      <Dialog open={modo !== null} onOpenChange={fecharDialogo}>
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={salvarPin}>
            <DialogHeader>
              <DialogTitle>
                {modo === "change" ? "Change PIN" : "Set a PIN"}
              </DialogTitle>
              <DialogDescription>
                {modo === "change"
                  ? "Enter your current PIN and choose a new one."
                  : "Choose a PIN of 4 to 8 digits to protect the app."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {modo === "change" && (
                <PinField
                  id="lock-current-pin"
                  label="Current PIN"
                  value={pinAtual}
                  onChange={setPinAtual}
                  autoFocus
                  disabled={salvando}
                />
              )}
              <PinField
                id="lock-new-pin"
                label="New PIN"
                value={pinNovo}
                onChange={setPinNovo}
                autoFocus={modo === "set"}
                disabled={salvando}
              />
              <PinField
                id="lock-confirm-pin"
                label="Confirm PIN"
                value={pinConfirmar}
                onChange={setPinConfirmar}
                disabled={salvando}
              />

              {erro && (
                <p role="alert" className="text-sm text-destructive">
                  {erro}
                </p>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => fecharDialogo(false)}
                disabled={salvando}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  salvando ||
                  !PIN_REGEX.test(pinNovo) ||
                  pinNovo !== pinConfirmar ||
                  (modo === "change" && !PIN_REGEX.test(pinAtual))
                }
              >
                {salvando && <Spinner data-icon="inline-start" />}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Remove PIN — destrutivo, pede o PIN atual para confirmar. */}
      <AlertDialog open={removendo} onOpenChange={fecharRemocao}>
        <AlertDialogContent>
          <form onSubmit={removerPin}>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove PIN?</AlertDialogTitle>
              <AlertDialogDescription>
                The app will no longer ask for a PIN on startup. Enter your
                current PIN to confirm.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="space-y-4 py-4">
              <PinField
                id="lock-remove-pin"
                label="Current PIN"
                value={pinAtual}
                onChange={setPinAtual}
                autoFocus
                disabled={salvando}
              />
              {erro && (
                <p role="alert" className="text-sm text-destructive">
                  {erro}
                </p>
              )}
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel
                type="button"
                variant="ghost"
                disabled={salvando}
              >
                Cancel
              </AlertDialogCancel>
              <Button
                type="submit"
                variant="destructive"
                disabled={salvando || !PIN_REGEX.test(pinAtual)}
              >
                {salvando && <Spinner data-icon="inline-start" />}
                Remove PIN
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </FramePanel>
  );
}
