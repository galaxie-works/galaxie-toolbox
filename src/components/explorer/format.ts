// #678: formatadores do painel de conteúdo. Puros/`.ts`. O tamanho reusa o
// `formatBytes` canônico (`@/lib/utils`); aqui ficam a data curta (localizada) e
// o rótulo de tipo da coluna "Tipo".
import type { FsEntry } from "@/lib/types";

/** Data curta "dd/mm/aaaa hh:mm" no locale ativo. Null/0 → "—". */
export function formatarDataArquivo(ms: number | null, locale: string): string {
  if (!ms) return "—";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/**
 * Rótulo da coluna "Tipo": pasta → rótulo localizado; arquivo com extensão →
 * "PNG" / "PDF" (extensão em maiúsculas); arquivo sem extensão → rótulo genérico.
 * Recebe os rótulos i18n de fora pra continuar puro.
 */
export function rotuloTipo(
  e: FsEntry,
  labels: { pasta: string; arquivo: string },
): string {
  if (e.isDir) return labels.pasta;
  const ext = e.extension?.replace(/^\./, "").toUpperCase();
  return ext ? ext : labels.arquivo;
}
