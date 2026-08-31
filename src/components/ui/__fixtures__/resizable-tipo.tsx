// PROVA DE TIPO (#1667) — NÃO é código de app: nunca é importado, e a varredura
// de `resizable-ponto-unico.test.ts` EXCLUI `__fixtures__/`.
//
// Prova que passar `style` ao `ResizableHandle` é ERRO DE COMPILAÇÃO, INCLUSIVE
// sob ALIAS (a forma que contornava a âncora de texto do gate). Cada
// `@ts-expect-error` EXIGE um erro na linha seguinte: se `style` voltar ao tipo,
// o erro desaparece, o directivo fica "unused" e o `tsc -b` do gate REPROVA.
// É o mutante do DoD 1, verificado pelo COMPILADOR em vez de por grep — nenhum
// alias, spread ou forma dinâmica engana a identidade do componente para o tsc.
import { ResizableHandle, ResizableHandle as RH } from "@/components/ui/resizable";

// Forma direta:
// @ts-expect-error #1667: `style` está fora do tipo (Omit<…, "style">) — passar é erro.
export const _styleDireto = <ResizableHandle style={{ marginLeft: 8 }} />;

// Sob alias — o caso exato que contornava a âncora de texto:
// @ts-expect-error #1667: idem sob `import { ResizableHandle as RH }`.
export const _styleAlias = <RH style={{ marginLeft: 8 }} />;
