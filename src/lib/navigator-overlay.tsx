import { createContext, useContext, useEffect } from "react";

/**
 * Z-order do WebView2 (#275, padrão do #174): a webview nativa pinta ACIMA do
 * DOM, então QUALQUER overlay DOM que caia sobre a área da webview (menu de
 * contexto de aba, dropdown da barra de favoritos, diálogos, submenu do "+") é
 * cortado por ela. A cura é esconder a webview enquanto o overlay estiver
 * aberto e revelá-la ao fechar.
 *
 * Este contexto centraliza isso: o `NavegadorScreen` provê um registrador que
 * conta os overlays abertos e mantém a webview escondida enquanto a conta > 0.
 * Cada overlay só declara "estou aberto" — sem cada um reimplementar o hide/show.
 */
export const OcultarWebviewContext = createContext<(aberto: boolean) => void>(
  () => {},
);

/** Devolve o registrador do contexto — para casos em que o "aberto/fechado" vem
 *  de um `onOpenChange` (menus/dropdowns do Radix): `onOpenChange={registrar}`. */
export function useRegistrarOverlayWebview(): (aberto: boolean) => void {
  return useContext(OcultarWebviewContext);
}

/**
 * Enquanto `aberto` for true, mantém a webview escondida. Seguro à desmontagem:
 * o cleanup libera o registro mesmo se o overlay sumir ainda aberto (ex.: fechar
 * a aba pelo próprio menu de contexto) — assim a conta nunca fica presa.
 */
export function useOcultarWebviewEnquantoAberto(aberto: boolean): void {
  const registrar = useContext(OcultarWebviewContext);
  useEffect(() => {
    if (!aberto) return;
    registrar(true);
    return () => registrar(false);
  }, [aberto, registrar]);
}
