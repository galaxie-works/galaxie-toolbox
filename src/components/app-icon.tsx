import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * #720 (SH2): ícone de um app do catálogo, carregado LAZY. Como são ~1795 SVGs,
 * a lista do command só busca o ícone quando ele entra na viewport
 * (IntersectionObserver) — sem isso o command dispararia ~1795 requests de uma vez.
 *
 * Os assets vivem em `public/app-icons/<id>.svg` (servidos como estáticos, URL
 * estável, fora do bundle). Escolha deliberada vs. `src/assets` + `import.meta.glob`:
 * o glob inlinava os SVGs < 4KB como data-URI (~4MB de base64 no chunk inicial) e
 * anulava o lazy. Em `public/` a URL é fixa e a fetch só acontece na viewport.
 * Sem ícone / erro de carga → fallback com a inicial do nome.
 */
/** #1153: ordem de tentativa da extensão do ícone (a maioria é SVG de verdade). */
const EXTENSOES_ICONE = ["svg", "png", "jpg", "webp"] as const;

export function AppIcon({
  id,
  name,
  className,
}: {
  id: string;
  name: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [visivel, setVisivel] = useState(false);
  const [erro, setErro] = useState(false);
  // #1153: nem todo ícone do catálogo é SVG. 26 arquivos servidos como `.svg`
  // eram JPEG/PNG renomeados — o servidor rotulava `image/svg+xml`, o browser
  // falhava ao parsear como XML e caía no fallback da inicial (o `wagner` viu
  // isso em DeepSeek e Base44). Os arquivos passaram a ter a extensão VERDADEIRA;
  // aqui a busca tenta na ordem e só desiste depois de todas. Só o ícone quebrado
  // paga request extra — e ele hoje não aparecia de jeito nenhum.
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    // Reseta ao trocar de app (reuso da instância numa lista virtualizada).
    setVisivel(false);
    setErro(false);
    setTentativa(0);
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        setVisivel(true);
      },
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [id]);

  return (
    <span
      ref={ref}
      className={cn(
        "grid size-5 shrink-0 place-items-center overflow-hidden rounded-[5px]",
        className
      )}
      aria-hidden
    >
      {visivel && !erro ? (
        <img
          src={`/app-icons/${id}.${EXTENSOES_ICONE[tentativa]}`}
          alt=""
          className="size-full object-contain"
          loading="lazy"
          onError={() =>
            setTentativa((t) =>
              t + 1 < EXTENSOES_ICONE.length ? t + 1 : (setErro(true), t),
            )
          }
        />
      ) : (
        // Fallback: inicial do nome num quadradinho neutro (fora da viewport / erro).
        <span className="grid size-full place-items-center bg-muted text-[10px] font-medium text-muted-foreground">
          {name.trim().charAt(0).toUpperCase() || "?"}
        </span>
      )}
    </span>
  );
}
