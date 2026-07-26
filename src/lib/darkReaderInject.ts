// Dark Reader (v4.9.x UMD) para o render de e-mail em iframe.
//
// Estratégia (igual ao MailVault):
// - O bundle UMD é carregado como string crua no load do módulo (Vite ?raw):
//   um único fetch, cacheado pela vida do app.
// - `getDarkReaderInlineScripts()` embute o bundle + um `enable()` direto no
//   <head> do srcDoc. O DR roda DURANTE o load da página — sem corrida com o
//   evento `load` do iframe e sem flash de conteúdo claro ao trocar de tema.
// - O DR instala um MutationObserver dentro do iframe, então conteúdo tardio
//   (imagens que reflowam, etc.) também é invertido.
//
// Notas de tuning p/ e-mail:
// - brightness/contrast em 100/90 mantêm o texto legível sem escurecer demais.
// - sepia 0 — queremos neutro, não quente.
// - darkScheme{Background,Text}Color combinam com o "letterbox" do painel.

import drSource from "darkreader/darkreader.js?raw";

type DarkReaderOptions = {
  brightness?: number;
  contrast?: number;
  sepia?: number;
  darkSchemeBackgroundColor?: string;
  darkSchemeTextColor?: string;
};

const DEFAULT_OPTIONS: DarkReaderOptions = {
  brightness: 100,
  contrast: 90,
  sepia: 0,
  darkSchemeBackgroundColor: "#0f0f11",
  darkSchemeTextColor: "#e6e6e8",
};

// Retorna as tags <script> inline p/ embutir o Dark Reader num documento HTML.
// O DR roda enquanto o documento carrega, então não há corrida com injeção
// pós-load nem flash de conteúdo claro.
export function getDarkReaderInlineScripts(options: DarkReaderOptions = {}): string {
  const opts = JSON.stringify({ ...DEFAULT_OPTIONS, ...options });
  // Neutraliza qualquer </script> perdido dentro do source, senão a tag
  // externa terminaria cedo.
  const safeSource = drSource.replace(/<\/script>/gi, "<\\/script>");
  return (
    `<script>${safeSource}</script>` +
    `<script>try{if(window.DarkReader)window.DarkReader.enable(${opts})}catch(e){}</script>`
  );
}
