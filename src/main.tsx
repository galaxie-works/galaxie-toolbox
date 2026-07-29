import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import '@/lib/tema'
import '@/lib/menu-contexto-nativo'
import App from './App.tsx'
import { SplashScreen } from '@/components/splash-screen'
import { IdiomaProvider } from '@/lib/idioma'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'

/**
 * Boot #164: as DUAS janelas Tauri (`main` e `splashscreen`) carregam este mesmo
 * bundle. Aqui desviamos pelo label da janela — a `splashscreen` renderiza só o
 * círculo animado (sem providers, sem app), a `main` renderiza o app inteiro. O
 * label é lido de forma síncrona dos internals, então dá para decidir antes do
 * primeiro paint.
 */
function ehJanelaSplash(): boolean {
  try {
    return (
      "__TAURI_INTERNALS__" in window &&
      (window as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } })
        .__TAURI_INTERNALS__?.metadata?.currentWindow?.label === "splashscreen"
    );
  } catch {
    return false;
  }
}

const raiz = createRoot(document.getElementById('root')!)

if (ehJanelaSplash()) {
  // Janela transparente (círculo flutuante): <html>/<body>/#root precisam ser
  // vazados para só o círculo aparecer — senão o `bg-background` do tema pinta o
  // quadrado 400×400 inteiro e mata a transparência. No Windows quem faz os
  // cantos realmente transparentes é o window-vibrancy (Rust, no setup).
  document.documentElement.classList.add('janela-splash')
  raiz.render(<SplashScreen />)
} else {
  raiz.render(
    <StrictMode>
      <IdiomaProvider>
        {/*
          TooltipProvider ÚNICO do app (#98). Todos os tooltips (toolbar do
          compose, sidebar principal, telas) usam este provider — delay alinhado
          em 300ms. Não montar outro provider em subárvores.
        */}
        <TooltipProvider delayDuration={300}>
          <App />
        </TooltipProvider>
        <Toaster position="top-center" />
      </IdiomaProvider>
    </StrictMode>,
  )
}
