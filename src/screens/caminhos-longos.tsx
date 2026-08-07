import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { Spinner } from "@/components/ui/spinner";
import * as api from "@/lib/api";
import { useIdioma } from "@/lib/idioma";
import { AlertTriangle, Check, ShieldCheck } from "lucide-react";

/**
 * Liga o suporte a caminhos com mais de 260 caracteres no Windows.
 * Escrever em HKLM exige elevacao, entao o backend dispara um UAC.
 */
export function CaminhosLongosScreen() {
  const { t } = useIdioma();
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
    <div className="max-w-3xl">
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">{t.caminhosLongos.titulo}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t.caminhosLongos.descricao}
            </p>
          </div>
          {ligado === null ? (
            <Badge variant="muted">{t.caminhosLongos.verificando}</Badge>
          ) : ligado ? (
            <Badge variant="success">
              <Check className="size-3" /> {t.caminhosLongos.ativado}
            </Badge>
          ) : (
            <Badge variant="warning">{t.caminhosLongos.desativado}</Badge>
          )}
        </div>

        <Alert variant="success" className="mt-5">
          <ShieldCheck />
          <AlertDescription>{t.caminhosLongos.aviso}</AlertDescription>
        </Alert>

        {erro && (
          <Alert variant="destructive" className="mt-3">
            <AlertTriangle />
            <AlertDescription data-selecionavel>{erro}</AlertDescription>
          </Alert>
        )}

        <div className="mt-5">
          {ligado ? (
            <p className="text-sm text-muted-foreground">
              {t.caminhosLongos.nadaAFazer}
            </p>
          ) : (
            <Button onClick={ligar} disabled={aplicando || ligado === null}>
              {aplicando ? (
                <>
                  <Spinner data-icon="inline-start" /> {t.caminhosLongos.aplicando}
                </>
              ) : (
                t.caminhosLongos.ativar
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
