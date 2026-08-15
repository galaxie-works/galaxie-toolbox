/**
 * Viewer de xlsx com **Univer** — #942 Fase 1 (engine de planilha embarcada).
 *
 * Substitui (atrás de `tipo === "xlsx"`) o render legado que virava HTML no
 * `<iframe sandbox>` (xlsx-preview/exceljs, frágil no runtime — #873). O Univer
 * monta um grid canvas nativo, READ-ONLY, a partir do snapshot `IWorkbookData`
 * produzido pelo `univer-xlsx.ts` (offline, sem servidor).
 *
 * Este módulo é carregado por `React.lazy` (ver `preview-arquivo.tsx`): o Univer
 * (+ exceljs) só entra no bundle quando o usuário ABRE um xlsx, num chunk lazy
 * separado — nunca no chunk `index` do boot.
 *
 * Read-only: escondemos a cromagem de edição pelo preset
 * (`header/toolbar/formulaBar/contextMenu` = false; footer só com a barra de abas
 * quando há mais de uma planilha) e travamos a edição com `setEditable(false)`.
 * Sem `workerURL` → nenhum web worker. Sem rede.
 *
 * Tema: segue o modo claro/escuro do app (`useTemaEscuro`) via `darkMode` na
 * criação e `univerAPI.toggleDarkMode` quando o modo muda com o viewer aberto.
 */
import { useEffect, useRef, useState } from "react";
import { createUniver, LocaleType, mergeLocales } from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import sheetsCoreEnUS from "@univerjs/preset-sheets-core/locales/en-US";
import type { Univer } from "@univerjs/core";
import "@univerjs/preset-sheets-core/lib/index.css";

import { xlsxParaWorkbookData } from "@/lib/univer-xlsx";
import { useTemaEscuro } from "@/lib/tema";

/** Handle da Facade API do Univer (tipada pelo retorno do `createUniver`). */
type UniverApi = ReturnType<typeof createUniver>["univerAPI"];

export function UniverXlsxViewer({
  bytes,
  vazioTexto,
}: {
  bytes: Uint8Array;
  vazioTexto: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [vazio, setVazio] = useState(false);
  const escuro = useTemaEscuro();
  const apiRef = useRef<UniverApi | null>(null);
  // Ref com o modo atual: a criação do Univer é assíncrona, então lemos o valor
  // mais recente no momento em que a instância fica pronta (evita flash de tema).
  const escuroRef = useRef(escuro);
  escuroRef.current = escuro;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let univer: Univer | null = null;
    let cancelado = false;

    (async () => {
      try {
        const dados = await xlsxParaWorkbookData(bytes);
        if (cancelado) return;
        if (!dados.sheetOrder || dados.sheetOrder.length === 0) {
          setVazio(true);
          return;
        }
        // Barra de abas só quando há múltiplas planilhas; nunca o botão de "+".
        const multiSheet = dados.sheetOrder.length > 1;
        const criado = createUniver({
          locale: LocaleType.EN_US,
          locales: { [LocaleType.EN_US]: mergeLocales(sheetsCoreEnUS) },
          // Tema inicial já no modo certo (o efeito abaixo cobre trocas ao vivo).
          darkMode: escuroRef.current,
          presets: [
            UniverSheetsCorePreset({
              container,
              // Read-only: sem cabeçalho/barra de ferramentas/fórmula/menu de contexto.
              header: false,
              toolbar: false,
              formulaBar: false,
              contextMenu: false,
              disableAutoFocus: true,
              // Rodapé: só as abas de planilha (quando >1), sem stats/zoom/menus/+.
              footer: multiSheet
                ? {
                    sheetBar: true,
                    statisticBar: false,
                    menus: false,
                    zoomSlider: false,
                    addSheetButtonConfig: { show: false },
                  }
                : false,
            }),
          ],
        });
        univer = criado.univer;
        apiRef.current = criado.univerAPI;
        criado.univerAPI.createWorkbook(dados);
        // Trava a edição (double-click/digitação) — preview inerte.
        criado.univerAPI.getActiveWorkbook()?.setEditable(false);
        // Reafirma o modo atual caso ele tenha mudado durante o parse assíncrono.
        criado.univerAPI.toggleDarkMode(escuroRef.current);
      } catch (e) {
        if (!cancelado) setErro(String(e));
      }
    })();

    return () => {
      cancelado = true;
      apiRef.current = null;
      univer?.dispose();
    };
  }, [bytes]);

  // Troca de tema com o viewer aberto: reflete sem remontar o Univer.
  useEffect(() => {
    apiRef.current?.toggleDarkMode(escuro);
  }, [escuro]);

  if (erro) {
    return <div className="p-4 text-xs text-destructive">{erro}</div>;
  }
  if (vazio) {
    return (
      <div className="p-6 text-center text-xs text-muted-foreground">
        {vazioTexto}
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1">
      {/* O Univer preenche este container (canvas). Altura vem do flex do card. */}
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
