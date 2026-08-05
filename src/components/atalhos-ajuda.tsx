import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import type { useIdioma } from "@/lib/idioma";

type T = ReturnType<typeof useIdioma>["t"];

/**
 * Modal de ajuda dos atalhos de teclado (#28), aberto por "?".
 *
 * É a DOCUMENTAÇÃO viva dos atalhos: o catálogo abaixo é a fonte única —
 * qualquer atalho novo entra aqui e aparece na ajuda. Usa o `Dialog` da ui
 * (reui, "não inventar UI") e o `Kbd` para as teclas.
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

/** Catálogo declarativo dos atalhos, montado a partir do dicionário ativo. */
export function catalogoAtalhos(t: T): AtalhoCategoria[] {
  const c = t.controlRoom;
  return [
    {
      titulo: c.atalhosCatNavegacao,
      itens: [
        { teclas: ["↑", "↓"], rotulo: c.atalhosNavegar },
        { teclas: ["j", "k"], rotulo: c.atalhosNavegar },
        { teclas: ["/"], rotulo: c.atalhosBuscar },
        { teclas: ["F9"], rotulo: c.atalhosAtualizar },
        { teclas: ["O"], rotulo: c.atalhosOrdenar },
      ],
    },
    {
      titulo: c.atalhosCatSelecao,
      itens: [
        { teclas: ["Ctrl", "A"], rotulo: c.atalhosSelecionarTudo },
        { teclas: [c.atalhosCliqueIntervalo], rotulo: c.atalhosIntervalo },
        { teclas: ["x"], rotulo: c.atalhosMarcarItem },
        { teclas: ["Esc"], rotulo: c.atalhosLimpar },
      ],
    },
    {
      titulo: c.atalhosCatAcoes,
      itens: [
        { teclas: ["Ctrl", "R"], rotulo: c.atalhosResponder },
        { teclas: ["Ctrl", "Shift", "R"], rotulo: c.atalhosResponderTodos },
        { teclas: ["Ctrl", "Shift", "F"], rotulo: c.atalhosEncaminhar },
        { teclas: ["c"], rotulo: c.atalhosCompor },
        { teclas: ["u"], rotulo: c.atalhosLidoNaoLido },
        { teclas: ["s"], rotulo: c.atalhosSinalizar },
        { teclas: ["Del"], rotulo: c.atalhosExcluir },
      ],
    },
    {
      // #549: atalhos de formatação que só valem DENTRO do editor de e-mail
      // (contenteditable — o keymap central do Bridge não os alcança).
      titulo: c.atalhosCatFormatacao,
      itens: [
        { teclas: ["Ctrl", "K"], rotulo: c.atalhosLink },
        { teclas: ["Ctrl", "Shift", "L"], rotulo: c.atalhosLista },
      ],
    },
    {
      titulo: c.atalhosCatGeral,
      itens: [{ teclas: ["?"], rotulo: c.atalhosAjuda }],
    },
  ];
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
