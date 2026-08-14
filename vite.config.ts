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
  // #873 fix: `xlsx-preview` é UMD-only (sem ESM) — força o esbuild a pré-bundlar
  // ele + o exceljs no dev, alinhando com o import ESTÁTICO que o build de
  // produção usa (Rollup). Sem isto o dev pode divergir do empacotado.
  optimizeDeps: { include: ["xlsx-preview", "exceljs"] },
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
