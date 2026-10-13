// #1728 (Ref #912 · decisão do #466) — trava o LITERAL 256 px da sidebar do
// Bridge, não só o mecanismo.
//
// O guard do #912 (`pollux-912-bridge-split.browser.test.tsx`) compara a largura
// contra a PRÓPRIA constante `LARGURA_SIDEBAR_PX` — protege o **splitter** (o
// mecanismo), mas se alguém trocar o 256, nenhum teste quebra e a decisão de
// produto (#466: a sidebar do Bridge nasce com 256 px) fica sem trava. Este teste
// afirma o **valor**, com dono próprio — não funde com o do splitter (AC do #1728).
//
// ⚠️ Lente (como o `porta-qa-atravessa-login.test.ts`, de onde vem a receita):
// olha a FORMA do fonte. Vale porque a decisão É um literal no código; a aparência
// renderizada é a lente da QA-V. Impede a regressão barata — trocar o número sem
// querer. Tira comentários antes de medir pra não casar o literal citado num
// comentário (medir a prosa seria o oposto do que este arquivo existe pra fazer).
//
// Rode com:
//   node --test --experimental-strip-types src/components/bridge/pollux-1728-largura-sidebar.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const BRIDGE_SPLIT = join(AQUI, "bridge-split.tsx");

/**
 * Remove comentários preservando o resto, varrendo caractere a caractere para não
 * tomar `//` dentro de string por início de comentário. Mesma forma do
 * `porta-qa-atravessa-login.test.ts` — o comentário que EXPLICA uma mudança do
 * literal precisa poder citá-lo sem que o teste o confunda com código vivo.
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

test("#1728 a sidebar do Bridge nasce com o LITERAL 256 px (decisão do #466)", () => {
  const fonte = semComentarios(readFileSync(BRIDGE_SPLIT, "utf8"));
  assert.match(
    fonte,
    /LARGURA_SIDEBAR_PX\s*=\s*256\b/,
    "`LARGURA_SIDEBAR_PX` deixou de ser 256 px. Isto é a decisão de produto do " +
      "#466 (a sidebar do Bridge nasce com 256 px) — mudá-la tem de ser DELIBERADO, " +
      "não efeito colateral. Se a mudança é intencional, atualize este literal E " +
      "registe no #466. O guard do splitter (#912) continua a proteger o MECANISMO; " +
      "este protege o VALOR — dois donos, sem fundir.",
  );
});
