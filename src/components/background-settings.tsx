import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, ImageOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { FramePanel } from "@/components/reui/frame";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  FUNDOS_ANIMADOS,
  RenderFundoAnimado,
} from "@/components/fundo-animado";
import { useAppStore } from "@/store";
import { useIdioma } from "@/lib/idioma";

/**
 * #474 (rework 2): Animated backgrounds — vive dentro do Appearance. NÃO há mais
 * switch on/off: o seletor tem "Nenhum" como 1ª opção (desliga o fundo) + os 4
 * fundos (Animate UI) em preview ao vivo. O chevron colapsa/expande as opções pra
 * liberar espaço, no MESMO estilo dos frames colapsáveis de Settings (Collapsible
 * + ChevronRight que rotaciona 90°). Os nomes são próprios (não traduzem).
 */
export function BackgroundSettings() {
  const { t } = useIdioma();
  const fundoAnimado = useAppStore((state) => state.fundoAnimado);
  const setFundoAnimado = useAppStore((state) => state.setFundoAnimado);
  const [aberto, setAberto] = useState(true);

  return (
    <FramePanel>
      <Collapsible
        open={aberto}
        onOpenChange={setAberto}
        className="group/collapsible"
      >
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t.settings.bgAnimados}</p>
            <p className="text-sm text-muted-foreground">
              {t.settings.bgAnimadosDesc}
            </p>
          </div>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {/* 1ª opção: Nenhum — desliga o fundo animado (sem preview ao vivo). */}
            <SelectableCard
              selecionado={fundoAnimado === "none"}
              onClick={() => setFundoAnimado("none")}
              label={t.settings.bgNenhum}
            >
              <div className="grid size-full place-items-center bg-muted text-muted-foreground">
                <ImageOff className="size-5" />
              </div>
            </SelectableCard>
            {FUNDOS_ANIMADOS.map((fundo) => (
              <SelectableCard
                key={fundo.valor}
                selecionado={fundoAnimado === fundo.valor}
                onClick={() => setFundoAnimado(fundo.valor)}
                label={fundo.rotulo}
              >
                {/* Preview ao vivo do componente do registry (sem customização). */}
                <RenderFundoAnimado tipo={fundo.valor} />
              </SelectableCard>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </FramePanel>
  );
}

/** Card selecionável do preview (fundo ao vivo + rótulo + estado de seleção). */
function SelectableCard({
  selecionado,
  onClick,
  label,
  children,
}: {
  selecionado: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selecionado}
      aria-label={label}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-lg border text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        selecionado
          ? "border-primary ring-1 ring-primary"
          : "border-border hover:border-foreground/30"
      )}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-muted">
        {/* #474: só monta o preview ao vivo quando o card tem tamanho real. Os
            fundos em canvas (Super nova/Gravity) fazem drawImage e explodem
            (InvalidStateError) se montarem com width/height 0 — o que acontece
            enquanto o frame colapsável da Aparência anima de height 0 → auto. */}
        <PreviewComTamanho>{children}</PreviewComTamanho>
        {selecionado && (
          <span className="absolute top-1.5 right-1.5 z-10 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground shadow">
            <Check className="size-3" />
          </span>
        )}
      </div>
      <span className="truncate px-2 py-1.5 text-xs font-medium">{label}</span>
    </button>
  );
}

/**
 * #474: adia a montagem do preview até o container ter tamanho real (>0). Os
 * fundos de canvas do registry (Super nova/Gravity) chamam `drawImage` num
 * canvas de dimensão 0 e lançam `InvalidStateError` se montarem cedo demais —
 * ex.: durante a animação de abertura do frame colapsável (height 0 → auto).
 * Um `ResizeObserver` libera a renderização quando as duas dimensões passam de 0.
 */
function PreviewComTamanho({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [temTamanho, setTemTamanho] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r && r.width > 0 && r.height > 0) setTemTamanho(true);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div ref={ref} className="absolute inset-0">
      {temTamanho && children}
    </div>
  );
}
