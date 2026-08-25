// Cliente de config do app (#1491, par do #1471-BE). `/me/config` — owner-scoped
// pela sessão. Doutrina do Altair (#1471): **allowlist explícita** — a web só pode
// escrever as chaves que o BE devolve; chave fora da allowlist o BE RECUSA. Por
// isso a UI é DATA-DRIVEN: renderiza só o que `obterConfig` devolve, não inventa
// chave nenhuma (esconder/mostrar controle é conforto; a barreira é server-side).
import { pedir } from "@/lib/http";

export type ValorConfig = boolean | string;

/** @rota /me/config */
export interface ItemConfig {
  chave: string;
  valor: ValorConfig;
  /** Como a UI renderiza o controle. */
  tipo: "bool" | "texto" | "opcao";
  /** Para `tipo: "opcao"`. */
  opcoes?: string[];
  /** Rótulo i18n opcional; a UI cai na própria `chave` se ausente. */
  rotulo?: { "pt-BR": string; en: string };
}

/** As prefs configuráveis pela plataforma (só as da allowlist do BE), com valor atual. */
export function obterConfig(): Promise<ItemConfig[]> {
  return pedir<ItemConfig[]>("/me/config");
}

/**
 * Salva um patch de prefs. Só chaves da allowlist entram — o BE recusa o resto
 * (a UI nunca manda chave que não veio de `obterConfig`). Devolve o estado novo.
 */
export function salvarConfig(patch: Record<string, ValorConfig>): Promise<ItemConfig[]> {
  return pedir<ItemConfig[]>("/me/config", { method: "PATCH", body: JSON.stringify(patch) });
}
