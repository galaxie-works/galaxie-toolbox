import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ehCapabilityOrg,
  planoBilling,
  recursoOrgDisponivel,
  temCapability,
  tierDaConta,
} from "./tier.ts";
import type { AppUser } from "./types.ts";

function conta(over: Partial<AppUser>): AppUser {
  return {
    displayName: "T",
    email: "t@x.com",
    initials: "T",
    provider: "microsoft",
    accountKind: "work",
    orgStatus: "contracted",
    capabilities: ["identity", "mailRead"],
    ...over,
  };
}

test("#699 recursoOrgDisponivel: só a org contratada", () => {
  assert.equal(recursoOrgDisponivel(conta({ orgStatus: "contracted" })), true);
  assert.equal(recursoOrgDisponivel(conta({ orgStatus: "uncontracted" })), false);
  assert.equal(recursoOrgDisponivel(conta({ orgStatus: "none" })), false);
  assert.equal(recursoOrgDisponivel(null), false);
});

test("#699 tierDaConta: contracted=organizacao, resto=pessoal", () => {
  assert.equal(tierDaConta(conta({ orgStatus: "contracted" })), "organizacao");
  assert.equal(tierDaConta(conta({ orgStatus: "uncontracted" })), "pessoal");
  assert.equal(tierDaConta(conta({ orgStatus: "none" })), "pessoal");
});

test("#699 temCapability: reflete o token", () => {
  const u = conta({ capabilities: ["identity", "orgAdmin"] });
  assert.equal(temCapability(u, "orgAdmin"), true);
  assert.equal(temCapability(u, "directoryRead"), false);
  assert.equal(temCapability(null, "orgAdmin"), false);
});

test("#699 ehCapabilityOrg: directory/orgAdmin são org; mailRead não", () => {
  assert.equal(ehCapabilityOrg("orgAdmin"), true);
  assert.equal(ehCapabilityOrg("directoryRead"), true);
  assert.equal(ehCapabilityOrg("mailRead"), false);
  assert.equal(ehCapabilityOrg("filesReadAll"), false);
});

test("#699 planoBilling: org-seat vs individual (placeholder)", () => {
  assert.equal(planoBilling(conta({ orgStatus: "contracted" })), "org-seat");
  assert.equal(planoBilling(conta({ orgStatus: "none" })), "individual");
});
