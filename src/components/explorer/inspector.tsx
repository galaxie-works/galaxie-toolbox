import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Eye, Info, SquareArrowOutUpRight } from "lucide-react";

import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/utils";
import { abrirCaminhoFs } from "@/lib/api";
import { preencher, useIdioma } from "@/lib/idioma";
import type { FsEntry } from "@/lib/types";
import { PreviewArquivo } from "@/components/preview/preview-arquivo";

import { ehImagem, iconeParaEntry } from "./icones-arquivo";
import { formatarDataArquivo, rotuloTipo } from "./format";
import { atributosAtivos, type AtributoArquivo } from "./filtro";
import { solicitarThumb } from "./thumb-fila";

// Mesmo gate do painel de conteúdo (S2): thumbnails só existem dentro do Tauri;
// no browser/mock degrada pro ícone grande.
const TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * #681: InspectorPane — o 3º painel (direita) do Explorer, dirigido pela seleção
 * LIFTADA do ContentPane (array de `FsEntry`).
 *
 * #873: ganha uma REGIÃO DE PREVIEW no topo, que reusa o MESMO viewer do Bridge
 * (`PreviewArquivo`, fonte local — pdf/txt/docx/xlsx/csv/imagem/mídia com iframe
 * `sandbox=""` + CSP). Abaixo do preview ficam os metadados de sempre:
 *  - 0 ou >1 selecionados, ou 1 pasta → o preview mostra o estado vazio
 *    ("selecione um arquivo para pré-visualizar"); os metadados abaixo seguem
 *    (resumo de multi-seleção / detalhes da pasta / nada quando 0);
 *  - 1 arquivo → preview do arquivo + metadados (nome, tipo, tamanho, datas,
 *    caminho, atributos). Formato fora do escopo cai no aviso do próprio viewer.
 * O toggle dedicado do painel (View › Preview pane) é escopo do #871.
 * Estilo de card igual aos painéis da árvore/conteúdo (`rounded-xl border bg-card`).
 */
export function InspectorPane({ itens }: { itens: FsEntry[] }) {
  const { t } = useIdioma();
  // Só há preview para UM arquivo (pasta não pré-visualiza).
  const arquivoUnico = itens.length === 1 && !itens[0].isDir ? itens[0] : null;

  return (
    <aside className="flex h-full flex-col rounded-xl border bg-card">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5">
        <Info className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">{t.arquivos.detalhes}</span>
      </div>

      {/* Região de preview (topo) — arquivo único ou estado vazio. */}
      <div className="min-h-0 flex-1 overflow-hidden p-3">
        {arquivoUnico ? (
          <PreviewArquivo
            key={arquivoUnico.path}
            fonte={{
              kind: "local",
              path: arquivoUnico.path,
              nome: arquivoUnico.name,
              tamanho: arquivoUnico.size,
            }}
            acaoPrimaria={{
              onClick: () => {
                // #1028 (FE7): abrir falhou → avisa, não fica um botão morto.
                void abrirCaminhoFs(arquivoUnico.path).catch(() =>
                  toast.error(t.arquivos.erroAbrirArquivo),
                );
              },
              rotulo: t.arquivos.abrir,
              Icone: SquareArrowOutUpRight,
            }}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <Eye className="size-8" />
            <p className="text-sm">{t.arquivos.previewSelecione}</p>
          </div>
        )}
      </div>

      {/* Metadados (abaixo do preview) — só quando há seleção. */}
      {itens.length > 0 && (
        <div className="max-h-[45%] shrink-0 overflow-y-auto border-t p-3">
          {itens.length === 1 ? (
            <InspetorUnico key={itens[0].path} entry={itens[0]} />
          ) : (
            <InspetorMulti itens={itens} />
          )}
        </div>
      )}
    </aside>
  );
}

