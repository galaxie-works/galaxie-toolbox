// #1359 — a lista de contatos do "atribuir contatos" clipa de verdade?
//
// Eu abri este card no #1324 e escrevi lá que **não** confirmava o
// comportamento: a construção é a mesma (`max-h-*` no Root do `ScrollArea`,
// cujo viewport é `size-full`), mas aqui ela vive num `Dialog`, que **poderia**
// impor altura por fora. Isto mede antes de qualquer conserto.
//
// Navegador real: em happy-dom nada tem altura e a medição seria ficção.
import "@/index.css";
import { describe, it, expect } from "vitest";
import { render } from "vitest-browser-react";

import { IdiomaProvider } from "@/lib/idioma";
import type { PeopleOrg } from "@/lib/organizations";
import type { PeopleContact } from "@/lib/people";
import { AssignContactsDialog } from "./organizations-view";

const ORG: PeopleOrg = {
  id: "org-1",
  name: "Acme",
  domains: ["acme.com"],
  memberIds: [],
  excludedIds: [],
  createdAt: 1,
  updatedAt: 1,
};

/** Muitos contatos: é o cenário do card (lista que cresce por contato). */
const CONTATOS: PeopleContact[] = Array.from({ length: 60 }, (_, i) => ({
  id: `c${i}`,
  name: `Contato ${i}`,
  emails: [{ address: `c${i}@acme.com`, kind: "work" }],
  phones: [],
})) as PeopleContact[];

async function ate(busca: () => Element | null, ms = 5000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    const el = busca();
    if (el) return el;
    await new Promise((r) => setTimeout(r, 60));
  }
  return null;
}

describe("#1359 scrollbox de contatos das Organizações", () => {
  it("com 60 contatos o viewport CLIPA e rola (não estica o diálogo)", async () => {
    render(
      <IdiomaProvider>
        <AssignContactsDialog
          open
          organization={ORG}
          contacts={CONTATOS}
          onOpenChange={() => {}}
        />
      </IdiomaProvider>
    );

    const viewport = (await ate(() =>
      document.querySelector('[data-slot="scroll-area-viewport"]')
    )) as HTMLElement | null;
    expect(viewport, "o ScrollArea do diálogo não montou").toBeTruthy();

    const alturaVisivel = viewport!.clientHeight;
    const alturaConteudo = viewport!.scrollHeight;

    expect(alturaConteudo).toBeGreaterThan(400); // 60 linhas: conteúdo grande
    expect(
      alturaVisivel,
      `viewport com ${alturaVisivel}px — o teto de 320px (max-h-80) não está clipando`
    ).toBeLessThanOrEqual(360);
  });
});
