import {
  MonitorCog,
  Gauge,
  FolderTree,
  Settings,
  LayoutGrid,
  Orbit,
  RadioTower,
  Radar,
  Sparkles,
} from "lucide-react";
import type { ComponentType } from "react";
import { CruiserIcon } from "@/components/ui/icons/marca/cruiser";
import { CopilotIcon } from "@/components/ui/icons/marca/copilot";
import { OneDriveIcon } from "@/components/ui/icons/marca/onedrive";
import { OutlookIcon } from "@/components/ui/icons/marca/outlook";
import type { Dicionario } from "@/lib/strings";

/** Aceita icone do lucide e os SVGs de marca — os dois so precisam de className. */
export type IconeNav = ComponentType<{ className?: string }>;

/** Telas do canvas. Cada uma sabe onde fica no menu (para o breadcrumb). */
export type Tela =
  | "onedrive"
  | "apps"
  | "navegador"
  | "comms"
  | "astro"
  | "pulsar"
  | "outlook"
  | "performance"
  | "caminhos-longos"
  | "configuracoes";

/** Chave dentro de `t.nav` — o texto sai do dicionario, nao daqui. */
type ChaveNav = keyof Dicionario["nav"];

export interface ItemFilho {
  id: Tela;
  titulo: ChaveNav;
  icone?: IconeNav;
}

export interface ItemNav {
  titulo: ChaveNav;
  icone: IconeNav;
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
      // Produtos da propria Galaxie, com nomes galacticos.
      {
        titulo: "galaxie",
        icone: Orbit,
        filhos: [
          { id: "navegador", titulo: "navegador", icone: CruiserIcon },
          { id: "comms", titulo: "comms", icone: RadioTower },
          { id: "astro", titulo: "astro", icone: Sparkles },
          { id: "pulsar", titulo: "pulsar", icone: Radar },
        ],
      },
      {
        titulo: "copilot",
        icone: CopilotIcon,
        filhos: [
          { id: "apps", titulo: "apps", icone: LayoutGrid },
          { id: "outlook", titulo: "outlook", icone: OutlookIcon },
          { id: "onedrive", titulo: "onedrive", icone: OneDriveIcon },
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
  { titulo: ChaveNav; secao: ChaveNav; icone: IconeNav }
> = {
  // Produtos Galaxie
  navegador: { titulo: "navegador", secao: "galaxie", icone: CruiserIcon },
  comms: { titulo: "comms", secao: "galaxie", icone: RadioTower },
  astro: { titulo: "astro", secao: "galaxie", icone: Sparkles },
  pulsar: { titulo: "pulsar", secao: "galaxie", icone: Radar },
  // Microsoft 365
  apps: { titulo: "apps", secao: "copilot", icone: LayoutGrid },
  outlook: { titulo: "outlook", secao: "copilot", icone: OutlookIcon },
  onedrive: { titulo: "onedrive", secao: "copilot", icone: OneDriveIcon },
  // Windows
  performance: { titulo: "performance", secao: "windows", icone: Gauge },
  "caminhos-longos": { titulo: "caminhosLongos", secao: "windows", icone: FolderTree },
  configuracoes: { titulo: "configuracoes", secao: "conta", icone: Settings },
};
