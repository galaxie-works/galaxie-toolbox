import { useCallback, useRef } from "react";

import { mesmoCaminho } from "./quick-access";
import type { AcoesMenu } from "./menu-arquivo";

/** As ações do painel + a pasta de que são as `entradas` embutidas nelas. */
export interface AcoesPublicadas {
  acoes: AcoesMenu;
  /** `null` = o painel ainda está lendo o disco. */
  dirPronto: string | null;
}

/**
 * #1386: guarda o `AcoesMenu` que o content-pane publica, pra a ÁRVORE montar o
 * menu de contexto dela com os MESMOS handlers (o AC pede reuso).
 *
 * Guardado em REF, não em estado, e isso é o ponto do arquivo. Eu medi o painel
 * (`zz-sonda`, descartada): o `acoesMenu` troca de IDENTIDADE a cada render —
 * 5 renders do pai, 5 objetos novos. Guardar em `useState` fecha um ciclo:
 * publicar → `setState` → render → objeto novo → publicar. Na primeira versão
 * desta fatia foi exatamente o que aconteceu: a página do teste travou e o
 * chromium caiu depois de 7 minutos.
 *
 * A árvore não perde nada com o ref: ela lê as ações no ATO de abrir o menu (o
 * `ComMenu` re-renderiza no open e avalia a thunk ali), então nunca precisou de
 * um render pra "saber" que os handlers mudaram.
 */
export function useAcoesPublicadas(): {
  /** As ações mais recentes. Chame em resposta a evento, não no render. */
  obter: () => AcoesPublicadas | null;
  publicar: (acoes: AcoesMenu, dirPronto: string | null) => void;
  /**
   * Roda `agir` assim que o painel tiver `dir` CARREGADO. Devolve `true` se já
   * rodou (o painel já estava lá) — quem chama navega só quando devolve `false`.
   */
  agendar: (dir: string, agir: (acoes: AcoesMenu) => void) => boolean;
} {
  const atual = useRef<AcoesPublicadas | null>(null);
  // Uma pendência por vez: é sempre um clique de menu, e clique novo substitui.
  const pendente = useRef<{
    dir: string;
    agir: (acoes: AcoesMenu) => void;
  } | null>(null);

  const obter = useCallback(() => atual.current, []);

  const publicar = useCallback((acoes: AcoesMenu, dirPronto: string | null) => {
    atual.current = { acoes, dirPronto };
    const espera = pendente.current;
    if (!espera || dirPronto === null) return;
    if (!mesmoCaminho(dirPronto, espera.dir)) return;
    // Esperar o `dirPronto` (e não só o caminho atual) é o que impede "Nova
    // pasta" de calcular o nome único com a lista da pasta ANTERIOR: o painel
    // troca de caminho ANTES de as entradas novas chegarem.
    pendente.current = null;
    espera.agir(acoes);
  }, []);

  const agendar = useCallback(
    (dir: string, agir: (acoes: AcoesMenu) => void) => {
      const agora = atual.current;
      if (agora?.dirPronto != null && mesmoCaminho(agora.dirPronto, dir)) {
        agir(agora.acoes);
        return true;
      }
      pendente.current = { dir, agir };
      return false;
    },
    [],
  );

  return { obter, publicar, agendar };
}
