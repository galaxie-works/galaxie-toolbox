import type { Pessoa } from "@/lib/types";

/** Endereço "inteiro o bastante" para virar destinatário sem estar no diretório. */
export function emailValido(texto: string): boolean {
  return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(texto.trim());
}

export function mesmoEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Decide se o Enter deve commitar o e-mail digitado como convidado livre, em vez
 * de deixar o combobox selecionar uma sugestão (#268).
 *
 * O Enter só é do combobox quando há um CONTATO REAL destacado — isto é, o item
 * destacado ainda aparece nas sugestões atuais. Não dá pra confiar só em
 * `destacadoRef` truthy: o Base UI nem sempre o limpa quando o item "digitado"
 * deixa de estar destacado (a cada tecla o memo recria o pseudo-item, o highlight
 * cai mas o ref fica obsoleto). Esse ref obsoleto travava o commit e deixava o
 * usuário num loop, sem conseguir adicionar um e-mail que não é contato — o bug
 * do #268. Por isso conferimos se o destacado é mesmo uma das sugestões, não só
 * se o ref existe.
 */
export function deveCommitarEnter(
  texto: string,
  destacado: Pessoa | undefined,
  sugestoes: Pessoa[],
): boolean {
  if (!emailValido(texto)) return false;
  const contatoRealDestacado =
    !!destacado && sugestoes.some((s) => mesmoEmail(s.email, destacado.email));
  return !contatoRealDestacado;
}
