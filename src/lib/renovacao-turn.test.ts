import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { faltaParaRenovar, devoAvisar } from "./renovacao-turn.ts";

// #1148 — a política de renovação da credencial TURN, com o relógio na mão.
//
// O DoD do card exige prova **com o relógio adiantado**, não que a função
// exista. Como a política é pura, o relógio é um argumento: não há `setTimeout`
// pra enganar, nem fake timer pra configurar errado.
//
// A asserção que mais importa não é nenhuma conta — é que **nenhum número de
// TTL aparece no cliente**. O TTL vive no `config.rs` do signaling e já mudou
// uma vez (3600 → 1800, PR #1146). Constante duplicada aqui envelheceria em
// silêncio: no dia em que o servidor baixasse o TTL, o cliente agendaria tarde
// e a sessão cairia, com o código "tendo renovação".

const AGORA = 1_700_000_000;

test("#1148: agenda a 3/4 do tempo RESTANTE, não do TTL nominal", () => {
  // Credencial de 1800s recém-emitida: renova em 1350s.
  assert.equal(faltaParaRenovar(AGORA + 1800, AGORA), 1_350_000);
  // A MESMA credencial vista com 900s de vida restante (o app abriu no meio da
  // sessão, ou o timer foi re-armado): 3/4 de 900, não de 1800. Usar o TTL
  // nominal aqui agendaria DEPOIS da expiração.
  assert.equal(faltaParaRenovar(AGORA + 900, AGORA), 675_000);
});

test("#1148: TTL diferente no servidor muda o gatilho sozinho", () => {
  // É o ponto inteiro de derivar do `expires_at`: o cliente não sabe nem
  // precisa saber quanto vale o TTL. Se amanhã virar 600s, isto continua certo.
  assert.equal(faltaParaRenovar(AGORA + 3600, AGORA), 2_700_000);
  assert.equal(faltaParaRenovar(AGORA + 600, AGORA), 450_000);
});

test("#1148: sem prazo declarado ⇒ nada a agendar (`null`, não `0`)", () => {
  // `0` é o que o `mapearIceServers` põe quando o servidor omite a expiração.
  // Devolver `0` aqui faria o agendador disparar em loop contra uma credencial
  // que não declara prazo.
  assert.equal(faltaParaRenovar(0, AGORA), null);
  assert.equal(faltaParaRenovar(Number.NaN, AGORA), null);
  assert.equal(faltaParaRenovar(AGORA + 100, Number.NaN), null);
});

test("#1148: relógio ADIANTADO além da expiração ⇒ não agenda", () => {
  // Renovar depois de expirado não salva a sessão: o `use-auth-secret` amarra a
  // alocação do coturn ao username que a criou. Quem trata isto é o aviso.
  assert.equal(faltaParaRenovar(AGORA + 1800, AGORA + 1801), null);
  assert.equal(faltaParaRenovar(AGORA + 1800, AGORA + 1800), null);
});

test("#1148: o aviso vem com ≥1/4 do TTL de antecedência, com a velha de pé", () => {
  const ttl = 1800;
  // Recém-emitida: nada a avisar.
  assert.equal(devoAvisar(AGORA + 1800, AGORA, ttl), false);
  // Restam 451s de 1800 (>1/4): ainda não.
  assert.equal(devoAvisar(AGORA + 451, AGORA, ttl), false);
  // Restam 450s = exatamente 1/4: é a hora. A credencial velha AINDA está viva,
  // que é o que dá ao usuário chance de agir.
  assert.equal(devoAvisar(AGORA + 450, AGORA, ttl), true);
  // Expirou sem renovar: avisar é o mínimo.
  assert.equal(devoAvisar(AGORA + 1800, AGORA + 2000, ttl), true);
});

test("#1148: sem TTL original conhecido, não inventa aviso", () => {
  assert.equal(devoAvisar(AGORA + 100, AGORA, 0), false);
  assert.equal(devoAvisar(0, AGORA, 1800), false);
});

test("#1148: o cliente NÃO carrega constante de TTL", () => {
  // A guarda que sobrevive a mim. Se alguém escrever `1800`/`3600` aqui, o
  // gatilho passa a duplicar uma verdade que mora no `config.rs` do signaling —
  // e que já mudou uma vez. O teste lê a fonte porque é a única forma de
  // afirmar uma AUSÊNCIA que nenhuma execução revelaria.
  const fonte = readFileSync(
    new URL("./renovacao-turn.ts", import.meta.url),
    "utf8",
  );
  const codigo = fonte
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");
  const suspeitos = [...codigo.matchAll(/\b(1800|3600|900|600)\b/g)].map(
    (m) => m[0] as string,
  );
  assert.deepEqual(
    suspeitos,
    [],
    `constante de TTL no cliente: ${suspeitos.join(", ")}. O prazo vem do ` +
      `\`expires_at_unix_seconds\` do servidor — número aqui envelhece calado.`,
  );
  // Anti-vazio: se o filtro de comentários comesse o arquivo inteiro, o
  // `deepEqual` acima passaria sem ver nada.
  assert.ok(
    codigo.includes("faltaParaRenovar"),
    "a varredura não enxergou o código — filtro comeu o arquivo",
  );
});
