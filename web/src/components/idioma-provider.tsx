import { useEffect, useState, type ReactNode } from "react";
import { aplicarIdiomaNoDocumento, idiomaAtual, resolverIdioma, type Idioma } from "@/i18n";
import { IdiomaContexto } from "@/idioma-contexto";
import { obterPerfil } from "@/lib/api-me";

/**
 * Fonte do idioma ativo do app web (#1732): **conta > navegador > pt-BR**.
 *
 * Começa no navegador (o que a página já usava) e pergunta o `/me` UMA vez na
 * montagem. Com sessão e um `idioma` suportado, troca pra ele; sem sessão (401 no
 * `/login`) ou em qualquer falha, fica no navegador — o pedido aqui é só
 * preferência, nunca decide nada nem manda ninguém pro login (isso é de cada
 * página, que já trata o próprio 401).
 *
 * Mantém o `<html lang>` alinhado ao idioma ativo (WCAG 3.1.1, #1484): o `main.tsx`
 * já declara o do navegador antes do 1.º render; aqui acompanha a troca.
 *
 * Custo conhecido: no `/conta` o `/me` é pedido duas vezes (aqui e pela página), e
 * numa conta pt-BR com navegador em inglês a 1.ª pintura sai em inglês até o `/me`
 * responder.
 */
export function IdiomaProvider({ children }: { children: ReactNode }) {
  const [idioma, setIdioma] = useState<Idioma>(() => idiomaAtual());

  useEffect(() => {
    let vivo = true;
    obterPerfil().then(
      (perfil) => {
        if (vivo) setIdioma(resolverIdioma(perfil.idioma));
      },
      () => {
        // Sem sessão ou falha: vale o navegador, que já é o estado inicial.
      },
    );
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    aplicarIdiomaNoDocumento(idioma);
  }, [idioma]);

  return <IdiomaContexto.Provider value={idioma}>{children}</IdiomaContexto.Provider>;
}
