import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { FramePanel } from "@/components/reui/frame";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import {
  FUNDOS_ANIMADOS,
  RenderFundoAnimado,
} from "@/components/fundo-animado";
import { useAppStore } from "@/store";
import { useIdioma } from "@/lib/idioma";

/**
 * #474: Animated backgrounds — vive dentro do Appearance. O switch liga/desliga o
 * fundo animado; ligado, mostra os 4 fundos (Animate UI) em preview ao vivo.
 *
 * O chevron à direita do switch (rework do feedback do #474) colapsa/expande as
 * opções de preview de forma INDEPENDENTE do on/off — dá pra liberar espaço na
 * tela sem precisar desligar o fundo. Estado de sessão (`expandido`), começa
 * aberto. Os nomes são próprios (Starry/Super nova/Space hive/Gravity).
 */
export function BackgroundSettings() {
  const { t } = useIdioma();
  const ativo = useAppStore((state) => state.fundosAnimadosAtivo);
  const setAtivo = useAppStore((state) => state.setFundosAnimadosAtivo);
  const fundoAnimado = useAppStore((state) => state.fundoAnimado);
  const setFundoAnimado = useAppStore((state) => state.setFundoAnimado);
  const [expandido, setExpandido] = useState(true);

  return (
    <FramePanel>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="animated-backgrounds">
            {t.settings.bgAnimados}
          </FieldLabel>
          <FieldDescription>{t.settings.bgAnimadosDesc}</FieldDescription>
        </FieldContent>
        <Switch
          id="animated-backgrounds"
          checked={ativo}
          onCheckedChange={setAtivo}
        />
        {/* Chevron: colapsa/expande as opções sem tocar no on/off. Só faz sentido
            quando o fundo está ligado (senão não há opções pra mostrar). */}
        {ativo && (
          <button
            type="button"
            onClick={() => setExpandido((v) => !v)}
            aria-expanded={expandido}
            aria-controls="animated-backgrounds-opcoes"
            aria-label={
              expandido
                ? t.settings.bgAnimadosColapsar
                : t.settings.bgAnimadosExpandir
            }
            className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronDown
              className={cn(
                "size-4 transition-transform",
                expandido ? "" : "-rotate-90"
              )}
            />
          </button>
        )}
      </Field>

      {ativo && expandido && (
        <div
          id="animated-backgrounds-opcoes"
          className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4"
        >
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
      )}
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
