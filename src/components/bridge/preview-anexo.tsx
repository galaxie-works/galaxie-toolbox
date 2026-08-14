/**
 * Pré-visualização de anexos do Bridge (épico #178 · #188 PDF/TXT · #189
 * docx/xlsx · #190 Path C · #450 imagem · #451 csv · #452 mídia).
 *
 * #873: o núcleo de renderização + segurança foi extraído para o
 * `PreviewArquivo` (`components/preview/preview-arquivo.tsx`), REUSADO também
 * pelo Explorer de Arquivos. Este arquivo é o adaptador fino do Bridge: fixa a
 * fonte em `anexo` (Graph, incl. Path C "alta fidelidade") e mapeia a ação
 * "Salvar" (Downloads). O contrato externo (`PreviewAnexoProps`) e o
 * comportamento/invariantes de segurança são os MESMOS de antes.
 */
import { Download } from "lucide-react";

import { useIdioma } from "@/lib/idioma";
import type { AnexoEmail } from "@/lib/types";
import { PreviewArquivo } from "@/components/preview/preview-arquivo";

export interface PreviewAnexoProps {
  anexo: AnexoEmail;
  messageId: string;
  mailbox?: string;
  /** Ação explícita "Salvar" (Downloads) — reusa o fluxo do control-room. */
  onSalvar: () => void;
  onFechar: () => void;
}

export function PreviewAnexo({
  anexo,
  messageId,
  mailbox,
  onSalvar,
  onFechar,
}: PreviewAnexoProps) {
  const { t } = useIdioma();
  return (
    <PreviewArquivo
      fonte={{ kind: "anexo", anexo, messageId, mailbox }}
      acaoPrimaria={{
        onClick: onSalvar,
        rotulo: t.controlRoom.previewSalvar,
        Icone: Download,
      }}
      onFechar={onFechar}
    />
  );
}
