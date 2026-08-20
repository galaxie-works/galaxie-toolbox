import assert from "node:assert/strict";
import { readFileSync, globSync } from "node:fs";
import test from "node:test";

// #1055 (SEC9) — gate: todo valor embutido em compile-time está INVENTARIADO.
//
// `option_env!` embute o valor como string literal no binário distribuído — não
// é ofuscação, sai extraível de qualquer cópia. O runbook
// `docs/reference/rotacao-segredos.md` documenta o que é público-na-prática, por
// que é aceitável, e como rotacionar.
//
// ── Por que gatear o runbook ────────────────────────────────────────────────
// Um runbook de segredos só vale ENQUANTO ESTIVER COMPLETO. Um `option_env!`
// novo entra num PR qualquer e nada obriga a atualizar o doc — e aí a próxima
// pessoa a auditar lê uma lista que não corresponde ao binário. O modo de falha
// é o mesmo de sempre nesta casa: **o documento afirma; ninguém confere**.
//
// Foi exatamente o que a varredura achou (`68e6dfb`, 18/08): o runbook cobria os
// DOIS valores que o card #1055 nomeia, e o repo tinha OITO, em quatro arquivos.
// Os outros seis não eram segredo — mas "não está listado" é como um segredo
// novo entra sem ninguém notar.
//
// Este gate não julga se o valor É segredo. Ele exige que EXISTA uma decisão
// registrada sobre cada um. Classificar é trabalho humano; lembrar de
// classificar é trabalho de máquina.

const FONTES = ["src-tauri/**/*.rs", "services/**/*.rs", "*.rs"];
const RUNBOOK = "docs/reference/rotacao-segredos.md";

/** `option_env!("NOME")` — o macro que embute valor no binário. */
const EMBUTIDO = /option_env!\s*\(\s*"([A-Z0-9_]+)"\s*\)/g;

function nomesEmbutidos(): Map<string, string[]> {
  const achados = new Map<string, string[]>();
  for (const padrao of FONTES) {
    for (const arq of globSync(padrao, { exclude: (p) => p.includes("target") })) {
      const src = readFileSync(arq, "utf8");
      for (const m of src.matchAll(EMBUTIDO)) {
        const nome = m[1];
        const onde = achados.get(nome) ?? [];
        if (!onde.includes(arq)) onde.push(arq);
        achados.set(nome, onde);
      }
    }
  }
  return achados;
}

test("#1055: todo `option_env!` do repo está no inventário do runbook", () => {
  const achados = nomesEmbutidos();

  // Sanidade: se o regex/glob quebrar, o gate passa a não ver nada — e um gate
  // que não vê nada passa para sempre. Foi assim que o `icon: true` (#1153)
  // ficou verde por meses.
  assert.ok(
    achados.size >= 5,
    `o scanner achou só ${achados.size} valores embutidos — o glob/regex quebrou, não o código`,
  );

  const runbook = readFileSync(RUNBOOK, "utf8");
  const ausentes = [...achados.entries()]
    .filter(([nome]) => !runbook.includes(nome))
    .map(([nome, onde]) => `${nome} (${onde.join(", ")})`);

  assert.deepEqual(
    ausentes,
    [],
    `valor embutido no binário sem entrada em ${RUNBOOK}. ` +
      "`option_env!` vira string literal extraível de todo executável distribuído: " +
      "classifique (credencial / config / público-na-prática / pin) e diga como se rotaciona.",
  );
});

test("#1055: o runbook não lista valor que já saiu do código", () => {
  const achados = new Set(nomesEmbutidos().keys());
  const runbook = readFileSync(RUNBOOK, "utf8");

  // Só cobra os nomes da convenção do projeto — evita reclamar de exemplo
  // genérico escrito em prosa.
  const citados = new Set(
    [...runbook.matchAll(/`(GALAXIE_[A-Z0-9_]+|GOOGLE_CLIENT_SECRET)`/g)].map((m) => m[1]),
  );

  const orfaos = [...citados].filter((n) => !achados.has(n));
  assert.deepEqual(
    orfaos,
    [],
    "o runbook documenta rotação de valor que o código não embute mais — " +
      "inventário que descreve o passado dá falsa sensação de cobertura",
  );
});

