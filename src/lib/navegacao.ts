import { Gauge, Settings, Radar, FolderTree, MonitorSmartphone } from "lucide-react";
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
  | "arquivos"
  | "remote"
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
          // #677: Explorer de arquivos local — oculto do sidebar por ora (S1),
          // mas a `Tela`/rota já existe (navegável direto por onNavegar/deep-link).
          // Fica como filho oculto: `filhos` visíveis continua vazio, então o
          // item Windows segue renderizando como folha (não muda o sidebar).
          { id: "arquivos", titulo: "arquivos", icone: FolderTree, oculto: true },
        ],
      },
    ],
  },
];

/** Tela em que o app abre por padrão (#718 SH0). */
export const TELA_PADRAO: Tela = "navegador";

/** Só é `Tela` o que existe no `TELAS` — sem `as Tela`, a checagem é o próprio mapa. */
function ehTela(valor: string): valor is Tela {
  return Object.prototype.hasOwnProperty.call(TELAS, valor);
}

/**
 * Tela inicial do app — FUNIL ÚNICO (#1299).
 *
 * Telas ocultas por flag (`oculto: true`, #663) não têm porta de entrada: o
 * código está na `pre-prod`, mas nem QA nem script conseguem chegar nelas. Esta
 * é a porta — `?tela=<id>` —, e ela vive aqui, num lugar só: o `App.tsx` NÃO lê
 * `location.search`. Quem precisar de outra entrada muda esta função, não
 * espalha leitura de URL pelo app.
 *
 * **A porta não existe em produção.** O corpo inteiro está atrás de
 * `import.meta.env.DEV`, que o Vite substitui por `false` no build de produção —
 * o bloco vira código morto e sai do bundle na minificação. Isso é AC de
 * SEGURANÇA (#1299), não conveniência: abrir a tela oculta em produção seria
 * fechar um buraco de QA criando um de produto, e o #663 continua de pé.
 *
 * Valor inválido, ausente ou fora do `TELAS` cai no padrão sem quebrar.
 */
export function telaInicial(): Tela {
  if (!import.meta.env.DEV) return TELA_PADRAO;
  if (typeof window === "undefined") return TELA_PADRAO;
  const pedida = new URLSearchParams(window.location.search).get("tela");
  if (!pedida) return TELA_PADRAO;
  const alvo = ehTela(pedida) ? pedida : TELA_PADRAO;
  // Sentinela do AC de segurança: esta string SÓ pode existir em build de dev.
  // O gate (`porta-qa-ausente-em-prod.test.ts`) falha se ela aparecer no `dist/`.
  // De quebra, a QA vê no console que a porta foi usada e para qual tela.
  console.info("[porta-qa-1299]", pedida, "->", alvo);
  return alvo;
}

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
  // #677: Explorer de arquivos local.
  arquivos: { titulo: "arquivos", secao: "plataforma", icone: FolderTree },
  // #718 (SH0): GALAXIE Remote — item fixo do rail (tela placeholder até o #682).
  remote: { titulo: "remote", secao: "plataforma", icone: MonitorSmartphone },
  configuracoes: { titulo: "configuracoes", secao: "conta", icone: Settings },
};
