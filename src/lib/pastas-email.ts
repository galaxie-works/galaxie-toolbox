// #1019: rótulo humano de uma pasta de e-mail.
//
// O desenho do `Altair` manda o que cruza seams pro `message-shared.tsx`, e
// isto cruza quatro. Mas aquele arquivo só exporta COMPONENTES, e pôr uma
// função pura lá acende o `react(only-export-components)` — warning novo num
// repo que tem catraca de warnings (#1056). Então o que é UI compartilhada vai
// pro enabler e o que é lógica pura vem pra cá. Se o `Altair` preferir o
// contrário, é mover um arquivo — está dito no card.
import type { useIdioma } from "@/lib/idioma";

export function rotuloPasta(tipo: string, nome: string, t: ReturnType<typeof useIdioma>["t"]): string {
  const m: Record<string, string> = {
    inbox: t.controlRoom.pastaInbox,
    drafts: t.controlRoom.pastaDrafts,
    sentitems: t.controlRoom.pastaSent,
    archive: t.controlRoom.pastaArchive,
    junkemail: t.controlRoom.pastaJunk,
    deleteditems: t.controlRoom.pastaTrash,
  };
  return m[tipo] ?? nome;
}
