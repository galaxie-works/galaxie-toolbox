/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// App web da plataforma — SPA Vite (espelha o stack do app Tauri: React 19 + TS +
// Tailwind v4). Separado do app Tauri; deploy é asset estático (Traefik em infra/).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./src/teste-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
