import { MonitorCog, Moon, Sun } from "lucide-react";

import { FramePanel } from "@/components/reui/frame";
import {
  FieldDescription,
  FieldGroup,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import {
  MODOS_TEMA,
  TEMAS_VISUAIS,
  type ModoTema,
  type TemaVisual,
} from "@/lib/tema";
import { useAppStore } from "@/store";

const ROTULOS_MODO: Record<ModoTema, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

const ICONES_MODO = {
  light: Sun,
  dark: Moon,
  system: MonitorCog,
} satisfies Record<ModoTema, typeof Sun>;

const ROTULOS_TEMA: Record<TemaVisual, string> = {
  galaxie: "Galaxie",
  "claude-plus": "Claude +",
  "melancholik-mint": "Melancholik mint",
  "zen-inspired": "Zen Inspired Theme",
  "sunny-sprout": "Sunny Sprout",
};

function modoValido(valor: string): valor is ModoTema {
  return MODOS_TEMA.includes(valor as ModoTema);
}

function temaValido(valor: string): valor is TemaVisual {
  return TEMAS_VISUAIS.includes(valor as TemaVisual);
}

export function ThemeSettings() {
  const modoTema = useAppStore((state) => state.modoTema);
  const temaVisual = useAppStore((state) => state.temaVisual);
  const setModoTema = useAppStore((state) => state.setModoTema);
  const setTemaVisual = useAppStore((state) => state.setTemaVisual);

  return (
    <FramePanel>
      <FieldGroup>
        <FieldSet>
          <FieldLegend>Color mode</FieldLegend>
          <FieldDescription>
            Use a light or dark appearance, or follow your operating system.
          </FieldDescription>
          <ToggleGroup
            type="single"
            value={modoTema}
            variant="outline"
            spacing={2}
            aria-label="Color mode"
            onValueChange={(valor) => {
              if (modoValido(valor)) setModoTema(valor);
            }}
          >
            {MODOS_TEMA.map((modo) => {
              const Icon = ICONES_MODO[modo];
              return (
                <ToggleGroupItem
                  key={modo}
                  value={modo}
                  aria-label={ROTULOS_MODO[modo]}
                >
                  <Icon data-icon="inline-start" />
                  {ROTULOS_MODO[modo]}
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
        </FieldSet>

        <FieldSet>
          <FieldLegend>Theme</FieldLegend>
          <FieldDescription>
            Choose the GALAXIE Toolbox palette and visual style.
          </FieldDescription>
          <ToggleGroup
            type="single"
            value={temaVisual}
            variant="outline"
            spacing={2}
            aria-label="Theme"
            className="flex-wrap"
            onValueChange={(valor) => {
              if (temaValido(valor)) setTemaVisual(valor);
            }}
          >
            {TEMAS_VISUAIS.map((tema) => (
              <ToggleGroupItem
                key={tema}
                value={tema}
                aria-label={ROTULOS_TEMA[tema]}
              >
                {ROTULOS_TEMA[tema]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </FieldSet>
      </FieldGroup>
    </FramePanel>
  );
}
