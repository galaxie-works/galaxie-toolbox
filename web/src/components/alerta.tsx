import type { ReactNode } from "react";

/**
 * A caixa de aviso do app web — **num ponto único**.
 *
 * ## Porque existe (#1614, P1 do Codex na PR #1557)
 *
 * O Codex apontou que o banner de org suspensa era **hand-craftado** em vez de
 * usar o `Alert` do registry. O apontamento está certo no fundo — a mesma caixa
 * estava escrita **quatro vezes** no `admin-org.tsx` — mas o remédio literal
 * **não é possível aqui**, e vale a pena dizer porquê em vez de o fingir:
 *
 * ```
 * o Alert do registry vive em ..... src/components/reui/alert.tsx   (app TAURI)
 * dependências do web/ ............ react · react-dom · react-router-dom
 * ```
 *
 * São **dois workspaces pnpm separados**, sem caminho de import entre eles. O
 * `web/` não tem ReUI, nem Radix, nem registry. Quem escreveu o banner à mão no
 * #1557 não tinha o que usar — e continua a não ter.
 *
 * ⚠️ **Isto NÃO é "o Alert do registry"**, e o nome (`Alerta`, não `Alert`) é
 * deliberado para não sugerir que seja. As alternativas de verdade — partilhar o
 * registry com o `web/` (arquitetura, @Altair) ou re-escopar o AC (@Mira) —
 * ficam abertas; isto serve o **intento** do P1 dentro da restrição real.
 *
 * É o mesmo caminho do `modal.tsx`, escrito na #1626 pela mesma razão medida.
 *
 * ## O que a caixa garante, e não é cosmético
 *
 * `role="status"` **com `aria-label`**. Sem nome, duas regiões vivas na mesma
 * página ficam indistinguíveis para quem usa leitor de ecrã — foi o achado da
 * @Íris no #1544, quando a faixa da página e o painel se anunciavam com a mesma
 * identidade. Aqui o nome é obrigatório por assinatura: não há como esquecê-lo.
 */
export function Alerta({
  tom,
  titulo,
  detalhe,
  className,
}: {
  /**
   * `aviso` — algo precisa de atenção e o utilizador **pode agir** (org
   * suspensa, último admin). `erro` — falhou e não há ação óbvia. `simples` —
   * texto sem caixa, quando o próprio painel já é o contexto (negativa de
   * acesso).
   *
   * Os dois primeiros usam os **tokens de severidade do tema** (`warning`,
   * `destructive`) — os MESMOS do desktop, declarados em `styles.css` com a
   * origem anotada. Requisito do @Altair: as duas superfícies dizem a mesma
   * coisa da mesma cor **sem uma linha de código partilhada**.
   */
  tom: "aviso" | "erro" | "simples";
  /** Também é o NOME acessível da região viva. Obrigatório de propósito. */
  titulo: string;
  detalhe?: ReactNode;
  className?: string;
}) {
  const caixa =
    tom === "aviso"
      ? "rounded-2xl border border-warning/30 bg-warning/10 p-4"
      : tom === "erro"
        ? "rounded-2xl border border-destructive/30 bg-destructive/10 p-4"
        : "text-sm";
  // Cor do texto por tom. ⚠️ `erro` NÃO usa `text-destructive-foreground`: esse
  // token é quase-branco DE PROPÓSITO — contrasta com o vermelho SÓLIDO do
  // `--destructive` (4.56:1). Mas o fundo aqui é `bg-destructive/10` (tinta clara
  // sobre a página branca), onde o quase-branco dá ~1.14:1 — ilegível (P1 do Codex
  // na #1640). Sobre a tinta o texto tem de ser vermelho ESCURO: `red-800` = 7.01:1
  // (AA). `text-destructive` (o vermelho médio) só daria 3.99:1 e reprovaria. O
  // `aviso` PODE usar o seu token porque `--warning-foreground` já é escuro
  // (yellow-900) e lê bem na tinta — a assimetria no código espelha a assimetria
  // real dos tokens. Cor crua como o `simples` abaixo. Guarda: `alerta.contrast.test.ts`.
  const corTitulo =
    tom === "aviso"
      ? "text-warning-foreground"
      : tom === "erro"
        ? "text-red-800"
        : "text-neutral-900";
  const corDetalhe = tom === "simples" ? "text-neutral-500" : corTitulo;

  return (
    <div
      role="status"
      aria-label={titulo}
      className={className ? `${caixa} ${className}` : caixa}
    >
      <p className={`text-sm font-medium ${corTitulo}`}>{titulo}</p>
      {detalhe !== undefined ? (
        <p className={`mt-1 text-sm ${corDetalhe}`}>{detalhe}</p>
      ) : null}
    </div>
  );
}
