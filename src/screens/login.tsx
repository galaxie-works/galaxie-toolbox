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
import { comDestaque, useIdioma } from "@/lib/idioma";
import { ShieldCheck, AlertTriangle } from "lucide-react";

/** Logo colorido da Microsoft para o botao de entrar. */
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

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginScreen({
  onLogin,
  loading,
  error,
}: {
  onLogin: (email: string) => void;
  loading: boolean;
  error?: string | null;
}) {
  const { t } = useIdioma();
  const [email, setEmail] = useState("");
  const valido = EMAIL_RX.test(email.trim());

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (valido && !loading) onLogin(email.trim());
  }

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

        <form onSubmit={enviar} className="mt-9">
          <label htmlFor="email" className="mb-1.5 block text-[13px] font-medium">
            {t.login.rotuloEmail}
          </label>
          <Input
            id="email"
            type="email"
            autoFocus
            autoComplete="username"
            spellCheck={false}
            placeholder={t.login.placeholderEmail}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
          />
          <p className="mt-1.5 text-[11.5px] text-muted-foreground">
            {t.login.ajudaEmail}
          </p>

          <Button
            type="submit"
            size="lg"
            className="mt-4 w-full gap-3 text-[15px]"
            disabled={!valido || loading}
          >
            {loading ? (
              <>
                <Spinner data-icon="inline-start" />
                {t.login.entrando}
              </>
            ) : (
              <>
                <MsLogo />
                {t.login.entrar}
              </>
            )}
          </Button>

          <Alert variant="success" className="mt-5">
            <ShieldCheck />
            <AlertDescription>
              {comDestaque(t.login.aviso, "senha", t.login.avisoSenha)}
            </AlertDescription>
          </Alert>

          {error && (
            <Alert variant="destructive" className="mt-3">
              <AlertTriangle />
              <AlertDescription data-selecionavel>{error}</AlertDescription>
            </Alert>
          )}
        </form>
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
