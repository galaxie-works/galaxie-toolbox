import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import type { useIdioma } from "@/lib/idioma";
import {
  ORDEM_CATEGORIAS_BRIDGE,
  TITULO_CATEGORIA_BRIDGE,
  atalhosBridgeDe,
} from "@/components/atalhos-bridge";

type T = ReturnType<typeof useIdioma>["t"];

/**
 * Modal de ajuda dos atalhos de teclado (#28), aberto por "?".
 *
 * É a DOCUMENTAÇÃO viva dos atalhos, montada a partir do catálogo declarativo
 * `atalhos-bridge.ts` (fonte ÚNICA, #1060) — a mesma que alimenta os tooltips
 * das ações. Qualquer atalho novo entra no catálogo e aparece aqui; um teste de
 * cross-check reprova catálogo↔handler divergentes. Usa o `Dialog` da ui (reui,
 * "não inventar UI") e o `Kbd` para as teclas.
 */
export interface AtalhoLinha {
  /** Teclas a exibir; cada string vira um <Kbd>. */
  teclas: string[];
  rotulo: string;
}
export interface AtalhoCategoria {
  titulo: string;
  itens: AtalhoLinha[];
}

/**
 * Catálogo declarativo dos atalhos, projetado do `atalhos-bridge.ts` para a
 * forma de exibição (título + linhas), resolvendo as chaves i18n no dicionário
 * ativo. Cada COMBO de um atalho vira uma linha (ex.: navegar = "↑ ↓" e "j k").
 */
export function catalogoAtalhos(t: T): AtalhoCategoria[] {
  const c = t.controlRoom;
  return ORDEM_CATEGORIAS_BRIDGE.map((categoria) => ({
    titulo: c[TITULO_CATEGORIA_BRIDGE[categoria]],
    itens: atalhosBridgeDe(categoria).flatMap((a) =>
      a.combos.map((combo) => ({ teclas: combo, rotulo: c[a.rotulo] })),
    ),
  }));
}

export function AtalhosAjuda({
  aberto,
  onOpenChange,
  t,
}: {
  aberto: boolean;
  onOpenChange: (v: boolean) => void;
  t: T;
}) {
  const cats = catalogoAtalhos(t);
  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.controlRoom.atalhosTitulo}</DialogTitle>
          <DialogDescription>{t.controlRoom.atalhosDescricao}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 sm:grid-cols-2">
          {cats.map((cat) => (
            <div key={cat.titulo} className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {cat.titulo}
              </p>
              <ul className="space-y-1.5">
                {cat.itens.map((item, i) => (
                  <li
                    key={`${item.rotulo}-${i}`}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="min-w-0 truncate text-foreground">{item.rotulo}</span>
                    <KbdGroup className="shrink-0">
                      {item.teclas.map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                      ))}
                    </KbdGroup>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
