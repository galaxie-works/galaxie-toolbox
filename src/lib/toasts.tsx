import { toast } from "sonner"
import {
  SendIcon,
  FlagIcon,
  FlagOffIcon,
  DownloadIcon,
  FileIcon,
  Undo2Icon,
} from "lucide-react"
import type { ReactNode } from "react"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"

/**
 * Helpers de toast reutilizáveis, agnósticos a i18n.
 * Todo texto exibido é passado por parâmetro — o chamador fornece as strings já traduzidas.
 * Estilo visual baseado nos exemplos reui c-sonner-19 / c-sonner-10 / c-sonner-9.
 */

/**
 * Toast simples com ícone (padrão c-sonner-19).
 * O ícone é escolhido pelo `tipo`.
 */
export function toastIcone(
  titulo: string,
  descricao: string,
  tipo: "enviado" | "marcado" | "desmarcado",
): void {
  const icones: Record<typeof tipo, ReactNode> = {
    enviado: <SendIcon className="size-4" />,
    marcado: <FlagIcon className="size-4" />,
    desmarcado: <FlagOffIcon className="size-4" />,
  }

  toast(titulo, {
    description: descricao,
    icon: icones[tipo],
  })
}

/**
 * Countdown do Outbox (#33), copiando a estrutura canônica do c-sonner-10:
 * card customizado, progresso atualizado pelo mesmo toast id e ação explícita.
 */
export function toastDesfazerEnvio(opts: {
  id?: string | number
  titulo: string
  descricao: string
  progresso: number
  rotuloDesfazer: string
  onDesfazer: () => void
}): string | number {
  // O Sonner diferencia "id ausente" de `id: undefined`: na primeira chamada,
  // omitir a chave permite que ele gere o id que as atualizações seguintes
  // reutilizam. Passar `undefined` deixava o toast inicial órfão.
  const configuracao =
    opts.id === undefined
      ? { duration: Infinity }
      : { id: opts.id, duration: Infinity }

  return toast.custom(
    () => (
      <div className="bg-popover text-popover-foreground border-border flex w-[356px] flex-col gap-3 rounded-md border p-4 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-md">
            <SendIcon className="size-4" aria-hidden="true" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="text-sm font-medium">{opts.titulo}</p>
            <p className="text-muted-foreground text-xs">{opts.descricao}</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={opts.onDesfazer}
          >
            <Undo2Icon aria-hidden="true" />
            {opts.rotuloDesfazer}
          </Button>
        </div>
        <Progress
          value={opts.progresso}
          className="**:data-[slot=progress-indicator]:bg-primary **:data-[slot=progress-track]:h-1.5"
        />
      </div>
    ),
    configuracao
  )
}

/**
 * Toast de download concluído com ações (padrão c-sonner-19 / c-sonner-9).
 */
export function toastDownload(opts: {
  titulo: string
  arquivo: string
  rotuloAbrir: string
  rotuloPasta: string
  onAbrir: () => void
  onPasta: () => void
}): void {
  const id = toast.custom(() => (
    <div className="bg-popover text-popover-foreground border-border flex w-[356px] flex-col gap-3 rounded-md border p-4 shadow-lg">
      <div className="flex items-center gap-3">
        <div className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-md">
          <DownloadIcon className="size-4" aria-hidden="true" />
        </div>
        <div className="flex flex-1 flex-col overflow-hidden">
          <p className="text-sm font-medium">{opts.titulo}</p>
          <p className="text-muted-foreground truncate text-xs">
            {opts.arquivo}
          </p>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            opts.onPasta()
            toast.dismiss(id)
          }}
        >
          {opts.rotuloPasta}
        </Button>
        <Button
          size="sm"
          onClick={() => {
            opts.onAbrir()
            toast.dismiss(id)
          }}
        >
          {opts.rotuloAbrir}
        </Button>
      </div>
    </div>
  ))
}

/**
 * Toast de mensagem recebida com avatar e ações (padrão c-sonner-9).
 */
export function toastMensagem(opts: {
  nome: string
  iniciais: string
  foto?: string | null
  texto: string
  quando: string
  rotuloResponder: string
  rotuloDispensar: string
  onResponder: () => void
}): void {
  toast.custom(() => (
    <div className="bg-popover text-popover-foreground border-border flex w-[356px] items-start gap-3 rounded-md border p-4 shadow-lg">
      <Avatar className="size-9 shrink-0">
        {opts.foto ? (
          <AvatarImage src={opts.foto} alt={opts.nome} />
        ) : (
          <AvatarFallback>{opts.iniciais}</AvatarFallback>
        )}
      </Avatar>
      <div className="flex flex-1 flex-col gap-1">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">{opts.nome}</p>
          <span className="text-muted-foreground text-xs">{opts.quando}</span>
        </div>
        <p className="text-muted-foreground line-clamp-2 text-sm">
          {opts.texto}
        </p>
        <div className="mt-2 flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => toast.dismiss()}
          >
            {opts.rotuloDispensar}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              opts.onResponder()
              toast.dismiss()
            }}
          >
            {opts.rotuloResponder}
          </Button>
        </div>
      </div>
    </div>
  ))
}

function UploadToast({
  nomeArquivo,
  tamanho,
  progress,
  rotuloConcluido,
  rotuloEnviando,
}: {
  nomeArquivo: string
  tamanho: string
  progress: number
  // #464 (S2): texto por parâmetro (convenção do arquivo) — nada de PT hardcoded.
  rotuloConcluido: string
  rotuloEnviando: string
}) {
  const done = progress >= 100

  return (
    <div className="bg-popover text-popover-foreground border-border flex w-[350px] flex-col gap-3 rounded-md border p-4 shadow-lg">
      <div className="flex items-center gap-3">
        <div className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-md">
          <FileIcon className="size-4" aria-hidden="true" />
        </div>
        <div className="flex flex-1 flex-col overflow-hidden">
          <p className="truncate text-sm font-medium">{nomeArquivo}</p>
          <p className="text-muted-foreground text-xs">
            {tamanho} &middot;{" "}
            {done ? rotuloConcluido : `${rotuloEnviando} ${progress}%`}
          </p>
        </div>
      </div>
      <Progress
        value={progress}
        className="**:data-[slot=progress-indicator]:bg-success **:data-[slot=progress-track]:h-1.5"
      />
    </div>
  )
}

/**
 * Toast de upload com barra de progresso (padrão c-sonner-10).
 * Retorna um controlador para atualizar o progresso e concluir.
 */
export function toastUpload(
  nomeArquivo: string,
  tamanho: string,
  // #464 (S2): rótulos traduzidos pelo chamador (convenção do arquivo).
  rotulos: { concluido: string; enviando: string },
): { atualizar(progress: number): void; concluir(): void } {
  let progress = 0

  const id = toast.custom(
    () => (
      <UploadToast
        nomeArquivo={nomeArquivo}
        tamanho={tamanho}
        progress={progress}
        rotuloConcluido={rotulos.concluido}
        rotuloEnviando={rotulos.enviando}
      />
    ),
    { duration: Infinity },
  )

  const render = (duration: number) => {
    toast.custom(
      () => (
        <UploadToast
          nomeArquivo={nomeArquivo}
          tamanho={tamanho}
          progress={progress}
          rotuloConcluido={rotulos.concluido}
          rotuloEnviando={rotulos.enviando}
        />
      ),
      { id, duration },
    )
  }

  return {
    atualizar(next: number) {
      progress = Math.max(0, Math.min(next, 100))
      render(Infinity)
    },
    concluir() {
      progress = 100
      render(3000)
    },
  }
}
