// #1148 (+retry) — a LIGAÇÃO do banner no ecrã, não só a regra pura.
//
// A @galaxie-lumen reprovou o #1747 (CHANGES_REQUESTED) com a medição certa: os
// testes do `remote-ttl.ts` matam 4/4 mutantes da função PURA, mas 4 mutantes do
// CONSUMIDOR (`remote.tsx`) sobreviviam porque nenhum teste tocava no ecrã —
// "o teste guarda a função, e o consumidor é que corre em produção"
// ([feedback-teste-nao-e-consumidor], a mesma classe do #1745/#1716). O @galaxie-altair
// subscreveu, pedindo este teste de componente (emitir `renew_ice_needed` 2× e
// depois `onIceServersRenovados`), porque mata o C1/C2/C3 no consumidor real.
//
// Os 4 mutantes (nomes da review da Lúmen), e como este arquivo os mata:
//  - C1: a retentativa REINICIA a pendência → o banner pisca durante a falha
//        (o defeito deslocado). Morto por: renew → espera → renew → o banner
//        acende por contar desde a 1.ª tentativa, não da 2.ª.
//  - C2: o `renew_ice_needed` deixa de marcar a pendência → a via primária morre.
//        Morto por: com horizonte NULO (ICE sem expiração), a ÚNICA via do aviso
//        é a pendência; se C2, o banner nunca acende.
//  - C3: o sucesso (`registrarExpiracao`) não limpa a pendência → o banner fica
//        aceso para sempre. Morto por: `onIceServersRenovados` → o banner some.
//  - C4: o efeito só vigia com `horizonte` → sem horizonte, nunca acende. Subsumido
//        pelo C2 aqui: todos os casos usam horizonte nulo, logo a via é a pendência.
//
// A regra é "pendente há MAIS de 30 s" (ver `CARENCIA_RENOVACAO_SEG`); o relógio
// do aviso corre num `setInterval` de 15 s + `Date.now()`, por isso o teste usa
// timers falsos (que também falsificam o `Date.now`).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";

import { IdiomaProvider } from "@/lib/idioma";

// Slots de captura dos callbacks que o `remote.tsx` entrega ao transporte/signaling.
// `vi.hoisted` porque as factories de `vi.mock` sobem acima dos imports.
const h = vi.hoisted(() => ({
  cap: {
    aoEvento: undefined as undefined | ((ev: { type: string }) => void),
    onIceServersRenovados: undefined as undefined | ((ice: unknown[]) => void),
  },
}));

// ICE sem expiração → `horizonteTtl` devolve null → isola a via da PENDÊNCIA do
// piso de 1/5 (assim um aviso que acenda só pode ter vindo da carência).
const ICE_SEM_EXPIRACAO = [
  { urls: ["turn:x"], username: "u", credential: "c", expiresAtUnixSeconds: 0, ttlSeconds: 0 },
];

vi.mock("@/lib/remote-signaling", () => ({
  endpointSignaling: vi.fn(async () => "ws://test"),
  criarSinalizadorWs: vi.fn(() => ({
    conectar: vi.fn(async (cbs: Record<string, (...a: never[]) => void>) => {
      h.cap.onIceServersRenovados = cbs.onIceServersRenovados as (ice: unknown[]) => void;
      // o servidor real pareia logo a seguir ao connect; dispara no microtask.
      queueMicrotask(() => (cbs.onPareado as (p: string) => void)?.("peer-1"));
      return { iceServers: ICE_SEM_EXPIRACAO };
    }),
    criarSessao: vi.fn(),
    resgatarSessao: vi.fn(),
    renovarIceServers: vi.fn(),
    enviarSinal: vi.fn(),
    fechar: vi.fn(),
  })),
}));

vi.mock("@/lib/remote", () => ({
  iniciarSessaoRemota: vi.fn(async (_cfg: unknown, aoEvento: (ev: { type: string }) => void) => {
    h.cap.aoEvento = aoEvento;
    return { state: "connected" };
  }),
  renovarIceServersSessao: vi.fn(async () => {}),
  encerrarSessao: vi.fn(async () => {}),
  enviarInput: vi.fn(),
  sinalizarSessao: vi.fn(async () => {}),
}));

