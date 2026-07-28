/**
 * Cor de destaque customizada (#121).
 *
 * O valor persiste no store único. Este módulo apenas valida, calcula o
 * foreground acessível e aplica/remove os overrides semânticos no <html>.
 */

export const CHAVE_COR_DESTAQUE = "galaxie-toolbox.accent-color";
export const COR_DESTAQUE_PICKER_PADRAO = "#c026d3";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const TOKENS_DESTAQUE = [
  "--primary",
  "--primary-foreground",
  "--sidebar-primary",
  "--sidebar-primary-foreground",
] as const;

export function corHexValida(valor: unknown): valor is string {
  return typeof valor === "string" && HEX_COLOR.test(valor);
}

function canalLinear(canal: number): number {
  const srgb = canal / 255;
  return srgb <= 0.04045
    ? srgb / 12.92
    : ((srgb + 0.055) / 1.055) ** 2.4;
}

export function luminanciaHex(cor: string): number {
  const r = Number.parseInt(cor.slice(1, 3), 16);
  const g = Number.parseInt(cor.slice(3, 5), 16);
  const b = Number.parseInt(cor.slice(5, 7), 16);
  return (
    0.2126 * canalLinear(r) +
    0.7152 * canalLinear(g) +
    0.0722 * canalLinear(b)
  );
}

export function foregroundParaCor(cor: string): "#000000" | "#ffffff" {
  const luminancia = luminanciaHex(cor);
  const contrasteEscuro = (luminancia + 0.05) / 0.05;
  const contrasteClaro = 1.05 / (luminancia + 0.05);
  return contrasteEscuro >= contrasteClaro ? "#000000" : "#ffffff";
}

export function contrasteCorDestaque(cor: string): number {
  const luminancia = luminanciaHex(cor);
  const foreground = foregroundParaCor(cor);
  return foreground === "#000000"
    ? (luminancia + 0.05) / 0.05
    : 1.05 / (luminancia + 0.05);
}

export function corDestaqueSalva(): string | null {
  try {
    const bruto = localStorage.getItem(CHAVE_COR_DESTAQUE);
    if (bruto === null) return null;

    try {
      const parsed = JSON.parse(bruto);
      return corHexValida(parsed) ? parsed.toLowerCase() : null;
    } catch {
      return corHexValida(bruto) ? bruto.toLowerCase() : null;
    }
  } catch {
    return null;
  }
}

export function aplicarCorDestaque(cor: string | null): void {
  const raiz = document.documentElement;

  if (!corHexValida(cor)) {
    for (const token of TOKENS_DESTAQUE) {
      raiz.style.removeProperty(token);
    }
    delete raiz.dataset.customAccent;
    return;
  }

  const normalizada = cor.toLowerCase();
  const foreground = foregroundParaCor(normalizada);
  raiz.style.setProperty("--primary", normalizada);
  raiz.style.setProperty("--primary-foreground", foreground);
  raiz.style.setProperty("--sidebar-primary", normalizada);
  raiz.style.setProperty("--sidebar-primary-foreground", foreground);
  raiz.dataset.customAccent = normalizada;
}

/** Aplica antes do React montar para evitar flash da cor padrão. */
aplicarCorDestaque(corDestaqueSalva());
