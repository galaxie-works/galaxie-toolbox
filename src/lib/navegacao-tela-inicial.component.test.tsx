// #1299 — porta determinística para telas ocultas por flag (`?tela=<id>`).
//
// Roda no projeto `component` (vite/happy-dom) e NÃO no `node --test`: a
// `navegacao.ts` importa ícones `.tsx` pelo alias `@/`, que o strip-types do
// node não resolve. Aqui `import.meta.env.DEV` também é real, que é o eixo do
// AC de segurança.
import { describe, it, expect, afterEach } from "vitest";

import { TELAS, TELA_PADRAO, telaInicial } from "@/lib/navegacao";

/** Troca a query string sem recarregar (happy-dom aceita). */
function comQuery(q: string) {
  window.history.replaceState({}, "", q ? `/?${q}` : "/");
}

afterEach(() => comQuery(""));

describe("#1299 telaInicial()", () => {
  it("sem query: cai no padrão", () => {
    comQuery("");
    expect(telaInicial()).toBe(TELA_PADRAO);
  });

  it("?tela=atoms: abre a tela OCULTA (é o card inteiro)", () => {
    comQuery("tela=atoms");
    expect(telaInicial()).toBe("atoms");
  });

  it("?tela=<inexistente>: cai no padrão sem quebrar", () => {
    comQuery("tela=nao-existe");
    expect(telaInicial()).toBe(TELA_PADRAO);
  });

  it("?tela= vazio: cai no padrão", () => {
    comQuery("tela=");
    expect(telaInicial()).toBe(TELA_PADRAO);
  });

  it("valida contra o PRÓPRIO mapa TELAS — tela nova ganha porta de graça", () => {
    // Se alguém acrescentar uma tela ao TELAS, ela passa a valer aqui sem que
    // ninguém precise lembrar de mexer nesta função (o AC pede regra, não lista).
    for (const id of Object.keys(TELAS)) {
      comQuery(`tela=${id}`);
      expect(telaInicial()).toBe(id);
    }
  });

  it("não aceita chave herdada de Object.prototype (constructor/toString)", () => {
    for (const veneno of ["constructor", "toString", "__proto__"]) {
      comQuery(`tela=${veneno}`);
      expect(telaInicial()).toBe(TELA_PADRAO);
    }
  });

  it("o padrão é uma Tela de verdade (existe no TELAS)", () => {
    expect(Object.keys(TELAS)).toContain(TELA_PADRAO);
  });
});