/** Item único: preview grande + linhas de metadados. */
function InspetorUnico({ entry }: { entry: FsEntry }) {
  const { t, idioma } = useIdioma();
  // A entrada da listagem já traz TODOS os campos do inspector (nome, tipo,
  // tamanho, datas, caminho, atributos) — é a fonte de verdade. Um refresh via
  // `statCaminho` seria redundante no v1 (a listagem acabou de carregar) e
  // dependeria do backend resolver o metadado por caminho.
  const info = entry;
  const atributos = atributosAtivos(info);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-2">
        <PreviewGrande entry={info} />
        <p className="w-full break-words text-center text-sm font-medium">
          {info.name}
        </p>
      </div>

      <Secao>
        <LinhaInfo rotulo={t.arquivos.colTipo}>
          {rotuloTipo(info, {
            pasta: t.arquivos.tipoPasta,
            arquivo: t.arquivos.tipoArquivo,
          })}
        </LinhaInfo>
        <LinhaInfo rotulo={t.arquivos.colTamanho}>
          {info.isDir ? "—" : formatBytes(info.size)}
        </LinhaInfo>
        <LinhaInfo rotulo={t.arquivos.criadoEm}>
          {formatarDataArquivo(info.createdMs, idioma)}
        </LinhaInfo>
        <LinhaInfo rotulo={t.arquivos.colModificado}>
          {formatarDataArquivo(info.modifiedMs, idioma)}
        </LinhaInfo>
      </Secao>

      <Divisor />

      <Secao>
        <LinhaInfo rotulo={t.arquivos.endereco} coluna>
          <span className="break-all text-xs text-muted-foreground">
            {info.path}
          </span>
        </LinhaInfo>
        <LinhaInfo rotulo={t.arquivos.atributos} coluna>
          {atributos.length === 0 ? (
            <span className="text-xs text-muted-foreground">—</span>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {atributos.map((a) => (
                <Tag key={a}>{rotuloAtributo(a, t)}</Tag>
              ))}
            </div>
          )}
        </LinhaInfo>
      </Secao>
    </div>
  );
}

/** Multi-seleção: nº de itens + tamanho total (soma dos `size`). */
function InspetorMulti({ itens }: { itens: FsEntry[] }) {
  const { t } = useIdioma();
  // #749: agregado — tamanho total (só arquivos) + contagem arquivos/pastas.
  const { total, arquivos, pastas } = useMemo(() => {
    let bytes = 0;
    let a = 0;
    let p = 0;
    for (const e of itens) {
      if (e.isDir) p++;
      else {
        a++;
        bytes += e.size;
      }
    }
    return { total: bytes, arquivos: a, pastas: p };
  }, [itens]);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-2 py-2 text-center">
        <span className="text-3xl font-semibold tabular-nums">
          {itens.length}
        </span>
        <span className="text-sm text-muted-foreground">
          {preencher(t.arquivos.total, { n: itens.length })}
        </span>
      </div>
      <Divisor />
      <Secao>
        <LinhaInfo rotulo={t.arquivos.conteudo}>
          {preencher(t.arquivos.arquivosPastas, { a: arquivos, p: pastas })}
        </LinhaInfo>
        <LinhaInfo rotulo={t.arquivos.tamanhoTotal}>
          {formatBytes(total)}
        </LinhaInfo>
      </Secao>
    </div>
  );
}

function PreviewGrande({ entry }: { entry: FsEntry }) {
  const { Icon, cor } = iconeParaEntry(entry);
  const [src, setSrc] = useState<string | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    setSrc(null);
    setErro(false);
    if (!TAURI || !ehImagem(entry)) return;
    // #738: aponta pro thumb webp cacheado (mesma fila/cache das Miniaturas —
    // maxSize 256 → hit instantâneo se o tile já carregou), nunca o original.
    let cancelado = false;
    void solicitarThumb(
      entry.path,
      entry.modifiedMs ?? 0,
      256,
      () => cancelado,
    ).then((uri) => {
      if (!cancelado && uri) setSrc(uri);
    });
    return () => {
      cancelado = true;
    };
  }, [entry, entry.path, entry.modifiedMs]);

  if (TAURI && ehImagem(entry) && src && !erro) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        onError={() => setErro(true)}
        className="size-24 rounded-lg border object-cover"
      />
    );
  }
  return (
    <span className="flex size-24 items-center justify-center rounded-lg border bg-muted/30">
      <Icon className={cn("size-12", cor)} />
    </span>
  );
}

// --- Primitivos locais (spacedrive-style) ---------------------------------
function Secao({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-1.5">{children}</div>;
}

function LinhaInfo({
  rotulo,
  children,
  coluna,
}: {
  rotulo: string;
  children: ReactNode;
  coluna?: boolean;
}) {
  return (
    <div
      className={cn(
        "gap-1 text-sm",
        coluna
          ? "flex flex-col"
          : "flex items-baseline justify-between gap-3",
      )}
    >
      <span className="shrink-0 text-xs font-medium text-muted-foreground">
        {rotulo}
      </span>
      {coluna ? (
        children
      ) : (
        <span className="min-w-0 truncate text-right">{children}</span>
      )}
    </div>
  );
}

function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border bg-muted/40 px-1.5 py-0.5 text-xs text-muted-foreground">
      {children}
    </span>
  );
}

function Divisor() {
  return <div className="border-t" />;
}

function rotuloAtributo(
  a: AtributoArquivo,
  t: ReturnType<typeof useIdioma>["t"],
): string {
  switch (a) {
    case "oculto":
      return t.arquivos.atribOculto;
    case "somenteLeitura":
      return t.arquivos.atribSomenteLeitura;
    case "symlink":
      return t.arquivos.atribSymlink;
    default:
      return a;
  }
}
