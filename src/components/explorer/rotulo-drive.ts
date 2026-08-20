// #1288: o rótulo de um drive na tela "Este computador".
//
// O defeito: drives de rede apareciam como `wagnao-marcenaria (\\srv\share) (W:) (W:)`
// — letra duas vezes. A causa não é um dos dois lados estar errado; é os dois
// estarem certos e ninguém combinar. O Rust monta o nome de drive de rede JÁ com
// a letra dentro (`nome_drive_rede`, `fs_explorer.rs:777`, é o formato
// documentado lá), e o card do front anexava ` (letra)` por cima.
//
// Por que NÃO chaveei em `kind === "network"`, que seria o conserto óbvio: isso
// amarraria o front a uma convenção do backend. No dia em que o Rust parasse de
// anexar a letra, o `if kind` deixaria o drive de rede SEM letra — e ninguém
// veria, porque o teste do `if` continuaria verde. Olhando o DADO, os dois
// mundos funcionam: com ou sem a letra no nome, o rótulo sai certo uma vez só.

/** A letra do drive, sem as barras finais: `W:\` → `W:`. */
export function letraDoDrive(path: string): string {
  return path.replace(/[\\/]+$/, "");
}

/**
 * Rótulo do drive: nome + letra, com a letra aparecendo UMA vez.
 *
 * Se o nome já termina com `(letra)` — como vem do redirector de rede —, ele é
 * devolvido intacto. A comparação ignora espaços no fim e diferença de caixa,
 * porque `w:` e `W:` são o mesmo drive.
 */
export function rotuloDrive(name: string, path: string): string {
  const letra = letraDoDrive(path);
  const nome = name.trim();
  if (!letra) return nome;
  if (!nome) return `(${letra})`;
  const sufixo = `(${letra})`.toLowerCase();
  if (nome.toLowerCase().endsWith(sufixo)) return nome;
  return `${nome} (${letra})`;
}
