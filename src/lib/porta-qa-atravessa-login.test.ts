// #1299 — a porta `?tela=<id>` tem de SOBREVIVER ao login (achado da Íris).
//
// O defeito: `telaInicial()` alimentava só o `useState` inicial, e o
// `handleLogin` pousava num literal logo depois. Fora do Tauri não existe sessão
// persistida, então TODO acesso pelo navegador passa pelo login — e a porta era
// anulada exatamente no ambiente que o AC nomeia (`pnpm dev`, 1420). A Íris
// mediu: abriu a porta, logou, aterrissou no Navigator.
//
// ⚠️ O QUE ESTE TESTE É, E O QUE NÃO É — honestidade sobre a lente:
// ele olha a FORMA do código-fonte, e o gate irmão (`porta-qa-ausente-em-prod`)
// diz, com razão, que "código-fonte mente". Vale aqui porque o defeito É uma
// escolha de código-fonte (literal vs. funil) e porque a alternativa — a jornada
// completa login → porta → tela — exige renderizar o `App` inteiro, que puxa
// store, Tauri e rede: caro demais para um card XS. **A jornada de verdade é a
// lente da Íris, com o app rodando.** Este teste impede a regressão barata
// (alguém volta o literal); não substitui o olho dela.
//
// Rode com:  node --test --experimental-strip-types src/lib/porta-qa-atravessa-login.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const APP = join(AQUI, "..", "App.tsx");
const NAVEGACAO = join(AQUI, "navegacao.ts");

/**
 * Remove comentários preservando o resto. Necessário porque o comentário que
 * EXPLICA o conserto precisa poder citar a forma antiga sem que o teste a
 * confunda com código vivo — medir a prosa em vez do código seria o oposto do
 * que este arquivo existe pra fazer. Varre caractere a caractere para não tomar
 * `//` dentro de string (ex.: uma URL) por início de comentário.
 */
function semComentarios(src: string): string {
  const BARRA = String.fromCharCode(92); // contrabarra, sem escape na fonte
  const NL = String.fromCharCode(10);
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const prox = src[i + 1];
    if (c === "/" && prox === "/") {
      while (i < src.length && src[i] !== NL) i++;
    } else if (c === "/" && prox === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
    } else if (c === '"' || c === "'" || c === "`") {
      const aspa = c;
      out += c;
      i++;
      while (i < src.length && src[i] !== aspa) {
        if (src[i] === BARRA) {
          out += src[i];
          i++;
        }
        out += src[i];
        i++;
      }
      out += aspa;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Recorta o corpo de uma função pelo balanço de chaves, a partir da assinatura. */
function corpoDaFuncao(fonte: string, assinatura: string): string {
  const ini = fonte.indexOf(assinatura);
  assert.notEqual(ini, -1, `assinatura não encontrada em App.tsx: ${assinatura}`);
  const abre = fonte.indexOf("{", ini);
  let nivel = 0;
  for (let i = abre; i < fonte.length; i++) {
    if (fonte[i] === "{") nivel++;
    else if (fonte[i] === "}") {
      nivel--;
      if (nivel === 0) return fonte.slice(abre, i + 1);
    }
  }
  throw new Error(`chaves desbalanceadas ao recortar ${assinatura}`);
}

test("#1299 o login pousa pelo FUNIL (`telaInicial()`), não num literal", () => {
  const fonte = semComentarios(readFileSync(APP, "utf8"));
  const corpo = corpoDaFuncao(fonte, "async function handleLogin(");

  assert.match(
    corpo,
    /setTela\(\s*telaInicial\(\)\s*\)/,
    "o handleLogin precisa pousar via `setTela(telaInicial())` — sem isso a porta " +
      "de QA é anulada em todo acesso pelo navegador",
  );

  // E o literal não pode voltar por baixo. Antes do conserto esta asserção
  // reprovava: o pouso era escolhido por uma string fixa.
  const literais = corpo.match(/setTela\(\s*["'`]/g) ?? [];
  assert.equal(
    literais.length,
    0,
    `o handleLogin não pode escolher tela por literal (achei ${literais.length}); ` +
      "quem decide tela inicial é `telaInicial()`, o funil único do #1299",
  );
});

test("#1299 o #718 segue preservado: sem a porta, o funil devolve o Navigator", () => {
  // Não é duplicata do teste de `telaInicial()`: aqui a afirmação é sobre a
  // PROMESSA que o conserto faz ao #718 — trocar o literal pelo funil não pode
  // mudar o pouso padrão do login. O valor vem do mapa, não de uma cópia.
  const nav = semComentarios(readFileSync(NAVEGACAO, "utf8"));
  assert.match(
    nav,
    /TELA_PADRAO\s*[:=][^;\n]*"navegador"/,
    "se o TELA_PADRAO deixar de ser `navegador`, o pouso do login (#718) muda " +
      "junto — e aí é decisão de produto, não efeito colateral do #1299",
  );
});
