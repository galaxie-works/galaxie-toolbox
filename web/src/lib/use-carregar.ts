import { useCallback, useEffect, useState } from "react";
import { ehNaoAutenticado } from "@/lib/api-me";

export type EstadoCarga = "carregando" | "ok" | "erro" | "nao-autenticado";

/**
 * Estado de um carregamento na UI — não é corpo de resposta de rota nenhuma.
 *
 * @nao-contrato estado local do hook. O `T` é que vem do contrato, e quem o
 * declara é o tipo dele, com o próprio `@rota`.
 */
export interface Carga<T> {
  dados: T | null;
  estado: EstadoCarga;
  recarregar: () => void;
}

// Hook genérico de leitura de um recurso `/me/*`: trata carregando/ok/erro e, em
// especial, distingue **não-autenticado** (401) — que a página usa pra mandar ao
// login em vez de mostrar "erro". Sem lib de data-fetching (scaffold enxuto);
// se a família crescer, troca por um cliente de query numa fatia própria.
export function useCarregar<T>(fn: () => Promise<T>): Carga<T> {
  const [dados, setDados] = useState<T | null>(null);
  const [estado, setEstado] = useState<EstadoCarga>("carregando");

  const rodar = useCallback(() => {
    let vivo = true;
    setEstado("carregando");
    fn()
      .then((d) => {
        if (!vivo) return;
        setDados(d);
        setEstado("ok");
      })
      .catch((e) => {
        if (!vivo) return;
        setEstado(ehNaoAutenticado(e) ? "nao-autenticado" : "erro");
      });
    return () => {
      vivo = false;
    };
  }, [fn]);

  useEffect(() => rodar(), [rodar]);

  return { dados, estado, recarregar: rodar };
}
