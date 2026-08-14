import assert from "node:assert/strict";
import test from "node:test";

import {
  orgAbsorvente,
  resolverOrgStatus,
  type PeopleOrg,
} from "./organizations.ts";
import type { AppUser } from "./types.ts";

function org(over: Partial<PeopleOrg>): PeopleOrg {
  return {
    id: "org:voaz",
    name: "Voaz",
    domains: ["voaz.builders"],
    memberIds: [],
    excludedIds: [],
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

type LoginUser = Pick<AppUser, "email" | "accountKind"> & {
  domain?: string | null;
};

function user(over: Partial<LoginUser>): LoginUser {
  return { email: "z@voaz.builders", accountKind: "personal", ...over };
}

const CLIENTE = [org({ contratada: true, dominiosVerificados: ["voaz.builders"] })];

test("#700 2b: work de org contratada+verificada → contracted", () => {
  assert.equal(
    resolverOrgStatus(user({ accountKind: "work", domain: "voaz.builders" }), CLIENTE),
    "contracted",
  );
});

test("#700 2b: work de empresa não-cliente → uncontracted (lead-gen)", () => {
  assert.equal(
    resolverOrgStatus(user({ accountKind: "work", domain: "outra.com" }), CLIENTE),
    "uncontracted",
  );
  // org existe mas NÃO é contratada → ainda uncontracted
  assert.equal(
    resolverOrgStatus(
      user({ accountKind: "work", domain: "voaz.builders" }),
      [org({ contratada: false, dominiosVerificados: ["voaz.builders"] })],
    ),
    "uncontracted",
  );
  // contratada mas domínio só DECLARADO (não verificado) → uncontracted
  assert.equal(
    resolverOrgStatus(
      user({ accountKind: "work", domain: "voaz.builders" }),
      [org({ contratada: true, domains: ["voaz.builders"], dominiosVerificados: [] })],
    ),
    "uncontracted",
  );
});

test("#700 2b: personal do domínio do cliente → contracted (absorção JIT)", () => {
  const u = user({ accountKind: "personal", email: "fulano@voaz.builders" });
  assert.equal(resolverOrgStatus(u, CLIENTE), "contracted");
  assert.equal(orgAbsorvente(u, CLIENTE)?.id, "org:voaz");
});

test("#700 2b: personal sem match → none, e não é absorvido", () => {
  const u = user({ accountKind: "personal", email: "eu@gmail.com" });
  assert.equal(resolverOrgStatus(u, CLIENTE), "none");
  assert.equal(orgAbsorvente(u, CLIENTE), null);
  // personal do domínio certo MAS org não-contratada → none, sem absorção
  const naoContratada = [org({ contratada: false, dominiosVerificados: ["voaz.builders"] })];
  assert.equal(
    resolverOrgStatus(user({ accountKind: "personal", email: "x@voaz.builders" }), naoContratada),
    "none",
  );
  assert.equal(
    orgAbsorvente(user({ accountKind: "personal", email: "x@voaz.builders" }), naoContratada),
    null,
  );
});

test("#700 2b: work NUNCA é absorvido (é gateado pelo #781, não migrado)", () => {
  assert.equal(
    orgAbsorvente(user({ accountKind: "work", domain: "voaz.builders" }), CLIENTE),
    null,
  );
});

test("#700 2b: domain do token tem prioridade sobre o sufixo do e-mail", () => {
  // e-mail pessoal @gmail mas token carrega domain do cliente (caso work): usa o domain
  const u = user({ accountKind: "work", email: "alias@gmail.com", domain: "voaz.builders" });
  assert.equal(resolverOrgStatus(u, CLIENTE), "contracted");
});

test("#700 2b: e-mail malformado / vazio → none (fail-closed)", () => {
  assert.equal(resolverOrgStatus(user({ accountKind: "personal", email: "" }), CLIENTE), "none");
  assert.equal(
    resolverOrgStatus(user({ accountKind: "personal", email: "semarroba" }), CLIENTE),
    "none",
  );
});