// RemoteVideo toca canvas na importação; stub (o papel host nem o renderiza).
vi.mock("@/components/remote/remote-video", () => ({ RemoteVideo: () => null }));
// SoftBlurIn anima com timers; sob timers falsos, renderiza os filhos direto.
vi.mock("@/components/smoothui/soft-blur-in", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { RemoteScreen } from "@/screens/remote";

// Locale-agnóstico: o IdiomaProvider resolve EN no happy-dom (navigator en-US),
// mas o teste não deve depender do idioma — casa pt E en.
const TITULO_AVISO = /pode cair em breve|may drop soon/i;
const BOTAO_HOST = /preciso de suporte|i need support/i;

/** O banner (AlertTitle) está no ecrã? */
function bannerVisivel(): boolean {
  return screen.queryByText(TITULO_AVISO) != null;
}

/** Monta o ecrã e leva-o até `connected` como host (captura `aoEvento`). */
async function montarEConectarHost(): Promise<void> {
  render(
    <IdiomaProvider>
      <RemoteScreen />
    </IdiomaProvider>,
  );
  // modoHost → iniciarHost (clicar no texto borbulha pro <button> do CartaoModo).
  fireEvent.click(screen.getByText(BOTAO_HOST));
  // Flush do connect (async) + do pareamento (microtask) + do iniciarSessaoRemota.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
  });
}

/** Emite um evento de transporte pelo caminho real (`aoEvento` capturado). */
async function emitir(ev: { type: string }): Promise<void> {
  await act(async () => {
    h.cap.aoEvento?.(ev);
    await vi.advanceTimersByTimeAsync(0);
  });
}

/** Avança o relógio (timers falsos → `Date.now` falso) e deixa o efeito reavaliar. */
async function avancar(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  h.cap.aoEvento = undefined;
  h.cap.onIceServersRenovados = undefined;
  // happy-dom pode não ter crypto.randomUUID; o iniciarHost usa-o.
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    Object.defineProperty(globalThis, "crypto", {
      value: { ...(globalThis.crypto ?? {}), randomUUID: () => "test-uuid" },
      configurable: true,
    });
  }
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("#1148 (+retry) a carência do banner, pelo consumidor real (remote.tsx)", () => {
  it("conecta sem aviso (C-base): credencial sem expiração e sem renovação pendente → banner apagado", async () => {
    await montarEConectarHost();
    expect(h.cap.aoEvento).toBeTypeOf("function"); // a sessão ligou de verdade
    expect(bannerVisivel()).toBe(false);
  });

  it("C2/C4: renew_ice_needed marca a pendência e, passados >30 s, o banner acende (horizonte nulo → só a pendência pode acender)", async () => {
    await montarEConectarHost();
    await emitir({ type: "renew_ice_needed" });
    expect(bannerVisivel()).toBe(false); // ainda dentro da carência
    await avancar(46_000); // > 30 s pendente
    expect(bannerVisivel()).toBe(true);
  });

  it("C1: a RETENTATIVA não reinicia a carência — ela conta desde a 1.ª tentativa", async () => {
    await montarEConectarHost();
    await emitir({ type: "renew_ice_needed" }); // 1.ª tentativa, t0
    await avancar(20_000); // 20 s: ainda apagado
    expect(bannerVisivel()).toBe(false);
    await emitir({ type: "renew_ice_needed" }); // retentativa (backoff do Rust), t0+20
    await avancar(26_000); // +26 s → 46 s desde t0, mas só 26 s desde a 2.ª
    // Correto: conta desde t0 (46 s) → ACESO. Mutante C1 (reinicia): 26 s → apagado.
    expect(bannerVisivel()).toBe(true);
  });

  it("C3: uma renovação BEM-sucedida (onIceServersRenovados) limpa a pendência e apaga o banner", async () => {
    await montarEConectarHost();
    await emitir({ type: "renew_ice_needed" });
    await avancar(46_000);
    expect(bannerVisivel()).toBe(true); // aceso pela carência
    await act(async () => {
      h.cap.onIceServersRenovados?.(ICE_SEM_EXPIRACAO);
      await vi.advanceTimersByTimeAsync(0);
    });
    // CRÍTICO p/ o C3: avança um tick do intervalo (15 s). O `registrarExpiracao`
    // apaga o aviso na hora de qualquer jeito; o que o C3 testa é se a PENDÊNCIA
    // foi limpa — se não foi, o próximo tick do relógio re-acende o banner.
    await avancar(16_000);
    expect(bannerVisivel()).toBe(false); // sucesso → some e FICA apagado (pendência limpa)
  });
});
