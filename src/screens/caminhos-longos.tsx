import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import * as api from "@/lib/api";
import { AlertTriangle, Check, Loader2, ShieldCheck } from "lucide-react";

/**
 * Liga o suporte a caminhos com mais de 260 caracteres no Windows.
 * Escrever em HKLM exige elevacao, entao o backend dispara um UAC.
 */
export function CaminhosLongosScreen() {
  const [ligado, setLigado] = useState<boolean | null>(null);
  const [aplicando, setAplicando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api.longPathsStatus().then(setLigado).catch(() => setLigado(null));
  }, []);

  async function ligar() {
    setAplicando(true);
    setErro(null);
    try {
      await api.enableLongPaths();
      setLigado(await api.longPathsStatus());
    } catch (e) {
      setErro(String(e));
    } finally {
      setAplicando(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Caminhos longos</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Por padrão o Windows trava em 260 caracteres de caminho. Pastas de
              projeto muito aninhadas passam disso e o arquivo simplesmente não
              abre — nem pelo Explorer, nem pelos aplicativos.
            </p>
          </div>
          {ligado === null ? (
            <Badge variant="muted">verificando</Badge>
          ) : ligado ? (
            <Badge variant="success">
              <Check className="size-3" /> Ativado
            </Badge>
          ) : (
            <Badge variant="warning">Desativado</Badge>
          )}
        </div>

        <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 p-3.5">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[color:var(--success)]" />
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            A alteração é feita no registro do Windows e vale para o computador
            inteiro, por isso o Windows vai pedir sua confirmação de
            administrador. Alguns programas só reconhecem a mudança depois de
            reiniciar.
          </p>
        </div>

        {erro && (
          <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 p-3.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <p className="text-[12.5px] leading-relaxed text-destructive">{erro}</p>
          </div>
        )}

        <div className="mt-5">
          {ligado ? (
            <p className="text-sm text-muted-foreground">
              Nada a fazer — este computador já aceita caminhos longos.
            </p>
          ) : (
            <Button onClick={ligar} disabled={aplicando || ligado === null}>
              {aplicando ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Aplicando...
                </>
              ) : (
                "Ativar caminhos longos"
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
