import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GalaxieMark } from "@/components/brand";
import { FundoAnimado } from "@/components/fundo-animado";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { IdiomaSelect } from "@/components/ui/idioma-select";
import { BarraJanela, FaixaArrasto } from "@/components/barra-janela";
import SoftBlurIn from "@/components/smoothui/soft-blur-in";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { Spinner } from "@/components/ui/spinner";
import type { AuthProvider } from "@/lib/api";
import { useIdioma } from "@/lib/idioma";
import { ArrowLeft, AlertTriangle } from "lucide-react";

/** Logo colorido da Microsoft (4 quadrados) pro botão de provider. */
function MsLogo() {
  return (
    <svg viewBox="0 0 21 21" className="size-4" aria-hidden>
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

/** Logo colorido do Google (o "G" de 4 cores) pro botão de provider (#695/PS3). */
function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" className="size-4" aria-hidden>
      <path
        fill="#ffc107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#ff3d00"
        d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4caf50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.1-11.3-7.5l-6.5 5C9.6 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976d2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C41.2 35.6 44 30.2 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}

export function LoginScreen({
  onLogin,
  loading,
  error,
}: {
  onLogin: (provider: AuthProvider, hint: string) => void;
  loading: boolean;
  error?: string | null;
}) {
  const { t } = useIdioma();
  // #781: login em 2 passos. Passo 1 = provedor (Microsoft/Google). Passo 2 (só
  // Microsoft) = tipo de conta (pessoal/trabalho). `contaTrabalho` revela o campo
  // de e-mail profissional. O e-mail é `login_hint` (só no caminho Work).
  const [email, setEmail] = useState("");
  const [passo, setPasso] = useState<"provedor" | "microsoft">("provedor");
  const [contaTrabalho, setContaTrabalho] = useState(false);

  return (
    <div className="relative grid h-full place-items-center overflow-hidden px-6">
      <FaixaArrasto />
      <BarraJanela />
      <FundoAnimado />
      {/* brilho de fundo sutil, por cima das estrelas */}
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[720px] -translate-x-1/2 rounded-full bg-foreground/[0.04] blur-[120px]" />

      <div className="relative w-full max-w-[400px] animate-[fade-in_0.4s_ease]">
        <div className="flex flex-col items-center text-center">
          <GalaxieMark className="logo-in mb-5 h-12" />
          <SoftBlurIn
            className="text-2xl font-semibold tracking-tight"
            delay={140}
            stagger={16}
          >
            {t.login.titulo}
          </SoftBlurIn>
          <SoftBlurIn
            className="mt-1.5 text-[15px] text-muted-foreground"
            delay={320}
            stagger={14}
          >
            {t.login.convite}
          </SoftBlurIn>
        </div>

        <div className="mt-9">
          {loading ? (
            // #781/AC8: status de login. (#782 — texto por-provider — é bundle à parte.)
            <div className="flex flex-col items-center gap-3 py-4 text-muted-foreground">
              <Spinner className="size-6" />
              <span className="text-sm">{t.login.entrando}</span>
            </div>
          ) : passo === "provedor" ? (
            // Passo 1: provedor. Microsoft abre o passo 2; Google loga direto.
            <div className="flex flex-col gap-2.5">
              <Button
                size="lg"
                className="w-full gap-3 text-[15px]"
                onClick={() => setPasso("microsoft")}
              >
                <MsLogo />
                {t.login.continuarMicrosoft}
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="w-full gap-3 text-[15px]"
                onClick={() => onLogin("google", "")}
              >
                <GoogleLogo />
                {t.login.continuarGoogle}
              </Button>
            </div>
          ) : !contaTrabalho ? (
            // Passo 2 (Microsoft): tipo de conta. Pessoal loga direto (consumers);
            // Trabalho revela o campo de e-mail profissional.
            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => onLogin("microsoft-personal", "")}
                className="flex flex-col gap-0.5 rounded-lg border border-border p-3.5 text-left transition-colors hover:bg-accent/50"
              >
                <span className="text-[15px] font-medium">
                  {t.login.contaPessoalTitulo}
                </span>
                <span className="text-[13px] text-muted-foreground">
                  {t.login.contaPessoalDesc}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setContaTrabalho(true)}
                className="flex flex-col gap-0.5 rounded-lg border border-border p-3.5 text-left transition-colors hover:bg-accent/50"
              >
                <span className="text-[15px] font-medium">
                  {t.login.contaTrabalhoTitulo}
                </span>
                <span className="text-[13px] text-muted-foreground">
                  {t.login.contaTrabalhoDesc}
                </span>
              </button>
              <Button
                variant="ghost"
                className="mt-1 gap-2 self-start text-muted-foreground"
                onClick={() => setPasso("provedor")}
              >
                <ArrowLeft className="size-4" />
                {t.login.voltar}
              </Button>
            </div>
          ) : (
            // Passo 2 (Trabalho): e-mail profissional → provider microsoft (deriva
            // o tenant do e-mail, fluxo antigo intacto).
            <div className="flex flex-col gap-3">
              <div>
                <label
                  htmlFor="email"
                  className="mb-1.5 block text-[13px] font-medium"
                >
                  {t.login.rotuloEmail}
                </label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  spellCheck={false}
                  autoFocus
                  placeholder={t.login.placeholderEmail}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onLogin("microsoft", email.trim());
                  }}
                />
              </div>
              <Button
                size="lg"
                className="w-full gap-3 text-[15px]"
                onClick={() => onLogin("microsoft", email.trim())}
              >
                <MsLogo />
                {t.login.continuarMicrosoft}
              </Button>
              <Button
                variant="ghost"
                className="gap-2 self-start text-muted-foreground"
                onClick={() => setContaTrabalho(false)}
              >
                <ArrowLeft className="size-4" />
                {t.login.voltar}
              </Button>
            </div>
          )}

          {error && (
            <Alert variant="destructive" className="mt-3">
              <AlertTriangle />
              <AlertDescription data-selecionavel>{error}</AlertDescription>
            </Alert>
          )}
        </div>
      </div>

      {/* Idioma e tema no rodape: as duas escolhas ficam salvas e valem para
          o app todo. */}
      <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-3">
        <IdiomaSelect className="h-9" />
        <ThemeToggle />
      </div>
    </div>
  );
}
