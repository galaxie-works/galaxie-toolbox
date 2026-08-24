import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// #1453 — as três divisórias do Bridge têm de parecer a mesma coisa.
//
// O `wagner` viu de primeira, no passe de runtime do #1392: o splitter entre o
// sidebar e a lista não combinava com o que fica entre a lista e o leitor.
//
// O defeito era meu e a causa não foi descuido — foi uma decisão de gosto tomada
// sem olhar os vizinhos. No #1373 eu escrevi que "o punho no meio do vão entre
// dois cards seria enfeite" e tirei o `withHandle` de UM dos três. Os outros
// dois vivem entre os MESMOS cards arredondados e têm punho. Consistência entre
// irmãos ganha de preferência local — e um handle sem realce no hover não avisa
// que é arrastável.
//
// Esta guarda não pina a aparência escolhida (isso engessaria o design). Ela
// pina a IGUALDADE: os três podem mudar juntos, nenhum pode mudar sozinho. É a
// forma que casa com o defeito real, que era divergência, não estilo.

const FONTES = [
  { arquivo: "src/components/bridge/bridge-split.tsx", onde: "sidebar ⇄ lista" },
  { arquivo: "src/screens/control-room.tsx", onde: "lista ⇄ leitor" },
  { arquivo: "src/components/bridge/message-detail.tsx", onde: "leitor ⇄ preview" },
];

/** As props visuais de um `<ResizableHandle>`: tem punho? qual o className? */
interface Handle {
  onde: string;
  arquivo: string;
  withHandle: boolean;
  classes: string[];
}

function handlesDe(arquivo: string, onde: string): Handle[] {
  const fonte = readFileSync(arquivo, "utf8");
  const fora: Handle[] = [];
  // Pega tanto `<ResizableHandle ... />` de uma linha quanto multi-linha.
  for (const m of fonte.matchAll(/<ResizableHandle\b([\s\S]*?)\/>/g)) {
    const corpo = m[1];
    const cls = corpo.match(/className=\{?"([^"]*)"/);
    fora.push({
      onde,
      arquivo,
      withHandle: /\bwithHandle\b/.test(corpo),
      // `print:hidden` é do preview (não imprimir a divisória) e não é
      // aparência na tela — fora da comparação de propósito.
      classes: (cls?.[1] ?? "")
        .split(/\s+/)
        .filter((c) => c && !c.startsWith("print:"))
        .sort(),
    });
  }
  return fora;
}

test("#1453: as três divisórias do Bridge não divergem entre si", () => {
  const todos = FONTES.flatMap((f) => handlesDe(f.arquivo, f.onde));

  // Anti-vazio: regex quebrada devolveria zero handles e a guarda passaria pra
  // sempre. Três é o número medido — se virar quatro, alguém acrescentou uma
  // divisória e ela tem de entrar nesta comparação, não escapar dela.
  assert.equal(
    todos.length,
    3,
    `esperava 3 <ResizableHandle> no Bridge, achei ${todos.length}: ${todos.map((h) => h.onde).join(", ") || "nenhum"}. Se acrescentaste uma divisória, inclui a fonte dela em FONTES.`,
  );

  const [ref, ...resto] = todos;
  for (const h of resto) {
    assert.equal(
      h.withHandle,
      ref.withHandle,
      `"${h.onde}" ${h.withHandle ? "tem" : "não tem"} punho e "${ref.onde}" ${ref.withHandle ? "tem" : "não tem"} — foi exatamente esta divergência que o PO viu no #1453.`,
    );
    assert.deepEqual(
      h.classes,
      ref.classes,
      `"${h.onde}" e "${ref.onde}" têm aparências diferentes. Os três mudam juntos ou nenhum muda.`,
    );
  }
});

test("#1453: o handle dá sinal de que é arrastável (hover)", () => {
  // O AC do card em letra: hoje o do sidebar não dava sinal nenhum. Pinado à
  // parte porque `withHandle` e hover são duas afirmações diferentes — a
  // primeira é o punho, esta é o feedback.
  for (const h of FONTES.flatMap((f) => handlesDe(f.arquivo, f.onde))) {
    assert.ok(
      h.classes.some((c) => c.startsWith("hover:")),
      `"${h.onde}" não tem realce de hover: nada avisa ao usuário que dá pra arrastar.`,
    );
  }
});
