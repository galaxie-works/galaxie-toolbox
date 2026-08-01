import { Estrelas } from "@/components/estrelas";
import { urlDoFundo } from "@/lib/backgrounds";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

/**
 * Fundo do app (#378): imagem selecionada OU céu estrelado OU fundo do tema —
 * mutuamente exclusivos. Quando há imagem, ela pinta cover/center com um scrim
 * sutil (claro/escuro) pra manter a legibilidade do conteúdo denso por cima;
 * senão delega pro `Estrelas` (que já respeita `fundoEstrelado`).
 */
export function FundoApp({ className }: { className?: string }) {
  const fundoImagem = useAppStore((s) => s.fundoImagem);
  const url = urlDoFundo(fundoImagem);

  if (url) {
    return (
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0 overflow-hidden",
          className
        )}
      >
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url("${url}")` }}
        />
        {/* Scrim pra legibilidade — mais forte no escuro. */}
        <div className="absolute inset-0 bg-background/40 dark:bg-background/55" />
      </div>
    );
  }

  return <Estrelas className={className} />;
}
