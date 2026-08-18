// #898 (spike): timestamp RELATIVO puro e testável ("agora", "2 min atrás",
// "3 h atrás", "ontem", "5 dias atrás") pro Status Center como histórico. Em `.ts`
// puro (sem React) de propósito — igual `operacao.ts`: roda no `node --test`
// (strip-types) e é reusável. Os rótulos i18n chegam de FORA (o caller passa
// `t.arquivos.*`), então o helper não depende de `strings.ts`/idioma e continua
// puro. A interpolação de `{n}` é literal (mesmo padrão de `formatarEta`).

/** Rótulos i18n das faixas de tempo relativo (passados de fora pra manter puro). */
export interface RotulosTempo {
  /** "agora" — usado em < 60 s. */
  agora: string;
  /** "{n} min atrás" — 1..59 min. */
  minAtras: string;
  /** "{n} h atrás" — 1..23 h. */
  horasAtras: string;
  /** "ontem" — exatamente 1 dia. */
  ontem: string;
  /** "{n} dias atrás" — ≥ 2 dias. */
  diasAtras: string;
}

/**
 * Formata `epochMs` relativo a `agoraMs`. Diferença negativa (relógio à frente /
 * skew) cai em "agora". As faixas: < 1 min → agora; < 1 h → min; < 1 dia → h;
 * 1 dia → ontem; ≥ 2 dias → dias.
 */
export function formatarTempoRelativo(
  epochMs: number,
  agoraMs: number,
  r: RotulosTempo,
): string {
  const seg = Math.floor((agoraMs - epochMs) / 1000);
  if (seg < 60) return r.agora;
  const min = Math.floor(seg / 60);
  if (min < 60) return r.minAtras.replace("{n}", String(min));
  const horas = Math.floor(min / 60);
  if (horas < 24) return r.horasAtras.replace("{n}", String(horas));
  const dias = Math.floor(horas / 24);
  if (dias === 1) return r.ontem;
  return r.diasAtras.replace("{n}", String(dias));
}
