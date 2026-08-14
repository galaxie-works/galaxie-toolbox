// #871 (Explorer slice 2a): diálogo "Mapear unidade de rede". Reusa o Dialog
// canônico (Animate UI) + Input/Select/Checkbox/Button + i18n. O estado
// `open`/`onOpenChange` é controlado pelo shell (chega intacto ao Radix — regra
// do #275/P0 de webview). Backend: `mapearNetworkDrive` (fs_map_network_drive).
import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { mapearNetworkDrive } from "@/lib/api";
import { useIdioma } from "@/lib/idioma";
import { toast } from "sonner";

// Letras candidatas: Z: → D: (convenção Win11; A/B/C costumam estar ocupadas).
const LETRAS = Array.from({ length: "Z".charCodeAt(0) - "D".charCodeAt(0) + 1 }, (_, i) =>
  `${String.fromCharCode("Z".charCodeAt(0) - i)}:`,
);

interface NetworkDriveDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** chamado após mapear com sucesso (o shell pode navegar/atualizar). */
  onMapeado?: (letter: string) => void;
}

export function NetworkDriveDialog({
  open,
  onOpenChange,
  onMapeado,
}: NetworkDriveDialogProps) {
  const { t } = useIdioma();

  const [letter, setLetter] = useState(LETRAS[0]);
  const [remote, setRemote] = useState("");
  const [persistent, setPersistent] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Reseta o formulário toda vez que o diálogo abre.
  useEffect(() => {
    if (open) {
      setLetter(LETRAS[0]);
      setRemote("");
      setPersistent(true);
      setSubmitting(false);
    }
  }, [open]);

  async function conectar() {
    setSubmitting(true);
    try {
      await mapearNetworkDrive(letter, remote.trim(), persistent);
      toast.success(t.arquivos.redeOk);
      onMapeado?.(letter);
      onOpenChange(false);
    } catch (e) {
      toast.error(t.arquivos.redeErro, { description: String(e) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md!">
        <DialogHeader>
          <DialogTitle>{t.arquivos.redeTitulo}</DialogTitle>
          <DialogDescription>{t.arquivos.redeDesc}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="rede-letra">{t.arquivos.redeLetra}</Label>
            <Select value={letter} onValueChange={setLetter}>
              <SelectTrigger id="rede-letra" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LETRAS.map((l) => (
                  <SelectItem key={l} value={l}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="rede-caminho">{t.arquivos.redeCaminho}</Label>
            <Input
              id="rede-caminho"
              value={remote}
              onChange={(e) => setRemote(e.target.value)}
              placeholder={t.arquivos.redePlaceholder}
            />
          </div>

          <Label className="w-fit">
            <Checkbox
              checked={persistent}
              onCheckedChange={(v) => setPersistent(v === true)}
            />
            {t.arquivos.redePersistir}
          </Label>
        </div>

        <DialogFooter className="sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t.arquivos.cancelar}
          </Button>
          <Button
            onClick={() => void conectar()}
            disabled={!remote.trim() || submitting}
          >
            {t.arquivos.redeConectar}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
