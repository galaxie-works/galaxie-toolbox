import { useCallback, useEffect, useRef, useState } from "react";
import { Info, ShieldCheck } from "lucide-react";

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
  telemetryDebugDump,
  telemetryRevoke,
  telemetrySetConsent,
  telemetryStatus,
  type TelemetryConsent,
  type TelemetryEnvelopeCarimbado,
} from "@/lib/api";
import { useIdioma, comDestaque } from "@/lib/idioma";

const CONSENT_ON: TelemetryConsent = {
  crash: true,
  diagnostico: true,
  analytics: true,
};

const CONSENT_OFF: TelemetryConsent = {
  crash: false,
  diagnostico: false,
  analytics: false,
};

/**
 * Consent UI da telemetria (#389, S3 do épico #380 — rework #388/#389).
 *
 * Fonte de verdade é o Rust (TelemetryPolicy): lê o estado por `telemetryStatus`
 * e grava por `telemetrySetConsent`/`telemetryRevoke`. **Default ON** (#388),
 * opt-OUT por categoria — diagnóstico anônimo ligado por padrão, o usuário
 * desliga o que quiser. Nada de PII é coletado (só enums/buckets, self-host).
 * Revogar apaga a fila local e reinicia o session-id.
 *
 * No 1º run (sem consent gravado, `status.configurado === false`) mostramos um
 * aviso de transparência até o usuário confirmar ou mexer nas categorias.
 *
 * Precedência admin>tenant>usuário: ainda não há fonte de política admin/tenant
 * no app — este painel controla o consent do USUÁRIO. O override admin/tenant
 * (MDM/Graph) é follow-up (ver #133).
 */
export function TelemetrySettings() {
  const { t } = useIdioma();
  // Otimista no default ON (#388) enquanto o status carrega — evita um flash de
  // "tudo OFF"; o status do Rust é a verdade e sobrescreve ao chegar.
  const [consent, setConsent] = useState<TelemetryConsent>(CONSENT_ON);
  // null = ainda carregando; true/false = há consent gravado (1º run se false).
  const [configurado, setConfigurado] = useState<boolean | null>(null);

  useEffect(() => {
    let vivo = true;
    telemetryStatus()
      .then((status) => {
        if (!vivo || !status) return;
        setConsent(status.consent);
        setConfigurado(status.configurado);
      })
      .catch(() => {
        /* best-effort: mantém o otimista */
      });
    return () => {
      vivo = false;
    };
  }, []);

  const alterar = (categoria: keyof TelemetryConsent, valor: boolean) => {
    const proximo = { ...consent, [categoria]: valor };
    setConsent(proximo);
    // Qualquer mudança grava o consent → deixa de ser 1º run.
    setConfigurado(true);
    void telemetrySetConsent(proximo);
  };

  const revogar = () => {
    setConsent(CONSENT_OFF);
    setConfigurado(true);
    void telemetryRevoke();
  };

  // #389: confirma o aviso do 1º run persistindo a escolha atual (default ON),
  // sem mudar nada — só marca como configurado pra o aviso sumir.
  const confirmarAviso = () => {
    setConfigurado(true);
    void telemetrySetConsent(consent);
  };

  const algumLigado = consent.crash || consent.diagnostico || consent.analytics;

  return (
    <FramePanel>
      <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/30 p-3">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {comDestaque(t.settings.telBanner, "estado", t.settings.telBannerEstado)}
        </p>
      </div>

      {configurado === false && (
        <div className="flex items-start gap-2.5 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <Info className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="flex flex-1 flex-col gap-2">
            <p className="text-sm text-foreground">{t.settings.telAviso1run}</p>
            <div>
              <Button type="button" size="sm" onClick={confirmarAviso}>
                {t.settings.telAvisoOk}
              </Button>
            </div>
          </div>
        </div>
      )}

      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="telemetry-crash">
            {t.settings.telCrashLabel}
          </FieldLabel>
          <FieldDescription>{t.settings.telCrashDesc}</FieldDescription>
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
            {t.settings.telPerfLabel}
          </FieldLabel>
          <FieldDescription>{t.settings.telPerfDesc}</FieldDescription>
        </FieldContent>
        <Switch
          id="telemetry-diagnostics"
          checked={consent.diagnostico}
          onCheckedChange={(v) => alterar("diagnostico", v)}
        />
      </Field>

      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="telemetry-analytics">
            {t.settings.telUsoLabel}
          </FieldLabel>
          <FieldDescription>{t.settings.telUsoDesc}</FieldDescription>
        </FieldContent>
        <Switch
          id="telemetry-analytics"
          checked={consent.analytics}
          onCheckedChange={(v) => alterar("analytics", v)}
        />
      </Field>

      <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
        <p className="text-xs text-muted-foreground">
          {t.settings.telRevogarDesc}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={revogar}
          disabled={!algumLigado}
        >
          {t.settings.telRevogarBtn}
        </Button>
      </div>

      {import.meta.env.DEV && <TelemetryInspector />}
    </FramePanel>
  );
}

/**
 * Inspetor de telemetria — SÓ em dev (`import.meta.env.DEV`). Mostra, em tempo
 * (quase) real, os envelopes já na fila com os atributos JÁ higienizados pela
 * policy do Rust (sem PII). Serve pra validar visualmente que o scrub funciona.
 * Em release este bloco nem é renderizado, e o backend devolve vazio de todo
 * jeito (defesa em profundidade).
 */
function TelemetryInspector() {
  const [envelopes, setEnvelopes] = useState<TelemetryEnvelopeCarimbado[]>([]);
  const [carregando, setCarregando] = useState(false);
  const montado = useRef(true);

  const atualizar = useCallback(async () => {
    setCarregando(true);
    const dump = await telemetryDebugDump();
    if (montado.current) {
      setEnvelopes(dump);
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    montado.current = true;
    void atualizar();
    // Poll leve: a fila só muda quando algo é rastreado; 2s é suficiente pra um
    // inspetor de dev sem pesar.
    const timer = setInterval(() => void atualizar(), 2000);
    return () => {
      montado.current = false;
      clearInterval(timer);
    };
  }, [atualizar]);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
            Dev
          </span>
          <span className="text-sm font-medium text-foreground">
            Telemetry inspector
          </span>
          <span className="text-xs text-muted-foreground">
            {envelopes.length} queued
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void atualizar()}
          disabled={carregando}
        >
          Refresh
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Live view of scrubbed envelopes in the local queue. Attributes shown here
        have already passed the PII denylist — this is what would be sent.
      </p>

      {envelopes.length === 0 ? (
        <p className="py-2 text-center text-xs text-muted-foreground">
          Queue is empty. Toggle a category on and use the app to see events.
        </p>
      ) : (
        <ul className="flex max-h-64 flex-col gap-1.5 overflow-auto">
          {envelopes.map((env, i) => (
            <li
              key={`${env.ts_unix}-${env.evento}-${i}`}
              className="rounded-md border border-border bg-background/60 p-2 text-xs"
            >
              <div className="flex items-center gap-2">
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {env.categoria}
                </span>
                <span className="font-medium text-foreground">{env.evento}</span>
              </div>
              {Object.keys(env.atributos).length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {Object.entries(env.atributos).map(([chave, valor]) => (
                    <span
                      key={chave}
                      className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                    >
                      {chave}={String(valor.v)}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
