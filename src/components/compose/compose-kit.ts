import { BasicNodesKit } from "@/components/editor/plugins/basic-nodes-kit";
import { ListKit } from "@/components/editor/plugins/list-kit";
import { LinkKit } from "@/components/editor/plugins/link-kit";
import { AutoformatKit } from "@/components/editor/plugins/autoformat-kit";

/**
 * Plugins do corpo de e-mail. Compartilhado entre o compose e o editor de
 * templates (Configurações) de propósito: o template é salvo como o HTML do
 * próprio Plate, então ele só volta igual se os dois editores tiverem os
 * mesmos nós registrados.
 */
export const COMPOSE_KIT = [
  ...BasicNodesKit,
  ...ListKit,
  ...LinkKit,
  ...AutoformatKit,
];
