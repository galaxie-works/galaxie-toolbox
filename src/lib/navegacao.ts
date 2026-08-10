import { Gauge, Settings, Radar } from "lucide-react";
import type { ComponentType } from "react";
import {
  AtomIcon,
  BridgeIcon,
  NavigatorIcon,
  CommsIcon,
  AstroIcon,
} from "@/components/ui/icons/marca-anim";
import { AppsIcon } from "@/components/ui/icons/apps-anim";
import { GalaxieSymbol } from "@/components/brand";
import { CopilotIcon } from "@/components/ui/icons/marca/copilot";
import { OneDriveIcon } from "@/components/ui/icons/marca/onedrive";
import { OutlookIcon } from "@/components/ui/icons/marca/outlook";
import { WindowsIcon } from "@/components/ui/icons/marca/windows";
import type { Dicionario } from "@/lib/strings";

/** Aceita icone do lucide e os SVGs de marca — os dois so precisam de className. */
export type IconeNav = ComponentType<{ className?: string }>;

/** Telas do canvas. Cada uma sabe onde fica no menu (para o breadcrumb). */
export type Tela =
  | "atoms"
  | "onedrive"
  | "apps"
  | "control-room"
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
  /**
   * #663 (RC): item escondido do sidebar no release-candidate. A `Tela` e a
   * tela continuam existindo (deep-link/atalho seguem funcionando); só o item
   * de menu não renderiza. Reversível: é só remover/flipar o flag — produtos
   * não-prontos não são deletados.
   */
  oculto?: boolean;
}

export interface ItemNav {
  titulo: ChaveNav;
  icone: IconeNav;
  filhos: ItemFilho[];
  /**
   * #664 (RC): item de nav navegável DIRETO (folha), em vez de grupo
   * colapsável. Quando presente e sem filhos visíveis, o sidebar renderiza um
   * item único que abre esta `Tela` (ex.: Windows → a tela de utilidades, que
   * roda no slot `caminhos-longos`).
   */
  id?: Tela;
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
        icone: GalaxieSymbol,
        filhos: [
          // #663 (RC): Atoms/Comms/Astro/Pulsar ocultos — sobram Bridge +
          // Navigator (os prontos). Ocultos por flag, nada deletado.
          { id: "atoms", titulo: "atoms", icone: AtomIcon, oculto: true },
          { id: "control-room", titulo: "controlRoom", icone: BridgeIcon },
          { id: "navegador", titulo: "navegador", icone: NavigatorIcon },
          { id: "comms", titulo: "comms", icone: CommsIcon, oculto: true },
          { id: "astro", titulo: "astro", icone: AstroIcon, oculto: true },
          { id: "pulsar", titulo: "pulsar", icone: Radar, oculto: true },
        ],
      },
      {
        titulo: "copilot",
        icone: CopilotIcon,
        filhos: [
          { id: "apps", titulo: "apps", icone: AppsIcon },
          // #663 (RC): Outlook oculto — sobram Apps + OneDrive.
          { id: "outlook", titulo: "outlook", icone: OutlookIcon, oculto: true },
          { id: "onedrive", titulo: "onedrive", icone: OneDriveIcon },
        ],
      },
      {
        // #664 (RC): Windows vira item ÚNICO (folha) com o logo do Windows,
        // abrindo a tela de utilidades. A tela real (WindowsScreen, #665/Sirius)
        // roda no slot `caminhos-longos`, então o item navega pra lá.
        // Performance e o antigo Caminhos-longos saem do sidebar (ocultos por
        // flag do #663); as `Tela`s deles seguem existindo.
        titulo: "windows",
        icone: WindowsIcon,
        id: "caminhos-longos",
        filhos: [
          { id: "performance", titulo: "performance", oculto: true },
          { id: "caminhos-longos", titulo: "caminhosLongos", oculto: true },
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
  atoms: { titulo: "atoms", secao: "galaxie", icone: AtomIcon },
  "control-room": { titulo: "controlRoom", secao: "galaxie", icone: BridgeIcon },
  navegador: { titulo: "navegador", secao: "galaxie", icone: NavigatorIcon },
  comms: { titulo: "comms", secao: "galaxie", icone: CommsIcon },
  astro: { titulo: "astro", secao: "galaxie", icone: AstroIcon },
  pulsar: { titulo: "pulsar", secao: "galaxie", icone: Radar },
  // Microsoft 365
  apps: { titulo: "apps", secao: "copilot", icone: AppsIcon },
  outlook: { titulo: "outlook", secao: "copilot", icone: OutlookIcon },
  onedrive: { titulo: "onedrive", secao: "copilot", icone: OneDriveIcon },
  // Windows
  performance: { titulo: "performance", secao: "windows", icone: Gauge },
  // #664: o slot `caminhos-longos` agora renderiza a tela Windows (#665) — então
  // o cabeçalho/breadcrumb vira "Platform > Windows" com o logo do Windows.
  "caminhos-longos": { titulo: "windows", secao: "plataforma", icone: WindowsIcon },
  configuracoes: { titulo: "configuracoes", secao: "conta", icone: Settings },
};
