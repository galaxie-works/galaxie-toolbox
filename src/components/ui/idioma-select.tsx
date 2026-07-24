import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useIdioma } from "@/lib/idioma";
import { IDIOMAS, type Idioma } from "@/lib/strings";

/**
 * Seletor de idioma no padrao do @reui/c-select-25 (bandeira + rotulo).
 *
 * O exemplo do reui usa a API do Base UI (prop `items` e SelectValue como
 * funcao); o select instalado aqui e o do Radix, onde o valor e string e o
 * SelectValue espelha o conteudo do item escolhido. Mesma aparencia, API da
 * versao que temos.
 */
export function IdiomaSelect({ className }: { className?: string }) {
  const { idioma, definir, t } = useIdioma();

  return (
    <Select value={idioma} onValueChange={(v) => definir(v as Idioma)}>
      <SelectTrigger className={className} aria-label={t.login.idioma}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {IDIOMAS.map((i) => (
            <SelectItem key={i.valor} value={i.valor}>
              <span className="flex items-center gap-2">
                <span className="rounded border px-1 text-[10px] leading-4 font-medium text-muted-foreground">
                  {i.sigla}
                </span>
                <span>{i.rotulo}</span>
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
