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

const CHAVE = "galaxie-idioma";

/** Idioma salvo; na falta dele, o do sistema; na falta dos dois, ingles. */
function idiomaInicial(): Idioma {
  const salvo = localStorage.getItem(CHAVE);
  if (salvo === "pt-BR" || salvo === "en") return salvo;
  return navigator.language?.toLowerCase().startsWith("pt") ? "pt-BR" : "en";
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
    localStorage.setItem(CHAVE, i);
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

/** Troca `{chave}` pelos valores informados. */
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
