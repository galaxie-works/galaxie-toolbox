/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// App web da plataforma — SPA Vite (espelha o stack do app Tauri: React 19 + TS +
// Tailwind v4). Separado do app Tauri; deploy é asset estático (Traefik em infra/).
/**
 * Onde a borda web escuta em desenvolvimento.
 *
 * `8080` é o default do `Config::from_env` em `services/platform-http/src/
 * servidor.rs` (`GALAXIE_PLATAFORMA_PORTA`). Fica aqui **também** como env pra
 * quem subir o binário noutra porta não precisar editar este arquivo — mesmo
 * nome de variável dos dois lados, de propósito: dois nomes para o mesmo
 * endereço divergem na primeira vez que alguém mudar um.
 */
const PORTA_BORDA = process.env.GALAXIE_PLATAFORMA_PORTA ?? "8080";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // ── Proxy de DESENVOLVIMENTO ─────────────────────────────────────────────
  // O cliente monta caminho RELATIVO com `credentials: "same-origin"` (desenho
  // do @Altair no #1484: SPA e API sob o mesmo host via Traefik em produção).
  // Em dev, porém, o Vite serve em 1490 e a borda em 8080 — origens diferentes,
  // e o cookie `__Host-` não atravessaria nem com CORS aberto, porque `__Host-`
  // exige mesma origem por imposição do navegador.
  //
  // O proxy resolve isso SEM afrouxar nada: o navegador continua falando com
  // uma origem só, e quem atravessa é o Vite, do lado do servidor. Nenhuma
  // linha disto entra no `build` — o artefato de produção não tem proxy, tem
  // Traefik.
  server: {
    proxy: {
      "/api/v1": {
        target: `http://localhost:${PORTA_BORDA}`,
        changeOrigin: false, // manter o Host: o `__Host-` depende dele
      },
    },
  },
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./src/teste-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
