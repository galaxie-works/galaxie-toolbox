import { useCallback, useEffect, useRef, type ReactNode } from "react";

/**
 * Modal com **foco contido** — o que faltava aos diálogos deste app.
 *
 * ## Porque existe
 *
 * Achado do Codex na PR #1626, e é um defeito de teclado num caminho
 * **destrutivo**: um `<div role="dialog" aria-modal="true">` sem gestão de foco
 * não contém nada. O foco fica no botão "Remover" da linha que abriu o diálogo,
 * e quem navega por teclado consegue **Tab** até ao botão de OUTRA linha e
 * carregar Enter — trocando em silêncio quem o diálogo remove. O `aria-modal`
 * anuncia a modalidade ao leitor de ecrã e **não a implementa**.
 *
 * Não é polimento: o DoD do `AGENTS.md` §5 exige *"sem regressão em teclado"*.
 *
 * ## Porque é escrito à mão
 *
 * O Codex sugeriu usar o primitivo de modal do repositório. **Medi: não existe
 * neste workspace.** O `web/` depende só de `react`, `react-dom` e
 * `react-router-dom` — sem Radix, sem headless. Os primitivos com foco vivem no
 * app Tauri (`src/components/ui`), que é outro workspace e não é importável
 * daqui. Então ou se traz uma dependência (decisão que não é minha e não cabe
 * nesta fatia), ou se escreve o mínimo correto — e o mínimo correto tem quatro
 * partes, todas exercitadas por teste.
 *
 * ⚠️ O `ConfirmarSuspensao` do `back-office.tsx` tem **o mesmo defeito** — foi
 * dele que copiei o desenho. Não o troco aqui porque é do #1492 e já passou
 * pela QA; fica sinalizado, com o primitivo pronto para adotar.
 */
export function Modal({
  rotulo,
  aoFechar,
  children,
}: {
  /** Nome acessível do diálogo. */
  rotulo: string;
  /** Escape e clique fora. Deve ser a MESMA ação do botão de cancelar. */
  aoFechar: () => void;
  children: ReactNode;
}) {
  const caixa = useRef<HTMLDivElement>(null);

  /** Os focáveis DENTRO do diálogo, na ordem do documento. */
  const focaveis = useCallback((): HTMLElement[] => {
    const raiz = caixa.current;
    if (!raiz) return [];
    return Array.from(
      raiz.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !el.hasAttribute("disabled"));
  }, []);

  // (1) foco entra e (4) foco volta a quem abriu.
  //
  // Devolver o foco importa tanto quanto contê-lo: sem isso, fechar o diálogo
  // deixa o foco no `<body>` e a navegação por teclado recomeça do topo da
  // página — quem estava na 7ª linha da tabela perde o lugar.
  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    // O primeiro focável é o CANCELAR, por desenho de quem usa este modal: num
    // caminho destrutivo o foco inicial não pode cair no botão que destrói.
    const primeiro = focaveis()[0] ?? caixa.current;
    primeiro?.focus();
    return () => anterior?.focus?.();
  }, [focaveis]);

  // (2) Tab circula dentro · (3) Escape fecha.
  function aoTeclar(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      aoFechar();
      return;
    }
    if (e.key !== "Tab") return;
    const alvos = focaveis();
    if (alvos.length === 0) return;
    const primeiro = alvos[0]!;
    const ultimo = alvos[alvos.length - 1]!;
    const atual = document.activeElement;
    // Circula nas duas pontas. Sem isto o Tab escapa para a tabela por baixo,
    // que é exatamente o caminho pelo qual se troca o alvo da remoção.
    if (e.shiftKey && (atual === primeiro || !caixa.current?.contains(atual))) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && atual === ultimo) {
      e.preventDefault();
      primeiro.focus();
    }
  }

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: o handler de
    // teclado vive no contentor de propósito — é ele que contém o foco.
    <div
      role="dialog"
      aria-modal="true"
      aria-label={rotulo}
      ref={caixa}
      onKeyDown={aoTeclar}
      className="fixed inset-0 flex items-center justify-center bg-neutral-900/40 p-4"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-sm">
        {children}
      </div>
    </div>
  );
}
