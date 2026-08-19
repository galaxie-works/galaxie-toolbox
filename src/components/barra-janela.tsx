import { cn } from "@/lib/utils";
import { useIdioma } from "@/lib/idioma";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useEffect, useState } from "react";
import { telAcaoConcluida } from "@/lib/telemetria";

const noTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Ícones no traço fino do Windows 11, não os do lucide (que são grossos demais nesse tamanho). */
const Minimizar = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
    <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
  </svg>
);
const Maximizar = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden fill="none">
    <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1" />
  </svg>
);
const Restaurar = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden fill="none">
    <rect x="0.5" y="2.5" width="7" height="7" stroke="currentColor" strokeWidth="1" />
    <path d="M2.5 2.5V0.5h7v7h-2" stroke="currentColor" strokeWidth="1" />
  </svg>
);
const Fechar = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
    <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" />
  </svg>
);

function Botao({
  children,
  onClick,
  rotulo,
  perigo,
}: {
  children: React.ReactNode;
  onClick: () => void;
  rotulo: string;
  perigo?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={rotulo}
          onClick={onClick}
          className={cn(
            "inline-grid h-full w-[46px] cursor-pointer place-items-center text-foreground/80",
            "transition-colors hover:text-foreground",
            perigo
              ? "hover:bg-[#c42b1c] hover:text-white"
              : "hover:bg-foreground/10"
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      {/* side="bottom": os botões estão colados no topo da janela; um tooltip
          "top" sairia para fora da tela. */}
      <TooltipContent side="bottom">{rotulo}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Controles de janela desenhados por nós — a janela roda com decorations:false.
 *
 * Ficam fixos no topo direito, acima de tudo. Quem arrasta a janela é o
 * cabeçalho (data-tauri-drag-region); aqui os botões precisam continuar
 * clicáveis, então a barra em si não é área de arrasto.
 *
 * Largura de 46px e o vermelho #c42b1c no fechar são os do Windows 11: a
 * pessoa já tem esse alvo na memória muscular.
 */
export function BarraJanela({ className }: { className?: string }) {
  const { t } = useIdioma();
  const [maximizada, setMaximizada] = useState(false);

  useEffect(() => {
    if (!noTauri()) return;
    let parar: (() => void) | undefined;
    (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const j = getCurrentWindow();
      setMaximizada(await j.isMaximized());
      // Maximizar tambem acontece por atalho e por arrastar para o topo, entao
      // o icone segue o evento da janela, nao so o nosso clique.
      parar = await j.onResized(async () => setMaximizada(await j.isMaximized()));
    })();
    return () => parar?.();
  }, []);

  if (!noTauri()) return null;

  async function janela() {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow();
  }

  /**
   * FUNIL ÚNICO dos comandos de janela (#1179).
   *
   * Os três handlers eram `onClick={async () => (await janela()).minimize()}` —
   * sem `catch`. Falha do lado nativo (permissão negada, IPC recusado, janela
   * não encontrada) virava rejeição não-tratada: o botão respondia ao hover,
   * nada acontecia, e NADA aparecia em lugar nenhum. Foi assim que a regressão
   * do passe de runtime do PO ("clicáveis, mas nenhuma ação acontece") chegou
   * a produção sem deixar rastro.
   *
   * Aqui a falha vira sinal: `console.error` com o comando nomeado (visível no
   * DevTools) + telemetria (`resultado: "erro"`, sem PII). Um lugar só — quem
   * adicionar um quarto botão herda o tratamento em vez de ter que lembrar.
   *
   * Isto NÃO conserta a inércia: instrumenta. Se a causa for o nativo recusando
   * a chamada, ela passa a se denunciar sozinha na primeira execução.
   */
  async function comandoJanela(
    nome: "minimizar" | "maximizar" | "fechar",
    acao: (j: Awaited<ReturnType<typeof janela>>) => Promise<void>
  ) {
    try {
      await acao(await janela());
      telAcaoConcluida(`janela_${nome}`, "ok");
    } catch (e) {
      console.error(`[barra-janela] comando "${nome}" falhou:`, e);
      telAcaoConcluida(`janela_${nome}`, "erro");
    }
  }

  return (
    <div
      className={cn(
        "fixed top-0 right-0 z-50 flex h-8 items-stretch select-none",
        className
      )}
    >
      <Botao
        rotulo={t.janela.minimizar}
        onClick={() => void comandoJanela("minimizar", (j) => j.minimize())}
      >
        <Minimizar />
      </Botao>
      <Botao
        rotulo={maximizada ? t.janela.restaurar : t.janela.maximizar}
        onClick={() => void comandoJanela("maximizar", (j) => j.toggleMaximize())}
      >
        {maximizada ? <Restaurar /> : <Maximizar />}
      </Botao>
      <Botao
        rotulo={t.janela.fechar}
        perigo
        onClick={() => void comandoJanela("fechar", (j) => j.close())}
      >
        <Fechar />
      </Botao>
    </div>
  );
}

/**
 * Faixa de arrasto para telas sem cabeçalho (login e carregamento). No app o
 * próprio cabeçalho já cumpre esse papel.
 */
export function FaixaArrasto() {
  if (!noTauri()) return null;
  return (
    <div
      data-tauri-drag-region
      className="fixed inset-x-0 top-0 z-40 h-8"
      aria-hidden
    />
  );
}
