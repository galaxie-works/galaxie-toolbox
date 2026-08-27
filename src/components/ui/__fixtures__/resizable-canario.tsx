// CANÁRIO (#1667) — viola de PROPÓSITO. NÃO é código de app: nunca é importado,
// e a varredura de `resizable-ponto-unico.test.ts` EXCLUI `__fixtures__/`.
//
// É a prova de que a guarda OLHA: o teste dedicado corre a MESMA análise só sobre
// este ficheiro e exige que ela ACUSE a violação abaixo. Se a âncora `tagsDeUso`
// deixar de reconhecer `<ResizableHandle`, este ficheiro deixa de ser acusado e o
// teste do canário PARTE — "a guarda deixou de olhar" passa a ser visível, em vez
// de a suite passar verde tendo verificado nada.
import { ResizableHandle } from "@/components/ui/resizable";

// Violação deliberada: `mx-4` não está em `PERMITIDAS` (só `print:hidden`).
export const ResizableCanario = <ResizableHandle className="mx-4" />;
