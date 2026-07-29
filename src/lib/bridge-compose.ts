import type { useIdioma } from "@/lib/idioma";

export const CAIXA_PROPRIA = "me";

export function descricaoErroEnvio(
  erro: unknown,
  mailbox: string,
  t: ReturnType<typeof useIdioma>["t"],
) {
  const detalhe = String(erro);
  return mailbox !== CAIXA_PROPRIA &&
    /\b403\b|sem permissão|permission/i.test(detalhe)
    ? t.controlRoom.caixaSemPermissaoEnvio
    : detalhe;
}
