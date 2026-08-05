import assert from "node:assert/strict"
import { test } from "node:test"

import { agendarEnvio, flushOutboxPendentes } from "./outbox.ts"

const esperar = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

test("undo cancels the pending operation before dispatch", async () => {
  let envios = 0
  let desfeitos = 0
  const agendamento = agendarEnvio({
    atrasoMs: 30,
    intervaloMs: 10,
    enviar: async () => {
      envios += 1
    },
    onDesfeito: () => {
      desfeitos += 1
    },
  })

  assert.equal(agendamento.desfazer(), true)
  assert.equal(agendamento.desfazer(), false)
  await esperar(50)

  assert.equal(envios, 0)
  assert.equal(desfeitos, 1)
  assert.equal(agendamento.fase(), "desfeito")
})

test("expiry dispatches exactly once and cannot be undone afterward", async () => {
  let envios = 0
  let concluidos = 0
  const agendamento = agendarEnvio({
    atrasoMs: 15,
    intervaloMs: 10,
    enviar: async () => {
      envios += 1
    },
    onConcluido: () => {
      concluidos += 1
    },
  })

  await esperar(40)

  assert.equal(envios, 1)
  assert.equal(concluidos, 1)
  assert.equal(agendamento.desfazer(), false)
  assert.equal(agendamento.fase(), "concluido")
})

test("cleanup cancellation is silent and prevents dispatch", async () => {
  let envios = 0
  let desfeitos = 0
  const agendamento = agendarEnvio({
    atrasoMs: 30,
    intervaloMs: 10,
    enviar: async () => {
      envios += 1
    },
    onDesfeito: () => {
      desfeitos += 1
    },
  })

  assert.equal(agendamento.cancelar(), true)
  assert.equal(agendamento.cancelar(), false)
  await esperar(50)

  assert.equal(envios, 0)
  assert.equal(desfeitos, 0)
  assert.equal(agendamento.fase(), "cancelado")
})

test("dispatch errors leave the scheduler in a failed phase", async () => {
  const erroEsperado = new Error("Graph rejected the message")
  let erroRecebido: unknown
  const agendamento = agendarEnvio({
    atrasoMs: 15,
    intervaloMs: 10,
    enviar: async () => {
      throw erroEsperado
    },
    onErro: (erro) => {
      erroRecebido = erro
    },
  })

  await esperar(40)

  assert.equal(erroRecebido, erroEsperado)
  assert.equal(agendamento.fase(), "falhou")
})

// #531 (AC4): "Desligado" = atrasoMs 0 envia na hora, SEM janela de undo.
test("atrasoMs 0 (Desligado) dispara na hora, sem contagem de undo", async () => {
  let envios = 0
  let contagens = 0
  const agendamento = agendarEnvio({
    atrasoMs: 0,
    enviar: async () => {
      envios += 1
    },
    onContagem: () => {
      contagens += 1
    },
  })

  await esperar(20)

  assert.equal(contagens, 0) // sem toast "Desfazer" no modo Desligado
  assert.equal(envios, 1)
  assert.equal(agendamento.fase(), "concluido")
})

// #531 (AC5): fechar o app na janela → flush dispara o pendente na hora.
test("flushOutboxPendentes dispara o envio pendente (fechamento do app)", async () => {
  let envios = 0
  const agendamento = agendarEnvio({
    atrasoMs: 10_000, // janela longa: não dispararia sozinho no teste
    intervaloMs: 10,
    enviar: async () => {
      envios += 1
    },
  })

  flushOutboxPendentes()
  await esperar(20)

  assert.equal(envios, 1) // o fechamento forçou o envio
  assert.equal(agendamento.fase(), "concluido")
  assert.equal(agendamento.desfazer(), false) // já saiu, não dá pra desfazer
})
