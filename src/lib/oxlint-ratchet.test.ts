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
// `api.ts`. O oxlint apontou; ninguém reprovou; **foi shipado**. Removido junto
// de outros 7 imports mortos na mesma fatia.
//
// ── Por que ratchet e não `--deny-warnings` ────────────────────────────────
// Ligar o deny de uma vez reprovaria o CI no dia seguinte por 164 achados
// herdados — o gate viraria ruído a ser ignorado, que é exatamente a doença que
// o card descreve. A baseline congela o conhecido e **só encolhe**.
//
// ── Escopo: só o NOSSO código ──────────────────────────────────────────────
// `reui/`, `ui/` e `animate-ui/` são vendorizados (o próprio `.oxlintrc.json`
// já os trata à parte). Contá-los faria a baseline oscilar a cada atualização
// de vendor, por coisa que não escrevemos. Todos os 8
// `oxc(const-comparisons)` do repo, por exemplo, estão em vendor.
//
// ── #1262: por que `--format=json`, e o que aprendi ────────────────────────
// A primeira versão lia a **saída humana** do oxlint com regex
// (`^arquivo:linha:col: warning regra(...)`). Funcionava local (Windows) e
// **capturou ZERO no runner do CI** — com o log do Actions mostrando
// `Found 156 warnings and 0 errors.` no mesmo run. O oxlint rodou; o meu parse
// é que não viu.
//
// Isso reprovou o `gate-front`, **bloqueou o corte da v0.45.0** e avermelhou o
// `feat`. Foi P0, e foi meu: eu tinha validado o gate local e tratado "passa
// aqui" como "passa lá".
//
// Não fui atrás da causa exata da divergência de ambiente (cor/ANSI, layout do
// `node_modules` do pnpm, plataforma) porque **a lição não é qual delas era** —
// é que **scrape de saída legível por humano é contrato instável**. O
// `--format=json` é saída de máquina, versionada pela ferramenta: some a classe
// inteira de falha, em vez de eu adivinhar qual variante me pegou.
//
// Confirmado em `2345643` (18/08): o JSON devolve os MESMOS números da baseline
// (15 + 1), então a troca é de robustez, não de comportamento.
//
// A outra correção é no diagnóstico: a guarda antiga dizia "o spawn/parse
// quebrou" **sem mostrar nada**. Custou um ciclo inteiro de CI para descobrir o
// óbvio. Agora ela **imprime a saída crua** — guarda que detecta problema e
// esconde a causa é meio caminho.

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
 * ligado. Despachado pra `Vega` no #1037; sai daqui quando ligar ou remover.
 */
const BASELINE: Record<string, number> = {
  "react(only-export-components)": 15,
  "eslint(no-unused-vars)": 1,
};

interface DiagnosticoOxlint {
  code: string;
  severity: string;
  filename: string;
}

/** Saída crua do oxlint — guardada para a mensagem de erro poder mostrá-la. */
function rodarOxlint(): string {
  // O shim JS (`node_modules/oxlint/bin/oxlint`) via `process.execPath` é
  // portátil: o `.CMD` do Windows não spawna por `execFileSync`.
  try {
    return execFileSync(
      process.execPath,
      ["node_modules/oxlint/bin/oxlint", "src", "--format=json"],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (e) {
    // oxlint sai != 0 quando há achado de severidade `error`; a saída é o que
    // interessa nos dois casos.
    const err = e as { stdout?: string; stderr?: string };
    return (err.stdout ?? "") + (err.stderr ?? "");
  }
}

function warningsDoNossoCodigo(saida: string): Map<string, number> {
  let diagnostics: DiagnosticoOxlint[];
  try {
    diagnostics = (JSON.parse(saida) as { diagnostics?: DiagnosticoOxlint[] })
      .diagnostics ?? [];
  } catch {
    // Não devolve mapa vazio em silêncio: vazio-por-erro e vazio-de-verdade
    // são coisas diferentes, e confundi-los foi o #1262.
    throw new Error(
      `o oxlint não devolveu JSON válido. Saída crua (${saida.length} bytes):\n${saida.slice(0, 2000)}`,
    );
  }

  const porRegra = new Map<string, number>();
  for (const d of diagnostics) {
    if (d.severity !== "warning") continue;
    const arquivo = (d.filename ?? "").replace(/\\/g, "/");
    if (VENDOR.some((v) => arquivo.includes(v))) continue;
    porRegra.set(d.code, (porRegra.get(d.code) ?? 0) + 1);
  }
  return porRegra;
}

test("#1056 (TST-11): warning de lint no nosso código não cresce — e a baseline não fica frouxa", () => {
  const saida = rodarOxlint();
  const atual = warningsDoNossoCodigo(saida);

  // Sanidade: se o spawn falhar, `atual` vem vazio e o ratchet passaria para
  // sempre. Gate que não vê nada é pior que gate nenhum — foi assim que o
  // `icon: true` (#1153) ficou verde por meses.
  //
  // #1262: a mensagem agora carrega a EVIDÊNCIA. Sem ela, este mesmo assert
  // disparou no CI dizendo só "o spawn/parse quebrou" e custou um ciclo até
  // alguém rodar o oxlint à mão para descobrir que ele tinha achado 156.
  const totalAtual = [...atual.values()].reduce((a, b) => a + b, 0);
  const totalBaseline = Object.values(BASELINE).reduce((a, b) => a + b, 0);
  assert.ok(
    totalAtual > 0 || totalBaseline === 0,
    `o oxlint não devolveu nenhum warning do nosso código — o spawn/parse quebrou, não o código.\n` +
      `bytes de saída: ${saida.length}\n` +
      `saída crua (2000 primeiros):\n${saida.slice(0, 2000)}`,
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
