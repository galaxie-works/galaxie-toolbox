// #1614 — o `Alerta` é o PONTO ÚNICO da caixa de aviso do app web.
//
// Duas metades, de propósito, porque são perguntas diferentes:
//   1. o `Alerta` FAZ o que promete (monta e lê o DOM);
//   2. ninguém volta a escrever a caixa à mão (varre a fonte).
//
// A 1ª sozinha deixaria alguém hand-craftar um `role="status"` ao lado; a 2ª
// sozinha provaria que ninguém copia, sem provar que o original funciona. Foi
// exatamente essa separação que me faltou no #1599 — a guarda de fonte dizia "o
// nome antigo saiu" e ninguém tinha provado que o novo aparecia no ecrã.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Alerta } from "./alerta";

afterEach(cleanup);

/**
 * `web/src` — a raiz da varredura.
 *
 * Pelo `cwd` e não por `import.meta.url`: sob o transform do Vite este último
 * não é um URL `file:` e o `fileURLToPath` estoura. O `existsSync` é a rede —
 * se o `cwd` mudar, o teste falha a dizer isso, em vez de varrer o vazio e
 * passar verde. Vazio-por-erro é o modo de falha que estas guardas mais temem.
 */
const WEB_SRC = join(process.cwd(), "src");

/** Este ficheiro cita `role="status"` para o caçar, e vive na fonte. */
const ESTE = "alerta.test.tsx";
/** O dono do padrão: é ELE que tem de trazer o `role="status"`. */
const DONO = "alerta.tsx";

function fontes(dir: string): string[] {
  const achados: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) achados.push(...fontes(p));
    else if (/\.tsx?$/.test(e)) achados.push(p);
  }
  return achados;
}

/**
 * Tira comentários antes de varrer.
 *
 * Não é preciosismo: o `admin-org.tsx` **explica** o `role="status"` em três
 * comentários — a documentar porque a região viva precisa de nome. Uma varredura
 * ingénua acusaria a própria explicação, e a saída natural seria apagar o
 * comentário para calar o teste. Guarda que empurra para apagar documentação
 * está a trabalhar contra quem a lê.
 */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/**
 * `role="status"` em **qualquer grafia válida de JSX**.
 *
 * Achado do Codex nesta PR, e é a **terceira vez hoje** que a mesma cegueira me
 * apanha: uma varredura que casa só a forma com aspas duplas deixa passar
 * `role='status'`, `role={"status"}`, `` role={`status`} `` — todas JSX válido,
 * todas a contornar o ponto único com o gate verde.
 *
 * As duas anteriores foram no `resizable-ponto-unico` (#1279, achado da @Íris:
 * `cn()` e aspas simples; #1629, achado do @Altair: prefixos). Escrevo o padrão
 * aqui de uma vez, em vez de o alargar quando alguém for mordido outra vez.
 */
const ROLE_STATUS = /role\s*=\s*\{?\s*["'`]status["'`]/;

describe("#1614 — a caixa de aviso tem um ponto único", () => {
  it("o `Alerta` monta região viva COM nome acessível", () => {
    render(<Alerta tom="aviso" titulo="Org suspensa" detalhe="Fale com o suporte" />);
    const regiao = screen.getByRole("status");
    // O nome é o que distingue duas regiões vivas na mesma página — achado da
    // @Íris no #1544, quando a faixa e o painel se anunciavam igual.
    expect(regiao.getAttribute("aria-label")).toBe("Org suspensa");
    expect(regiao.textContent).toContain("Org suspensa");
    expect(regiao.textContent).toContain("Fale com o suporte");
  });

  it("sem `detalhe`, não inventa um parágrafo vazio", () => {
    const { container } = render(<Alerta tom="erro" titulo="Não foi possível remover" />);
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });

  it("o tom muda a caixa, e `simples` não desenha caixa", () => {
    const { container: aviso } = render(<Alerta tom="aviso" titulo="a" />);
    expect(aviso.firstElementChild!.className).toContain("bg-warning/10");
    cleanup();
    const { container: simples } = render(<Alerta tom="simples" titulo="a" />);
    expect(simples.firstElementChild!.className).not.toContain("bg-");
  });

  // ── a metade de FONTE ────────────────────────────────────────────────────
  it("ninguém escreve `role=\"status\"` à mão — vem do `Alerta`", () => {
    expect(existsSync(WEB_SRC), `WEB_SRC não existe: ${WEB_SRC}`).toBe(true);
    const arquivos = fontes(WEB_SRC);
    // Anti-cegueira: varredura que não acha ficheiro nenhum passaria vazia, e
    // vazio diz "conferido" — que é pior que errado.
    expect(arquivos.length).toBeGreaterThan(10);

    const infratores = arquivos
      .filter((p) => {
        const nome = p.replace(/\\/g, "/").split("/").pop()!;
        // O dono do padrão e este próprio ficheiro estão fora: um TEM de o
        // trazer, o outro cita-o para o caçar. A exclusão do ficheiro-guarda
        // é a lição do #1599 — lá ela existia e estava aplicada só a UMA das
        // duas varreduras, e a outra ficou com folga permanente.
        return nome !== DONO && nome !== ESTE;
      })
      .filter((p) => ROLE_STATUS.test(semComentarios(readFileSync(p, "utf8"))))
      .map((p) => p.replace(/\\/g, "/").split("/web/src/")[1]);

    expect(
      infratores,
      "caixa de aviso escrita à mão — use o `Alerta` de `components/alerta.tsx`, " +
        "que garante o `role=\"status\"` COM nome acessível",
    ).toEqual([]);
  });

  it("o dono do padrão realmente o carrega (senão a varredura acima é decoração)", () => {
    const dono = readFileSync(join(WEB_SRC, "components", DONO), "utf8");
    expect(ROLE_STATUS.test(dono)).toBe(true);
    expect(dono).toContain("aria-label={titulo}");
  });
});
