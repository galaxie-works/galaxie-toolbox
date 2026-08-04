import { Check } from "lucide-react";

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
 * #474: Animated backgrounds — vive dentro do Appearance. Um switcher liga/desliga
 * o fundo animado; ligado, mostra os 4 fundos (Animate UI) em preview ao vivo, no
 * mesmo formato de card do antigo "Background images". Os nomes são próprios
 * (Starry/Super nova/Space hive/Gravity), não traduzem.
 */
export function BackgroundSettings() {
  const { t } = useIdioma();
  const ativo = useAppStore((state) => state.fundosAnimadosAtivo);
  const setAtivo = useAppStore((state) => state.setFundosAnimadosAtivo);
  const fundoAnimado = useAppStore((state) => state.fundoAnimado);
  const setFundoAnimado = useAppStore((state) => state.setFundoAnimado);

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
      </Field>

      {ativo && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
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
        {children}
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
