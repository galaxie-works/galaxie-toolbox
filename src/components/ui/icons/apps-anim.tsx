import { BlocksIcon } from "@/components/ui/blocks";

/**
 * Ícone dos Apps — wrapper do BlocksIcon (motion/react, anima no hover sozinho).
 * O BlocksIcon dimensiona pelo prop numérico `size` (não pela className), então
 * fixamos 20px para casar com o `size-5` da sidebar; a className ainda é
 * repassada ao div raiz do BlocksIcon.
 */
export function AppsIcon({ className }: { className?: string }) {
  return <BlocksIcon size={22} className={className} />;
}
