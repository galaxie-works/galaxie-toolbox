// #687 (Remote S4-UI): mapeamento PURO de eventos do DOM (mouse/teclado) →
// `InputEvent` do contrato (coord NORMALIZADA 0..1, down/up explícito). Sem React
// e sem import de valor do Tauri (só TIPOS, erasados) — carrega no `node --test`.
// A tela (`remote.tsx`) captura os eventos na viewport e manda pro backend via
// `enviarInput`; aqui só a tradução, testável.
import type { BotaoMouse, InputEvent, Tecla } from "@/lib/remote";

export interface Retangulo {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Coordenada de tela → normalizada 0..1 na viewport (clampada). */
export function posNormalizada(
  clientX: number,
  clientY: number,
  rect: Retangulo,
): { x: number; y: number } {
  const nx = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
  const ny = rect.height > 0 ? (clientY - rect.top) / rect.height : 0;
  return {
    x: Math.min(1, Math.max(0, nx)),
    y: Math.min(1, Math.max(0, ny)),
  };
}

/** `MouseEvent.button` (0/1/2) → `BotaoMouse`; outros botões → null (ignora). */
export function botaoMouse(button: number): BotaoMouse | null {
  switch (button) {
    case 0:
      return "left";
    case 1:
      return "middle";
    case 2:
      return "right";
    default:
      return null;
  }
}

// Teclas nomeadas do `KeyboardEvent.key` → o `Tecla` do contrato (tag `k`).
const NOMEADAS: Record<string, Tecla> = {
  Enter: { k: "enter" },
  Backspace: { k: "backspace" },
  Tab: { k: "tab" },
  Escape: { k: "escape" },
  " ": { k: "space" },
  Delete: { k: "delete" },
  ArrowLeft: { k: "left" },
  ArrowRight: { k: "right" },
  ArrowUp: { k: "up" },
  ArrowDown: { k: "down" },
  Home: { k: "home" },
  End: { k: "end" },
  PageUp: { k: "pageUp" },
  PageDown: { k: "pageDown" },
  Shift: { k: "shift" },
  Control: { k: "control" },
  Alt: { k: "alt" },
  Meta: { k: "meta" },
};

/**
 * `KeyboardEvent.key` → `Tecla`. Nomeadas viram a variante própria; `F1..F24`
 * viram `{k:"f",n}`; um único caractere imprimível vira `{k:"char",c}`. Qualquer
 * outra coisa (nome desconhecido, string multi-char) → null (ignora).
 */
export function mapearTecla(key: string): Tecla | null {
  const nomeada = NOMEADAS[key];
  if (nomeada) return nomeada;
  const fMatch = /^F([1-9]|1\d|2[0-4])$/.exec(key);
  if (fMatch) return { k: "f", n: Number(fMatch[1]) };
  if ([...key].length === 1) return { k: "char", c: key };
  return null;
}

/** Mouse move na viewport → `InputEvent` normalizado. */
export function eventoMouseMove(
  clientX: number,
  clientY: number,
  rect: Retangulo,
): InputEvent {
  const { x, y } = posNormalizada(clientX, clientY, rect);
  return { e: "mouseMove", x, y };
}

/** Botão do mouse pressionado/solto → `InputEvent` (ou null se botão ignorado). */
export function eventoMouseBotao(
  button: number,
  pressed: boolean,
): InputEvent | null {
  const botao = botaoMouse(button);
  return botao ? { e: "mouseButton", botao, pressed } : null;
}

/** Tecla pressionada/solta → `InputEvent` (ou null se a tecla não mapeia). */
export function eventoTecla(key: string, pressed: boolean): InputEvent | null {
  const tecla = mapearTecla(key);
  return tecla ? { e: "key", tecla, pressed } : null;
}

/** Roda do mouse → scroll em "cliques" (sinal = direção). */
export function eventoScroll(deltaX: number, deltaY: number): InputEvent {
  return {
    e: "mouseScroll",
    dx: Math.sign(deltaX) * Math.min(3, Math.ceil(Math.abs(deltaX) / 40) || 0),
    dy: Math.sign(deltaY) * Math.min(3, Math.ceil(Math.abs(deltaY) / 40) || 0),
  };
}
