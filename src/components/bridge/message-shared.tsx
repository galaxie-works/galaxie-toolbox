/**
 * Módulo COMPARTILHADO do Bridge — componentes/tipo usados por seams DIFERENTES
 * do control-room (regra do Altair: "nasce no 2º consumidor de seam diferente").
 *
 * Extraído no enabler do #1019 (Ref) antes do S3 (MessageList), pra evitar
 * dependência circular — o padrão do enabler de data #1171:
 *
 *  • PastaDestino  — tipo do seletor "Mover para pasta…"; usado em FolderSidebar
 *                    (S2), SubmenuMover, ItensMenuEmail e MessageList (S3).
 *  • BotaoExcluir  — usado por MessageList (S3) E por MultiSelecaoContexto (fica
 *                    no control-room) → cross-boundary.
 *  • SubmenuMover  — usado por FolderSidebar (S2, no control-room) E por
 *                    ItensMenuEmail (desce pro S3) → cross-boundary.
 *
 * Movimento PURO (cut-and-paste, sem mudar comportamento). Um seam-único NÃO
 * entra aqui: DicaSomenteLeitura/PastaVazia/descricaoErroEscrita descem com o
 * seam do seu uso, não nesta gaveta.
 */
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { TextMorph } from "torph/react";
import * as AnimatedButton from "@/components/morphin/animated-border-button";
import SuccessIcon from "@/components/ui/icons/success";
import TrashIcon from "@/components/ui/icons/trash";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Folder, FolderInput } from "lucide-react";
import { useIdioma } from "@/lib/idioma";
import { cn } from "@/lib/utils";

/**
 * Pasta ACHATADA para o seletor de destino do "Mover para pasta…" (#88): a
 * árvore (raízes de `crMailFolders` + subpastas de `crSubpastas`) vira uma lista
 * plana, com a profundidade para indentar — o padrão do `MoveToFolderDropdown`
 * do MailVault. `caminho` é o nome completo ("Caixa de entrada / Clientes"):
 * alimenta a busca (achar "Clientes" pela pasta-mãe) e o title da linha.
 */
export type PastaDestino = {
  id: string;
  rotulo: string;
  caminho: string;
  profundidade: number;
};

/**
 * Botão de exclusão no padrão destrutivo do app — o mesmo animated-border-button
 * do registry @morphin usado no "Remover biblioteca": parado → processando
 * (borda tracejada animada) → sucesso (verde, brevemente). `onExcluir` pode ser
 * async; `onConcluir` (opcional) roda após o flash de sucesso — usado pra limpar
 * a seleção sem cortar a animação. Cores dark vão no uso (o registry só tem claro).
 */
export function BotaoExcluir({
  onExcluir,
  onConcluir,
  rotulo,
  rotuloProcessando,
  rotuloConcluido,
  size = "small",
  className,
  disabled = false,
}: {
  onExcluir: () => void | Promise<void>;
  onConcluir?: () => void;
  rotulo: string;
  rotuloProcessando: string;
  rotuloConcluido: string;
  size?: "medium" | "small" | "xsmall";
  className?: string;
  disabled?: boolean;
}) {
  const [estado, setEstado] = useState<"parado" | "processando" | "sucesso">("parado");

  useEffect(() => {
    if (estado !== "sucesso" || !onConcluir) return;
    const id = setTimeout(onConcluir, 900);
    return () => clearTimeout(id);
  }, [estado, onConcluir]);

  async function run() {
    if (disabled || estado !== "parado") return;
    setEstado("processando");
    try {
      // Duração mínima pra a animação (borda tracejada) ser visível mesmo quando
      // a exclusão é otimista/instantânea — antes o botão sumia sem animar (#23).
      await Promise.all([
        Promise.resolve(onExcluir()),
        new Promise((r) => setTimeout(r, 650)),
      ]);
      setEstado("sucesso");
    } catch {
      setEstado("parado");
    }
  }

  return (
    <AnimatedButton.Root
      variant={estado === "sucesso" ? "success" : "error"}
      mode="animatedBorder"
      size={size}
      onClick={run}
      animateBorder={estado === "processando"}
      showAnimatedBorder={estado === "processando"}
      animatedBorderStyle={estado === "processando" ? "dashed" : "solid"}
      disabled={disabled || estado !== "parado"}
      className={cn(
        estado === "sucesso"
          ? "dark:border-green-500/40 dark:bg-green-950/40 dark:text-green-300 dark:hover:bg-green-950/60 dark:hover:text-green-200"
          : "dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/60",
        className
      )}
    >
      <AnimatePresence mode="popLayout">
        <motion.div
          key={estado === "sucesso" ? "sucesso" : "excluir"}
          initial={false}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.4, y: 10 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          <AnimatedButton.Icon
            as={estado === "sucesso" ? SuccessIcon : TrashIcon}
            className="size-4"
            aria-hidden
          />
        </motion.div>
      </AnimatePresence>
      <TextMorph>
        {estado === "sucesso"
          ? rotuloConcluido
          : estado === "processando"
            ? rotuloProcessando
            : rotulo}
      </TextMorph>
    </AnimatedButton.Root>
  );
}

