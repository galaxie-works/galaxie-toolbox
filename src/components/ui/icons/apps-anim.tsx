import { BlocksIcon } from "@/components/ui/blocks";
import { IconeItemAnim, type AnimIcon } from "@/components/ui/icons/marca-anim";
import { HandMetalIcon } from "@/components/ui/hand-metal";
import { GaugeIcon } from "@/components/ui/gauge";
import { WrenchIcon } from "@/components/ui/wrench";
import { BookTextIcon } from "@/components/ui/book-text";
import { MessageCircleIcon } from "@/components/ui/message-circle";
import { ArchiveIcon } from "@/components/ui/archive";
import { WorkflowIcon } from "@/components/ui/workflow";
import { UsersIcon } from "@/components/ui/users";
import { TerminalIcon } from "@/components/ui/terminal";

/**
 * Ícone dos Apps — wrapper do BlocksIcon (motion/react, anima no hover sozinho).
 * O BlocksIcon dimensiona pelo prop numérico `size` (não pela className), então
 * fixamos 20px para casar com o `size-5` da sidebar; a className ainda é
 * repassada ao div raiz do BlocksIcon.
 */
export function AppsIcon({ className }: { className?: string }) {
  return <BlocksIcon size={22} className={className} />;
}

/**
 * #620: ícones dos itens do sidebar da tela Apps — lucide-animated (registry),
 * animando no hover da LINHA inteira via `IconeAnim` (mesmo padrão do
 * `marca-anim.tsx`: acha o `<a>/<button>` ancestral e dispara start/stop). Um
 * por item: Recommended + as 8 categorias (mapa no épico #619).
 */
export function RecommendedIcon({ className }: { className?: string }) {
  return <IconeItemAnim Comp={HandMetalIcon as unknown as AnimIcon} className={className} />;
}
export function ProdutividadeIcon({ className }: { className?: string }) {
  return <IconeItemAnim Comp={GaugeIcon as unknown as AnimIcon} className={className} />;
}
export function UtilitariosIcon({ className }: { className?: string }) {
  return <IconeItemAnim Comp={WrenchIcon as unknown as AnimIcon} className={className} />;
}
export function EducacaoIcon({ className }: { className?: string }) {
  return <IconeItemAnim Comp={BookTextIcon as unknown as AnimIcon} className={className} />;
}
export function ComunicacaoIcon({ className }: { className?: string }) {
  return <IconeItemAnim Comp={MessageCircleIcon as unknown as AnimIcon} className={className} />;
}
export function ConteudoIcon({ className }: { className?: string }) {
  return <IconeItemAnim Comp={ArchiveIcon as unknown as AnimIcon} className={className} />;
}
export function ProjetosIcon({ className }: { className?: string }) {
  return <IconeItemAnim Comp={WorkflowIcon as unknown as AnimIcon} className={className} />;
}
export function ExperienciaIcon({ className }: { className?: string }) {
  return <IconeItemAnim Comp={UsersIcon as unknown as AnimIcon} className={className} />;
}
export function DesenvolvimentoIcon({ className }: { className?: string }) {
  return <IconeItemAnim Comp={TerminalIcon as unknown as AnimIcon} className={className} />;
}
