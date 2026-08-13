import assert from "node:assert/strict";
import test from "node:test";

import { surfaceSuportada, type Surface } from "./capabilities-surface.ts";

const msOrg = { provider: "microsoft", accountKind: "work" } as const;
const msPessoal = { provider: "microsoft", accountKind: "personal" } as const;
const google = { provider: "google", accountKind: "personal" } as const;

test("mail (Outlook): MS org e pessoal sim; Google não (#803)", () => {
  assert.equal(surfaceSuportada(msOrg, "mail"), true);
  assert.equal(surfaceSuportada(msPessoal, "mail"), true);
  assert.equal(surfaceSuportada(google, "mail"), false);
});

test("sites e peopleDirectory: só MS org (#802/#803)", () => {
  for (const s of ["sites", "peopleDirectory"] as const satisfies Surface[]) {
    assert.equal(surfaceSuportada(msOrg, s), true, `${s} devia valer pra MS org`);
    assert.equal(surfaceSuportada(msPessoal, s), false, `${s} é org-only`);
    assert.equal(surfaceSuportada(google, s), false, `${s} é org-only`);
  }
});

test("files/calendar/contacts: MS e Google (caminho próprio)", () => {
  for (const s of ["files", "calendar", "contacts"] as const satisfies Surface[]) {
    assert.equal(surfaceSuportada(msOrg, s), true);
    assert.equal(surfaceSuportada(msPessoal, s), true);
    assert.equal(surfaceSuportada(google, s), true);
  }
});

test("sem conta → nada suportado (fail-closed)", () => {
  assert.equal(surfaceSuportada(null, "mail"), false);
  assert.equal(surfaceSuportada(undefined, "sites"), false);
});
