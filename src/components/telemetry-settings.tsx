import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";

import { FramePanel } from "@/components/reui/frame";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  telemetryRevoke,
  telemetrySetConsent,
  telemetryStatus,
  type TelemetryConsent,
} from "@/lib/api";

const CONSENT_OFF: TelemetryConsent = {
  crash: false,
  diagnostico: false,
  analytics: false,
};

/**
 * Consent UI da telemetria (#389, S3 do épico #380).
 *
 * Fonte de verdade é o Rust (TelemetryPolicy, #388): lê o estado por
 * `telemetryStatus` e grava por `telemetrySetConsent`/`telemetryRevoke`. Default
 * OFF, opt-in por categoria. Nada de PII é coletado — só diagnóstico anônimo em
 * enums/buckets, self-host. Revogar apaga a fila local e reinicia o session-id.
 *
 * Precedência admin>tenant>usuário: ainda não há fonte de política admin/tenant
 * no app — este painel controla o consent do USUÁRIO. O override admin/tenant
 * (MDM/Graph) é follow-up (ver #133).
 */
export function TelemetrySettings() {
  const [consent, setConsent] = useState<TelemetryConsent>(CONSENT_OFF);

  useEffect(() => {
    let vivo = true;
    telemetryStatus()
      .then((status) => {
        if (vivo && status) setConsent(status.consent);
      })
      .catch(() => {
        /* best-effort: mantém OFF */
      });
    return () => {
      vivo = false;
    };
  }, []);

  const alterar = (categoria: keyof TelemetryConsent, valor: boolean) => {
    const proximo = { ...consent, [categoria]: valor };
    setConsent(proximo);
    void telemetrySetConsent(proximo);
  };

  const revogar = () => {
    setConsent(CONSENT_OFF);
    void telemetryRevoke();
  };

  const algumLigado = consent.crash || consent.diagnostico || consent.analytics;

  return (
    <FramePanel>
      <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/30 p-3">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Telemetry is <span className="font-medium text-foreground">off by
          default</span> and opt-in per category. GALAXIE Toolbox never collects
          personal data — no emails, names, message content, URLs or file paths,
          only anonymous, bucketed diagnostics. Data is self-hosted.
        </p>
      </div>

      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="telemetry-crash">Crash reports</FieldLabel>
          <FieldDescription>
            Send crash reports so we can fix what breaks. Essential diagnostics
            only.
          </FieldDescription>
        </FieldContent>
        <Switch
          id="telemetry-crash"
          checked={consent.crash}
          onCheckedChange={(v) => alterar("crash", v)}
        />
      </Field>

      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="telemetry-diagnostics">
            Performance diagnostics
          </FieldLabel>
          <FieldDescription>
            Share anonymous performance and error diagnostics to help us find
            slow spots.
          </FieldDescription>
        </FieldContent>
        <Switch
          id="telemetry-diagnostics"
          checked={consent.diagnostico}
          onCheckedChange={(v) => alterar("diagnostico", v)}
        />
      </Field>

      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="telemetry-analytics">Anonymous usage</FieldLabel>
          <FieldDescription>
            Share anonymous feature-usage stats so we know what to improve.
          </FieldDescription>
        </FieldContent>
        <Switch
          id="telemetry-analytics"
          checked={consent.analytics}
          onCheckedChange={(v) => alterar("analytics", v)}
        />
      </Field>

      <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
        <p className="text-xs text-muted-foreground">
          Revoking turns everything off, clears the local queue and resets your
          ephemeral session id.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={revogar}
          disabled={!algumLigado}
        >
          Revoke all
        </Button>
      </div>
    </FramePanel>
  );
}
