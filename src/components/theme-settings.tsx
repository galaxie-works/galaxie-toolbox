import { MonitorCog, Moon, Sun, type LucideIcon } from "lucide-react";

import { FramePanel } from "@/components/reui/frame";
import { Switch } from "@/components/ui/switch";
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
import { useIdioma } from "@/lib/idioma";

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
  {
    value: "nordic-moss",
    label: "Nordic moss",
    color: "oklch(0.6411 0.0666 130.1256)",
  },
  {
    value: "fallout",
    label: "Fallout",
    color: "oklch(0.5930 0.1524 52.0222)",
  },
  {
    value: "glacial-drift",
    label: "Glacial",
    color: "oklch(0.6400 0.2050 28)",
  },
];

// #469: os rótulos (Light/Dark/System) são traduzidos, então o array é montado no
// corpo do componente (o hook `t` não roda em escopo de módulo). O `value`/`icon`
// ficam estáveis; só o `label` vem do `t`.
function modoValido(valor: string): valor is ModoTema {
  return MODOS_TEMA.includes(valor as ModoTema);
}

function temaValido(valor: string): valor is TemaVisual {
  return TEMAS_VISUAIS.includes(valor as TemaVisual);
}

/**
 * Stacked card do Mood (paleta visual) — vive dentro do frame "Appearance"
 * junto do Style (padrão c-frame-3: FramePanels empilhados num frame só, igual
 * ao Sound & notifications). Label + descrição à esquerda; o select à direita.
 * Select = ReUI c-select-17 (bullet colorido), persistido no useAppStore.
 *
 * `disabled` desliga o select quando o alto contraste (#136) está ligado — o
 * preset high-contrast sobrepõe o Mood, então escolher paleta não faz efeito.
 */
export function MoodSettings({ disabled = false }: { disabled?: boolean }) {
  const { t } = useIdioma();
  const temaVisual = useAppStore((state) => state.temaVisual);
  const setTemaVisual = useAppStore((state) => state.setTemaVisual);

  return (
    <FramePanel>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{t.settings.themeMoodTitulo}</h3>
          <p className="text-sm text-muted-foreground">
            {t.settings.themeMoodDesc}
          </p>
        </div>
        <Select
          value={temaVisual}
          disabled={disabled}
          onValueChange={(valor) => {
            if (temaValido(valor)) setTemaVisual(valor);
          }}
        >
          <SelectTrigger
            aria-label={t.settings.themeMoodTitulo}
            className="w-56 shrink-0"
          >
            <SelectValue placeholder={t.settings.themeMoodPlaceholder} />
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
      </div>
    </FramePanel>
  );
}

/**
 * Stacked card do Style (light/dark/system) — segundo card do frame "Appearance".
 * Label + descrição à esquerda; o select à direita.
 * Select = ReUI c-select-2 (ícone + caption), persistido no useAppStore.
 */
export function StyleSettings() {
  const { t } = useIdioma();
  const modoTema = useAppStore((state) => state.modoTema);
  const setModoTema = useAppStore((state) => state.setModoTema);

  const styles: StyleOption[] = [
    { value: "light", label: t.settings.themeStyleLight, icon: Sun },
    { value: "dark", label: t.settings.themeStyleDark, icon: Moon },
    { value: "system", label: t.settings.themeStyleSystem, icon: MonitorCog },
  ];

  return (
    <FramePanel>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{t.settings.themeStyleTitulo}</h3>
          <p className="text-sm text-muted-foreground">
            {t.settings.themeStyleDesc}
          </p>
        </div>
        <Select
          value={modoTema}
          onValueChange={(valor) => {
            if (modoValido(valor)) setModoTema(valor);
          }}
        >
          <SelectTrigger
            aria-label={t.settings.themeStyleTitulo}
            className="w-56 shrink-0"
          >
            <SelectValue placeholder={t.settings.themeStylePlaceholder} />
          </SelectTrigger>
          <SelectContent position="popper" align="end">
            <SelectGroup>
              {styles.map((style) => {
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
      </div>
    </FramePanel>
  );
}

/**
 * Stacked card do Accessibility (#136) — terceiro card do frame "Appearance",
 * no mesmo padrão do Mood/Style. Label + descrição à esquerda; um Switch
 * (`@/components/ui/switch`, default OFF) à direita. Ligado aplica o preset de
 * alto contraste (sobrepondo o Mood) e persiste no useAppStore.
 */
export function AccessibilitySettings() {
  const { t } = useIdioma();
  const altoContraste = useAppStore((state) => state.altoContraste);
  const setAltoContraste = useAppStore((state) => state.setAltoContraste);

  return (
    <FramePanel>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">
            {t.settings.themeAccessTitulo}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t.settings.themeAccessDesc}
          </p>
        </div>
        <Switch
          aria-label={t.settings.themeAccessAria}
          checked={altoContraste}
          onCheckedChange={setAltoContraste}
          className="shrink-0"
        />
      </div>
    </FramePanel>
  );
}
