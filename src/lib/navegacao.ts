import { Cloud, Mail, MonitorCog, Gauge, FolderTree, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Dicionario } from "@/lib/strings";

/** Telas do canvas. Cada uma sabe onde fica no menu (para o breadcrumb). */
export type Tela =
  | "onedrive"
  | "outlook"
  | "performance"
  | "caminhos-longos"
  | "configuracoes";

/** Chave dentro de `t.nav` — o texto sai do dicionario, nao daqui. */
type ChaveNav = keyof Dicionario["nav"];

export interface ItemFilho {
  id: Tela;
  titulo: ChaveNav;
}

export interface ItemNav {
  titulo: ChaveNav;
  icone: LucideIcon;
  filhos: ItemFilho[];
}

export interface GrupoNav {
  titulo: ChaveNav;
  itens: ItemNav[];
}

export const NAV: GrupoNav[] = [
  {
    titulo: "plataforma",
    itens: [
      {
        titulo: "microsoft365",
        icone: Cloud,
        filhos: [
          { id: "outlook", titulo: "outlook" },
          { id: "onedrive", titulo: "onedrive" },
        ],
      },
      {
        titulo: "windows",
        icone: MonitorCog,
        filhos: [
          { id: "performance", titulo: "performance" },
          { id: "caminhos-longos", titulo: "caminhosLongos" },
        ],
      },
    ],
  },
];

/** Ícone e trilha de cada tela, usados no cabeçalho do canvas. */
export const TELAS: Record<
  Tela,
  { titulo: ChaveNav; secao: ChaveNav; icone: LucideIcon }
> = {
  outlook: { titulo: "outlook", secao: "microsoft365", icone: Mail },
  onedrive: { titulo: "onedrive", secao: "microsoft365", icone: Cloud },
  performance: { titulo: "performance", secao: "windows", icone: Gauge },
  "caminhos-longos": { titulo: "caminhosLongos", secao: "windows", icone: FolderTree },
  configuracoes: { titulo: "configuracoes", secao: "conta", icone: Settings },
};
