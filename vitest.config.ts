import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// #786: runner de teste de COMPONENTE (happy-dom + @testing-library/react) pra
// exercitar a INTERAÇÃO real com o Base UI (Combobox do compose), que o
// `node --test` não cobre (só função pura + não transforma JSX). Roda os
// `*.component.test.tsx`; o `node --test` segue nos `*.test.ts` puros.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    globals: true,
    environment: "happy-dom",
    include: ["src/**/*.component.test.tsx"],
  },
});
