import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Config voltada para o Tauri: porta fixa 1420, sem limpar a tela, HMR estavel.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  clearScreen: false,
  // #942: `exceljs` é CommonJS e agora só é importado DENTRO do chunk lazy do
  // Univer (`univer-xlsx.ts`). Pré-bundlá-lo aqui evita uma re-otimização/reload
  // do Vite na primeira vez que um xlsx é aberto no dev, alinhando dev e prod.
  // (`xlsx-preview` saiu junto com o render legado — não é mais importado.)
  optimizeDeps: { include: ["exceljs"] },
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
