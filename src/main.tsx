import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import '@/lib/tema'
import App from './App.tsx'
import { IdiomaProvider } from '@/lib/idioma'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <IdiomaProvider>
      <App />
    </IdiomaProvider>
  </StrictMode>,
)
