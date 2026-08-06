import assert from "node:assert/strict";
import { test } from "node:test";

import type { Pessoa } from "../../lib/types.ts";
import { deveCommitarEnter } from "./campo-pessoas-logic.ts";

const contato = (email: string, origem: Pessoa["origem"] = "contatos"): Pessoa => ({
  nome: email.split("@")[0],
  email,
  origem,
});

test("commita e-mail livre válido quando não há sugestões", () => {
  assert.equal(deveCommitarEnter("externo@cliente.com", []), true);
});

test("não commita e-mail incompleto (fica editável)", () => {
  assert.equal(deveCommitarEnter("externo@", []), false);
  assert.equal(deveCommitarEnter("externo", []), false);
  assert.equal(deveCommitarEnter("", []), false);
});

test("cede o Enter ao combobox quando o texto É o e-mail de uma sugestão", () => {
  // O usuário digitou o e-mail completo de um contato conhecido — o combobox
  // seleciona esse contato (o chip resultante é o mesmo e-mail).
  const dir = contato("maria@empresa.com", "organizacao");
  assert.equal(deveCommitarEnter("maria@empresa.com", [dir]), false);
});

test("#606: commita o e-mail externo mesmo com sugestões de OUTROS contatos", () => {
  // A regressão: o Graph retorna gente por relevância até pra um e-mail externo,
  // e o Base UI auto-destaca a 1ª sugestão. O commit NÃO pode depender do
  // highlight — se o texto é um e-mail completo que não é nenhuma sugestão, vira
  // chip (antes o campo apagava o endereço).
  const sugestoes = [
    contato("ana@empresa.com", "organizacao"),
    contato("joao@empresa.com", "organizacao"),
  ];
  assert.equal(deveCommitarEnter("externo@cliente.com", sugestoes), true);
});

test("#268: e-mail livre válido commita independentemente das sugestões", () => {
  const sugestoes = [contato("joao@empresa.com", "organizacao")];
  assert.equal(deveCommitarEnter("externo@cliente.com", sugestoes), true);
});
