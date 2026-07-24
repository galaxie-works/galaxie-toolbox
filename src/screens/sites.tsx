import AnimatedTabs from "@/components/smoothui/animated-tabs";
import { Badge } from "@/components/reui/badge";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/animate-ui/components/radix/dropdown-menu";
import { Switch } from "@/components/animate-ui/components/radix/switch";
import { ConnectIcon } from "@/components/ui/connect";
import { FileStackIcon } from "@/components/ui/file-stack";
import { FolderOpenIcon } from "@/components/ui/folder-open";
import { FolderTreeIcon } from "@/components/ui/folder-tree";
import { FoldersIcon } from "@/components/ui/folders";
import { HammerIcon } from "@/components/ui/hammer";
import { Spinner } from "@/components/ui/spinner";
import { SquareActivityIcon } from "@/components/ui/square-activity";
import {
  ConfirmarBiblioteca,
  gravarPularConfirmacao,
  podePularConfirmacao,
  type ModoConfirmacao,
} from "@/components/confirmar-biblioteca";
import { EmBreveScreen } from "@/screens/em-breve";
import { formatBytes } from "@/lib/utils";
import { preencher, useIdioma } from "@/lib/idioma";
import type { Dicionario } from "@/lib/strings";
import type { Site } from "@/lib/types";
import { AlertTriangle, Hammer, Info, Loader2, Lock } from "lucide-react";
import { useState } from "react";

/* size padrao dos icones animados e 28, alto demais pra linha da aba */
const abas = (t: Dicionario) => [
  { id: "bibliotecas", label: t.abas.bibliotecas, icon: <FolderTreeIcon size={17} /> },
  { id: "problemas", label: t.abas.problemas, icon: <HammerIcon size={17} /> },
];

/**
 * Chip de metrica. Enquanto o Graph responde, mostra um spinner no lugar do
 * numero; se a consulta terminar sem valor, o chip some (nao fica girando).
 */
function Metrica({
  icone,
  valor,
  titulo,
  consultando,
  carregando,
}: {
  icone: React.ReactNode;
  valor?: string;
  titulo: string;
  consultando: string;
  carregando?: boolean;
}) {
  if (!valor) {
    if (!carregando) return null;
    return (
      <Badge variant="secondary" size="lg" title={consultando}>
        <Spinner data-icon="inline-start" />
        {icone}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" size="lg" title={titulo}>
      {icone}
      {valor}
    </Badge>
  );
}

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

  return (
    <FramePanel className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-2">
        <h2 className="text-sm font-semibold">{site.name}</h2>
        <p className="text-muted-foreground text-sm">
          {site.description || t.bibliotecas.descricaoPadrao}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Metrica
            icone={<SquareActivityIcon size={13} />}
            valor={site.bytes != null ? formatBytes(site.bytes) : undefined}
            titulo={t.bibliotecas.tamanho}
            consultando={preencher(t.bibliotecas.consultando, { o: t.bibliotecas.tamanho })}
            carregando={carregandoDetalhes}
          />
          <Metrica
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
          <Metrica
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
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label={t.bibliotecas.abrir}>
                <FolderOpenIcon size={16} />
              </Button>
            </DropdownMenuTrigger>
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
            <ConnectIcon size={16} />
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
  const [aba, setAba] = useState("bibliotecas");
  // Biblioteca aguardando confirmacao, e o que sera feito com ela.
  const [confirmando, setConfirmando] = useState<Site | null>(null);
  const [modo, setModo] = useState<ModoConfirmacao>("conectar");
  const [pular, setPular] = useState(podePularConfirmacao);

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
      gravarPularConfirmacao(pular);
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
      ) : (
        <>
          {error && (
            <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 p-3.5">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <p className="text-[12.5px] leading-relaxed text-destructive">{error}</p>
            </div>
          )}

          {loading && sites.length === 0 ? (
            <div className="mt-16 flex flex-col items-center gap-3 text-muted-foreground">
              <Loader2 className="size-6 animate-spin" />
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
