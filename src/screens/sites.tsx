import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, formatBytes } from "@/lib/utils";
import type { Site } from "@/lib/types";
import {
  AlertTriangle,
  Check,
  Folder,
  FolderCheck,
  Loader2,
  Lock,
  Plug,
  Sparkles,
  Unplug,
} from "lucide-react";

function StatusBadge({ status }: { status: Site["status"] }) {
  if (status === "connected")
    return (
      <Badge variant="success">
        <Check className="size-3" /> Conectado
      </Badge>
    );
  if (status === "connecting")
    return (
      <Badge variant="warning">
        <Loader2 className="size-3 animate-spin" /> Conectando
      </Badge>
    );
  if (status === "noaccess")
    return (
      <Badge variant="muted">
        <Lock className="size-3" /> Sem acesso
      </Badge>
    );
  return <Badge variant="outline">Disponível</Badge>;
}

function SiteCard({
  site,
  onConnect,
  onOpen,
  onDisconnect,
}: {
  site: Site;
  onConnect: (s: Site) => void;
  onOpen: (s: Site) => void;
  onDisconnect: (s: Site) => void;
}) {
  const connected = site.status === "connected";
  const disabled = site.status === "noaccess";
  return (
    <div
      className={cn(
        "group relative flex flex-col gap-4 rounded-xl border border-border bg-card p-4 transition-all",
        !disabled && "hover:border-primary/40 hover:shadow-md hover:shadow-primary/5",
        disabled && "opacity-55"
      )}
    >
      <div className="flex items-start justify-between">
        <div
          className={cn(
            "grid size-11 place-items-center rounded-lg transition-colors",
            connected
              ? "bg-[color:var(--success)]/12 text-[color:var(--success)]"
              : "bg-primary/10 text-primary"
          )}
        >
          {connected ? (
            <FolderCheck className="size-5" />
          ) : (
            <Folder className="size-5" />
          )}
        </div>
        <StatusBadge status={site.status} />
      </div>

      <div className="min-w-0">
        <div className="truncate text-[15px] font-semibold">{site.name}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {site.files != null && site.bytes != null
            ? `${site.files.toLocaleString("pt-BR")} arquivos · ${formatBytes(site.bytes)}`
            : "Biblioteca do SharePoint"}
        </div>
      </div>

      <div className="flex gap-2">
        <Button
          variant={connected ? "outline" : "default"}
          size="sm"
          className="w-full"
          disabled={disabled || site.status === "connecting"}
          onClick={() => (connected ? onOpen(site) : onConnect(site))}
        >
          {connected ? (
            <>
              <FolderCheck className="size-4" /> Abrir no Explorer
            </>
          ) : site.status === "connecting" ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Aguarde...
            </>
          ) : disabled ? (
            <>
              <Lock className="size-4" /> Sem acesso
            </>
          ) : (
            <>
              <Plug className="size-4" /> Conectar
            </>
          )}
        </Button>
        {connected && (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            title="Desconectar (remove o atalho do seu OneDrive)"
            aria-label="Desconectar"
            onClick={() => onDisconnect(site)}
          >
            <Unplug className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

export function SitesScreen({
  sites,
  loading,
  error,
  onConnect,
  onOpen,
  onDisconnect,
  onConnectAll,
}: {
  sites: Site[];
  loading?: boolean;
  error?: string | null;
  onConnect: (s: Site) => void;
  onOpen: (s: Site) => void;
  onDisconnect: (s: Site) => void;
  onConnectAll: () => void;
}) {
  const accessible = sites.filter((s) => s.status !== "noaccess");
  const connected = sites.filter((s) => s.status === "connected").length;
  const pending = accessible.filter((s) => s.status === "available").length;

  return (
    <div className="mx-auto max-w-5xl">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">
                Suas bibliotecas
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {connected} conectada{connected === 1 ? "" : "s"} · {pending}{" "}
                disponíve{pending === 1 ? "l" : "is"} para conectar
              </p>
            </div>
            {pending > 0 && (
              <Button onClick={onConnectAll} className="gap-2">
                <Sparkles className="size-4" />
                Conectar todas ({pending})
              </Button>
            )}
          </div>

          {error && (
            <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 p-3.5">
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
            <div className="mt-6 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
              {sites.map((s) => (
                <SiteCard key={s.key} site={s} onConnect={onConnect} onOpen={onOpen} onDisconnect={onDisconnect} />
              ))}
            </div>
          )}

          <p className="mt-6 text-center text-[11.5px] text-muted-foreground/70">
            As bibliotecas aparecem no seu OneDrive, no Explorer. Só ocupam espaço
            quando você abre um arquivo.
          </p>
    </div>
  );
}
