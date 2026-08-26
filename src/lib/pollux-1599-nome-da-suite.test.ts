// #1599 — o nome da suite nos rótulos, e a FRONTEIRA que separa rótulo de dado.
//
// O card tem duas metades e só uma é sobre texto:
//
//  Classe A (este card) — rótulos que a pessoa LÊ. Trocar é cosmético.
//  Classe B (NÃO tocar) — `galaxie-toolbox.*` no localStorage e `toolbox.json`
//    em disco. São **identificadores de persistência**: renomeá-los não muda um
//    texto, ORFANA a configuração e a sessão de todo mundo que já usa o produto.
//    Ninguém vê o erro no code review, porque o diff parece igual ao da Classe A.
//
// É por isso que esta guarda existe. O perigo do #1599 não é esquecer um rótulo
// — é um `replace` bem-intencionado varrer as duas classes de uma vez.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZ = new URL("../..", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);

/** Todo arquivo de fonte sob um diretório, recursivo. */
function fontes(dir: string, exts: string[]): string[] {
  const achados: string[] = [];
  for (const nome of readdirSync(dir)) {
    if (nome === "node_modules" || nome === "target" || nome === "dist") continue;
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) achados.push(...fontes(p, exts));
    else if (exts.some((e) => nome.endsWith(e))) achados.push(p);
  }
  return achados;
}

/**
 * Linhas com o nome antigo, ignorando o que é DADO e o que é comentário.
 *
 * O DoD do card exclui as duas coisas de propósito: chave de persistência é
 * Classe B (não se toca) e comentário não é rótulo (ninguém o lê na tela).
 */
/**
 * Este arquivo. Precisa sair da varredura, e a razão não é conveniência: uma
 * guarda que procura um literal na fonte **e vive na fonte** acha-se a si mesma
 * — os meus próprios regexes contêm o nome que caçam. Sem esta exclusão ela
 * nunca fica verde, e a tentação seguinte seria afrouxar o padrão até calar,
 * que é como uma guarda perde os dentes sem ninguém reparar.
 */
const ESTE_ARQUIVO = "pollux-1599-nome-da-suite.test.ts";

function rotulosComNomeAntigo(): string[] {
  const fora: string[] = [];
  for (const p of fontes(join(RAIZ, "src"), [".ts", ".tsx"])) {
    if (p.endsWith(ESTE_ARQUIVO)) continue;
    const linhas = readFileSync(p, "utf8").split("\n");
    linhas.forEach((l, i) => {
      if (!/Toolbox/.test(l)) return;
      if (/galaxie-toolbox\./.test(l)) return; // Classe B: chave de dados
      const t = l.trim();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return; // comentário
      fora.push(`${relative(RAIZ, p)}:${i + 1}: ${t.slice(0, 90)}`);
    });
  }
  return fora;
}

test("#1599 — a varredura ENXERGA (anti-vazio)", () => {
  // Sem isto, um parser quebrado devolveria zero rótulos e a asserção de baixo
  // passaria dizendo "conferido". É o mesmo furo que já me apanhou na guarda de
  // contrato do #1490: vazio por erro é indistinguível de vazio de verdade.
  const arquivos = fontes(join(RAIZ, "src"), [".ts", ".tsx"]);
  assert.ok(
    arquivos.length >= 50,
    `li ${arquivos.length} arquivos em src/ — esperava ≥50; varredura cega passa igual`,
  );

  // E prova que o detector SABE achar o nome antigo, plantando-o numa string.
  const plantado = ['const x = "GALAXIE Toolbox";'];
  const vePlantado = plantado.some(
    (l) => /Toolbox/.test(l) && !/galaxie-toolbox\./.test(l),
  );
  assert.ok(vePlantado, "o detector não reconhece o nome antigo nem quando plantado");
});

test("#1599 — nenhum RÓTULO de exibição diz o nome antigo", () => {
  const sobras = rotulosComNomeAntigo();
  assert.deepEqual(
    sobras,
    [],
    `rótulo de exibição com o nome antigo (a suite é "The GALAXIE"):\n  ${sobras.join("\n  ")}`,
  );
});

test("#1599 AC5 — a CLASSE B continua intacta (o rename não pode alcançá-la)", () => {
  // Estas contagens são o ponto inteiro do teste. Elas não sobem por acaso: se
  // caírem, alguém renomeou um identificador de PERSISTÊNCIA achando que era
  // rótulo — e o efeito não aparece em teste de UI nenhum, aparece no usuário
  // que perde tema, sessão e configuração ao atualizar.
  const chaves = fontes(join(RAIZ, "src"), [".ts", ".tsx"])
    // MESMA razão do `ESTE_ARQUIVO` na varredura de rótulos — e faltava aqui.
    // Apanhado pela @Lúmen: esta guarda MENCIONA a chave que conta (no
    // comentário acima e na mensagem de falha abaixo), e essas duas menções
    // **não desaparecem** quando alguém renomeia uma chave real. Eram folga
    // permanente do tamanho delas: 12 ocorrências contra piso 10, logo as duas
    // primeiras chaves de persistência podiam morrer EM SILÊNCIO. Escrevi a
    // razão da exclusão no cabeçalho deste ficheiro e apliquei-a a um dos dois
    // sítios; a guarda de rótulos ficou com dentes e esta ficou com a frase.
    .filter((p) => !p.endsWith(ESTE_ARQUIVO))
    .flatMap((p) =>
      readFileSync(p, "utf8")
        .split("\n")
        .filter((l) => /galaxie-toolbox\./.test(l)),
    ).length;

  const json = fontes(join(RAIZ, "src-tauri", "src"), [".rs"])
    .flatMap((p) =>
      readFileSync(p, "utf8")
        .split("\n")
        .filter((l) => /toolbox\.json/.test(l)),
    ).length;

  // ── Por que PISO e não `> 0` ────────────────────────────────────────────
  // A 1ª versão desta asserção dizia só `> 0`, e eu medi que ela **não pega o
  // caso real**: renomear a chave em UM arquivo (o `tema.ts`, por exemplo) faz a
  // contagem cair sem chegar a zero, porque os outros ainda a têm — e o mutante
  // sobreviveu. O defeito de verdade é parcial, não total: ninguém varre as 10
  // ocorrências de uma vez; alguém troca a que está à frente.
  //
  // O piso é uma catraca: adicionar chave legítima SOBE o número e passa;
  // renomear qualquer uma DESCE e reprova. Baixar o piso tem de ser um ato
  // deliberado, com o motivo escrito aqui — que é a fricção certa para um
  // identificador de persistência.
  const PISO_CHAVES = 10; // medido em 2026-08-26, antes do rename dos rótulos
  const PISO_JSON = 6;

  assert.ok(
    chaves >= PISO_CHAVES,
    `só ${chaves} ocorrências de \`galaxie-toolbox.\` (piso ${PISO_CHAVES}). ` +
      `Alguma chave de PERSISTÊNCIA foi renomeada — isso ORFANA tema, sessão e ` +
      `configuração de quem já usa o produto, e nenhum teste de UI acusa.`,
  );
  assert.ok(
    json >= PISO_JSON,
    `só ${json} ocorrências de \`toolbox.json\` (piso ${PISO_JSON}). ` +
      `Mesma suspeita: arquivo de dado renomeado como se fosse rótulo.`,
  );
});
