import AnimatedToggle from "@/components/smoothui/animated-toggle";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIdioma } from "@/lib/idioma";
import { useTemaEscuro } from "@/lib/tema";
import { useAppStore } from "@/store";

const SunIcon = () => (
  <svg
    aria-hidden="true"
    className="size-full"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    viewBox="0 0 24 24"
  >
    <circle cx="12" cy="12" r="5" />
    <line x1="12" x2="12" y1="1" y2="3" />
    <line x1="12" x2="12" y1="21" y2="23" />
    <line x1="4.22" x2="5.64" y1="4.22" y2="5.64" />
    <line x1="18.36" x2="19.78" y1="18.36" y2="19.78" />
    <line x1="1" x2="3" y1="12" y2="12" />
    <line x1="21" x2="23" y1="12" y2="12" />
    <line x1="4.22" x2="5.64" y1="19.78" y2="18.36" />
    <line x1="18.36" x2="19.78" y1="5.64" y2="4.22" />
  </svg>
);

const MoonIcon = () => (
  <svg
    aria-hidden="true"
    className="size-full"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    viewBox="0 0 24 24"
  >
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

/** Alterna claro/escuro. Ligado = tema escuro. A escolha fica salva.
 *  #876: `size` deixa o switcher caber na altura de uma tab na title bar
 *  (default "lg" preserva o tamanho antigo de onde já era usado). */
export function ThemeToggle({ size = "lg" }: { size?: "sm" | "md" | "lg" }) {
  const { t } = useIdioma();
  const dark = useTemaEscuro();
  const setModoTema = useAppStore((state) => state.setModoTema);

  return (
    // Tooltip visual (#160). O AnimatedToggle (componente de referência do
    // smoothui) não repassa refs/props arbitrárias ao botão interno, então o
    // gatilho do Tooltip é um <span> em volta — o hover cobre o botão e o nome
    // acessível continua no próprio botão via `label`/`aria-label`.
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <AnimatedToggle
            checked={dark}
            onChange={(escuro) => setModoTema(escuro ? "dark" : "light")}
            label={t.tema.alternar}
            icons={{ on: <MoonIcon />, off: <SunIcon /> }}
            size={size}
            variant="icon"
          />
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{t.tema.alternar}</TooltipContent>
    </Tooltip>
  );
}
