import { Component, type ErrorInfo, type ReactNode } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { logErro } from "@/lib/log";
import { revelarAppEFecharSplash } from "@/lib/splash";
import { useIdioma } from "@/lib/idioma";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Fallback visual do #148. Componente FUNCIONAL de propósito: mora abaixo do
 * IdiomaProvider (main.tsx) e acima só do que pode estourar, então pode usar o
 * hook de idioma com segurança para sair no idioma certo.
 */
function ErroFallback({ error }: { error: Error }) {
  const { t } = useIdioma();
  return (
    <div className="relative grid h-svh w-full place-items-center overflow-auto bg-background p-6">
      {/* Faixa de arrasto: o app quebrou, mas a janela sem decoração ainda
          precisa poder ser arrastada pra fora do caminho. */}
      <div data-tauri-drag-region className="fixed inset-x-0 top-0 h-8" />
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <TriangleAlert className="size-5" />
          </div>
          <CardTitle className="mt-3">{t.erro.titulo}</CardTitle>
          <CardDescription>{t.erro.descricao}</CardDescription>
        </CardHeader>
        <CardContent>
          <details className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium select-none">
              {t.erro.detalhes}
            </summary>
            <pre className="mt-2 max-h-40 overflow-auto break-words whitespace-pre-wrap">
              {error.message}
              {error.stack ? `\n\n${error.stack}` : ""}
            </pre>
          </details>
        </CardContent>
        <CardFooter>
          <Button onClick={() => window.location.reload()}>
            <RotateCcw />
            {t.erro.recarregar}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

/**
 * ErrorBoundary raiz (#148). Segura qualquer erro de render da árvore abaixo,
 * mostra o fallback (em vez de desmontar pra uma tela branca) e — no capricho
 * que "todo dev Delphi faria" — LOGA tudo: message + stack + componentStack, no
 * console E no log do backend (Rust). Fica FORA de tudo que pode estourar; por
 * isso o próprio fallback é enxuto e não depende do estado do app.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logErro("ErrorBoundary", error, info.componentStack ?? undefined);
    // Boot #164: se o crash aconteceu durante o boot, a main window ainda está
    // oculta atrás do splash. Revela a main (mostrando este fallback) e fecha a
    // splash — em vez de deixar o usuário preso na animação para sempre.
    void revelarAppEFecharSplash();
  }

  render(): ReactNode {
    if (this.state.error) return <ErroFallback error={this.state.error} />;
    return this.props.children;
  }
}
