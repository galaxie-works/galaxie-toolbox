import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// #1056 (TST-05) — o gate do front tem UMA definição, e os dois caminhos a usam.
//
// O buraco original: o `ci.yml` rodava lint + os 3 canais; o `release.yml`
// rodava só `pnpm test` antes do `tauri build`. Um PR que reprovasse em
// `test:component`/`test:browser` não integrava, mas uma tag que reprovaria nos
// mesmos testes ERA PUBLICADA — foi por aí que a v0.44.0 saiu.
//
// A correção não foi copiar os steps (duas listas voltam a divergir), e sim
// extrair para `gate-front.yml` (`workflow_call`). Esta guarda existe porque a
// estrutura é fácil de desfazer sem querer: basta alguém "consertar" um dos
// caminhos re-inlinando os steps, e a assimetria volta em silêncio.

const DEFINICAO = ".github/workflows/gate-front.yml";
const CHAMADORES = [".github/workflows/ci.yml", ".github/workflows/release.yml"];

test("#1056: CI e release chamam a MESMA definição do gate do front", () => {
  const gate = readFileSync(DEFINICAO, "utf8");
  assert.match(
    gate,
    /on:\s*\n\s*workflow_call:/,
    `${DEFINICAO} precisa ser reutilizável (\`on: workflow_call\`) — sem isso ninguém pode chamá-lo`,
  );

  const faltando = CHAMADORES.filter(
    (arq) => !readFileSync(arq, "utf8").includes("uses: ./.github/workflows/gate-front.yml"),
  );
  assert.deepEqual(
    faltando,
    [],
    "caminho que deixou de chamar a definição única: o gate dele passa a poder divergir do outro em silêncio",
  );
});

test("#1056: o release não volta a rodar o gate por conta própria", () => {
  const release = readFileSync(".github/workflows/release.yml", "utf8");

  // Re-inlinar os canais no release é o jeito de a duplicação voltar.
  const reinlinados = ["pnpm test:component", "pnpm test:browser", "pnpm lint"].filter((cmd) =>
    release.includes(`run: ${cmd}`),
  );
  assert.deepEqual(
    reinlinados,
    [],
    "o release voltou a declarar o gate localmente — use o `gate-front.yml`, senão as duas listas divergem de novo",
  );

  // E o job que builda tem que ESPERAR o gate; sem `needs`, os dois rodam em
  // paralelo e a tag pode publicar antes do gate reprovar.
  assert.match(
    release,
    /needs:\s*gate-front/,
    "o job de build precisa de `needs: gate-front` — sem isso o gate roda junto do build, não antes",
  );
});
