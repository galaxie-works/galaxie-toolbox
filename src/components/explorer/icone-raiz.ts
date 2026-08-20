import { Cloud, Monitor, Network, Pin } from "lucide-react";
import type { ElementType } from "react";

import type { IdIconeRaiz } from "./caminho";

/**
 * #1287 (reprovação da Lúmen): o ÚNICO lugar que traduz o id de ícone de uma
 * raiz semântica no componente que a desenha.
 *
 * Fica separado do `caminho.ts` porque aquele arquivo é lido pelo `node --test`
 * (`--experimental-strip-types`, sem bundler) e não pode importar React nem
 * `lucide-react`. Fica separado dos componentes porque a árvore E a view usam o
 * mesmo mapa: era justamente terem cópias próprias que deixava sidebar e página
 * discordarem sobre o que é a raiz, sem nada acusar.
 */
export const ICONE_DA_RAIZ: Record<IdIconeRaiz, ElementType> = {
  monitor: Monitor,
  cloud: Cloud,
  network: Network,
  pin: Pin,
};
