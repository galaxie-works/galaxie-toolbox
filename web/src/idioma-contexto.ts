import { createContext, useContext } from "react";
import { idiomaAtual, type Idioma } from "@/i18n";

// O idioma ATIVO do app (#1732). O valor vem do `IdiomaProvider` (conta > navegador
// > pt-BR); fora dele — ex.: uma página renderizada isolada num teste — cai no
// navegador, o mesmo default de antes. Módulo `.ts` (sem JSX) pra o arquivo do
// provider só exportar componente (`react-refresh/only-export-components`).
export const IdiomaContexto = createContext<Idioma>(idiomaAtual());

/**
 * O idioma que a página deve usar: o explícito, se veio por prop (os testes e quem
 * força um idioma), senão o ativo do app. O hook é chamado SEMPRE — nunca atrás do
 * `??` —, senão a ordem dos hooks muda entre renders.
 */
export function useIdiomaAtivo(explicito?: Idioma): Idioma {
  const ativo = useContext(IdiomaContexto);
  return explicito ?? ativo;
}
