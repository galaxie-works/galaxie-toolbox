import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DICIONARIOS, type Dicionario, type Idioma } from "@/lib/strings";
import { idiomaAtual, CHAVE_IDIOMA } from "./idioma-core.ts";

// O `idiomaAtual` puro (e a chave) vivem em `idioma-core.ts` (.ts sem JSX) para
// que store/lib importáveis por testes (`node --test`) não puxem `.tsx`.
// Reexporta pra compat de quem já importava daqui.
export { idiomaAtual };

/** Idioma inicial do provider (= `idiomaAtual`). */
function idiomaInicial(): Idioma {
  return idiomaAtual();
}

interface Ctx {
  idioma: Idioma;
  definir: (i: Idioma) => void;
  t: Dicionario;
}

const IdiomaCtx = createContext<Ctx | null>(null);

export function IdiomaProvider({ children }: { children: ReactNode }) {
  const [idioma, setIdioma] = useState<Idioma>(idiomaInicial);

  // Mantem o <html lang> em dia: e o que o leitor de tela usa para escolher a
  // pronuncia, e o que a hifenizacao do navegador consulta.
  useEffect(() => {
    document.documentElement.lang = idioma;
  }, [idioma]);

  const definir = useCallback((i: Idioma) => {
    localStorage.setItem(CHAVE_IDIOMA, i);
    setIdioma(i);
  }, []);

  const valor = useMemo(
    () => ({ idioma, definir, t: DICIONARIOS[idioma] }),
    [idioma, definir]
  );

  return <IdiomaCtx.Provider value={valor}>{children}</IdiomaCtx.Provider>;
}

export function useIdioma(): Ctx {
  const ctx = useContext(IdiomaCtx);
  if (!ctx) throw new Error("useIdioma precisa estar dentro de IdiomaProvider");
  return ctx;
}

/**
 * Troca `{chave}` pelos valores informados.
 *
 * #464 (S0) — débito conhecido de PLURAL: `{n}` NÃO flexiona a frase (ex.: "1
 * item" vs "2 itens" / "1 item" vs "2 items"). Hoje cada string escolhe uma forma
 * fixa. Resolver plural real (Intl.PluralRules por idioma) fica pro épico i18n —
 * registrado aqui de propósito, não é pra corrigir agora.
 */
export function preencher(
  texto: string,
  valores: Record<string, string | number>
): string {
  return texto.replace(/\{(\w+)\}/g, (bruto, chave) => {
    const v = valores[chave];
    return v == null ? bruto : String(v);
  });
}

/**
 * Igual ao `preencher`, mas o trecho substituido sai em negrito. Serve para
 * frases em que so o nome da biblioteca (ou um termo) precisa destaque, sem
 * quebrar a frase em pedacos que nao se traduzem.
 */
export function comDestaque(
  texto: string,
  chave: string,
  valor: string
): ReactNode {
  const partes = texto.split(`{${chave}}`);
  if (partes.length === 1) return texto;
  return (
    <>
      {partes[0]}
      <strong>{valor}</strong>
      {partes.slice(1).join(`{${chave}}`)}
    </>
  );
}

/** Formata numero no idioma ativo (separador de milhar muda). */
export function formatarNumero(n: number, idioma: Idioma): string {
  return n.toLocaleString(idioma);
}
