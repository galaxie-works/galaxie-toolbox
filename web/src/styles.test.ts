// #1614 — os tokens de severidade do `web/` NÃO divergem do desktop, e o
// foreground do destructive CONTRASTA com o seu fundo.
//
// ## Porque este teste existe
//
// O gate do card apanhou um defeito meu VIVO na pre-prod: eu declarei
// `--destructive-foreground: var(--color-red-800)` — copiado da linha 48 do
// `src/index.css` do desktop — mas essa linha é **vencida** pela 112/117
// (`oklch(0.985 0 0)`, quase-branco) em todos os 9 temas. Copiei a coordenada
// perdedora. Um foreground avermelhado sobre o vermelho do destructive não
// contrasta: é a definição do defeito (@Íris/@Lúmen/@Altair).
//
// ⚠️ LIMITE DECLARADO: este teste NÃO computa contraste real (isso exigiria
// resolver oklch e a luminância — candidato a card próprio, se a QA-V quiser o
// oráculo do motor). Ele trava a REGRESSÃO exata e a sua vizinhança óbvia: o
// foreground do destructive não pode voltar a ser um tom do próprio vermelho.
// É a mesma direção restritiva do resto: prova o que consegue provar por parse,
// e diz o que não prova.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CSS = readFileSync(join(process.cwd(), "src", "styles.css"), "utf8");

/** O valor declarado de um token no `:root` do `web/styles.css`. */
function tokenDoWeb(nome: string): string | null {
  const m = new RegExp(`--${nome}\\s*:\\s*([^;]+);`).exec(CSS);
  return m ? m[1]!.trim() : null;
}

describe("#1614 — tokens de severidade do web", () => {
  it("o `--destructive-foreground` NÃO é avermelhado (contrasta com o destructive)", () => {
    const fg = tokenDoWeb("destructive-foreground");
    expect(fg, "o web perdeu o token `--destructive-foreground`").toBeTruthy();

    // O defeito exato: `var(--color-red-*)`. Um foreground que É vermelho não
    // contrasta com um fundo vermelho. O desktop usa quase-branco (0.985) em 8
    // temas e quase-preto (0.12) no alto-contraste — nunca o próprio vermelho.
    expect(
      fg,
      `\`--destructive-foreground: ${fg}\` é o próprio vermelho do destructive — ` +
        `não contrasta com o fundo. O valor efetivo do desktop é \`oklch(0.985 0 0)\` ` +
        `(src/index.css:112). Ver o cabeçalho de styles.css.`,
    ).not.toMatch(/--color-red-|--destructive\b/);
  });

  it("batem com o valor EFETIVO do desktop (cascata resolvida, não a linha citada)", () => {
    // Valores medidos pela @Íris na cascata real (getComputedStyle). Se um
    // mudar no desktop, muda aqui — é cópia deliberada, e este teste apanha a
    // cópia a envelhecer.
    const esperado: Record<string, string> = {
      warning: "oklch(0.72 0.17 70)",
      destructive: "oklch(0.577 0.245 27.325)",
      "destructive-foreground": "oklch(0.985 0 0)",
      "warning-foreground": "var(--color-yellow-900)",
    };
    for (const [nome, valor] of Object.entries(esperado)) {
      expect(tokenDoWeb(nome), `--${nome} divergiu do desktop`).toBe(valor);
    }
  });
});
