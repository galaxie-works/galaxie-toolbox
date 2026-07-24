import AnimatedTabs from "@/components/smoothui/animated-tabs";
import { Badge } from "@/components/reui/badge";
import {
  Frame,
  FrameDescription,
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
import { SquareActivityIcon } from "@/components/ui/square-activity";
import { EmBreveScreen } from "@/screens/em-breve";
import { formatBytes } from "@/lib/utils";
import type { Site } from "@/lib/types";
import { AlertTriangle, Hammer, Loader2, Lock } from "lucide-react";
import { useState } from "react";

/* size padrao dos icones animados e 28, alto demais pra linha da aba */
const ABAS = [
  {
    id: "bibliotecas",
    label: "Bibliotecas",
    icon: <FolderTreeIcon size={17} />,
  },
  {
    id: "problemas",
    label: "Solução de problemas",
    icon: <HammerIcon size={17} />,
  },
];

const fmt = (n: number) => n.toLocaleString("pt-BR");

/** Chip de metrica. Some quando o numero ainda nao chegou (ou falhou). */
function Metrica({
  icone,
  valor,
  titulo,
}: {
  icone: React.ReactNode;
  valor?: string;
  titulo: string;
}) {
  if (!valor) return null;
  return (
    <Badge variant="secondary" size="lg" title={titulo}>
      {icone}
      {valor}
    </Badge>
  );
}

function BibliotecaPanel({
  site,
  onConnect,
  onOpen,
  onDisconnect,
  onAbrirUrl,
}: {
  site: Site;
  onConnect: (s: Site) => void;
  onOpen: (s: Site) => void;
  onDisconnect: (s: Site) => void;
  onAbrirUrl: (url: string) => void;
}) {
  const conectado = site.status === "connected";
  const ocupado = site.status === "connecting";
  const semAcesso = site.status === "noaccess";

  return (
    <FramePanel className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-2">
        <h2 className="text-sm font-semibold">{site.name}</h2>
        <p className="text-muted-foreground text-sm">
          {site.description || "Biblioteca de documentos do SharePoint."}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Metrica
            icone={<SquareActivityIcon size={13} />}
            valor={site.bytes != null ? formatBytes(site.bytes) : undefined}
            titulo="Tamanho da biblioteca"
          />
          <Metrica
            icone={<FoldersIcon size={13} />}
            valor={site.folders != null ? `${fmt(site.folders)} pastas` : undefined}
            titulo="Pastas (aproximado, vem da busca do SharePoint)"
          />
          <Metrica
            icone={<FileStackIcon size={13} />}
            valor={site.files != null ? `${fmt(site.files)} arquivos` : undefined}
            titulo="Arquivos (aproximado, vem da busca do SharePoint)"
          />
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {conectado && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Abrir biblioteca">
                <FolderOpenIcon size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onOpen(site)}>
                Abrir no Explorer
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!site.webUrl}
                onClick={() => site.webUrl && onAbrirUrl(site.webUrl)}
              >
                Abrir no SharePoint
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          {ocupado ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : semAcesso ? (
            <Lock className="size-4 text-muted-foreground" />
          ) : (
            <ConnectIcon size={16} />
          )}
          <span className="text-muted-foreground w-27 shrink-0">
            {semAcesso ? "Sem acesso" : conectado ? "Conectado" : "Desconectado"}
          </span>
          <Switch
            checked={conectado}
            disabled={ocupado || semAcesso}
            onCheckedChange={(on) => (on ? onConnect(site) : onDisconnect(site))}
          />
        </label>
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
  onConnect: (s: Site) => void;
  onOpen: (s: Site) => void;
  onDisconnect: (s: Site) => void;
  onAbrirUrl: (url: string) => void;
}) {
  const [aba, setAba] = useState("bibliotecas");

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
        tabs={ABAS}
        variant="segment"
      />

      {aba === "problemas" ? (
        <EmBreveScreen
          titulo="Solução de problemas"
          icone={Hammer}
          descricao="Correções para os perrengues clássicos do OneDrive, sem precisar abrir chamado."
          itens={[
            "Reiniciar o OneDrive",
            "Destravar a sincronização",
            "Reconectar a conta do Microsoft 365",
            "Liberar espaço com arquivos sob demanda",
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
              <p className="text-sm">Carregando suas bibliotecas...</p>
            </div>
          ) : sites.length === 0 ? (
            <div className="mt-16 text-center text-sm text-muted-foreground">
              Nenhuma biblioteca disponível para a sua conta.
            </div>
          ) : (
            <Frame className="w-full">
              <FrameHeader>
                <FrameTitle>Biblioteca de documentos</FrameTitle>
                <FrameDescription>
                  As bibliotecas de documentos organizam todo o inventário da
                  empresa em sites do SharePoint. Use esta seção para habilitar a
                  sincronização do seu OneDrive com as bibliotecas que você tem
                  acesso.
                </FrameDescription>
              </FrameHeader>

              {sites.map((s) => (
                <BibliotecaPanel
                  key={s.key}
                  site={s}
                  onConnect={onConnect}
                  onOpen={onOpen}
                  onDisconnect={onDisconnect}
                  onAbrirUrl={onAbrirUrl}
                />
              ))}
            </Frame>
          )}

          <p className="mt-6 text-[11.5px] text-muted-foreground/70">
            As bibliotecas aparecem no seu OneDrive, no Explorer. Só ocupam espaço
            quando você abre um arquivo.
          </p>
        </>
      )}
    </div>
  );
}
