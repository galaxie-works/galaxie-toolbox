// #1472 — `deviceIdValido` aceita EXATAMENTE o que o servidor aceita.
//
// Pedido da @Lúmen no gate (mutantes F1/F2): o teste do painel só exercitava um
// ID com espaço. Um regex que recusasse o `@` (válido no `remote-net`,
// `authority.rs`: alfanumérico ASCII + `- _ . : @`, 1..=128) ou que aceitasse
// 129 caracteres passava verde. O primeiro torna IDs reais impossíveis de
// conceder pela UI; o segundo empurra a recusa para o servidor (`400`).
import { describe, it, expect } from "vitest";
import { deviceIdValido } from "./remoto";

describe("#1472 deviceIdValido = a regra do remote-net", () => {
  it.each([
    ["a", true],
    ["x".repeat(128), true],
    ["laptop:ana@1", true], // o `@` e o `:`: o ID do meu próprio runtime
    ["pc-bia_2.local", true], // `-`, `_` e `.`
    ["x".repeat(129), false],
    ["", false],
    ["pc bia", false],
    ["pc/bia", false],
    ["pcé", false], // só ASCII
    ["pc#1", false],
  ] as const)("%j ⇒ %s", (id, esperado) => {
    expect(deviceIdValido(id)).toBe(esperado);
  });
});
