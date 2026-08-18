import AnimatedTabs from "@/components/smoothui/animated-tabs";
import { MetricaChip } from "@/components/metrica-chip";
import { Alert, AlertDescription } from "@/components/reui/alert";
import {
  Frame,
  FrameDescription,
  FrameFooter,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@/components/reui/frame";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { ConnectIcon, type ConnectIconHandle } from "@/components/ui/connect";
import { FileStackIcon } from "@/components/ui/file-stack";
import { FolderOpenIcon } from "@/components/ui/folder-open";
import { FolderTreeIcon } from "@/components/ui/folder-tree";
import { FoldersIcon } from "@/components/ui/folders";
import { HammerIcon } from "@/components/ui/hammer";
import { Spinner } from "@/components/ui/spinner";
import { SquareActivityIcon } from "@/components/ui/square-activity";
import {
  ConfirmarBiblioteca,
  type ModoConfirmacao,
} from "@/components/confirmar-biblioteca";
import { MeusArquivosScreen } from "@/screens/meus-arquivos";
import { RecursoOrgEmpty } from "@/components/recurso-org-empty";
import { useTier } from "@/lib/tier-context";
import { formatBytes } from "@/lib/utils";
import { preencher, useIdioma } from "@/lib/idioma";
import type { Dicionario } from "@/lib/strings";
import type { Site } from "@/lib/types";
import { AlertTriangle, Hammer, Info, Loader2, Lock } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useAppStore } from "@/store";

// #1025 (FE11, parte B): EmBreve é lazy no App.tsx; este segundo importador
// (estático) o prendia no chunk `index` do boot. Dinâmico aqui também → a tela
// vira chunk próprio, carregado só quando a aba "problemas" abre.
const EmBreveScreen = lazy(() =>
  import("@/screens/em-breve").then((m) => ({ default: m.EmBreveScreen })),
);

/* size padrao dos icones animados e 28, alto demais pra linha da aba */
const abas = (t: Dicionario) => [
  { id: "bibliotecas", label: t.abas.bibliotecas, icon: <FolderTreeIcon size={17} /> },
  { id: "meusArquivos", label: t.abas.meusArquivos, icon: <FolderOpenIcon size={17} /> },
  { id: "problemas", label: t.abas.problemas, icon: <HammerIcon size={17} /> },
];

