import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import {
  agendarEnvio,
  type AgendamentoEnvio,
  type ProgressoEnvioPendente,
} from "@/lib/outbox"
import { toastDesfazerEnvio } from "@/lib/toasts"
import { useAppStore } from "@/store"

export type EstadoUndoSend =
  | { fase: "ocioso"; segundosRestantes: 0 }
  | { fase: "pendente"; segundosRestantes: number }
  | { fase: "enviando"; segundosRestantes: 0 }

export interface TextosUndoSend {
  tituloPendente: (segundos: number) => string
  descricaoPendente: string
  rotuloDesfazer: string
  envioCancelado: string
  enviando: string
}

export interface TarefaUndoSend {
  enviar: () => Promise<void>
  onConcluido: () => void
  onErro: (erro: unknown) => void
}

/**
 * Integra o agendador em memória com o toast canônico. O callback de envio só
 * recebe o controle depois dos 10 s; até lá `desfazer` é síncrono e confiável.
 * O cleanup cancela silenciosamente qualquer item ainda pendente.
 */
export function useUndoSend(textos: TextosUndoSend) {
  const [estado, setEstado] = useState<EstadoUndoSend>({
    fase: "ocioso",
    segundosRestantes: 0,
  })
  // Atraso configurável (#150): 5/10/30 s escolhidos em Settings > Bridge. Sem
  // valor salvo o slice devolve o padrão de 10 s (mantém o comportamento da #33).
  const atrasoMs = useAppStore((s) => s.undoSendDelayMs)
  const agendamentoRef = useRef<AgendamentoEnvio | null>(null)
  const toastIdRef = useRef<string | number | null>(null)

  const dispensarToast = useCallback(() => {
    if (toastIdRef.current !== null) toast.dismiss(toastIdRef.current)
    toastIdRef.current = null
  }, [])

  const desfazer = useCallback(() => {
    return agendamentoRef.current?.desfazer() ?? false
  }, [])

  const agendar = useCallback(
    (tarefa: TarefaUndoSend): boolean => {
      if (agendamentoRef.current !== null) return false

      const atualizarToast = ({
        segundosRestantes,
        progresso,
      }: ProgressoEnvioPendente) => {
        setEstado({ fase: "pendente", segundosRestantes })
        toastIdRef.current = toastDesfazerEnvio({
          id: toastIdRef.current ?? undefined,
          titulo: textos.tituloPendente(segundosRestantes),
          descricao: textos.descricaoPendente,
          progresso,
          rotuloDesfazer: textos.rotuloDesfazer,
          onDesfazer: desfazer,
        })
      }

      const agendamento = agendarEnvio({
        enviar: tarefa.enviar,
        atrasoMs,
        onContagem: atualizarToast,
        onDisparando: () => {
          setEstado({ fase: "enviando", segundosRestantes: 0 })
          if (toastIdRef.current !== null) {
            toast.loading(textos.enviando, { id: toastIdRef.current })
          }
        },
        onDesfeito: () => {
          agendamentoRef.current = null
          dispensarToast()
          setEstado({ fase: "ocioso", segundosRestantes: 0 })
          toast.success(textos.envioCancelado)
        },
        onConcluido: () => {
          agendamentoRef.current = null
          dispensarToast()
          setEstado({ fase: "ocioso", segundosRestantes: 0 })
          tarefa.onConcluido()
        },
        onErro: (erro) => {
          agendamentoRef.current = null
          dispensarToast()
          setEstado({ fase: "ocioso", segundosRestantes: 0 })
          tarefa.onErro(erro)
        },
      })

      agendamentoRef.current = agendamento
      return true
    },
    [atrasoMs, desfazer, dispensarToast, textos]
  )

  useEffect(
    () => () => {
      agendamentoRef.current?.cancelar()
      agendamentoRef.current = null
      if (toastIdRef.current !== null) toast.dismiss(toastIdRef.current)
      toastIdRef.current = null
    },
    []
  )

  return {
    agendar,
    desfazer,
    estado,
    ocupado: estado.fase !== "ocioso",
  }
}
