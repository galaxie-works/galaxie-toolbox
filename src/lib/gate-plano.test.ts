import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

// #1326 — testes do PLANO do `pnpm gate`.
//
// O que pode dar errado neste script não é rodar `tsc` (isso ou roda ou não).
// É **decidir o que roda**: pular Rust numa fatia que mexeu em `src-tauri`, ou
// esquecer o `clippy` num crate gateado, reproduz exatamente os defeitos que o
// card existe para fechar (a auditoria §3.A.1 e a #1330).
//
// Por isso o script tem `-Explicar`: imprime o plano e sai, sem rodar nada.
// Estes testes são rápidos e batem na lógica de decisão.

function plano(args: string[]): string[] {
  const r = spawnSync(
    "pwsh",
    ["-NoProfile", "-File", "scripts/gate.ps1", "-Explicar", ...args],
    { encoding: "utf8" },
  );
  assert.notEqual(
    (r.error as NodeJS.ErrnoException | undefined)?.code,
    "ENOENT",
    "pwsh não encontrado: o gate é PowerShell 7 (Windows), e este teste precisa dele",
  );
  assert.equal(r.status, 0, `-Explicar deveria sair 0; stderr=${r.stderr}`);
  return (r.stdout ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
}

const FRONT = ["tsc", "vite build", "lint", "test", "test:component", "test:browser"];

test("#1326: fatia só de front roda os 6 canais de front e nenhum de Rust", () => {
  const p = plano(["-Arquivos", "src/App.tsx"]);
  assert.deepEqual(p, FRONT);
  assert.ok(!p.some((c) => c.startsWith("cargo") || c.startsWith("clippy")));
});

test("#1326: o gate de front espelha o CI — inclui `lint`, que o card não listou", () => {
  // `pnpm lint` é passo do job `frontend / gate`. Sem ele o espelho MENTIRIA:
  // passaria local e reprovaria no PR.
  assert.ok(plano(["-Arquivos", "src/App.tsx"]).includes("lint"));
});

test("#1326: fatia que toca src-tauri puxa cargo check + test", () => {
  const p = plano(["-Arquivos", "src-tauri/src/fs_explorer.rs"]);
  assert.ok(p.includes("cargo check"), "check tem de entrar");
  assert.ok(p.includes("cargo test"), "test tem de entrar");
  assert.ok(
    !p.includes("cargo check --features remote"),
    "fatia fora de remote* não paga o build do OpenSSL vendored",
  );
});

test("#1326: fatia que toca src-tauri/src/remote* puxa também os canais --features remote", () => {
  const p = plano(["-Arquivos", "src-tauri/src/remote_identity.rs"]);
  assert.ok(p.includes("cargo check --features remote"));
  assert.ok(p.includes("cargo test --features remote"));
});

test("#1326: crate de services puxa o teste DELE e, se for gateado, o clippy", () => {
  const p = plano(["-Arquivos", "services/remote-signaling/src/lib.rs"]);
  assert.ok(p.includes("cargo test (remote-signaling)"));
  assert.ok(
    p.includes("clippy (remote-signaling)"),
    "clippy é CHECK OBRIGATÓRIO na pre-prod — foi a sua ausência no gate local que travou a release na #1330",
  );
  assert.ok(
    !p.includes("cargo test (remote-capture)"),
    "só o crate tocado, não a bateria inteira",
  );
});

test("#1326: crate de services fora do gate de clippy não ganha clippy", () => {
  // `remote-capture` roda `cargo test` no CI, mas NÃO está no job de clippy.
  // O espelho não pode ser mais duro que o CI — senão ninguém usa.
  const p = plano(["-Arquivos", "services/remote-capture/src/lib.rs"]);
  assert.ok(p.includes("cargo test (remote-capture)"));
  assert.ok(!p.some((c) => c.startsWith("clippy")));
});

test("#1326: -SkipRust tira só o Rust; -SkipBrowser tira só o browser", () => {
  const semRust = plano(["-Arquivos", "src-tauri/src/lib.rs", "-SkipRust"]);
  assert.deepEqual(semRust, FRONT);

  const semBrowser = plano(["-Arquivos", "src/App.tsx", "-SkipBrowser"]);
  assert.ok(!semBrowser.includes("test:browser"));
  assert.ok(semBrowser.includes("test:component"), "component NÃO é o browser");
});

test("#1326: -Only reduz a um canal", () => {
  assert.deepEqual(
    plano(["-Arquivos", "src/App.tsx", "-Only", "test:component"]),
    ["test:component"],
  );
});

test("#1326: sem NENHUM arquivo encontrado, assume Rust (errar pro lado de rodar)", () => {
  // Este ramo só dispara em worktree LIMPA com base inalcançável. A primeira
  // versão deste teste dependia da árvore estar suja: passou local e REPROVOU
  // no CI, que faz checkout limpo. Agora o script expõe `-SemArquivos` só para
  // forçar o ramo — o teste não depende mais do ambiente.
  const p = plano(["-SemArquivos"]);
  assert.ok(
    p.includes("cargo check"),
    "na dúvida roda: pular canal em silêncio é o defeito que este card fecha",
  );
});

test("#1326: com arquivos conhecidos, NÃO cai no fallback", () => {
  const p = plano(["-Arquivos", "src/App.tsx"]);
  assert.ok(!p.some((c) => c.startsWith("cargo")), "o fallback não pode vazar");
});
