/**
 * #1019 (enabler dos seams S3/S6): helpers puros de data/horário do Bridge,
 * extraídos do control-room.tsx pra um lib compartilhado.
 *
 * Motivo: `faixaHora` só é usado pelo `EventoDialog` (S6) e `quandoCurto` pela
 * `MessageList` (S3), mas ambos dependem de `comZ`, que o control-room usa em
 * ~9 lugares. Extrair um seam levando `comZ` junto o roubaria dos outros;
 * deixá-lo no control-room e importar de volta criaria dependência CIRCULAR
 * (control-room ↔ seam). Pôr os 4 num lib puro resolve os dois — cada seam e o
 * control-room importam daqui. Funções puras, zero UI/estado.
 */

/** O backend às vezes devolve ISO sem o `Z`; normaliza pra UTC antes de `Date`. */
export function comZ(iso: string): string {
  return iso.endsWith("Z") ? iso : iso + "Z";
}

/** Hora local `HH:MM` do ISO; `""` se inválido. */
export function hora(iso: string, idioma: string): string {
  const d = new Date(comZ(iso));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(idioma, { hour: "2-digit", minute: "2-digit" });
}

/** Faixa `HH:MM – HH:MM` (só a de início se não houver fim). */
export function faixaHora(ini: string, fim: string, idioma: string): string {
  const a = hora(ini, idioma);
  const b = hora(fim, idioma);
  return b ? `${a} – ${b}` : a;
}

/** Data + hora curtas para a lista (hoje = só hora; senão data curta + hora). */
export function quandoCurto(iso: string, idioma: string): string {
  const d = new Date(comZ(iso));
  if (Number.isNaN(d.getTime())) return "";
  const hoje = new Date();
  const hora = d.toLocaleTimeString(idioma, { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === hoje.toDateString()) return hora;
  const mesmoAno = d.getFullYear() === hoje.getFullYear();
  const data = d.toLocaleDateString(idioma, {
    day: "2-digit",
    month: "short",
    year: mesmoAno ? undefined : "2-digit",
  });
  return `${data} · ${hora}`;
}
