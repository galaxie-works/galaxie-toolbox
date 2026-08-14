import { useCallback, useState, type ReactNode } from "react";

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
import { CAMINHO_ESTE_PC } from "./caminho";

// #869: valores-sentinela dos nós-RAIZ do accordion (This PC / Acesso rápido).
// Não são caminhos reais — o prefixo "::" nunca colide com um caminho Windows (só
// existe ':' logo após a letra do drive), então dá pra distinguir uma raiz
// ESTÁTICA (filhos vêm por prop) de um caminho LAZY (filhos vêm do disco) só pelo
// valor, sem uma flag extra por nó.
const RAIZ_ESTE_PC = "::este-pc::";
const RAIZ_ACESSO_RAPIDO = "::acesso-rapido::";

/** Um valor de accordion é "lazy" (carrega filhos do disco ao abrir) quando é um
 *  caminho real; as raízes estáticas usam o prefixo-sentinela "::". */
function ehLazy(value: string): boolean {
  return !value.startsWith("::");
}

/** Sintetiza um `FsEntry` de pasta para um drive-root (nó da árvore). */
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
 * #869: árvore ÚNICA do sidebar do Explorer, renderizada pelo componente `Files`
 * do animate-ui (Radix Accordion `type="multiple"`) em modo CONTROLADO — um único
 * `open: string[]` compartilhado por toda a árvore, chaveado pelo valor do nó
 * (caminho completo p/ pastas; sentinela p/ as raízes). Estrutura:
 *
 *   Este computador (raiz)  →  drives  →  pastas (lazy, recursivo)
 *   Acesso rápido  (raiz)   →  pastas conhecidas  →  pastas (lazy, recursivo)
 *
 * As RAÍZES têm filhos estáticos (drives/`dirsConhecidos`, já carregados); só as
 * PASTAS carregam sob demanda: ao expandir um caminho ainda não lido, dispara
 * `listarDir`, guarda só as PASTAS (`isDir`) em `filhosPorPath` e mostra o spinner
 * enquanto `carregando` tem o caminho. Só pastas na árvore — arquivos ficam pro
 * painel de conteúdo. (#677 substituiu o `LocaisSidebar` flat: This PC/drives/
 * Acesso rápido agora são nós desta mesma árvore, não `SidebarNavItem` soltos.)
 */
export function ArvoreArquivos({
  drives,
  acessoRapido,
  currentPath,
  onNavegar,
}: {
  drives: DriveInfo[];
  acessoRapido: FsEntry[] | null;
  currentPath: string;
  onNavegar: (path: string) => void;
}) {
  const { t } = useIdioma();
  // As raízes começam ABERTAS — drives e acesso rápido ficam visíveis de cara,
  // como no sidebar antigo; só as PASTAS é que carregam ao expandir. Manter um
  // sentinela em `open` sem FolderItem correspondente (ex.: acesso rápido ainda
  // não carregou) é inofensivo — o Radix ignora valores desconhecidos.
  const [open, setOpen] = useState<string[]>(() => [
    RAIZ_ESTE_PC,
    RAIZ_ACESSO_RAPIDO,
  ]);
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
        // Só caminhos reais carregam do disco; sentinelas de raiz têm filhos
        // estáticos e nunca vão pro `filhosPorPath`.
        if (ehLazy(p) && !filhosPorPath.has(p) && !carregando.has(p)) {
          void carregar(p);
        }
      }
      // Expandir uma PASTA também navega até ela (cobre teclado; o clique do mouse
      // já navega pelo container). Ignora sentinelas — não são caminhos. This PC
      // navega pelo próprio clique do cabeçalho (abaixo).
      const alvo = adicionados.filter(ehLazy).at(-1);
      if (alvo) onNavegar(alvo);
    },
    [open, filhosPorPath, carregando, carregar, onNavegar],
  );

  return (
    <Files open={open} onOpenChange={aoAbrir} className="p-0">
      {/* Raiz "Este computador" → drives (estáticos) → pastas (lazy). Clicar o
          cabeçalho navega pro This PC (grade de drives, #855). */}
      <SecaoRaiz
        value={RAIZ_ESTE_PC}
        label={t.arquivos.drives}
        navPath={CAMINHO_ESTE_PC}
        currentPath={currentPath}
        onNavegar={onNavegar}
      >
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
      </SecaoRaiz>

      {/* #869: "Acesso rápido" como raiz-IRMÃ na MESMA árvore (dados de
          `dirsConhecidos`). Os itens são pastas — expansíveis/lazy como as demais.
          O cabeçalho é só rótulo: sem `navPath`, não navega ao clicar. */}
      {acessoRapido && acessoRapido.length > 0 && (
        <SecaoRaiz
          value={RAIZ_ACESSO_RAPIDO}
          label={t.arquivos.acessoRapido}
          currentPath={currentPath}
          onNavegar={onNavegar}
        >
          {acessoRapido.map((e) => (
            <NoArvore
              key={e.path}
              entry={e}
              filhosPorPath={filhosPorPath}
              carregando={carregando}
              currentPath={currentPath}
              onNavegar={onNavegar}
              carregandoLabel={t.arquivos.carregando}
              vazioLabel={t.arquivos.vazio}
            />
          ))}
        </SecaoRaiz>
      )}
    </Files>
  );
}

/**
 * #869: nó-RAIZ do sidebar (Este computador / Acesso rápido). Difere do `NoArvore`
 * em dois pontos: os filhos são ESTÁTICOS (vêm por prop, não do disco) e o
 * cabeçalho só navega quando recebe um `navPath` (This PC → grade de drives;
 * Acesso rápido é só um rótulo, sem caminho). O padrão do container-que-navega é o
 * mesmo do `NoArvore` (o `FolderTrigger` é `pointer-events-none`).
 */
function SecaoRaiz({
  value,
  label,
  navPath,
  currentPath,
  onNavegar,
  children,
}: {
  value: string;
  label: string;
  navPath?: string;
  currentPath: string;
  onNavegar: (path: string) => void;
  children: ReactNode;
}) {
  const ativo = navPath !== undefined && currentPath === navPath;
  return (
    <FolderItem value={value}>
      {navPath !== undefined ? (
        <div
          onClick={() => onNavegar(navPath)}
          className={cn("rounded-md", ativo && "bg-secondary")}
        >
          <FolderTrigger>{label}</FolderTrigger>
        </div>
      ) : (
        <FolderTrigger>{label}</FolderTrigger>
      )}
      <FolderContent>{children}</FolderContent>
    </FolderItem>
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
