import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// #1270 — dry-run do step de notas do `release.yml`.
//
// O defeito: `release.yml` gravava `notes = "GALAXIE <tag>"` no `latest.json`, e
// o corpo da release no repo de distribuição era um texto fixo. Toda release
// nascia sem changelog; o Deploy Manager corrigia o feed na mão (v0.45.1).
//
// O que estes testes protegem NÃO é o caminho feliz — é o de FALHA. Um default
// silencioso foi exatamente o que deixou o placeholder chegar em produção; se o
// job voltar a "seguir em frente" sem notas, o bug volta inteiro e invisível.

const SCRIPT = "scripts/notas-release.ps1";

function rodar(tag: string, raiz: string) {
  const r = spawnSync(
    "pwsh",
    ["-NoProfile", "-NonInteractive", "-File", SCRIPT, "-Tag", tag, "-Raiz", raiz],
    { encoding: "utf8" },
  );
  // pwsh ausente seria um falso VERDE — a suíte passaria sem exercitar nada.
  // Runners do GitHub (ubuntu e windows) têm PowerShell 7 pré-instalado.
  assert.notEqual(
    (r.error as NodeJS.ErrnoException | undefined)?.code,
    "ENOENT",
    "pwsh não encontrado: este teste precisa de PowerShell 7 para dry-run do step de release",
  );
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function raizComNotas(tag: string, conteudo: string): string {
  const raiz = mkdtempSync(join(tmpdir(), "notas-release-"));
  mkdirSync(join(raiz, "docs", "releases"), { recursive: true });
  writeFileSync(join(raiz, "docs", "releases", `${tag}.md`), conteudo, "utf8");
  return raiz;
}

test("#1270: notas presentes → o step devolve o changelog e passa", () => {
  const corpo = "## v1.2.3\n\n- Bridge abre anexo .msg\n- Correção do login em etapas";
  const { status, stdout } = rodar("v1.2.3", raizComNotas("v1.2.3", corpo));
  assert.equal(status, 0);
  assert.match(stdout, /Bridge abre anexo \.msg/);
  assert.match(stdout, /login em etapas/);
});

test("#1270: notas AUSENTES → o job falha, e falha legível", () => {
  const raiz = mkdtempSync(join(tmpdir(), "notas-release-vazio-"));
  const { status, stderr } = rodar("v1.2.3", raiz);

  assert.notEqual(status, 0, "sem notas o release TEM de falhar — placeholder foi o bug");
  // Legibilidade não é enfeite: quem lê isto está no meio de um corte.
  assert.match(stderr, /docs\/releases\/v1\.2\.3\.md/, "a mensagem tem de dizer QUAL arquivo falta");
  assert.match(stderr, /Como resolver/, "a mensagem tem de dizer o que fazer");
  assert.ok(stderr.split("\n").length > 3, "erro de uma linha não orienta ninguém");
});

test("#1270: notas VAZIAS falham como se não existissem", () => {
  const { status, stderr } = rodar("v1.2.3", raizComNotas("v1.2.3", "   \n\n  "));
  assert.notEqual(status, 0, "arquivo vazio publica release muda igual ao placeholder");
  assert.match(stderr, /VAZIAS/);
});

test("#1270: tag fora de vX.Y.Z falha antes de procurar arquivo", () => {
  const { status, stderr } = rodar("nao-e-tag", raizComNotas("v1.2.3", "x"));
  assert.notEqual(status, 0);
  assert.match(stderr, /Tag invalida/);
});

/**
 * Zera linhas de comentário (YAML `#` e, dentro dos blocos `run:`, o `#` do
 * PowerShell). Sem isto a varredura acusa o comentário que CITA o código antigo
 * — mesma armadilha que o gate #1070 resolve com `semComentarios`.
 */
function semComentarios(yml: string): string {
  return yml
    .split(String.fromCharCode(10))
    .map((linha) => (/^\s*#/.test(linha) ? "" : linha))
    .join(String.fromCharCode(10));
}

test("#1270: o release.yml realmente usa a fonte única — sem placeholder sobrando", () => {
  const yml = semComentarios(readFileSync(".github/workflows/release.yml", "utf8"));

  assert.doesNotMatch(
    yml,
    /notes\s*=\s*"GALAXIE \$tag"/,
    "o placeholder do latest.json voltou — era ESTE o bug do #1270",
  );
  assert.doesNotMatch(
    yml,
    /--notes\s+"Instalador para Windows/,
    "o corpo fixo da release no dist voltou; tem de sair da mesma fonte",
  );
  assert.match(yml, /notas-release\.ps1/, "o workflow tem de chamar o resolvedor de notas");
  assert.match(yml, /--notes-file/, "o release do dist tem de usar --notes-file");
});
