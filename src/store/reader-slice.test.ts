import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  EmailDetalhe,
  InsightsRemetente,
  SegurancaEmail,
} from "../lib/types.ts";
import {
  criarReaderSlice,
  type ReaderSlice,
} from "./reader-slice.ts";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

function detalhe(assunto: string): EmailDetalhe {
  return {
    assunto,
    de: "Ana",
    deEmail: "ana@galaxie.works",
    para: ["Codex"],
    cc: [],
    paraEmails: ["codex@galaxie.works"],
    ccEmails: [],
    recebido: "2026-07-29T07:00:00Z",
    corpo: `<p>${assunto}</p>`,
    corpoTipo: "html",
    anexos: [],
    webLink: "https://outlook.office.com",
  };
}

function seguranca(resultado: string): SegurancaEmail {
  return {
    replyTo: [],
    autenticacao: [resultado],
    receivedSpf: [],
  };
}

function criarStoreDeTeste(api: Parameters<typeof criarReaderSlice>[0]) {
  const state = {} as ReaderSlice;
  const set = (
    update:
      | Partial<ReaderSlice>
      | ((atual: ReaderSlice) => Partial<ReaderSlice>),
  ) => {
    Object.assign(state, typeof update === "function" ? update(state) : update);
  };
  const slice = criarReaderSlice(api)(
    set as never,
    (() => state) as never,
    {} as never,
  );
  return Object.assign(state, slice);
}

test("fast message switch ignores stale body and security responses", async () => {
  const corpos = new Map<string, Deferred<EmailDetalhe>>();
  const segurancas = new Map<string, Deferred<SegurancaEmail>>();
  const store = criarStoreDeTeste({
    carregarCorpo: (id) => {
      const d = deferred<EmailDetalhe>();
      corpos.set(id, d);
      return d.promise;
    },
    carregarSeguranca: (id) => {
      const d = deferred<SegurancaEmail>();
      segurancas.set(id, d);
      return d.promise;
    },
    carregarInsights: async () => ({}),
  });

  const primeira = store.carregarLeitor({ id: "m-1", mailbox: "me" });
  const segunda = store.carregarLeitor({ id: "m-2", mailbox: "shared@example.com" });

  assert.deepEqual(store.leitorAlvo, {
    id: "m-2",
    mailbox: "shared@example.com",
  });
  corpos.get("m-1")!.resolve(detalhe("antiga"));
  segurancas.get("m-1")!.resolve(seguranca("spf=fail"));
  await primeira;
  await Promise.resolve();

  assert.equal(store.leitorDetalhe, null);
  assert.equal(store.leitorSeguranca, null);

  corpos.get("m-2")!.resolve(detalhe("atual"));
  segurancas.get("m-2")!.resolve(seguranca("spf=pass"));
  await segunda;
  await Promise.resolve();

  assert.equal(store.leitorDetalhe?.assunto, "atual");
  assert.deepEqual(store.leitorSeguranca?.autenticacao, ["spf=pass"]);
});

test("clear invalidates in-flight reader data and resets reader-owned state", async () => {
  const corpo = deferred<EmailDetalhe>();
  const segurancaPendente = deferred<SegurancaEmail>();
  const store = criarStoreDeTeste({
    carregarCorpo: async () => corpo.promise,
    carregarSeguranca: async () => segurancaPendente.promise,
    carregarInsights: async () => ({}),
  });

  const carregamento = store.carregarLeitor({ id: "m-1", mailbox: "me" });
  store.limparLeitor();
  corpo.resolve(detalhe("não deve entrar"));
  segurancaPendente.resolve(seguranca("spf=pass"));
  await carregamento;
  await Promise.resolve();

  assert.equal(store.leitorAlvo, null);
  assert.equal(store.leitorDetalhe, null);
  assert.equal(store.leitorSeguranca, null);
});

test("sender insights are lazy, retryable, and stale-safe after close", async () => {
  const pedidos: Deferred<InsightsRemetente>[] = [];
  const store = criarStoreDeTeste({
    carregarCorpo: async () => detalhe("mensagem"),
    carregarSeguranca: async () => seguranca("spf=pass"),
    carregarInsights: async () => {
      const d = deferred<InsightsRemetente>();
      pedidos.push(d);
      return d.promise;
    },
  });

  const primeira = store.abrirInsights("ana@galaxie.works");
  assert.equal(store.insightsEstado, "carregando");
  assert.equal(pedidos.length, 1);

  store.fecharInsights();
  pedidos[0].resolve({ recebidos: 99 });
  await primeira;
  assert.equal(store.insightsAberto, false);
  assert.equal(store.insightsEstado, "idle");
  assert.equal(store.insightsDados, null);

  const segunda = store.abrirInsights("ana@galaxie.works");
  assert.equal(pedidos.length, 2);
  pedidos[1].resolve({ recebidos: 12, enviados: 3 });
  await segunda;
  assert.equal(store.insightsEstado, "ok");
  assert.deepEqual(store.insightsDados, { recebidos: 12, enviados: 3 });

  store.fecharInsights();
  await store.abrirInsights("ana@galaxie.works");
  assert.equal(pedidos.length, 2, "cached success must not refetch");
  assert.equal(store.insightsAberto, true);
});
