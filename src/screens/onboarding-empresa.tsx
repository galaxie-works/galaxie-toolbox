import { useState } from "react";
import { Building2, CheckCircle2, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { GalaxieMark } from "@/components/brand";
import { FundoAnimado } from "@/components/fundo-animado";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { IdiomaSelect } from "@/components/ui/idioma-select";
import { BarraJanela, FaixaArrasto } from "@/components/barra-janela";
import SoftBlurIn from "@/components/smoothui/soft-blur-in";
import { Alert, AlertDescription } from "@/components/reui/alert";
import type { AppUser } from "@/lib/types";
import { preencher, useIdioma } from "@/lib/idioma";

/** Nome da suite exibido no onboarding — {app} das strings (#1599). */
const APP = "The GALAXIE";

/**
 * #698 (PS5): estado "empresa NÃO contratada". O funcionário loga (não bloqueia)
 * e cai aqui — vê o convite de lead-gen ("sua empresa ainda não usa o app") com
 * CTAs para chamar o admin, e pode entrar assim mesmo no tier pessoal.
 *
 * A captura de lead é MOCKADA (só o gesto/estado de confirmação): o registro real
 * de orgs + o e-mail do admin vêm do backend depois. O `orgStatus` que roteia até
 * aqui também é mockado (ver api.ts) — ligar no hook do PS0/PS1 quando landar.
 */
export function OnboardingEmpresaScreen({
  user,
  onContinuar,
  onSair,
}: {
  user: AppUser;
  onContinuar: () => void;
  onSair: () => void;
}) {
  const { t } = useIdioma();
  const [avisar, setAvisar] = useState(false);
  // Estado do lead: qual CTA foi acionado (mock). Ao registrar, mostra a confirmação.
  const [enviado, setEnviado] = useState(false);

  function registrarLead() {
    // MOCK: o backend do registro de orgs/lead vem depois (PS0/PS1). Aqui só o gesto.
    setEnviado(true);
  }

  return (
    <div className="relative grid h-full place-items-center overflow-hidden px-6">
      <FaixaArrasto />
      <BarraJanela />
      <FundoAnimado />
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[720px] -translate-x-1/2 rounded-full bg-foreground/[0.04] blur-[120px]" />

      <div className="relative w-full max-w-[440px] animate-[fade-in_0.4s_ease]">
        <div className="flex flex-col items-center text-center">
          <GalaxieMark className="logo-in mb-5 h-12" />
          <div className="mb-4 grid size-12 place-items-center rounded-full border border-border bg-card/60">
            <Building2 className="size-6 text-muted-foreground" />
          </div>
          <SoftBlurIn
            className="text-2xl font-semibold tracking-tight text-balance"
            delay={140}
            stagger={16}
          >
            {preencher(t.onboarding.empresaSemApp, { app: APP })}
          </SoftBlurIn>
          <SoftBlurIn
            className="mt-2 text-[15px] text-muted-foreground text-pretty"
            delay={320}
            stagger={10}
          >
            {preencher(t.onboarding.empresaSemAppDesc, { app: APP })}
          </SoftBlurIn>
          {user.email && (
            <p className="mt-2 text-[12.5px] text-muted-foreground/80">
              {preencher(t.onboarding.comConta, { email: user.email })}
            </p>
          )}
        </div>

        <div className="mt-8">
          {enviado ? (
            <Alert variant="success">
              <CheckCircle2 />
              <AlertDescription>{t.onboarding.leadRegistrado}</AlertDescription>
            </Alert>
          ) : (
            <div className="flex flex-col gap-2.5">
              {/* CTAs de lead-gen: chamar o admin / pedir setup (mock). */}
              <Button
                size="lg"
                className="w-full gap-2.5 text-[15px]"
                onClick={registrarLead}
              >
                <Send className="size-4" />
                {t.onboarding.convidarAdmin}
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="w-full gap-2.5 text-[15px]"
                onClick={registrarLead}
              >
                <Sparkles className="size-4" />
                {t.onboarding.solicitarSetup}
              </Button>

              {/* Opcional: avisar quando a empresa entrar. */}
              <label className="mt-2 flex items-center gap-2.5 self-center text-[13px] text-muted-foreground">
                <Checkbox
                  checked={avisar}
                  onCheckedChange={(v) => setAvisar(v === true)}
                />
                {t.onboarding.avisarQuandoEntrar}
              </label>
            </div>
          )}

          {/* Não bloqueia: sempre dá pra entrar no tier pessoal. */}
          <Button
            variant="ghost"
            className="mt-5 w-full text-muted-foreground"
            onClick={onContinuar}
          >
            {t.onboarding.continuarMesmoAssim}
          </Button>
        </div>
      </div>

      <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-3">
        <IdiomaSelect className="h-9" />
        <ThemeToggle />
        <Button
          variant="ghost"
          size="sm"
          className="h-9 text-muted-foreground"
          onClick={onSair}
        >
          {t.nav.sair}
        </Button>
      </div>
    </div>
  );
}
