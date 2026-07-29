import { useEffect, useState } from "react";
import { toast } from "sonner";

import * as api from "@/lib/api";
import { logErro } from "@/lib/log";
import { FramePanel } from "@/components/reui/frame";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";

/**
 * Settings > System > Startup (#123).
 *
 * Controle direto dentro do frame colapsável "Startup" (a moldura vem da tela de
 * Settings), no mesmo padrão stacked-card dos irmãos (Background, Appearance):
 * rótulo + descrição à esquerda, um Switch à direita. Liga/desliga o autostart
 * do SO (plugin oficial tauri-plugin-autostart) via `@/lib/api`.
 *
 * O estado real é lido de `autostartEnabled()` na montagem (Spinner enquanto
 * carrega); alternar chama `setAutostartEnabled()` e reflete o estado do SO.
 * Nunca quebra: erros são logados (#148) e o toggle revertido, com toast.
 */
export function StartupSettings() {
  // null = ainda carregando o estado real do SO.
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let ativo = true;
    void (async () => {
      try {
        const atual = await api.autostartEnabled();
        if (ativo) setEnabled(atual);
      } catch (e) {
        logErro("startup.autostartEnabled", e);
        if (ativo) setEnabled(false);
      }
    })();
    return () => {
      ativo = false;
    };
  }, []);

  async function alternar(proximo: boolean) {
    if (salvando || enabled === null) return;
    setSalvando(true);
    // Otimista: reflete na hora e reverte se o SO recusar.
    setEnabled(proximo);
    try {
      await api.setAutostartEnabled(proximo);
    } catch (e) {
      logErro("startup.setAutostartEnabled", e);
      setEnabled(!proximo);
      toast.error("Couldn’t update launch on startup. Please try again.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <FramePanel>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="launch-on-startup">Launch on startup</FieldLabel>
          <FieldDescription>
            Open GALAXIE Toolbox automatically when you sign in to Windows.
          </FieldDescription>
        </FieldContent>
        {enabled === null ? (
          <Spinner className="shrink-0" />
        ) : (
          <Switch
            id="launch-on-startup"
            checked={enabled}
            disabled={salvando}
            onCheckedChange={alternar}
          />
        )}
      </Field>
    </FramePanel>
  );
}
