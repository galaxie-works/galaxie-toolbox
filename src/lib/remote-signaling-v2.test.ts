import { test } from "node:test";
import assert from "node:assert/strict";
import {
  montarEnvelopeRegistroV2,
  respostaV2ConfirmaRegistro,
  motivoFallbackV2,
  mensagemProbeV2,
  tentarRegistrarV2,
  type DepsProbeV2,
  type ResultadoV2Tipo,
  type WsMinimoV2,
} from "./remote-signaling-v2.ts";

// PoP de exemplo (formato do `remote_sign_register` do Rust). A `publicKey` NÃO
// entra no payload do fio — o teste-âncora prova isso.
const POP = {
  deviceId: "dev-abc",
  publicKey: "PUB_KEY_NAO_VAI_NO_FIO",
  nonce: "nonce-xyz",
  timestamp: 1_700_000_000,
  signature: "assinatura-base64",
};

// Fake de WebSocket dirigido por um "script" do servidor, agendado DEPOIS de os
// handlers serem atribuídos pelo probe (setTimeout 0).
function fakeWs(script: (ws: FakeSocket) => void): (url: string) => WsMinimoV2 {
  return () => {
    const ws: FakeSocket = {
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
      enviados: [],
      fechado: false,
      send(d: string) {
        this.enviados.push(d);
      },
      close() {
        this.fechado = true;
      },
    };
    setTimeout(() => script(ws), 0);
    return ws;
  };
}

interface FakeSocket extends WsMinimoV2 {
  enviados: string[];
  fechado: boolean;
}

function depsBase(over: Partial<DepsProbeV2>): DepsProbeV2 {
  return {
    endpointV2: "wss://host.example/remote/v2/ws",
    obterPoP: async () => POP,
    abrirWs: fakeWs(() => {}),
    gerarId: () => "id-fixo",
    timeoutMs: 30,
    ...over,
  };
}

function ackValido(id: string): string {
  return JSON.stringify({
    v: 2,
    id,
    type: "response",
    method: "device.register",
    payload: null,
  });
}

// ── ÂNCORA DO WIRE ──────────────────────────────────────────────────────────
test("#1129 montarEnvelopeRegistroV2: Envelope v2 no formato do protocol.rs", () => {
  const env = montarEnvelopeRegistroV2(POP, "id-1");
  assert.equal(env.v, 2);
  assert.equal(env.id, "id-1");
  assert.equal(env.type, "request");
  assert.equal(env.method, "device.register");
  // payload ANINHADO, camelCase, só os 4 campos do DeviceRegister.
  assert.deepEqual(env.payload, {
    deviceId: "dev-abc",
    nonce: "nonce-xyz",
    timestamp: 1_700_000_000,
    signature: "assinatura-base64",
  });
  // A publicKey NÃO vai no fio (server resolve pelo deviceId).
  assert.equal("publicKey" in env.payload, false);
  // E o JSON serializado tem exatamente as chaves esperadas.
  const j = JSON.parse(JSON.stringify(env));
  assert.deepEqual(Object.keys(j), ["v", "id", "type", "method", "payload"]);
  assert.deepEqual(Object.keys(j.payload), [
    "deviceId",
    "nonce",
    "timestamp",
    "signature",
  ]);
});

test("#1129 respostaV2ConfirmaRegistro: só o ACK exato confirma", () => {
  assert.equal(
    respostaV2ConfirmaRegistro(
      { v: 2, id: "x", type: "response", method: "device.register" },
      "x",
    ),
    true,
  );
  // id diferente do request → não confirma.
  assert.equal(
    respostaV2ConfirmaRegistro(
      { v: 2, id: "y", type: "response", method: "device.register" },
      "x",
    ),
    false,
  );
  // type errado, method errado, versão errada, não-objeto → não confirma.
  assert.equal(
    respostaV2ConfirmaRegistro({ v: 2, id: "x", type: "request", method: "device.register" }, "x"),
    false,
  );
  assert.equal(
    respostaV2ConfirmaRegistro({ v: 2, id: "x", type: "response", method: "device.heartbeat" }, "x"),
    false,
  );
  assert.equal(
    respostaV2ConfirmaRegistro({ v: 1, id: "x", type: "response", method: "device.register" }, "x"),
    false,
  );
  assert.equal(respostaV2ConfirmaRegistro(null, "x"), false);
});

