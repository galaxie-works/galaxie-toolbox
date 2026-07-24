import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

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
    <button
      type="button"
      aria-label={rotulo}
      title={rotulo}
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

  return (
    <div
      className={cn(
        "fixed top-0 right-0 z-50 flex h-8 items-stretch select-none",
        className
      )}
    >
      <Botao rotulo="Minimizar" onClick={async () => (await janela()).minimize()}>
        <Minimizar />
      </Botao>
      <Botao
        rotulo={maximizada ? "Restaurar" : "Maximizar"}
        onClick={async () => (await janela()).toggleMaximize()}
      >
        {maximizada ? <Restaurar /> : <Maximizar />}
      </Botao>
      <Botao rotulo="Fechar" perigo onClick={async () => (await janela()).close()}>
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