/**
 * Submenu "Mover para pasta…" (#88) — a árvore de pastas ACHATADA (indentada
 * por profundidade) com BUSCA por nome, portando o padrão do
 * `MoveToFolderDropdown` do MailVault para o menu de contexto do Bridge.
 *
 * Montado com `ContextMenuSub`/`SubTrigger`/`SubContent` do @reui/context-menu
 * (Radix) e o `Input` do registry — o mesmo arranjo "campo de busca + separador
 * + lista rolável" que o @reui/filters usa na sua lista pesquisável.
 *
 * A pasta ATUAL não entra na lista (já vem filtrada do pai): mover para onde a
 * mensagem já está não é uma opção.
 *
 * Serve aos DOIS "mover" do Bridge: o de mensagens (#88, `alvos` = ids das
 * mensagens) e o de PASTA (#90, `alvos` = [id da pasta], com `rotulo` próprio e
 * a lista já sem a própria pasta/descendentes). Só muda o rótulo do gatilho — a
 * árvore achatada, a busca e o comportamento do menu são os mesmos.
 */
export function SubmenuMover({
  alvos,
  pastas,
  carregando,
  rotulo,
  onAbrir,
  onMover,
  disabled = false,
  t,
}: {
  alvos: string[];
  pastas: PastaDestino[];
  carregando: boolean;
  /** Texto do gatilho; padrão é o "Mover para pasta…" das mensagens (#88). */
  rotulo?: string;
  onAbrir: () => void;
  onMover: (ids: string[], destino: string, rotulo: string) => void;
  disabled?: boolean;
  t: ReturnType<typeof useIdioma>["t"];
}) {
  const [busca, setBusca] = useState("");
  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return pastas;
    // Busca no CAMINHO: digitar o nome da pasta-mãe também acha as filhas.
    return pastas.filter((p) => p.caminho.toLowerCase().includes(q));
  }, [pastas, busca]);

  return (
    <ContextMenuSub
      onOpenChange={(aberto) => {
        // Abrir o submenu é o gatilho pra completar a árvore (as subpastas são
        // lazy); fechar limpa a busca pra próxima abertura começar do zero.
        if (aberto) onAbrir();
        else setBusca("");
      }}
    >
      <ContextMenuSubTrigger
        className="gap-2"
        disabled={disabled}
        title={disabled ? t.controlRoom.caixaSomenteLeitura : undefined}
      >
        <FolderInput />
        {rotulo ?? t.controlRoom.moverPara}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="w-64 p-0">
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder={t.controlRoom.moverBuscarPasta}
          aria-label={t.controlRoom.moverBuscarPasta}
          className="h-8 rounded-none border-0 bg-transparent! px-2 text-sm shadow-none focus-visible:border-border focus-visible:ring-0"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            // Escape/Tab seguem pro Radix (fecham o menu); o resto fica no
            // input — senão a navegação-por-digitação do menu roubaria as
            // letras e a busca nunca receberia texto.
            if (e.key !== "Escape" && e.key !== "Tab") e.stopPropagation();
          }}
        />
        <ContextMenuSeparator className="mx-0 my-0" />
        {filtradas.length === 0 ? (
          <p className="px-3 py-3 text-center text-sm text-muted-foreground">
            {carregando ? t.controlRoom.moverCarregandoPastas : t.controlRoom.moverSemPastas}
          </p>
        ) : (
          <ScrollArea className="max-h-64">
            <div className="p-1">
              {filtradas.map((p) => (
                <ContextMenuItem
                  key={p.id}
                  className="gap-2"
                  title={p.caminho}
                  onClick={() => onMover(alvos, p.id, p.rotulo)}
                >
                  {/* Indentação por profundidade = a hierarquia continua
                      legível mesmo com a árvore achatada (MailVault). */}
                  <Folder style={{ marginLeft: p.profundidade * 12 }} />
                  <span className="truncate">{p.rotulo}</span>
                </ContextMenuItem>
              ))}
            </div>
          </ScrollArea>
        )}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

