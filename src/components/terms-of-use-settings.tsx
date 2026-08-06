import { useState } from "react";
import { FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useIdioma } from "@/lib/idioma";

/**
 * Settings > System > Termos de uso (#581).
 *
 * Renderiza dentro do frame colapsável (a moldura vem da tela de Settings), no
 * mesmo padrão dos irmãos (Telemetria, Lock screen): resumo curto à esquerda +
 * botão "Ler / Read" à direita que abre o modal com os termos completos.
 *
 * Este modal é a "casa da transparência" que o #580 tirou de dentro do painel
 * de telemetria: deixa explícito, de forma acolhedora, que a coleta é anônima,
 * NÃO identifica o usuário, e existe só pra melhorar o que é usado + corrigir
 * o que quebra. Copy nos 2 idiomas via `useIdioma` (sem hardcode).
 */
export function TermsOfUseSettings() {
  const { t } = useIdioma();
  const s = t.settings;
  const [aberto, setAberto] = useState(false);

  // #581-rework: só o botão "Ler" + o modal — o frame é estático (a moldura,
  // o título e a descrição curta vêm do OptionFrame). Sem FramePanel/lead aqui.
  return (
    <>
      <Button
        variant="outline"
        className="shrink-0"
        onClick={() => setAberto(true)}
      >
        <FileText aria-hidden="true" />
        {s.termsLerBtn}
      </Button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{s.cfgTermsTitulo}</DialogTitle>
            <DialogDescription>{s.termsIntro}</DialogDescription>
          </DialogHeader>

          {/* Conteúdo rolável: largura confortável de leitura, claro/escuro. */}
          <div className="-mr-2 max-h-[60vh] space-y-5 overflow-y-auto pr-2 text-sm leading-relaxed">
            <TermsSection titulo={s.termsSec1Titulo} corpo={s.termsSec1Corpo} />
            <TermsSection titulo={s.termsSec2Titulo} corpo={s.termsSec2Corpo} />
            <TermsSection titulo={s.termsSec3Titulo} corpo={s.termsSec3Corpo} />
            <TermsSection titulo={s.termsSec4Titulo} corpo={s.termsSec4Corpo} />
            <p className="text-muted-foreground">{s.termsControle}</p>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{s.termsFecharBtn}</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function TermsSection({ titulo, corpo }: { titulo: string; corpo: string }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-sm font-semibold text-foreground">{titulo}</h3>
      <p className="text-muted-foreground">{corpo}</p>
    </section>
  );
}
