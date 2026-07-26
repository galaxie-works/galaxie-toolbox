import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import '@/lib/tema'
import App from './App.tsx'
import { IdiomaProvider } from '@/lib/idioma'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <IdiomaProvider>
      {/* TooltipProvider é exigido pelos botões de toolbar do Plate (compose). */}
      <TooltipProvider delayDuration={300}>
        <App />
      </TooltipProvider>
      <Toaster position="top-center" />
    </IdiomaProvider>
  </StrictMode>,
)
