import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import '@/lib/tema'
import App from './App.tsx'
import { IdiomaProvider } from '@/lib/idioma'
import { Toaster } from '@/components/ui/sonner'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <IdiomaProvider>
      <App />
      <Toaster position="top-center" />
    </IdiomaProvider>
  </StrictMode>,
)