function BibliotecaPanel({
  site,
  onAlternar,
  onOpen,
  onAbrirUrl,
}: {
  site: Site;
  onAlternar: (s: Site, ligar: boolean) => void;
  onOpen: (s: Site) => void;
  onAbrirUrl: (url: string) => void;
}) {
  const { idioma, t } = useIdioma();
  const fmt = (n: number) => n.toLocaleString(idioma);
  const conectado = site.status === "connected";
  const ocupado = site.status === "connecting";
  const semAcesso = site.status === "noaccess";
  const destino = site.libraryUrl ?? site.webUrl;
  const carregandoDetalhes = site.detalhes === "carregando";
  const estado = semAcesso
    ? t.bibliotecas.semAcesso
    : conectado
      ? t.bibliotecas.conectado
      : t.bibliotecas.desconectado;

  // O icone de conexao tem duas poses: "normal" = plugue JUNTO (conectado),
  // "animate" = plugue SEPARADO (desconectado). Fixamos por estado, senao ate
  // o desconectado pareceria conectado.
  const conexaoRef = useRef<ConnectIconHandle>(null);
  useEffect(() => {
    if (semAcesso || ocupado) return;
    if (conectado) conexaoRef.current?.stopAnimation();
    else conexaoRef.current?.startAnimation();
  }, [conectado, semAcesso, ocupado]);

  return (
    <FramePanel className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-2">
        <h2 className="text-sm font-semibold">{site.name}</h2>
        <p className="text-muted-foreground text-sm">
          {site.description || t.bibliotecas.descricaoPadrao}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <MetricaChip
            icone={<SquareActivityIcon size={13} />}
            valor={site.bytes != null ? formatBytes(site.bytes) : undefined}
            titulo={t.bibliotecas.tamanho}
            consultando={preencher(t.bibliotecas.consultando, { o: t.bibliotecas.tamanho })}
            carregando={carregandoDetalhes}
          />
          <MetricaChip
            icone={<FoldersIcon size={13} />}
            valor={
              site.folders != null
                ? preencher(t.bibliotecas.pastas, { n: fmt(site.folders) })
                : undefined
            }
            titulo={t.bibliotecas.tituloPastas}
            consultando={preencher(t.bibliotecas.consultando, { o: t.confirmar.cartaoPastas })}
            carregando={carregandoDetalhes}
          />
          <MetricaChip
            icone={<FileStackIcon size={13} />}
            valor={
              site.files != null
                ? preencher(t.bibliotecas.arquivos, { n: fmt(site.files) })
                : undefined
            }
            titulo={t.bibliotecas.tituloArquivos}
            consultando={preencher(t.bibliotecas.consultando, { o: t.confirmar.cartaoArquivos })}
            carregando={carregandoDetalhes}
          />
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {conectado && (
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label={t.bibliotecas.abrir}>
                    <FolderOpenIcon size={16} />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{t.bibliotecas.abrir}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onOpen(site)}>
                {t.bibliotecas.abrirExplorer}
              </DropdownMenuItem>
              {/* libraryUrl leva direto aos arquivos; webUrl e a home do site,
                  que num site de comunicacao cai na pagina inicial. */}
              <DropdownMenuItem
                disabled={!destino}
                onClick={() => destino && onAbrirUrl(destino)}
              >
                {t.bibliotecas.abrirSharepoint}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* DIV, nao <label>: o Switch do Radix e um <button>, e o label
            reenviava o clique para ele — o handler disparava duas vezes
            (liga/desliga) e nada acontecia. */}
        <div className="flex items-center gap-2 text-sm">
          {ocupado ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : semAcesso ? (
            <Lock className="size-4 text-muted-foreground" />
          ) : (
            <ConnectIcon ref={conexaoRef} size={16} />
          )}
          <span className="text-muted-foreground w-27 shrink-0">
            {estado}
          </span>
          <Switch
            aria-label={preencher(
              conectado ? t.bibliotecas.desconectar : t.bibliotecas.conectar,
              { nome: site.name }
            )}
            checked={conectado}
            disabled={ocupado || semAcesso}
            onCheckedChange={(on) => onAlternar(site, on)}
          />
        </div>
      </div>
    </FramePanel>
  );
}

