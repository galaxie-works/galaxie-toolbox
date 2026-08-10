import { useEffect, useState } from "react";
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FrameTitle,
} from "@/components/reui/frame";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import SoftBlurIn from "@/components/smoothui/soft-blur-in";
import * as api from "@/lib/api";
import { useIdioma } from "@/lib/idioma";
import { toast } from "sonner";
import { MonitorCog } from "lucide-react";

/**
 * Tela Windows (#665) — página de opções no estilo **Settings > System**: uma
 * coluna de frames de opção (mesmo card `estatico` do `OptionFrame` de
 * `configuracoes.tsx` — `Frame stacked` + título/descrição à esquerda, controle à
 * direita). 1ª opção = **Enable long paths**, reusando o backend
 * `long_paths_status`/`enable_long_paths` já provado na antiga `CaminhosLongosScreen`.
 * Extensível: novas opções entram como novos `<*Frame/>` abaixo.
 */
export function WindowsScreen() {
  const { t } = useIdioma();
  return (
    <div className="flex h-full flex-col gap-4">
      {/* Hero — mesmo padrão do Settings/Apps: ícone + título animado. */}
      <div className="flex shrink-0 items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
          <MonitorCog className="size-5" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">
          <SoftBlurIn delay={80} stagger={16}>
            {t.windows.titulo}
          </SoftBlurIn>
        </h1>
      </div>

      {/* Coluna de frames de opção (extensível — novas opções entram aqui). */}
      <div className="min-w-0 flex-1 space-y-3 overflow-y-auto pr-1">
        <LongPathsFrame />
      </div>
    </div>
  );
}

/**
 * Opção "Enable long paths": o switch reflete o status REAL (`long_paths_status`);
 * ligar chama `enable_long_paths` (escreve em HKLM → dispara UAC). O backend só
 * HABILITA (não desliga), então quando já está ligado o switch fica ON e
 * desabilitado ("nada a fazer"). Falha de elevação → toast + volta pro estado real.
 */
function LongPathsFrame() {
  const { t } = useIdioma();
  const [ligado, setLigado] = useState<boolean | null>(null);
  const [aplicando, setAplicando] = useState(false);

  useEffect(() => {
    api.longPathsStatus().then(setLigado).catch(() => setLigado(false));
  }, []);

  async function ligar(novo: boolean) {
    if (!novo || ligado || aplicando) return; // só liga; já-ligado = nada a fazer
    setAplicando(true);
    try {
      await api.enableLongPaths(); // dispara UAC
      setLigado(await api.longPathsStatus());
    } catch (e) {
      toast.error(t.windows.erroAtivar, { description: String(e) });
      // Elevação negada não muda o registro → volta o switch pro estado REAL.
      setLigado(await api.longPathsStatus().catch(() => false));
    } finally {
      setAplicando(false);
    }
  }

  return (
    <Frame className="w-full" stacked>
      <FrameHeader className="flex grow flex-row items-center justify-between gap-3">
        <div className="min-w-0">
          <FrameTitle>{t.windows.longPathsTitulo}</FrameTitle>
          <FrameDescription>{t.windows.longPathsDesc}</FrameDescription>
        </div>
        {ligado === null ? (
          <Spinner className="size-4 text-muted-foreground" />
        ) : (
          <div className="flex items-center gap-2">
            {aplicando && <Spinner className="size-4 text-muted-foreground" />}
            <Switch
              checked={ligado}
              disabled={ligado || aplicando}
              onCheckedChange={ligar}
              aria-label={t.caminhosLongos.ativar}
            />
          </div>
        )}
      </FrameHeader>
    </Frame>
  );
}
