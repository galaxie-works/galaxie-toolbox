import assert from "node:assert/strict";
import { test } from "node:test";

import type { Pessoa } from "../../lib/types.ts";
import { deveCommitarEnter } from "./campo-pessoas-logic.ts";

const contato = (email: string, origem: Pessoa["origem"] = "contatos"): Pessoa => ({
  nome: email.split("@")[0],
  email,
  origem,
});

test("commita e-mail livre válido quando nada está destacado", () => {
  assert.equal(deveCommitarEnter("externo@cliente.com", undefined, []), true);
});

test("não commita e-mail incompleto (fica editável)", () => {
  assert.equal(deveCommitarEnter("externo@", undefined, []), false);
  assert.equal(deveCommitarEnter("externo", undefined, []), false);
  assert.equal(deveCommitarEnter("", undefined, []), false);
});

test("cede o Enter ao combobox quando um contato REAL está destacado", () => {
  const dir = contato("maria@empresa.com", "organizacao");
  assert.equal(deveCommitarEnter("maria@empresa.com", dir, [dir]), false);
});

test("#268: ignora destacado OBSOLETO fora das sugestões atuais e commita o digitado", () => {
  // O usuário digitou um trecho que casou com um contato (destacado), depois
  // completou pra um e-mail externo — as sugestões esvaziaram, mas o ref do
  // destacado ficou apontando pro contato antigo. Deve commitar mesmo assim.
  const obsoleto = contato("maria@empresa.com");
  assert.equal(deveCommitarEnter("externo@cliente.com", obsoleto, []), true);
});

test("#268: destacado obsoleto mesmo com outras sugestões não bloqueia o commit", () => {
  const obsoleto = contato("maria@empresa.com");
  const sugestoes = [contato("joao@empresa.com", "organizacao")];
  assert.equal(deveCommitarEnter("externo@cliente.com", obsoleto, sugestoes), true);
});
