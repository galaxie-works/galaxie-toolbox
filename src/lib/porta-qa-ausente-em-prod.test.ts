// #1299 — AC de SEGURANÇA: a porta `?tela=<id>` NÃO pode existir em produção.
//
// Este gate não olha a FORMA do código-fonte (código-fonte mente: alguém pode
// mudar o `import.meta.env.DEV` e o teste de forma continuar verde). Ele olha o
// ARTEFATO: varre o `dist/` recém-buildado atrás da sentinela que só existe
// dentro do bloco de dev. Se ela aparecer, a porta vazou pro usuário — e o #663
// (produto oculto) foi furado por uma conveniência de QA.
//
// Rode com:  node --test --experimental-strip-types src/lib/porta-qa-ausente-em-prod.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SENTINELA = "[porta-qa-1299]";
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIST = join(RAIZ, "dist");

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    return statSync(caminho).isDirectory() ? arquivos(caminho) : [caminho];
  });
}

test("#1299 a porta de QA não está no bundle de produção", (t) => {
  if (!existsSync(DIST)) {
    // O gate roda `vite build` antes de `node --test`; fora dessa ordem não há
    // artefato pra inspecionar e o teste não tem o que afirmar.
    t.skip("dist/ ausente — rode `vite build` antes (é a ordem do gate)");
    return;
  }
  const texto = arquivos(DIST).filter((f) => /\.(js|mjs|cjs|html|css)$/.test(f));
  assert.ok(texto.length > 0, "dist/ existe mas não tem asset de texto — build suspeito");

  const vazados = texto.filter((f) => readFileSync(f, "utf8").includes(SENTINELA));
  assert.deepEqual(
    vazados.map((f) => f.slice(RAIZ.length + 1)),
    [],
    `a sentinela ${SENTINELA} vazou pro bundle de produção: a porta ?tela= existe em prod`
  );
});
