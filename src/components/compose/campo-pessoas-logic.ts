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
 * #606 (regressão da classe #268): **NÃO dependemos mais do item destacado**. A
 * versão anterior conferia se o `destacado` (do `onItemHighlighted`) estava nas
 * sugestões — mas o Base UI passou a AUTO-destacar a 1ª sugestão ao abrir o
 * popup. Com a busca por relevância do Graph retornando gente até pra um e-mail
 * externo, isso fazia o `destacado` virar um contato real, o commit era negado, e
 * o Enter caía no combobox que LIMPAVA o input — o campo "apagava" o endereço.
 *
 * Regra robusta (independe de highlight): se o texto é um e-mail COMPLETO e NÃO é
 * nenhuma das sugestões atuais, ele é um endereço livre e deve virar chip. Se o
 * texto casa com uma sugestão (o usuário digitou o e-mail de um contato conhecido),
 * deixamos o combobox selecionar — o chip resultante é o mesmo e-mail.
 */
export function deveCommitarEnter(
  texto: string,
  sugestoes: Pessoa[],
): boolean {
  if (!emailValido(texto)) return false;
  return !sugestoes.some((s) => mesmoEmail(s.email, texto));
}

/**
 * #606 (o "apaga ENQUANTO digita", caminho value-change): decide se, após um
 * `onValueChange` do combobox, devemos LIMPAR o input.
 *
 * O bug: o Base UI auto-seleciona a 1ª sugestão DURANTE a digitação (o Graph
 * retorna gente por relevância até pra e-mail externo); isso dispara
 * `onValueChange` → `aplicar` → `setTexto("")`, apagando o endereço que o usuário
 * ainda estava digitando. O #298/#610 só blindaram o Enter, não este caminho.
 *
 * Regra: NÃO limpamos quando o `texto` atual é um e-mail COMPLETO que NÃO entrou
 * nos e-mails aplicados — sinal de auto-select espúrio (o texto do usuário ficou
 * de fora). Em commit genuíno o texto ou está vazio, ou é uma query parcial (o
 * usuário clicou numa sugestão), ou é o próprio e-mail digitado (Enter) — todos
 * limpam normalmente.
 */
export function deveLimparAposAplicar(
  texto: string,
  emailsAplicados: string[],
): boolean {
  const t = texto.trim();
  if (!emailValido(t)) return true;
  return emailsAplicados.some((e) => mesmoEmail(e, t));
}