// ── #1055 (DoD 3): a rotação deixa de ser só documentada e passa a ser TESTÁVEL ─
//
// O runbook manda "rotacione o secret X no GitHub". Isso só funciona enquanto a
// CORRENTE estiver inteira: o código lê `option_env!("X")`, e o `release.yml`
// precisa injetar `X` a partir do secret `X`.
//
// Dois elos arrebentam calados:
//
// 1. **A injeção some** (alguém limpa o workflow). `option_env!` vira `None`, a
//    telemetria cai fail-closed e o build passa verde — sem credencial e sem
//    aviso. O operador só descobre quando for procurar dado que nunca chegou.
//
// 2. **Os nomes divergem** (`X: ${{ secrets.X_ANTIGO }}`). Aí é pior: rotacionar
//    `X` no GitHub não muda NADA no binário, e o token velho — o que se queria
//    justamente revogar — continua embarcando em todo release. A rotação
//    *parece* ter acontecido.
//
// O elo 2 é o que transforma um incidente de segurança em incidente longo: a
// pessoa acredita ter revogado. Por isso o gate confere o nome dos DOIS lados.

const WORKFLOW = ".github/workflows/release.yml";

/**
 * Valores embutidos que o `release.yml` legitimamente NÃO injeta — cada um com
 * o motivo que o runbook registra. O default é o contrário (tem de injetar):
 * `option_env!` novo entra cobrado, e quem souber que é exceção declara aqui.
 */
const FORA_DO_RELEASE: Record<string, string> = {
  GALAXIE_BUILD_SHA: "sai do build do signaling (Docker), não do instalador — #1311",
  GALAXIE_REMOTE_SIGNALING_URL: "config de host, não credencial; só muda se o host mudar",
  GALAXIE_SIGN_PIN_ISSUER: "pin de publisher: fica vazio até o cert EV existir (S7/F5)",
  GALAXIE_SIGN_PIN_SUBJECT_O: "pin de publisher: idem",
};

/** `NOME: ${{ secrets.ORIGEM }}` / `${{ vars.ORIGEM }}` → NOME ⇒ ORIGEM. */
function injecoesDoRelease(): Map<string, string> {
  const yml = readFileSync(WORKFLOW, "utf8");
  const re = /^\s*([A-Z0-9_]+):\s*\$\{\{\s*(?:secrets|vars)\.([A-Z0-9_]+)\s*\}\}/gm;
  return new Map([...yml.matchAll(re)].map((m): [string, string] => [m[1], m[2]]));
}

test("#1055: todo valor embutido que o release deve injetar está no workflow", () => {
  const injetados = injecoesDoRelease();

  // Sanidade: gate que não enxerga nada passa para sempre (lição do `icon: true`).
  assert.ok(
    injetados.size >= 5,
    `o parser achou só ${injetados.size} injeções em ${WORKFLOW} — o regex quebrou, não o workflow`,
  );

  const ausentes = [...nomesEmbutidos().keys()]
    .filter((n) => !(n in FORA_DO_RELEASE))
    .filter((n) => !injetados.has(n));

  assert.deepEqual(
    ausentes,
    [],
    `valor lido por \`option_env!\` que ${WORKFLOW} não injeta. No binário entregue ` +
      "isso vira `None` em silêncio: a telemetria cai fail-closed e o release passa " +
      "verde sem credencial. Se a ausência for proposital, declare em FORA_DO_RELEASE " +
      "com o motivo.",
  );
});

test("#1055: rotacionar o secret alcança o build (nomes não divergem)", () => {
  // Só os valores que o código EMBUTE. Um `GH_TOKEN: ${{ secrets.RELEASES_TOKEN }}`
  // diverge de propósito — `GH_TOKEN` é o nome que o `gh` exige, e nada disso
  // entra no binário. A corrente que importa aqui é a do `option_env!`.
  const embutidos = nomesEmbutidos();
  const divergentes = [...injecoesDoRelease().entries()]
    .filter(([env]) => embutidos.has(env) && !(env in FORA_DO_RELEASE))
    .filter(([env, origem]) => env !== origem)
    .map(([env, origem]) => `${env} lê secrets/vars.${origem}`);

  assert.deepEqual(
    divergentes,
    [],
    "a variável embutida e o secret que a alimenta têm nomes diferentes: rotacionar " +
      "o secret que o runbook nomeia NÃO troca o valor que vai no binário, e o token " +
      "que se queria revogar continua embarcando. Rotação que parece ter acontecido " +
      "é pior que rotação não feita.",
  );
});
