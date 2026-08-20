// #1285 (B2): mapa de ícone semântico por pasta conhecida da home. Em arquivo
// próprio (não no home-view.tsx) porque o lint `react(only-export-components)`
// exige que um arquivo de componente exporte só componentes — e este helper
// precisa ser exportado pra ser testado direto.
import {
  Download,
  Folder,
  Image,
  Music,
  FileText,
  Monitor,
  Video,
  type LucideIcon,
} from "lucide-react";

/**
 * Ícone por pasta conhecida da home, casado pelo nome-base em minúsculas (nomes
 * em inglês do Windows). Pasta não-reconhecida (nome localizado ou custom) cai
 * no `Folder` — é o "e as demais subpastas" do AC.
 */
const ICONE_POR_NOME: Record<string, LucideIcon> = {
  desktop: Monitor,
  documents: FileText,
  downloads: Download,
  pictures: Image,
  music: Music,
  videos: Video,
};

export function iconeDaPasta(nome: string): LucideIcon {
  return ICONE_POR_NOME[nome.trim().toLowerCase()] ?? Folder;
}
