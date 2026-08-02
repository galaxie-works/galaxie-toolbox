import assert from "node:assert/strict";
import { test } from "node:test";

import { dominiosExternos } from "./organizations.ts";
import type { PeopleContact } from "./people.ts";

const contato = (email: string | null): PeopleContact =>
  ({
    id: email ?? "sem-email",
    name: email ?? "sem-email",
    emails: email ? [{ address: email }] : [],
    phones: [],
    organization: false,
    frequent: false,
    sources: ["contacts"],
    categories: [],
  }) as unknown as PeopleContact;

test("#278 S4 dominiosExternos agrupa por domínio, exclui o do usuário e ordena", () => {
  const contatos = [
    contato("a@acme.com"),
    contato("b@acme.com"),
    contato("c@beta.io"),
    contato("eu@galaxie.works"), // domínio do usuário → fora
    contato("outro@galaxie.works"), // idem
    contato(null), // sem email → fora
    contato("d@WWW.Acme.com"), // normaliza www./caixa → acme.com
  ];

  const res = dominiosExternos(contatos, "galaxie.works");

  // acme.com tem 3 (a, b, d normalizado), beta.io tem 1; ordena por contagem.
  assert.deepEqual(res, [
    { dominio: "acme.com", total: 3 },
    { dominio: "beta.io", total: 1 },
  ]);
});

test("#278 S4 dominiosExternos empata por contagem e desempata alfabético", () => {
  const contatos = [contato("x@zeta.com"), contato("y@alfa.com")];
  const res = dominiosExternos(contatos, "galaxie.works");
  assert.deepEqual(res, [
    { dominio: "alfa.com", total: 1 },
    { dominio: "zeta.com", total: 1 },
  ]);
});

test("#278 S4 dominiosExternos vazio quando só há contatos internos/sem email", () => {
  const contatos = [contato("eu@galaxie.works"), contato(null)];
  assert.deepEqual(dominiosExternos(contatos, "galaxie.works"), []);
});
