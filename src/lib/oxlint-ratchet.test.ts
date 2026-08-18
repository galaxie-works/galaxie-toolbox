import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

// #1056 (TST-11) — ratchet dos warnings do oxlint no NOSSO código.
//
// ── O que o card dizia, e o que realmente é ─────────────────────────────────
// O #1056 afirma que o `.oxlintrc.json` "não tem nenhuma regra de variável/
// import não usado". **Testei: é falso.** `no-unused-vars` vem no conjunto
// default do oxlint e dispara sem estar listada.
//
// O defeito real é o NÍVEL: sai como `warning`, e `pnpm lint` é `oxlint` puro,
// **sem `--deny-warnings`**. O CI nunca reprovou por lint. Medido em `56ddc51`
// (18/08): **164 warnings**, zero gateando.
//
// Não é "falta regra" — é **"o gate não morde"**.
//
// ── A prova de que isso custa ──────────────────────────────────────────────
// A F2 do #1075 (minha) trocou `crTarefas(): Promise<Tarefa[]>` por
// `Promise<TarefasResultado>` e deixou o `import type { Tarefa }` morto no
// `api.ts`. O oxlint apontou; ninguém reprovou; **foi shipado**. Removido nesta
// mesma fatia, junto de outros 7 imports mortos.
//
// ── Por que ratchet e não `--deny-warnings` ────────────────────────────────
// Ligar o deny de uma vez reprovaria o CI no dia seguinte por 164 achados
// herdados — o gate viraria ruído a ser ignorado, que é exatamente a doença que
// o card descreve. A baseline congela o conhecido e **só encolhe**.
//
// ── Escopo: só o NOSSO código ──────────────────────────────────────────────
// `reui/`, `ui/` e `animate-ui/` são vendorizados (o próprio `.oxlintrc.json`
// já os trata à parte). Contá-los faria a baseline oscilar a cada atualização
// de vendor, por coisa que não escrevemos — o gate perderia sentido. Todos os 8
// `oxc(const-comparisons)` do repo, por exemplo, estão em vendor.

const VENDOR = [
  "src/components/reui/",
  "src/components/ui/",
  "src/components/animate-ui/",
];

/**
 * Warnings herdados no NOSSO código, por regra. **A lista só encolhe.**
 *
 * `react(only-export-components)` é advertência de Fast Refresh em arquivos que
 * exportam um Provider e o hook dele juntos — padrão legítimo de contexto, não
 * defeito. Fica congelado; se alguém dividir os arquivos, o número cai.
 *
 * `eslint(no-unused-vars)` está em **1**, e o que sobra é um achado de verdade,
 * não ruído: `navegador.tsx:1185` recebe a prop `onAlternarModoPrivado` e
 * **nunca a chama**, enquanto o `App.tsx:1402` passa um handler real
 * (`setModoPrivado((v) => !v)`). É **fio morto** — o chamador acha que está
 * ligado. Não removi porque decidir se o Navigator deve poder alternar o modo
 * privado é produto, não lint.
 */
const BASELINE: Record<string, number> = {
  "react(only-export-components)": 15,
  "eslint(no-unused-vars)": 1,
};

/** Roda o oxlint pelo shim JS — portátil (o `.CMD` do Windows não spawna). */
function warningsDoNossoCodigo(): Map<string, number> {
  let saida = "";
  try {
    saida = execFileSync(
      process.execPath,
      ["node_modules/oxlint/bin/oxlint", "src"],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (e) {
    // oxlint sai != 0 quando há achados; a saída é o que interessa.
    const err = e as { stdout?: string; stderr?: string };
    saida = (err.stdout ?? "") + (err.stderr ?? "");
  }

  const porRegra = new Map<string, number>();
  for (const linha of saida.split("\n")) {
    const m = /^(\S+?):\d+:\d+: warning ([a-z-]+\([a-z/-]+\))/.exec(linha.trim());
    if (!m) continue;
    const arquivo = m[1].replace(/\\/g, "/");
    if (VENDOR.some((v) => arquivo.includes(v))) continue;
    porRegra.set(m[2], (porRegra.get(m[2]) ?? 0) + 1);
  }
  return porRegra;
}

test("#1056 (TST-11): warning de lint no nosso código não cresce — e a baseline não fica frouxa", () => {
  const atual = warningsDoNossoCodigo();

  // Sanidade: se o spawn falhar, `atual` vem vazio e o ratchet passaria para
  // sempre. Gate que não vê nada é pior que gate nenhum — foi assim que o
  // `icon: true` (#1153) ficou verde por meses.
  const totalAtual = [...atual.values()].reduce((a, b) => a + b, 0);
  const totalBaseline = Object.values(BASELINE).reduce((a, b) => a + b, 0);
  assert.ok(
    totalAtual > 0 || totalBaseline === 0,
    "o oxlint não devolveu nenhum warning — o spawn/parse quebrou, não o código",
  );

  const regras = new Set([...atual.keys(), ...Object.keys(BASELINE)]);
  const problemas: string[] = [];

  // As DUAS direções num assert só: separados, o primeiro a falhar mascara o
  // segundo (lição da F1 do #1074).
  for (const regra of [...regras].sort()) {
    const teto = BASELINE[regra] ?? 0;
    const agora = atual.get(regra) ?? 0;
    if (agora > teto) {
      problemas.push(
        `${regra}: ${agora} > ${teto} — warning NOVO. Corrija, ou justifique subindo a baseline no PR.`,
      );
    } else if (agora < teto) {
      problemas.push(
        `${regra}: ${agora} < ${teto} — dívida paga; BAIXE a baseline para ${agora}, senão ela guarda folga e para de barrar.`,
      );
    }
  }

  assert.deepEqual(
    problemas,
    [],
    "`pnpm lint` não usa `--deny-warnings`: sem este ratchet, warning de lint não reprova nada",
  );
});
