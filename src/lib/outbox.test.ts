import assert from "node:assert/strict"
import { test } from "node:test"

import { agendarEnvio } from "./outbox.ts"

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
