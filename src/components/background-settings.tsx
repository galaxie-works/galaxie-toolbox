import { Check, ImageOff } from "lucide-react";

import { APP_BACKGROUNDS } from "@/lib/backgrounds";
import { cn } from "@/lib/utils";
import { FramePanel } from "@/components/reui/frame";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { useAppStore } from "@/store";
import { useIdioma } from "@/lib/idioma";

export function BackgroundSettings() {
  const { t } = useIdioma();
  const fundoEstrelado = useAppStore((state) => state.fundoEstrelado);
  const setFundoEstrelado = useAppStore((state) => state.setFundoEstrelado);
  const fundoImagem = useAppStore((state) => state.fundoImagem);
  const setFundoImagem = useAppStore((state) => state.setFundoImagem);

  return (
    <FramePanel>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="starry-background">
            {t.settings.bgEstreladoLabel}
          </FieldLabel>
          <FieldDescription>{t.settings.bgEstreladoDesc}</FieldDescription>
        </FieldContent>
        <Switch
          id="starry-background"
          checked={fundoEstrelado}
          onCheckedChange={setFundoEstrelado}
        />
      </Field>

      {/* #378: galeria de imagens de fundo (extensível via backgrounds.ts).
          Selecionar uma imagem desliga o starry; "None" volta ao tema. */}
      <div className="mt-4 border-t border-border pt-4">
        <h3 className="text-sm font-semibold">{t.settings.bgImagensTitulo}</h3>
        <p className="text-sm text-muted-foreground">
          {t.settings.bgImagensDesc}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <SelectableCard
            selecionado={fundoImagem === null}
            onClick={() => setFundoImagem(null)}
            label={t.settings.bgNenhum}
          >
            <div className="grid size-full place-items-center bg-muted text-muted-foreground">
              <ImageOff className="size-5" />
            </div>
          </SelectableCard>

          {APP_BACKGROUNDS.map((bg) => (
            <SelectableCard
              key={bg.id}
              selecionado={fundoImagem === bg.id}
              onClick={() => setFundoImagem(bg.id)}
              label={bg.label}
            >
              <img
                src={bg.thumb}
                alt=""
                loading="lazy"
                draggable={false}
                className="size-full object-cover"
              />
            </SelectableCard>
          ))}
        </div>
      </div>
    </FramePanel>
  );
}

/** Card selecionável da galeria (thumb + rótulo + estado de seleção). */
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
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-lg border text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        selecionado
          ? "border-primary ring-1 ring-primary"
          : "border-border hover:border-foreground/30"
      )}
    >
      <div className="relative aspect-video w-full overflow-hidden">
        {children}
        {selecionado && (
          <span className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground shadow">
            <Check className="size-3" />
          </span>
        )}
      </div>
      <span className="truncate px-2 py-1.5 text-xs font-medium">{label}</span>
    </button>
  );
}
