import { useEffect, useState } from "react";

/**
 * useState que persiste em localStorage. Serve pra guardar o estado que o
 * usuário deixa o app: menus colapsados, preferências de painel, etc. As
 * proporções dos ResizablePanelGroup usam o `autoSaveId` do próprio
 * react-resizable-panels (não passam por aqui).
 */
export function usePersistedState<T>(
  chave: string,
  inicial: T
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [valor, setValor] = useState<T>(() => {
    try {
      const bruto = localStorage.getItem(chave);
      return bruto !== null ? (JSON.parse(bruto) as T) : inicial;
    } catch {
      return inicial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(chave, JSON.stringify(valor));
    } catch {
      /* localStorage cheio/indisponível: só não persiste */
    }
  }, [chave, valor]);

  return [valor, setValor];
}
