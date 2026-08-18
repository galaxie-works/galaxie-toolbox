import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

// #1193 (escopo) — todo crate de `services/` está DECIDIDO quanto ao clippy:
// ou entra no gate `-D warnings` do CI, ou consta na lista de fora COM motivo.
//
// ── O buraco que este gate fecha ────────────────────────────────────────────
// O #1193 criou o gate de clippy com escopo CRESCENTE e deliberado — decisão
// certa (um hard-fail global no `src-tauri`, 9,6k linhas, seria revertido em uma
// hora). Mas o escopo mora numa lista de steps do `ci.yml`, e **um crate novo
// nasce fora dela sem nada acusar**.
//
// Aconteceu hoje: o `remote-capabilities` foi criado no #1240, entrou no CI de
// TESTE (3 sítios) e ficou de fora do de CLIPPY. Ninguém errou — não havia como
// notar.
//
// Medido em `3e2c361` (18/08), com `-D warnings`, default features:
//
//   remote-signaling      gateado
//   remote-transport      gateado
//   remote-capabilities   0 achados  ← estava FORA
//   remote-broker-client  0 achados  ← estava FORA
//   remote-capture        0 achados  ← estava FORA
//   remote-net            3 achados  ← fica fora, com dívida declarada
//   remote-system-agent  16 achados  ← idem (o `Confucius` declarou 14 no #1070;
//                                       medi 16 em `--all-targets`)
//
// Três crates estavam limpos e fora do gate — entraram nesta mesma fatia, de
// graça. Os dois com dívida ficam fora **por escrito**, que é a diferença entre
// "decidido" e "esquecido".
//
// `remote-system-helper` NÃO é crate Rust: não tem `Cargo.toml` (é helper
// Delphi/PowerShell). Por isso o scanner exige `Cargo.toml` em vez de listar
// diretórios — e por isso ele não aparece aqui.

const CI = ".github/workflows/ci.yml";
const SERVICES = "services";

/**
 * Crates deliberadamente FORA do gate, com o motivo.
 *
 * Sair daqui = entrar no `ci.yml`. A lista só encolhe.
 */
const FORA_DO_GATE: Record<string, string> = {
  "remote-net":
    "3 achados sob `-D warnings` (medido em 3e2c361). Entra quando zerar — um crate por vez, como o #1193 desenhou.",
  "remote-system-agent":
    "16 achados sob `-D warnings` (medido em 3e2c361; o #1070 declarou 14 sem `--all-targets`). Entra quando zerar.",
};

/** Crates que o job de clippy roda hoje, lidos do próprio `ci.yml`. */
function cratesGateados(): Set<string> {
  const ci = readFileSync(CI, "utf8");
  const gateados = new Set<string>();
  // Casa o par `working-directory: services/<crate>` + `cargo clippy ... -D warnings`
  // dentro do mesmo step; ler o YAML como texto basta e evita dependência nova.
  const re =
    /working-directory:\s*services\/([\w-]+)\s*\n\s*run:\s*cargo clippy[^\n]*-D warnings/g;
  for (const m of ci.matchAll(re)) gateados.add(m[1]);
  return gateados;
}

/** Diretórios de `services/` que são crate Rust de verdade. */
function cratesReais(): string[] {
  return readdirSync(SERVICES, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((nome) => existsSync(`${SERVICES}/${nome}/Cargo.toml`))
    .sort();
}

test("#1193: todo crate de services/ está decidido quanto ao clippy", () => {
  const crates = cratesReais();
  const gateados = cratesGateados();

  // Sanidade dupla: se o glob ou o parser do YAML quebrar, o gate passa a não
  // ver nada — e gate que não vê nada passa para sempre.
  assert.ok(crates.length >= 5, `só ${crates.length} crates achados — o scanner quebrou`);
  assert.ok(
    gateados.size >= 2,
    `só ${gateados.size} crates gateados lidos do ci.yml — o parser do YAML quebrou, não o CI`,
  );

  const problemas: string[] = [];

  for (const crate of crates) {
    const dentro = gateados.has(crate);
    const justificado = crate in FORA_DO_GATE;
    if (!dentro && !justificado) {
      problemas.push(
        `${crate}: fora do gate de clippy e sem motivo. Some um step no ${CI} ou uma entrada em FORA_DO_GATE.`,
      );
    }
    if (dentro && justificado) {
      problemas.push(
        `${crate}: está gateado E na lista de fora — tire de FORA_DO_GATE, senão a lista mente.`,
      );
    }
  }

  // Entrada que aponta para crate inexistente: a lista descreveria o passado.
  for (const crate of Object.keys(FORA_DO_GATE)) {
    if (!crates.includes(crate)) {
      problemas.push(`${crate}: está em FORA_DO_GATE mas não existe em ${SERVICES}/ — remova.`);
    }
  }

  assert.deepEqual(
    problemas,
    [],
    "o escopo do clippy vive numa lista de steps do CI; sem esta guarda, crate novo nasce fora dela em silêncio (foi o que aconteceu com o remote-capabilities no #1240)",
  );
});

test("#1193: toda entrada de FORA_DO_GATE traz motivo utilizável", () => {
  const semMotivo = Object.entries(FORA_DO_GATE)
    .filter(([, motivo]) => motivo.trim().length < 20)
    .map(([crate]) => crate);
  assert.deepEqual(
    semMotivo,
    [],
    "sem motivo, a exceção vira permanente — o motivo é o que permite alguém removê-la depois",
  );
});
