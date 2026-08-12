import { useCallback, useState } from "react";

import {
  Files,
  FolderItem,
  FolderTrigger,
  FolderContent,
} from "@/components/animate-ui/components/radix/files";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useIdioma } from "@/lib/idioma";
import { listarDir } from "@/lib/api";
import type { DriveInfo, FsEntry } from "@/lib/types";

/** Sintetiza um `FsEntry` de pasta para um drive-root (raiz da árvore). */
function driveParaEntry(d: DriveInfo): FsEntry {
  return {
    name: `${d.name} (${d.path.replace(/\\+$/, "")})`,
    path: d.path,
    isDir: true,
    isSymlink: false,
    size: 0,
    modifiedMs: null,
    createdMs: null,
    extension: null,
    isHidden: false,
    isReadonly: false,
  };
}

/**
 * #677: árvore de pastas LAZY. Reusa o componente `Files` do animate-ui (um Radix
 * Accordion `type="multiple"`) em modo CONTROLADO — um único `open: string[]` de
 * caminhos, compartilhado por toda a árvore (sem `SubFiles`, pra o modelo de
 * expansão ficar global e chavear pelo caminho completo). Ao expandir um caminho
 * ainda não carregado, dispara `listarDir`, guarda só as PASTAS (`isDir`) em
 * `filhosPorPath` e mostra o spinner enquanto `carregando` tem o caminho. Só
 * pastas na árvore — arquivos ficam pro painel de conteúdo (story posterior).
 */
export function ArvoreArquivos({
  drives,
  currentPath,
  onNavegar,
}: {
  drives: DriveInfo[];
  currentPath: string;
  onNavegar: (path: string) => void;
}) {
  const { t } = useIdioma();
  const [open, setOpen] = useState<string[]>([]);
  const [filhosPorPath, setFilhosPorPath] = useState<Map<string, FsEntry[]>>(
    () => new Map(),
  );
  const [carregando, setCarregando] = useState<Set<string>>(() => new Set());

  const carregar = useCallback(async (path: string) => {
    setCarregando((prev) => new Set(prev).add(path));
    try {
      const entradas = await listarDir(path);
      const pastas = entradas.filter((e) => e.isDir);
      setFilhosPorPath((prev) => new Map(prev).set(path, pastas));
    } catch {
      // Falha de leitura (permissão negada / caminho sumiu): registra vazio pra o
      // spinner sumir e a árvore não girar pra sempre.
      setFilhosPorPath((prev) => new Map(prev).set(path, []));
    } finally {
      setCarregando((prev) => {
        const proximo = new Set(prev);
        proximo.delete(path);
        return proximo;
      });
    }
  }, []);

  const aoAbrir = useCallback(
    (novo: string[]) => {
      const adicionados = novo.filter((p) => !open.includes(p));
      setOpen(novo);
      for (const p of adicionados) {
        if (!filhosPorPath.has(p) && !carregando.has(p)) void carregar(p);
      }
      // Expandir uma pasta também navega até ela (cobre teclado; o clique do mouse
      // já navega pelo container). `onNavegar` é idempotente pro caminho atual.
      const alvo = adicionados.at(-1);
      if (alvo) onNavegar(alvo);
    },
    [open, filhosPorPath, carregando, carregar, onNavegar],
  );

  return (
    <Files open={open} onOpenChange={aoAbrir} className="p-0">
      {drives.map((d) => (
        <NoArvore
          key={d.path}
          entry={driveParaEntry(d)}
          filhosPorPath={filhosPorPath}
          carregando={carregando}
          currentPath={currentPath}
          onNavegar={onNavegar}
          carregandoLabel={t.arquivos.carregando}
          vazioLabel={t.arquivos.vazio}
        />
      ))}
    </Files>
  );
}

function NoArvore({
  entry,
  filhosPorPath,
  carregando,
  currentPath,
  onNavegar,
  carregandoLabel,
  vazioLabel,
}: {
  entry: FsEntry;
  filhosPorPath: Map<string, FsEntry[]>;
  carregando: Set<string>;
  currentPath: string;
  onNavegar: (path: string) => void;
  carregandoLabel: string;
  vazioLabel: string;
}) {
  const filhos = filhosPorPath.get(entry.path);
  const estaCarregando = carregando.has(entry.path);
  const ativo = currentPath === entry.path;

  return (
    <FolderItem value={entry.path}>
      {/* O conteúdo do `FolderTrigger` do animate-ui é `pointer-events-none`: o
          clique cai no botão do acordeão (expande/colapsa). Envolvemos num
          container que captura o MESMO clique por bubbling pra também NAVEGAR até
          a pasta. Sem lint de a11y no projeto; o gatilho por baixo é um <button>
          real (teclado cobre via `aoAbrir`). */}
      <div
        onClick={() => onNavegar(entry.path)}
        className={cn("rounded-md", ativo && "bg-secondary")}
      >
        <FolderTrigger>{entry.name}</FolderTrigger>
      </div>
      <FolderContent>
        {estaCarregando ? (
          <div className="flex items-center gap-2 p-2">
            <Spinner className="size-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              {carregandoLabel}
            </span>
          </div>
        ) : filhos && filhos.length > 0 ? (
          filhos.map((f) => (
            <NoArvore
              key={f.path}
              entry={f}
              filhosPorPath={filhosPorPath}
              carregando={carregando}
              currentPath={currentPath}
              onNavegar={onNavegar}
              carregandoLabel={carregandoLabel}
              vazioLabel={vazioLabel}
            />
          ))
        ) : filhos ? (
          <p className="p-2 text-xs text-muted-foreground">{vazioLabel}</p>
        ) : null}
      </FolderContent>
    </FolderItem>
  );
}
