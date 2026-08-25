# @galaxie/web — plataforma web

App web da Galaxie (`platform.thegalaxie.cloud`) — **autenticado** (login /
onboarding / dashboard). Scaffold do **#1484** (fatia FE do épico #1265, irmã da
fundação BE #1469).

**Separado do app Tauri.** Workspace pnpm próprio (`web/`), stack espelhando a
casa: **Vite + React 19 + TS + Tailwind v4**. Decisão de framework (Vite SPA, não
Next) e o porquê: #1484 (comentário do Castor) — sem SSR/SEO no escopo, então SPA
reusa o tooling da casa inteiro.

## Rodar

```bash
pnpm --filter @galaxie/web dev      # dev server (Vite)
pnpm --filter @galaxie/web build    # tsc -b && vite build → dist/
pnpm --filter @galaxie/web test     # vitest (happy-dom)
```

## Autorização — a UI não decide (desenho do Altair, #1265)

A tela de login **coleta** credenciais e **reflete** o que a sessão do backend
(#1469) devolve; ela **não autoriza**. A barreira é server-side (default-deny), o
principal (tipo/papel) vem da sessão, nunca de input do cliente. Esconder um botão
é conforto, não autorização. O wiring real do login (POST à fundação BE) é a fatia
AC2/AC3, fiada quando o #1469 landar.

## Deploy

O `build` produz **assets estáticos** em `dist/` — é o artefato de deploy. A
hospedagem em produção (`platform.thegalaxie.cloud`, atrás do Traefik em `infra/`)
é **infra-gated** (VPS: #1312 / domínio: #1184) e não é desta fatia FE. O CI
(`ci.yml`, job `web`) já builda + testa o pacote a cada push/PR.

## Escopo entregue (AC1) × pendente

- ✅ **AC1** — scaffold sobe, builda, tem CI, serve a rota `/login` (i18n pt/en).
- ⏳ **AC2/AC3** — login estabelece sessão do #1469 + teste do caminho negado.
  Dependem da fundação BE (#1469, @Alcor) landar.
