// Cliente de config do app (#1491, par do #1471-BE). `/me/config` — owner-scoped
// pela sessão. Doutrina do Altair (#1471): **allowlist explícita** — a web só pode
// escrever as chaves que o BE devolve; chave fora da allowlist o BE RECUSA. Por
// isso a UI é DATA-DRIVEN: renderiza só o que `obterConfig` devolve, não inventa
// chave nenhuma (esconder/mostrar controle é conforto; a barreira é server-side).
import { pedir, ErroApi, ehNaoAutenticado } from "@/lib/http";

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

/** Resultado POR CHAVE de `salvarConfig` — nunca um "guardei tudo" único. */
export interface ResultadoSalvar {
  /** Chaves gravadas com sucesso. */
  ok: string[];
  /** Chaves que falharam, com o status HTTP (400 = valor/opção inválida). */
  falhas: { chave: string; status: number }[];
  /** Itens efetivamente gravados (o que o SERVIDOR guardou) — re-sincroniza a tela. */
  itens: ItemConfig[];
}

/**
 * Salva as prefs tocadas. A borda serve `PATCH /me/config` como **um par
 * `{chave, valor}` por request** (decisão do @Altair no #1588, saída (a)): o
 * `definir_pref` do BE é por-item e sem transação, então a atomicidade da API
 * não pode exceder a do armazém — daí **um PATCH por chave**. O `valor` vai
 * **stringificado**; o BE deriva o tipo pela forma da chave (o cliente não forja
 * tipo). Como a escrita é por chave, ela pode ficar **parcialmente aplicada** →
 * o retorno é **por chave** (ok/falha), nunca um "salvo" global que mentiria se
 * uma preferência ficasse para trás. `401` a meio = sessão morta (sinal do app
 * inteiro, não falha de chave) → propaga pra UI mandar ao login.
 */
export async function salvarConfig(patch: Record<string, ValorConfig>): Promise<ResultadoSalvar> {
  const ok: string[] = [];
  const falhas: { chave: string; status: number }[] = [];
  const itens: ItemConfig[] = [];
  for (const [chave, valor] of Object.entries(patch)) {
    try {
      const item = await pedir<ItemConfig>("/me/config", {
        method: "PATCH",
        body: JSON.stringify({ chave, valor: String(valor) }),
      });
      ok.push(chave);
      itens.push(item);
    } catch (e) {
      if (ehNaoAutenticado(e)) throw e; // 401 = sessão morta → login, não falha de chave
      falhas.push({ chave, status: e instanceof ErroApi ? e.status : 0 });
    }
  }
  return { ok, falhas, itens };
}
