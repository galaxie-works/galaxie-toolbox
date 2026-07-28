import { RotateCcw } from "lucide-react";

import { FramePanel } from "@/components/reui/frame";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  contrasteCorDestaque,
  COR_DESTAQUE_PICKER_PADRAO,
} from "@/lib/cor-destaque";
import { useAppStore } from "@/store";

export function ColorSettings() {
  const corDestaque = useAppStore((state) => state.corDestaque);
  const setCorDestaque = useAppStore((state) => state.setCorDestaque);
  const resetCorDestaque = useAppStore((state) => state.resetCorDestaque);
  const valor = corDestaque ?? COR_DESTAQUE_PICKER_PADRAO;
  const contraste = contrasteCorDestaque(valor);

  return (
    <FramePanel>
      <Field orientation="responsive">
        <FieldContent>
          <FieldLabel htmlFor="accent-color">Accent color</FieldLabel>
          <FieldDescription>
            {corDestaque
              ? `${corDestaque.toUpperCase()} · ${contraste.toFixed(1)}:1 contrast`
              : "Using the current mood default."}
          </FieldDescription>
        </FieldContent>
        <div className="flex items-center justify-end gap-2">
          <Input
            id="accent-color"
            type="color"
            value={valor}
            aria-label="Accent color"
            className="size-9 shrink-0 cursor-pointer p-1"
            onChange={(event) => setCorDestaque(event.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            disabled={corDestaque === null}
            onClick={resetCorDestaque}
          >
            <RotateCcw data-icon="inline-start" />
            Reset
          </Button>
        </div>
      </Field>
    </FramePanel>
  );
}