test("#1129 mensagemProbeV2: resultado + motivo, no formato do AC", () => {
  assert.equal(motivoFallbackV2("registrado"), "v2 sem ice_servers (#1133)");
  assert.equal(motivoFallbackV2("nao-matriculado"), "device não matriculado");
  assert.equal(motivoFallbackV2("timeout"), "timeout");
  assert.equal(motivoFallbackV2("erro"), "erro");
  assert.equal(
    mensagemProbeV2("registrado"),
    "[remote] v2 register: registrado — usando v1 (motivo: v2 sem ice_servers (#1133))",
  );
  assert.equal(
    mensagemProbeV2("timeout"),
    "[remote] v2 register: timeout — usando v1 (motivo: timeout)",
  );
  // NUNCA vaza a assinatura/chave/nonce na linha de log.
  for (const t of ["registrado", "nao-matriculado", "timeout", "erro"] as ResultadoV2Tipo[]) {
    const m = mensagemProbeV2(t);
    assert.equal(m.includes(POP.signature), false);
    assert.equal(m.includes(POP.publicKey), false);
    assert.equal(m.includes(POP.nonce), false);
  }
});

// ── ROBUSTEZ DO PROBE (invariante que protege o v1) ─────────────────────────
test("#1129 probe: ACK válido → registrado, manda o Envelope certo e fecha o WS", async () => {
  let capturado: FakeSocket | null = null;
  const deps = depsBase({
    abrirWs: () => {
      const ws: FakeSocket = {
        onopen: null,
        onmessage: null,
        onerror: null,
        onclose: null,
        enviados: [],
        fechado: false,
        send(d: string) {
          this.enviados.push(d);
        },
        close() {
          this.fechado = true;
        },
      };
      capturado = ws;
      setTimeout(() => {
        ws.onopen?.();
        ws.onmessage?.({ data: ackValido("id-fixo") });
      }, 0);
      return ws;
    },
  });
  const r = await tentarRegistrarV2(deps);
  assert.equal(r.tipo, "registrado");
  assert.equal(r.mensagem, mensagemProbeV2("registrado"));
  // Mandou exatamente o Envelope montado.
  assert.deepEqual(
    JSON.parse(capturado!.enviados[0]),
    JSON.parse(JSON.stringify(montarEnvelopeRegistroV2(POP, "id-fixo"))),
  );
  // Probe fecha o WS (é só probe — não segura conexão).
  assert.equal(capturado!.fechado, true);
});

test("#1129 probe: WS fecha antes do ACK → erro (v1 segue)", async () => {
  const deps = depsBase({
    abrirWs: fakeWs((ws) => {
      ws.onopen?.();
      ws.onclose?.();
    }),
  });
  const r = await tentarRegistrarV2(deps);
  assert.equal(r.tipo, "erro");
});

test("#1129 probe: sem resposta → timeout (não pendura o v1)", async () => {
  const deps = depsBase({
    timeoutMs: 15,
    abrirWs: fakeWs((ws) => {
      ws.onopen?.();
      // servidor mudo: nunca responde.
    }),
  });
  const r = await tentarRegistrarV2(deps);
  assert.equal(r.tipo, "timeout");
});

test("#1129 probe: PoP falha (comando indisponível) → erro, nunca lança", async () => {
  const deps = depsBase({
    obterPoP: async () => {
      throw new Error("remote_sign_register indisponível");
    },
  });
  // Resolve com erro — NÃO rejeita (invariante: v1 nunca quebra).
  const r = await tentarRegistrarV2(deps);
  assert.equal(r.tipo, "erro");
});

test("#1129 probe: abrirWs lança → erro, nunca lança", async () => {
  const deps = depsBase({
    abrirWs: () => {
      throw new Error("URL inválida");
    },
  });
  const r = await tentarRegistrarV2(deps);
  assert.equal(r.tipo, "erro");
});
