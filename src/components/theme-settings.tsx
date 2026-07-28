import { MonitorCog, Moon, Sun, type LucideIcon } from "lucide-react";

import { FramePanel } from "@/components/reui/frame";
import { Field } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MODOS_TEMA,
  TEMAS_VISUAIS,
  type ModoTema,
  type TemaVisual,
} from "@/lib/tema";
import { useAppStore } from "@/store";

interface MoodOption {
  value: TemaVisual;
  label: string;
  color: string;
}

interface StyleOption {
  value: ModoTema;
  label: string;
  icon: LucideIcon;
}

const MOODS: MoodOption[] = [
  {
    value: "galaxie",
    label: "Galaxie",
    color: "oklch(0.518 0.253 323.949)",
  },
  {
    value: "claude-plus",
    label: "Claude",
    color: "oklch(0.6171 0.1375 39.0427)",
  },
  {
    value: "melancholik-mint",
    label: "Mint",
    color: "oklch(0.7193 0.0439 196.2166)",
  },
  {
    value: "zen-inspired",
    label: "Zen",
    color: "oklch(0.852 0.0205 100.6306)",
  },
  {
    value: "sunny-sprout",
    label: "Spring",
    color: "oklch(0.8274 0.0903 112.4121)",
  },
];

const STYLES: StyleOption[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: MonitorCog },
];

function modoValido(valor: string): valor is ModoTema {
  return MODOS_TEMA.includes(valor as ModoTema);
}

function temaValido(valor: string): valor is TemaVisual {
  return TEMAS_VISUAIS.includes(valor as TemaVisual);
}

/**
 * ReUI c-select-17: select com bullet colorido, adaptado literalmente para
 * selecionar o mood visual persistido no useAppStore.
 */
export function MoodSettings() {
  const temaVisual = useAppStore((state) => state.temaVisual);
  const setTemaVisual = useAppStore((state) => state.setTemaVisual);

  return (
    <FramePanel>
      <Field className="ml-auto max-w-xs">
        <Select
          value={temaVisual}
          onValueChange={(valor) => {
            if (temaValido(valor)) setTemaVisual(valor);
          }}
        >
          <SelectTrigger aria-label="Mood" className="min-w-48">
            <SelectValue placeholder="Select a mood" />
          </SelectTrigger>
          <SelectContent position="popper" align="end">
            <SelectGroup>
              {MOODS.map((mood) => (
                <SelectItem key={mood.value} value={mood.value}>
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="size-1.5 rounded-full"
                      style={{ backgroundColor: mood.color }}
                    />
                    <span>{mood.label}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
    </FramePanel>
  );
}

/**
 * ReUI c-select-2: select com ícone e caption, adaptado literalmente para o
 * modo light/dark/system persistido no useAppStore.
 */
export function StyleSettings() {
  const modoTema = useAppStore((state) => state.modoTema);
  const setModoTema = useAppStore((state) => state.setModoTema);

  return (
    <FramePanel>
      <Field className="ml-auto max-w-xs">
        <Select
          value={modoTema}
          onValueChange={(valor) => {
            if (modoValido(valor)) setModoTema(valor);
          }}
        >
          <SelectTrigger aria-label="Style" className="min-w-48">
            <SelectValue placeholder="Select a style" />
          </SelectTrigger>
          <SelectContent position="popper" align="end">
            <SelectGroup>
              {STYLES.map((style) => {
                const Icon = style.icon;
                return (
                  <SelectItem key={style.value} value={style.value}>
                    <Icon className="text-muted-foreground size-4" />
                    {style.label}
                  </SelectItem>
                );
              })}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
    </FramePanel>
  );
}
