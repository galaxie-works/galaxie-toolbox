import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import path from "node:path";

// #786: dois projetos de teste de componente.
//  - `component` (happy-dom): rápido, exercita render/lógica/wiring dos
//    `*.component.test.tsx`. NÃO reproduz interações de foco/ponteiro do Base UI.
//  - `browser` (Playwright/chromium REAL): roda os `*.browser.test.tsx` num
//    navegador de verdade — é o único jeito de reproduzir o auto-select/erase do
//    Combobox do compose (a recorrência crônica #268/#298/#606/#786) e travar o fix.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "component",
          environment: "happy-dom",
          globals: true,
          include: ["src/**/*.component.test.tsx"],
        },
      },
      {
        extends: true,
        test: {
          name: "browser",
          include: ["src/**/*.browser.test.tsx"],
          // #1262: tetos explícitos. Um teste que PENDURA é pior que um que
          // falha — o CI ficou 45+ min sem passar nem reprovar. Estes limites
          // fazem o canal falhar rápido; o `timeout-minutes` do job no ci.yml é
          // a rede seguinte, para o caso de o travamento ser na SUBIDA do
          // navegador (antes de qualquer teste rodar), que é o suspeito aqui.
          testTimeout: 20_000,
          hookTimeout: 30_000,
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