export function SitesScreen({
  sites,
  loading,
  error,
  onConnect,
  onOpen,
  onDisconnect,
  onAbrirUrl,
}: {
  sites: Site[];
  loading?: boolean;
  error?: string | null;
  onConnect: (s: Site) => Promise<void>;
  onOpen: (s: Site) => void;
  onDisconnect: (s: Site) => Promise<void>;
  onAbrirUrl: (url: string) => void;
}) {
  const { t } = useIdioma();
  // #699 (PS6): SharePoint Sites é feature de ORG — degrada pra empty-state nos
  // tiers pessoal/uncontracted. A aba "meusArquivos" (OneDrive próprio) fica.
  const { recursoOrgDisponivel } = useTier();
  const [aba, setAba] = useState("bibliotecas");
  // Biblioteca aguardando confirmacao, e o que sera feito com ela.
  const [confirmando, setConfirmando] = useState<Site | null>(null);
  const [modo, setModo] = useState<ModoConfirmacao>("conectar");
  const pularPersistido = useAppStore(
    (state) => state.pularConfirmacaoConexao,
  );
  const setPularPersistido = useAppStore(
    (state) => state.setPularConfirmacaoConexao,
  );
  const [pular, setPular] = useState(pularPersistido);

  useEffect(() => setPular(pularPersistido), [pularPersistido]);

  function alternar(site: Site, ligar: boolean) {
    // Desconectar sempre confirma: e destrutivo do lado da maquina. Conectar
    // respeita o "nao pedir novamente".
    if (ligar && pular) {
      onConnect(site);
      return;
    }
    setModo(ligar ? "conectar" : "desconectar");
    setConfirmando(site);
  }

  async function confirmar() {
    const alvo = confirmando;
    if (!alvo) return;
    if (modo === "conectar") {
      setConfirmando(null);
      setPularPersistido(pular);
      await onConnect(alvo);
      return;
    }
    // Na remocao o dialogo continua aberto: ele mostra o processamento e o
    // sucesso no proprio botao, e se fecha sozinho depois.
    await onDisconnect(alvo);
  }

  return (
    <div className="w-full">
      {/* Icone em cima do rotulo e rotulo em uma linha so. Feito pelo
          className que o componente expoe, para nao mexer no arquivo do
          registry (assim uma reinstalacao nao derruba o ajuste). */}
      <AnimatedTabs
        activeTab={aba}
        className="mb-6 [&>button]:flex-col [&>button]:gap-1.5 [&>button]:whitespace-nowrap"
        layoutId="onedrive-abas"
        onChange={setAba}
        tabs={abas(t)}
        variant="segment"
      />

      {aba === "problemas" ? (
        <Suspense
          fallback={
            <div className="grid h-full place-items-center">
              <Spinner className="size-6 text-muted-foreground" />
            </div>
          }
        >
          <EmBreveScreen
            titulo={t.problemas.titulo}
            icone={Hammer}
            descricao={t.problemas.descricao}
            itens={[
              t.problemas.item1,
              t.problemas.item2,
              t.problemas.item3,
              t.problemas.item4,
            ]}
          />
        </Suspense>
      ) : aba === "meusArquivos" ? (
        <MeusArquivosScreen />
      ) : !recursoOrgDisponivel ? (
        // #699: SharePoint Sites gateado por tier — empty-state, nunca erro.
        <RecursoOrgEmpty className="mt-10 border border-border bg-card/40 p-10" />
      ) : (
        <>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertTriangle />
              <AlertDescription data-selecionavel>{error}</AlertDescription>
            </Alert>
          )}

          {loading && sites.length === 0 ? (
            <div className="mt-16 flex flex-col items-center gap-3 text-muted-foreground">
              <Spinner className="size-6" />
              <p className="text-sm">{t.bibliotecas.carregando}</p>
            </div>
          ) : sites.length === 0 ? (
            <div className="mt-16 text-center text-sm text-muted-foreground">
              {t.bibliotecas.vazio}
            </div>
          ) : (
            <Frame className="w-full">
              <FrameHeader>
                <FrameTitle>{t.bibliotecas.titulo}</FrameTitle>
                <FrameDescription>
                  {t.bibliotecas.descricao}
                </FrameDescription>
              </FrameHeader>

              {sites.map((s) => (
                <BibliotecaPanel
                  key={s.key}
                  site={s}
                  onAlternar={alternar}
                  onOpen={onOpen}
                  onAbrirUrl={onAbrirUrl}
                />
              ))}

              {/* O token --info do reui e violeta, que ao lado do magenta da
                  marca nao le como "informacao". Por isso o azul da paleta. */}
              <FrameFooter className="flex-row items-center gap-2">
                <Info className="size-4 shrink-0 text-blue-500 dark:text-blue-400" />
                <p className="text-muted-foreground text-sm">
                  {t.bibliotecas.rodape}
                </p>
              </FrameFooter>
            </Frame>
          )}

          <ConfirmarBiblioteca
            site={confirmando}
            modo={modo}
            pular={pular}
            onPularChange={setPular}
            onConfirmar={confirmar}
            onCancelar={() => setConfirmando(null)}
          />
        </>
      )}
    </div>
  );
}
