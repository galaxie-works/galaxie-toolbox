import { Cloud, Mail, MonitorCog, Gauge, FolderTree, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/** Telas do canvas. Cada uma sabe onde fica no menu (para o breadcrumb). */
export type Tela =
  | "onedrive"
  | "outlook"
  | "performance"
  | "caminhos-longos"
  | "configuracoes";

export interface ItemFilho {
  id: Tela;
  titulo: string;
}

export interface ItemNav {
  titulo: string;
  icone: LucideIcon;
  filhos: ItemFilho[];
}

export interface GrupoNav {
  titulo: string;
  itens: ItemNav[];
}

export const NAV: GrupoNav[] = [
  {
    titulo: "Plataforma",
    itens: [
      {
        titulo: "Microsoft 365",
        icone: Cloud,
        filhos: [
          { id: "outlook", titulo: "Outlook" },
          { id: "onedrive", titulo: "OneDrive" },
        ],
      },
      {
        titulo: "Windows",
        icone: MonitorCog,
        filhos: [
          { id: "performance", titulo: "Performance" },
          { id: "caminhos-longos", titulo: "Caminhos longos" },
        ],
      },
    ],
  },
];

/** Ícone e trilha de cada tela, usados no cabeçalho do canvas. */
export const TELAS: Record<Tela, { titulo: string; secao: string; icone: LucideIcon }> = {
  outlook: { titulo: "Outlook", secao: "Microsoft 365", icone: Mail },
  onedrive: { titulo: "OneDrive", secao: "Microsoft 365", icone: Cloud },
  performance: { titulo: "Performance", secao: "Windows", icone: Gauge },
  "caminhos-longos": { titulo: "Caminhos longos", secao: "Windows", icone: FolderTree },
  configuracoes: { titulo: "Configurações", secao: "Conta", icone: Settings },
};
