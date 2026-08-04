import { FramePanel } from "@/components/reui/frame";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IDIOMAS, type Idioma } from "@/lib/strings";
import { useIdioma } from "@/lib/idioma";

function ehIdioma(valor: string): valor is Idioma {
  return IDIOMAS.some((i) => i.valor === valor);
}

/**
 * Settings > System > Language (#453).
 *
 * Controle direto dentro do frame colapsável "Language" (a moldura vem da tela de
 * Settings), no mesmo padrão stacked-card dos irmãos Mood/Style (`AppearancePanels`):
 * rótulo à esquerda, um Select ReUI à direita. O i18n já existe inteiro — este é
 * só o controle que faltava: lê `useIdioma().idioma` e chama `definir()` no change
 * (persiste em localStorage e reflete `<html lang>` via o provider). Trocar aplica
 * na hora, sem reload — o próprio rótulo (`t.login.idioma`) flipa pt↔en.
 */
export function LanguageSettings() {
  const { idioma, definir, t } = useIdioma();

  return (
    <FramePanel>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{t.login.idioma}</h3>
          <p className="text-sm text-muted-foreground">
            {t.settings.languageDesc}
          </p>
        </div>
        <Select
          value={idioma}
          onValueChange={(valor) => {
            if (ehIdioma(valor)) definir(valor);
          }}
        >
          <SelectTrigger aria-label={t.login.idioma} className="w-56 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="end">
            <SelectGroup>
              {IDIOMAS.map((it) => (
                <SelectItem key={it.valor} value={it.valor}>
                  {it.rotulo}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </FramePanel>
  );
}
