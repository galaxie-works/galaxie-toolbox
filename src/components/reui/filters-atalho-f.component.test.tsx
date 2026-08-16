// #1060 (UX2, CRÍTICO) — regressão do guard do atalho de TECLA ÚNICA `f` do
// `Filters`. Antes o listener global só descartava input/textarea (via
// `document.activeElement`), então a letra 'f' digitada no CORPO do e-mail
// (contenteditable) abria o filtro E o `Ctrl+Shift+F` (Encaminhar) colidia.
// Agora usa `isTypingTarget(e.target)` + bail em QUALQUER modificador.
//
// Roda no vitest (`pnpm test:component`, happy-dom). O DropdownMenu do Radix é
// CONTROLADO por `addFilterOpen` (state React) → o `data-state`/`aria-expanded`
// do trigger reflete o open sem depender de ponteiro (limite conhecido do
// happy-dom com Base UI/Radix não nos afeta aqui: só lemos o estado do trigger).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

import { Filters, type FilterFieldConfig } from "./filters";

const CAMPOS: FilterFieldConfig<string>[] = [
  { key: "status", label: "Status", type: "select", options: [{ value: "a", label: "A" }] },
];

function montar() {
  return render(
    <Filters<string>
      filters={[]}
      fields={CAMPOS}
      onChange={vi.fn()}
      enableShortcut
      shortcutKey="f"
      showSearchInput={false}
      trigger={<button data-testid="trigger-filtro">Filtro</button>}
    />,
  );
}

/** Dispara um keydown que borbulha até o `window` com o `target` desejado. */
function teclar(alvo: EventTarget, init: KeyboardEventInit) {
  act(() => {
    alvo.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
  });
}

function estaAberto() {
  const t = screen.getByTestId("trigger-filtro");
  // Radix reflete o open no trigger via data-state="open" / aria-expanded.
  return (
    t.getAttribute("data-state") === "open" ||
    t.getAttribute("aria-expanded") === "true"
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("#1060 guard do atalho `f` do Filters", () => {
  it("'f' num CONTENTEDITABLE (corpo do e-mail) NÃO abre o filtro", () => {
    montar();
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    document.body.appendChild(editor);
    editor.focus();
    expect(estaAberto()).toBe(false);
    teclar(editor, { key: "f" });
    expect(estaAberto()).toBe(false);
  });

  it("Ctrl+Shift+F (Encaminhar) NÃO abre o filtro", () => {
    montar();
    teclar(document.body, { key: "F", ctrlKey: true, shiftKey: true });
    expect(estaAberto()).toBe(false);
  });

  it("'f' isolado num alvo NEUTRO ainda ABRE o filtro (o atalho segue vivo)", () => {
    montar();
    expect(estaAberto()).toBe(false);
    teclar(document.body, { key: "f" });
    expect(estaAberto()).toBe(true);
  });
});
