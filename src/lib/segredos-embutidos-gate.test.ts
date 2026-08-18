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
