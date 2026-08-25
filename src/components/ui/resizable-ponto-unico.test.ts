// #1279: o PADRÃO do splitter do app (barra transparente + `hover:bg-border` +
// margem `mx-1.5`) mora num PONTO ÚNICO — o default de `ResizableHandle` em
// `ui/resizable.tsx`. Foi por REPETIÇÃO desse padrão em cada uso que o Files
// divergiu (ficou sem o hover). Este gate reprova qualquer USO de
// `<ResizableHandle>` que traga esses tokens no `className`: eles têm de vir do
// default, não de cópia. Um uso pode passar `className` só pra ALGO A MAIS
// (ex.: `print:hidden`), nunca pra a barra/hover/margem.
//
// Estilo dos gates da casa: parse do fonte, sem montar componente. Rode com
//   node --test --experimental-strip-types src/components/ui/resizable-ponto-unico.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const SRC = fileURLToPath(new URL("../../", import.meta.url)); // .../src
const PONTO_UNICO = "components/ui/resizable.tsx";
// O trio que É o padrão do app — só pode aparecer no ponto único.
const TOKENS = ["mx-1.5", "bg-transparent", "hover:bg-border"];

function arquivosTsx(dir: string): string[] {
  const achados: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const p = join(dir, entrada);
    if (statSync(p).isDirectory()) achados.push(...arquivosTsx(p));
    else if (entrada.endsWith(".tsx")) achados.push(p);
  }
  return achados;
}

test("#1279: nenhum uso de <ResizableHandle> repete o padrão do splitter (barra/hover/margem vêm do ponto único)", () => {
  const infratores: string[] = [];
  for (const arquivo of arquivosTsx(SRC)) {
    if (arquivo.replace(/\\/g, "/").endsWith(PONTO_UNICO)) continue; // o dono do padrão
    const texto = readFileSync(arquivo, "utf8");
    // Usos são self-closing (`<ResizableHandle ... />`); pega multi-linha até o `/>`.
    for (const m of texto.matchAll(/<ResizableHandle\b[\s\S]*?\/>/g)) {
      const cls = /className\s*=\s*"([^"]*)"/.exec(m[0])?.[1] ?? "";
      const classes = cls.split(/\s+/);
      const repetidos = TOKENS.filter((t) => classes.includes(t));
      if (repetidos.length) {
        infratores.push(`${arquivo.replace(/\\/g, "/")}: [${repetidos.join(", ")}]`);
      }
    }
  }
  assert.deepEqual(
    infratores,
    [],
    "Uso de <ResizableHandle> repetindo o padrão no className — deve herdar do ponto único (ui/resizable.tsx), não copiar:\n" +
      infratores.map((i) => "  " + i).join("\n"),
  );
});

test("#1279: o ponto único (ui/resizable.tsx) É quem carrega o padrão (senão o gate acima vira decoração)", () => {
  const dono = readFileSync(join(SRC, "components/ui/resizable.tsx"), "utf8");
  for (const t of TOKENS) {
    assert.ok(
      dono.includes(t),
      `ui/resizable.tsx perdeu o token "${t}" do padrão — o default do ResizableHandle precisa dele, ou os usos ficam sem o padrão do app.`,
    );
  }
});
