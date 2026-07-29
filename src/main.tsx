import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import '@/lib/tema'
import '@/lib/menu-contexto-nativo'
import App from './App.tsx'
import { IdiomaProvider } from '@/lib/idioma'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'

createRoot(document.getElementById('root')!).render(
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
