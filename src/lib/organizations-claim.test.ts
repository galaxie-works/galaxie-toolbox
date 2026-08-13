import assert from "node:assert/strict";
import test from "node:test";

import {
  dominioEhCliente,
  orgContratadaDoDominio,
  type PeopleOrg,
} from "./organizations.ts";

function org(over: Partial<PeopleOrg>): PeopleOrg {
  return {
    id: "org:x",
    name: "X",
    domains: ["voaz.builders"],
    memberIds: [],
    excludedIds: [],
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

test("#700 2b: contratada + domínio VERIFICADO → é cliente (case/prefixo-insensível)", () => {
  const orgs = [org({ contratada: true, dominiosVerificados: ["Voaz.Builders"] })];
  assert.equal(dominioEhCliente(orgs, "voaz.builders"), true);
  assert.equal(dominioEhCliente(orgs, "https://VOAZ.builders"), true);
  assert.equal(orgContratadaDoDominio(orgs, "voaz.builders")?.id, "org:x");
});

test("#700 2b: sem flag, sem verify, sufixo cru ou org legada → NÃO é cliente", () => {
  // flag desligada
  assert.equal(
    dominioEhCliente([org({ contratada: false, dominiosVerificados: ["voaz.builders"] })], "voaz.builders"),
    false,
  );
  // contratada MAS domínio só declarado (não verificado) → não absorve pelo sufixo cru
  assert.equal(
    dominioEhCliente([org({ contratada: true, domains: ["voaz.builders"], dominiosVerificados: [] })], "voaz.builders"),
    false,
  );
  // domínio de outra org
  assert.equal(
    dominioEhCliente([org({ contratada: true, dominiosVerificados: ["voaz.builders"] })], "outra.com"),
    false,
  );
  // org legada (campos ausentes) → não-contratada
  assert.equal(dominioEhCliente([org({})], "voaz.builders"), false);
  // domínio vazio
  assert.equal(dominioEhCliente([org({ contratada: true, dominiosVerificados: ["voaz.builders"] })], ""), false);
});
