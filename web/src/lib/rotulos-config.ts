import type { ChaveConfigConhecida, Dicionario, OpcaoConfigConhecida } from "@/i18n";

// #1749 (achado da @Íris no gate do #1732) — rótulos da config do app. O BE
// devolve só `chave`, `tipo`, `opcoes` e `valor`; texto de UI mora no
// dicionário (regra 7 do AGENTS), indexado por eles. Antes a tela fazia
// `item.rotulo?.[idioma] ?? item.chave` contra um `rotulo` que o BE nunca
// mandou — e mostrava `app.tema` cru, em qualquer idioma.
//
// `Object.hasOwn`, não `chave in t.configChave`: o objeto do dicionário herda do
// protótipo, e `t.configChave["constructor"]` devolveria uma FUNÇÃO. Uma chave
// vinda do servidor nunca pode alcançar o protótipo.

/** O rótulo da chave no idioma de `t`; chave desconhecida → o fallback genérico, nunca a chave crua. */
export function rotuloDaChave(t: Dicionario, chave: string): string {
  return Object.hasOwn(t.configChave, chave)
    ? t.configChave[chave as ChaveConfigConhecida]
    : t.configChaveDesconhecida;
}

/**
 * O rótulo do valor de opção no idioma de `t`. Valor desconhecido → o próprio
 * valor: é DADO (o que vai e volta do BE), e trocá-lo por um genérico tornaria
 * as opções indistinguíveis. O `value` do `<option>` continua sempre o dado cru.
 */
export function rotuloDaOpcao(t: Dicionario, valor: string): string {
  return Object.hasOwn(t.configOpcao, valor) ? t.configOpcao[valor as OpcaoConfigConhecida] : valor;
}
