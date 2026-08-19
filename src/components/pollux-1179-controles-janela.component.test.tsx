// #1179 (regressão do passe de runtime do PO) — "minimizar, maximizar e fechar
// são clicáveis, mas nenhuma ação acontece".
//
// Este arquivo BISSECTA a camada: prova que o clique no DOM chega ao handler e
// que o handler chama o comando de janela do Tauri. Se estes testes passam, a
// camada React está íntegra e a inércia vem do NATIVO (drag region / IPC /
// permissão) — não do wrapper de Tooltip.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const minimize = vi.fn(async () => {});
const toggleMaximize = vi.fn(async () => {});
const fechar = vi.fn(async () => {});
const isMaximized = vi.fn(async () => false);
const onResized = vi.fn(async () => () => {});

const telAcaoConcluida = vi.fn();
vi.mock("@/lib/telemetria", () => ({
  telAcaoConcluida: (...a: unknown[]) => telAcaoConcluida(...a),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize,
    toggleMaximize,
    close: fechar,
    isMaximized,
    onResized,
  }),
}));

import { BarraJanela } from "@/components/barra-janela";
import { TooltipProvider } from "@/components/ui/tooltip";
import { IdiomaProvider } from "@/lib/idioma";

async function montar() {
  const r = render(
    <IdiomaProvider>
      <TooltipProvider>
        <BarraJanela />
      </TooltipProvider>
    </IdiomaProvider>
  );
  // o efeito de boot (isMaximized/onResized) resolve em microtask
  await act(async () => {
    await Promise.resolve();
  });
  return r;
}

beforeEach(() => {
  // BarraJanela só renderiza dentro do Tauri (`__TAURI_INTERNALS__`).
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  vi.clearAllMocks();
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

describe("#1179 controles de janela respondem ao clique", () => {
  it("os três botões existem e estão acessíveis por rótulo", async () => {
    await montar();
    expect(screen.getByRole("button", { name: /minimizar|minimize/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /maximizar|maximize/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /fechar|close/i })).toBeTruthy();
  });

  it("minimizar: clique chama window.minimize()", async () => {
    const user = userEvent.setup();
    await montar();
    await user.click(screen.getByRole("button", { name: /minimizar|minimize/i }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(minimize).toHaveBeenCalledTimes(1);
  });

  it("maximizar: clique chama window.toggleMaximize()", async () => {
    const user = userEvent.setup();
    await montar();
    await user.click(screen.getByRole("button", { name: /maximizar|maximize/i }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(toggleMaximize).toHaveBeenCalledTimes(1);
  });

  it("fechar: clique chama window.close()", async () => {
    const user = userEvent.setup();
    await montar();
    await user.click(screen.getByRole("button", { name: /fechar|close/i }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(fechar).toHaveBeenCalledTimes(1);
  });

  it("o clique sobrevive ao wrapper de Tooltip (hover antes do clique)", async () => {
    // O PO relatou tooltip funcionando E botão inerte — este é o caminho real:
    // o mouse passa (tooltip abre) e SÓ ENTÃO clica.
    const user = userEvent.setup();
    await montar();
    const botao = screen.getByRole("button", { name: /minimizar|minimize/i });
    await user.hover(botao);
    await user.click(botao);
    await act(async () => {
      await Promise.resolve();
    });
    expect(minimize).toHaveBeenCalledTimes(1);
  });
});

// O funil `comandoJanela` existe porque a falha nativa era ENGOLIDA: sem catch,
// "clicável e inerte" não deixava rastro em lugar nenhum. Estes casos travam o
// rastro — se alguém voltar ao handler cru, o CI reprova.
describe("#1179 falha do comando de janela vira sinal, não silêncio", () => {
  it("sucesso reporta telemetria ok", async () => {
    const user = userEvent.setup();
    await montar();
    await user.click(screen.getByRole("button", { name: /minimizar|minimize/i }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(telAcaoConcluida).toHaveBeenCalledWith("janela_minimizar", "ok");
  });

  it("falha nativa NÃO é engolida: console.error + telemetria de erro", async () => {
    const erro = new Error("window.minimize not allowed");
    minimize.mockRejectedValueOnce(erro);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    await montar();
    await user.click(screen.getByRole("button", { name: /minimizar|minimize/i }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(spy).toHaveBeenCalled();
    expect(String(spy.mock.calls[0]?.[0])).toContain("minimizar");
    expect(telAcaoConcluida).toHaveBeenCalledWith("janela_minimizar", "erro");
    spy.mockRestore();
  });

  it("falha em fechar também é reportada (o funil vale para os três)", async () => {
    fechar.mockRejectedValueOnce(new Error("denied"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    await montar();
    await user.click(screen.getByRole("button", { name: /fechar|close/i }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(telAcaoConcluida).toHaveBeenCalledWith("janela_fechar", "erro");
    spy.mockRestore();
  });
});
