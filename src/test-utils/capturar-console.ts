// #1301 — captura e asserção de `console.*` em teste.
//
// Antes existia um spy ad hoc (`vi.spyOn(console, "error")`) num teste só
// (#1179). Isso amarrava a asserção de log ao vitest e obrigava cada teste a
// lembrar do `mockRestore()` — esquecer significa vazar o mock pros testes
// seguintes, que é falha intermitente.
//
// Este helper é **agnóstico de framework** de propósito: troca os métodos do
// console na mão e devolve o `restaurar`. Funciona igual no `node --test` e no
// vitest/browser, então o mesmo jeito de afirmar log vale no repo inteiro.
//
// PII (lição RB do #1076): o capturado fica **só em memória** e nada é
// re-impresso — nem em CI. Morre quando o teste termina.

/** Níveis que o helper intercepta. */
export type NivelConsole = "log" | "info" | "warn" | "error";

const NIVEIS: NivelConsole[] = ["log", "info", "warn", "error"];

export interface ConsoleCapturado {
  /** Argumentos de cada chamada, por nível. */
  chamadas: Record<NivelConsole, unknown[][]>;
  /** Alguma chamada desse nível cujo texto contenha `trecho`. */
  contem(nivel: NivelConsole, trecho: string): boolean;
  /** Devolve o console original. **Sempre** chame (ou use `comConsole`). */
  restaurar(): void;
}

function texto(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      if (typeof a === "string") return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
}

/**
 * Começa a capturar `console.*`. O console real **não** é chamado — o teste
 * fica silencioso, que é o comportamento certo para uma suíte.
 *
 * Prefira [`comConsole`] quando puder: ele garante o `restaurar` mesmo se o
 * corpo lançar.
 */
export function capturarConsole(): ConsoleCapturado {
  const originais = {} as Record<NivelConsole, (...args: unknown[]) => void>;
  const chamadas = {
    log: [],
    info: [],
    warn: [],
    error: [],
  } as Record<NivelConsole, unknown[][]>;

  for (const nivel of NIVEIS) {
    originais[nivel] = console[nivel] as (...args: unknown[]) => void;
    console[nivel] = ((...args: unknown[]) => {
      chamadas[nivel].push(args);
    }) as typeof console.log;
  }

  return {
    chamadas,
    contem(nivel, trecho) {
      return chamadas[nivel].some((args) => texto(args).includes(trecho));
    },
    restaurar() {
      for (const nivel of NIVEIS) console[nivel] = originais[nivel];
    },
  };
}

/**
 * Versão com escopo: restaura o console **mesmo se `fn` lançar**. É a que
 * deveria ser usada por padrão — o `try/finally` é justamente o que o spy ad
 * hoc não tinha.
 *
 * Aceita função síncrona ou assíncrona.
 */
export async function comConsole<T>(
  fn: (capturado: ConsoleCapturado) => T | Promise<T>,
): Promise<{ resultado: T; capturado: ConsoleCapturado }> {
  const capturado = capturarConsole();
  try {
    const resultado = await fn(capturado);
    return { resultado, capturado };
  } finally {
    capturado.restaurar();
  }
}

/** Falha se nenhuma chamada do nível contiver `trecho`. */
export function assertLogou(
  capturado: ConsoleCapturado,
  nivel: NivelConsole,
  trecho: string,
): void {
  if (capturado.contem(nivel, trecho)) return;
  const lista =
    capturado.chamadas[nivel].map((a) => `  - ${texto(a)}`).join("\n") || "  (nenhuma)";
  throw new Error(
    `esperava console.${nivel} contendo ${JSON.stringify(trecho)}, mas capturei:\n${lista}`,
  );
}

/** Falha se ALGUMA chamada do nível contiver `trecho`. */
export function assertNaoLogou(
  capturado: ConsoleCapturado,
  nivel: NivelConsole,
  trecho: string,
): void {
  if (!capturado.contem(nivel, trecho)) return;
  const lista = capturado.chamadas[nivel].map((a) => `  - ${texto(a)}`).join("\n");
  throw new Error(
    `NÃO esperava console.${nivel} contendo ${JSON.stringify(trecho)}, mas capturei:\n${lista}`,
  );
}
