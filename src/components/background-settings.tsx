import { FramePanel } from "@/components/reui/frame";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { useAppStore } from "@/store";

export function BackgroundSettings() {
  const fundoEstrelado = useAppStore((state) => state.fundoEstrelado);
  const setFundoEstrelado = useAppStore(
    (state) => state.setFundoEstrelado
  );

  return (
    <FramePanel>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="starry-background">
            Starry background
          </FieldLabel>
          <FieldDescription>
            Show the animated stars behind GALAXIE Toolbox.
          </FieldDescription>
        </FieldContent>
        <Switch
          id="starry-background"
          checked={fundoEstrelado}
          onCheckedChange={setFundoEstrelado}
        />
      </Field>
    </FramePanel>
  );
}
