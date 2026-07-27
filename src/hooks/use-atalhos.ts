import { useEffect, useRef } from "react";

/**
 * Hook central de atalhos de teclado (#28).
 *
 * Instala UM listener global de `keydown` no `window` e delega ao `handler`
 * passado. O listener é estável (instala uma vez): o `handler` mais recente é
 * lido via ref, então closures novas a cada render não re-registram o listener
 * nem perdem estado (padrão "use latest").
 *
 * Não decide NADA sobre foco/modificadores — isso é do handler, que recebe o
 * `KeyboardEvent` nativo cru. Use `isTypingTarget(e.target)` para não disparar
 * atalhos de tecla única enquanto o usuário digita num campo.
 *
 * ⚠️ Reserva do zoom do leitor (#76): a faixa `Ctrl +/−/0` é do zoom do iframe
 * do leitor. Este hook NÃO a captura; o handler deve ignorá-la explicitamente.
 */
export type AtalhoHandler = (e: KeyboardEvent) => void;

export function useAtalhos(handler: AtalhoHandler, ativo = true) {
  const ref = useRef(handler);
  // Mantém sempre a última versão do handler sem reinstalar o listener.
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    if (!ativo) return;
    const onKey = (e: KeyboardEvent) => ref.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ativo]);
}

/**
 * `true` quando o foco está num alvo de digitação — atalhos de tecla única
 * (r/a/f/j/k/c/…) não devem disparar aí, senão digitar "r" numa busca ou no
 * editor de compose viraria "responder". Cobre input/textarea/select,
 * `contenteditable` (o editor do compose) e qualquer nó marcado com
 * `data-atalhos-ignore`.
 */
export function isTypingTarget(alvo: EventTarget | null): boolean {
  if (!(alvo instanceof HTMLElement)) return false;
  const tag = alvo.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (alvo.isContentEditable) return true;
  if (alvo.closest("[contenteditable='true'], [data-atalhos-ignore]")) return true;
  return false;
}

/** Modificador "principal" multiplataforma (Ctrl no Windows, ⌘ no macOS). */
export function ehModPrincipal(e: KeyboardEvent): boolean {
  return e.ctrlKey || e.metaKey;
}
