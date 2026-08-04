# Astro — Arquitetura de Solução

> 📌 **Snapshot de discovery/pesquisa (2026-07/08). Estado atual: NÃO construído** — Astro (#180/#196) segue em fase de decisão do PO (go/no-go). Este doc reflete a arquitetura proposta, não o que existe no app. Fonte viva de escopos: [`graph-scopes.md`](../reference/graph-scopes.md).

Camada de IA pré-paga do **GALAXIE Toolbox** (Tauri 2 + React 19 + Graph delegado).
Autor: Arquiteto de Soluções (delegado pelo PO). Data: 2026-07-29.
Companheiro deste doc: `docs/astro/galaxie-ai-discovery.md` (#180, produto/negócio) — **este documento fecha o COMO técnico**, não repete a estratégia.

> **O que é decisão vs. o que é recomendação.** As decisões de negócio (preço, trial, gateway, residência de dados) continuam do Wagner (discovery §10). **O pipeline técnico do meeting-assistant o Wagner delegou a mim** — este doc RECOMENDA, faseado, com esforço e risco francos. Onde há aposta, está marcado como aposta.

---

## 0. TL;DR de arquitetura

- **`astro` já existe como slot na sidebar** (`src/lib/navegacao.ts` → `NAV[0].itens[0].filhos` tem `{ id: "astro", icone: AstroIcon }`, e `TELAS.astro`). Não se cria item novo: veste-se essa tela com o painel de saldo/compra e liga-se o e-mail-assist. O nome de marca do produto de IA **é "Astro"**.
- **Backend Astro roda no VPS Hostinger do Wagner** — fora do M365, controle total. Stack recomendada: **Node 22 LTS + Fastify + TypeScript + Postgres + Redis**, atrás de **Caddy** (TLS automático), tudo em **Docker Compose**, com a chave Claude e a ASR vivendo **só lá**. É o `suzette-local-server.mjs` promovido de script local a serviço hospedado, tipado e com DB real.
- **Auth desktop→backend sem senha paralela:** expor uma **API própria no mesmo registro Entra** (`api://{CLIENT_ID}/Astro.Use`); o PKCE de `auth.rs` passa a pedir esse escopo junto; o backend valida o JWT pela **JWKS do Entra** e extrai `tid` (tenant) + `oid` (usuário). Zero cadastro de senha, mantendo o princípio do `auth.rs` (o app nunca vê senha).
- **Modelo de créditos = Suzette transplantado 1:1**, trocando *conta→tenant* e *filial→usuário*. Reaproveita a mecânica de `pricing.ts`/`domain.ts` (medição token→custo→crédito, ledger, gate duplo, idempotência de compra), recalibrada para os preços do Claude e roteamento por tarefa. **Refinado (PO, 04/ago): duas cotas por usuário (org + pessoal), consumo org-first — ver a seção Modelo de cotas abaixo.**
- **Meeting-assistant, recomendação:** **híbrido por origem da reunião** — quando existe **gravação oficial** (reunião gravada), puxa via Graph `OnlineMeetingRecording.Read.All` e roda **nossa ASR** (sem companion); para **ao vivo / não-gravada**, o **companion Delphi (WASAPI loopback)** é o motor. Montagem sempre: **ASR → Claude Opus (ata) + To-Dos → Microsoft To Do** + **crachá** (active-speaker) faseado. O transcript nativo do Teams é só benchmark.
- **Fatiamento:** **A** motor de créditos + e-mail-assist · **B** meeting-assistant premium · **C** master/cota/crachá · **D** óculos completo + RAG.

---

## Modelo de cotas (org + pessoal) — refinamento do PO (04/ago/2026)

**Cada usuário tem DUAS carteiras separadas, consumidas em ordem fixa:**

1. **Cota da org (`wallet_org`)** — o **dono do negócio / master** faz top-up no nível do **tenant** e **distribui com controle fino: por departamento e por pessoa**. É o crédito que a empresa banca. Origem do saldo: alocação do master.
2. **Cota pessoal (`wallet_personal`)** — o **próprio usuário** pode fazer top-up pra si; vira um **saldo separado, dele**, que não se mistura com o da org nem volta pra empresa. Origem: compra do próprio usuário.

**Ordem de consumo — regra dura: ORG-FIRST.** Todo débito de medição (token→custo→crédito) **esgota primeiro a cota da org** disponível pro usuário; só quando ela zera é que consome a **cota pessoal**. Um único gasto pode **atravessar** as duas carteiras (parte org, resto pessoal) → o ledger registra o **split** por operação. Garante que o crédito bancado pela empresa é usado antes do dinheiro do próprio usuário.

**Impacto no ledger/dados (a fatia A já nasce com isso — não retrofitar depois):**
- **Duas carteiras por `oid` (usuário)**, ambas ancoradas no `tid` (tenant): `wallet_org` (saldo alocado + histórico de alocação) e `wallet_personal` (saldo comprado pelo usuário).
- **Alocação hierárquica da org:** master → **departamento** → **pessoa**. O campo `department` vem de graça do diretório M365 (`/users/{id}` com `User.Read.All`), então dá pra distribuir por depto **sem cadastro paralelo**. O master pode ratear por depto e/ou fixar override por pessoa.
- **Débito atômico org-first:** o gate de medição consome `min(custo, saldo_org)` da org e o resto de `wallet_personal`; só falha (402/insufficient) se **ambas** zeram. Idempotência de compra/top-up (do Suzette) mantida **por carteira**.
- **Visibilidade:** o **master** vê consumo e saldo **por depto e por pessoa** (painel de governança); o **usuário** vê **quanto a empresa deu / restante da cota org** + o **saldo pessoal separado**, sinalizando qual está sendo gasto.
- **A decidir (flags pro PO):** a cota da org **expira / volta pro pool** ao fim de um ciclo? a pessoal segue política própria do usuário? top-up mínimo? reembolso?

**Fatiamento:** o detalhamento acima é o coração da fatia **C** (master/cota), MAS a fatia **A** (motor de créditos) precisa **nascer com o ledger de 2 carteiras + ordem org-first** desde o início — a UI de alocação por depto/pessoa e o painel do master entram na C.

---

## 1. Âncoras reais no código (o que restringe o desenho)

| Camada | Símbolo real | Papel no Astro |
| --- | --- | --- |
| Auth PKCE | `src-tauri/src/auth.rs` — `interactive_login`, `exchange_code`, `refresh`, `build_tokens`, `TokenStore`, `Tokens { access_token, tenant, scopes }` | Já é public client + PKCE, token só em memória + sessão DPAPI. **Não pode guardar chave de LLM** → backend obrigatório. O `refresh` já sabe re-pedir `config::SCOPES`; basta acrescentar o escopo da API do Astro. |
| Detecção de tenant | `auth.rs` — `detectar_tenant` (lê OIDC do domínio, extrai GUID do `issuer`) | Entrega o `tenant_id` real e confiável = **chave da carteira**, de graça, antes mesmo do login. |
| Escopos | `src-tauri/src/config.rs` — `SCOPES`, `CLIENT_ID = 214d735e-…`, `client_id()`, `token_endpoint()` | Ponto único onde se adiciona `api://{CLIENT_ID}/Astro.Use` e (por fase) escopos de meeting/roles. `client_id()` já permite override por env. |
| WebView2 do Navigator | `src-tauri/src/browser.rs` — `browser_abrir` (webview NATIVO filho, `WebviewBuilder`), `esconder_menos` | O Teams roda DENTRO do nosso WebView2 → dá pra injetar script/`MutationObserver` p/ **active-speaker** (crachá, §5). |
| Reunião no Graph | `src-tauri/src/graph.rs` — `cr_agenda`/`cr_evento_corpo` com `$select=…,onlineMeeting`, lê `onlineMeeting.joinUrl` (`EventoDetalhe.join_url`) | Hook natural: evento → `onlineMeeting` → (com escopo) gravação/transcript. O `access_token()` + pool de throttle (`graph_enviar`, `GRAPH_MAX_CONCORRENTES`) já é o padrão de chamada Graph a reusar. |
| Tarefas | `graph.rs` — `cr_tarefas` (já usa `Tasks.ReadWrite`, `/me/todo/lists`) | To-Dos da ata caem aqui sem escopo novo. |
| E-mail-assist (mock) | `src/components/editor/use-chat.ts` — `createChatTransport` com `fetch` mockado por `fakeStreamText`; comentário *"Remove it when you implement the route /api/ai/command"*; `aiChatPlugin` (`plugins/ai-kit.tsx`) | **Front já existe.** O menor caminho até a 1ª feature: trocar o mock por um transport real apontando ao backend Astro (SSE UI-message stream do AI SDK — o formato `data: {"type":"text-delta",…}` que o mock já emite). |
| Sidebar | `src/lib/navegacao.ts` — `astro` em `Tela`, `NAV`, `TELAS`; ícone `AstroIcon` | Slot pronto. Só falta a tela de conteúdo (saldo/compra/histórico + estado do e-mail-assist). |

**Três verdades que decidem tudo (confirmadas no código):**
1. **Não há backend hoje** — o app fala só com o Graph. Créditos/medição/chave exigem o serviço Astro no VPS.
2. **O app é público (PKCE, sem secret)** — chave Claude no cliente = chave vazada. Regra dura: chave vive **só** no VPS.
3. **O tenant é identidade de organização de graça** — `detectar_tenant` já entrega o GUID; a carteira ancora nisso sem cadastro paralelo.

---

## 2. Visão de componentes

```
┌─────────────────────────────── Desktop (Tauri 2, public client PKCE) ───────────────────────────────┐
│  React 19 + Plate editor            src-tauri (Rust)                                                  │
│  ┌──────────────┐  ┌────────────┐   ┌───────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │ Tela "astro" │  │ e-mail-    │   │ auth.rs PKCE  │  │ browser.rs   │  │ companion IPC (Fase B)│  │
│  │ saldo/compra │  │ assist     │   │ (Graph + API  │  │ WebView2     │  │ localhost/named pipe  │  │
│  │ histórico    │  │ use-chat.ts│   │  Astro token) │  │ active-spkr  │  │ ↕ Delphi (WASAPI)     │  │
│  └──────┬───────┘  └─────┬──────┘   └──────┬────────┘  └──────┬───────┘  └──────────┬────────────┘  │
└─────────┼────────────────┼─────────────────┼──────────────────┼─────────────────────┼───────────────┘
          │  Bearer (aud = api://{CLIENT_ID}/Astro.Use, tid+oid)  │                      │ áudio bruto (efêmero)
          ▼                ▼                 ▼                    │                      ▼
┌──────────────────────────── VPS Hostinger (Docker Compose, Caddy TLS) ───────────────────────────────┐
│  Backend Astro (Node 22 + Fastify + TS)                                                              │
│  ┌───────────────┐ ┌──────────────┐ ┌───────────────┐ ┌──────────────┐ ┌─────────────────────────┐ │
│  │ auth guard    │ │ credits engine│ │ LLM proxy     │ │ meeting svc   │ │ ASR worker (Fase B)     │ │
│  │ JWKS Entra    │ │ wallet/ledger │ │ Anthropic key │ │ orquestra     │ │ whisper.cpp/faster-    │ │
│  │ tid+oid       │ │ gate + débito │ │ (SÓ AQUI)     │ │ pipeline ata  │ │ whisper (GPU/CPU)      │ │
│  └───────────────┘ └──────┬───────┘ └──────┬────────┘ └──────┬───────┘ └───────────┬─────────────┘ │
│         Postgres (carteira/ledger/uso, particionado por tenant) ─ Redis (fila ASR, rate, idempot.)  │
└──────────────────────────────────────────┬──────────────────────┬───────────────────────────────────┘
                                            ▼                      ▼
                                    api.anthropic.com        (Fase D: índice RAG por tenant)
```

---

## 3. Backend Astro no VPS Hostinger

### 3.1 Stack recomendada
O Suzette provou o padrão como **Node `.mjs` cru** (`node:http`, sem framework, sem DB — estado em `Map`). Para produção monetizada, promover para:

| Escolha | Recomendação | Por quê (vs. alternativas) |
| --- | --- | --- |
| Runtime | **Node 22 LTS** | Continuidade com o legado Suzette (JS/`fetch` nativo, mesmo time), SDK Anthropic oficial em TS, ecossistema de billing. Alternativas descartadas: **Rust/axum** (máxima performance, mas o gargalo é I/O de rede ao Claude, não CPU — e divide o time em duas linguagens de backend); **Bun** (rápido, mas menos maduro para libs de pagamento/observabilidade). |
| Framework HTTP | **Fastify + TypeScript** | Schema-validation nativa (JSON Schema/`zod`), hooks de auth, plugin de SSE, baixo overhead. Express seria aceitável; Fastify dá tipagem e validação de borda quase de graça. |
| Persistência | **Postgres 16** | Dinheiro real: precisa de transação ACID no débito de crédito (o `Map` do Suzette não serve). Modela `AiWallet/AiLedgerEntry/AiUsage` (§3.4) com constraint de idempotência. |
| Cache/fila | **Redis 7** | Idempotência de compra (`creditedIntentIds` → SET com TTL), rate-limit por tenant/usuário, **fila de jobs de ASR** (BullMQ) para reunião. |
| ASR (Fase B) | **faster-whisper / whisper.cpp** como worker separado | Self-hosted no VPS (privacidade + custo fixo). Ver §5.2. |
| Borda | **Caddy** (reverse proxy, TLS Let's Encrypt automático) | Um subdomínio (`astro.<dominio>`), HTTP/2, renovação de cert sem cron. |
| Empacotamento | **Docker Compose** (backend, asr-worker, postgres, redis, caddy) | Deploy reprodutível; o VPS Hostinger roda Docker nativamente (há MCP de VPS Hostinger disponível para provisionar/observar). |
| Processo | Container com `restart: unless-stopped` + healthcheck | O Suzette expõe `/api/suzette/health`; manter `/health` (liveness) e `/ready` (checa Postgres/Redis/Anthropic). |

### 3.2 Proxy Claude (a chave vive só aqui)
Espelha `callOpenAiProvider` do Suzette, trocando provedor e endpoint:
- **Provider abstraído** (interface `LlmProvider`) — default **Anthropic** (`api.anthropic.com`, SDK oficial, streaming). Manter a abstração permite **Azure OpenAI / Bedrock** quando um tenant exigir residência de dados (discovery §10 Q5) sem reescrever o billing.
- **Roteamento por tarefa** (discovery §5): `Haiku` (classificação/triagem/extração de To-Dos de transcript pronto) · `Sonnet` (**default do e-mail-assist**) · `Opus` (**ata premium**, sumário executivo). Um mapa `feature → modelo` no backend, sobrescrevível por env.
- **Streaming**: repassar o stream do Claude como **UI-message SSE do AI SDK** (mesmos eventos `text-start/text-delta/text-end/finish` que `fakeStreamText` já emite em `use-chat.ts`) → o front real precisa de **zero** mudança de contrato.
- **Chave**: `ANTHROPIC_API_KEY` só em variável de ambiente do container (nunca no repo, nunca no bundle Tauri; rodar varredura de segredos). Prompt-caching do Anthropic modelado desde o dia 1 (o campo `cachedInputTokens` já existe na fórmula).

### 3.3 Medição → custo → crédito → débito
Reuso direto de `suzette-ai-credits/pricing.ts` (portar TS quase verbatim):
- Ler `usage` **da resposta real do Claude** (`input_tokens`, `cache_read_input_tokens`, `output_tokens`) — o análogo exato do que `callOpenAiProvider` faz com `usage.input_tokens_details.cached_tokens`.
- **`calculateOpenAiCost`** (renomear `calculateModelCost`): `(input−cached)×inPrice + cached×cachedPrice + output×outPrice)/1e6` (USD) → `×operationalUsdBrlRate` (BRL). Só trocar a tabela `SUZETTE_PROVIDER_PRICING` pelos preços Claude **por modelo** (confirmar na página oficial no momento da implementação — mudam).
- **`calculateCreditsToDebit`**: `ceil(custoBrl × markup / creditUnitBrl)`, depois `max(créditos, pisoDaFeature)`. Mantém markup **no preço do pacote** (`SUZETTE_DEFAULT_MARKUP_MULTIPLIER = 1` na medição), como o Suzette.
- **Recalibrar `creditUnitBrl`**: output de Sonnet/Opus é ~10–60× o `gpt-5.4-nano` → a "ação de referência" e/ou o preço de pacote mudam (discovery §5). **Aposta minha:** definir a unidade de crédito por uma **ação de e-mail em Sonnet** (barata, alto volume) e dar **piso alto por feature** para ata em Opus (`SUZETTE_FEATURE_MINIMUM_CREDITS` → `astro_meeting_minutes: 500+`), para reunião "custar visivelmente mais" sem estourar o mental do usuário.
- **Débito transacional** (o que o `Map` do Suzette não garantia): em uma transação Postgres — checar gate → inserir `AiUsage` → inserir `AiLedgerEntry(type=usage)` → `UPDATE wallet SET balance = balance − credits`. Tudo ou nada.

### 3.4 Carteira / ledger por tenant (modelo de dados)
Transplante das entidades do Suzette (`suzette-ai-credits/types.ts`), trocando substantivos:

| Suzette (`types.ts`) | Astro |
| --- | --- |
| `SuzetteWallet { accountId, balanceCredits, totalContextCredits, trialCreditsGranted }` | `AiWallet { tenantId (PK), balanceCredits, totalCredits, trialGranted, status }` |
| `SuzetteBranchBudget { branchId, creditLimit, usedCredits, active }` | `AiUserBudget { tenantId, userId, limitCredits|percent, usedCredits, active, disabledReason }` |
| `SuzetteCreditLedgerEntry { type: trial_grant\|purchase\|usage\|refund\|adjustment\|branch_budget_change, credits, balanceAfter, …tokens, …cost, creditsCharged, model, featureKey }` | `AiLedgerEntry` idem, `budget_change` no lugar de `branch_budget_change`; **append-only**, `tenantId` em toda linha. |
| `SuzetteAiUsage { …tokens, openAiCostBrl, markupMultiplier, creditsCharged, balanceBefore/After, status }` | `AiUsage` idem + `tenantId, userId, feature`. |
| `SuzetteCheckoutIntent { status: …\|paid\|credited, wooCommerceOrderId, providerReference }` + `creditedIntentIds` | `AiCheckoutIntent` + tabela/SET de idempotência. |

Funções de domínio a reusar de `suzette-ai-credits/domain.ts` (portar a lógica, servir por API):
- **`canUseSuzette`** → **`canUseAstro`**: gate **duplo** — saldo do tenant **E** cota do usuário (`limitCredits − usedCredits`) cobrindo o custo estimado.
- **`recordAiUsage`** → **`recordAiUsage`**: debita carteira, incrementa `usedCredits` do usuário, grava ledger `usage` + `AiUsage`.
- **`activateSuzette`** → **`activateAstro`**: **trial grant** (o Suzette dá `250` créditos `trial_grant` na ativação; quantidade e escopo — por tenant ou por usuário — são decisão do Wagner).
- **`updateBranchBudgetPercent`** → **`updateUserBudget`**: aloca % da carteira por usuário, com clamp da soma ≤ 100% e **re-escala proporcional** na compra; grava ledger `budget_change`.
- **Compra idempotente:** copiar `creditedIntentIds`/`checkoutIntentId` (é dinheiro; callback duplicado não pode creditar 2×).

### 3.5 Endpoints (contrato)
Namespace `/api/astro/*`, todos autenticados (exceto health), `tenantId`/`userId` **derivados do token — nunca do corpo** (a falha de segurança do Suzette, que aceitava `accountId`/`userId` no body):

| Método | Rota | Função |
| --- | --- | --- |
| GET | `/health` · `/ready` | liveness / readiness (checa PG+Redis+Anthropic) |
| GET | `/api/astro/wallet` | saldo do tenant + cota do usuário logado |
| GET | `/api/astro/ledger?cursor=` | histórico paginado (do tenant; usuário comum vê o seu, master vê tudo) |
| GET | `/api/astro/packages` | pacotes de crédito à venda |
| POST | `/api/astro/checkout/intents` | cria intent de compra (gateway §9 Q3) — **só master** |
| POST | `/api/astro/checkout/webhook` | callback do gateway → credita (idempotente, assinatura verificada) |
| POST | `/api/astro/ai/command` | **e-mail-assist** — recebe contexto do editor, faz gate → Claude (stream SSE) → mede → debita. Substitui `/api/ai/command` mockado em `use-chat.ts`. |
| POST | `/api/astro/meeting/sessions` | abre sessão de reunião (consentimento, origem: recording\|live) |
| POST | `/api/astro/meeting/sessions/:id/audio` | (Fase B, live) ingest de chunks do companion → fila ASR |
| POST | `/api/astro/meeting/sessions/:id/finalize` | ASR → Opus → **ata + To-Dos**; devolve doc + cria tarefas (via app, `Tasks.ReadWrite`) |
| GET | `/api/astro/master/status` | resolve papel de master (§6) |
| POST | `/api/astro/master/delegate` | master delega papel a outro usuário |
| POST | `/api/astro/budgets` | define política de distribuição/cotas — **só master** |

### 3.6 Auth desktop → backend (sem senha paralela)
O app já prova identidade M365 (token delegado, `auth.rs`). O backend precisa confiar nisso e extrair `tenant_id` + `oid`. **Duas rotas, recomendo a A:**

**A) Expor a API do Astro no próprio registro Entra (recomendada).**
No app registration (`CLIENT_ID = 214d735e-…`), "Expose an API" → escopo `Astro.Use`. Acrescentar `api://{CLIENT_ID}/Astro.Use` a `config::SCOPES`. O `interactive_login`/`refresh` de `auth.rs` passam a **também** receber um access token cujo `aud` = a API do Astro. O backend valida esse JWT com a **JWKS pública do Entra** (`https://login.microsoftonline.com/{tid}/discovery/v2.0/keys`), confere `iss`/`aud`/`exp`, e lê os claims **`tid`** (→ carteira do tenant) e **`oid`** (→ cota do usuário).
- **Prós:** validação **offline** (sem round-trip por request), audience correta, padrão OAuth de livro. Multi-tenant já funciona (o `tid` vem do token do cliente).
- **Custo:** um escopo novo no registro + os usuários relogam uma vez (o mesmo padrão que o doc de escopos já descreve para todo escopo novo). Sem admin consent (é escopo delegado do próprio app).
- **Nota Rust:** hoje `auth.rs` guarda **um** `access_token` (audience Graph). Com a API própria, o Entra emite tokens **por audience**; o app pede o token do Astro pela mesma sessão/refresh. Guardar os dois no `TokenStore` (ou pedir o do Astro sob demanda) é a única mudança de forma.

**B) Introspecção via Graph (fallback zero-config, bom p/ bootstrap).**
O backend recebe o **token Graph** do usuário e faz `GET https://graph.microsoft.com/v1.0/me` com ele; se 200, a identidade é válida e o `/me` + o `tid` do token (decodificado, não confiado na assinatura) dão tenant+usuário.
- **Prós:** nenhum registro novo, funciona já. **Contras:** 1 round-trip ao Graph por sessão (cachear com TTL curto), e tokens Graph não são "para" o Astro validar (usa-se o Graph como introspection endpoint — aceitável para bootstrap, não ideal como regime permanente).

**Recomendação:** começar a Fase A (e-mail-assist) pela rota **B** para não travar no registro, e migrar para **A** antes de cobrar de verdade. Em nenhuma hipótese o backend confia em `tenantId`/`userId` do corpo do request.

### 3.7 Deploy & observabilidade no VPS
- **Segredos** em env do container (`ANTHROPIC_API_KEY`, `DATABASE_URL`, `REDIS_URL`, `CHECKOUT_WEBHOOK_SECRET`) — nunca no repo; `.env` fora do git; varredura de segredos no CI.
- **Logs estruturados** (pino), **sem corpo de e-mail/transcript** (privacidade, §7). Métrica de uso (tokens/feature/custo/tenant) sim; conteúdo não.
- **Observabilidade barata:** `/metrics` Prometheus + Grafana no próprio VPS, ou Uptime-Kuma no `/health`. Alertas de saldo/erro Anthropic. O MCP `hostinger-vps` (`VPS_getMetricsV1`, `VPS_getVirtualMachinesV1`) permite ver métricas do host.
- **Backups Postgres** diários (dinheiro/carteira) + snapshot do VPS.
- **Firewall:** só 443 aberto (Caddy); Postgres/Redis só na rede do Compose.

---

## 4. Integração no app desktop

- **Tela `astro`** (slot já existe): painel de **saldo** (carteira do tenant + cota do usuário, de `GET /api/astro/wallet`), **histórico** (`/ledger`), **compra** de pacotes (só master vê o botão de checkout), estado do e-mail-assist. Reusar componentes de saldo/pacote do Suzette como referência visual (mock-store/mock-data), sem inventar UI.
- **E-mail-assist real:** em `src/components/editor/use-chat.ts`, substituir o `createChatTransport` mockado (o bloco `fetch:` com `fakeStreamText`) por um `DefaultChatTransport` que aponta para `POST /api/astro/ai/command` no backend, injetando o **Bearer do Astro** (via comando Tauri que pega o token do `TokenStore`). O formato de stream já bate (o mock emite exatamente os eventos do AI SDK). Remover `fakeStreamText`/`faker` no fim.
- **Saldo insuficiente / feature bloqueada:** o gate do backend (`canUseAstro`) devolve `{ allowed:false, reason }` (mesmo shape de `SuzetteUsageCheck`) → o front mostra CTA de compra em vez de chamar o Claude.
- **Meeting-assistant:** botão contextual no evento online do Control Room (`cr_evento_corpo` já entrega `join_url`/`online`) e/ou no Navigator quando o Teams está aberto. Consentimento visível antes de qualquer captura.

---

## 5. Meeting-assistant — o pipeline "mais fiel que funcione" (recomendação)

**Tese (confirmada pelo PO):** o transcript nativo do Teams é ruim; o produto é **batê-lo** com **áudio de qualidade → nossa ASR → Claude**. O transcript nativo é **benchmark/fallback**, nunca dependência.

### 5.1 Captura — RECOMENDAÇÃO: híbrido por origem da reunião
| Situação | Fonte recomendada | Como |
| --- | --- | --- |
| **Reunião GRAVADA** (recording existe) | **Graph recording** (`OnlineMeetingRecording.Read.All` — já concedido) | `evento → onlineMeeting.joinUrl` (`graph.rs`) resolve o `onlineMeeting`; `GET /me/onlineMeetings/{id}/recordings/…/content` baixa o MP4; o backend extrai áudio e roda **nossa ASR**. **Sem companion, sem captura ao vivo.** Mais limpo e legalmente mais simples (dado já retido no M365 com consentimento do Teams). |
| **Reunião AO VIVO / não-gravada / fora do Teams** | **Companion Delphi (WASAPI loopback)** | Helper nativo (Delphi 13, força do ecossistema do Wagner) grava o **áudio do sistema** (todos os falantes), streama chunks por IPC (localhost/named pipe) → backend → fila ASR. É o **motor** onde não há gravação oficial. |

**Por que híbrido e não "só companion" nem "só Graph":** a gravação oficial elimina o custo/atrito do companion **quando ela existe** (muitas reuniões corporativas são gravadas), e ainda dá a **lista de participantes** (attendance report) para ancorar o crachá; o companion cobre o resto (o caso "ao vivo, agora, sem gravar") — que é justamente onde o "óculos em tempo real" brilha. A captura pela **WebView2** (`getDisplayMedia`/`AudioWorklet` injetado no nosso webview) fica como **plano B de captura** (máquina sem admin p/ instalar companion) e, principalmente, como **camada de identidade** (§5.3), não como via principal de áudio (DOM do Teams é volátil).

### 5.2 ASR — RECOMENDAÇÃO: Whisper-class self-hosted no VPS (com escape para API)
- **Recomendo self-hosted (faster-whisper / whisper.cpp) como worker no VPS**, modelo `large-v3` (ou distil para latência). Motivos: **custo fixo** (o financeiro cobre; sem custo por-minuto que escala com o uso), **privacidade** (áudio de reunião não sai para um terceiro de ASR além do provedor de LLM), **pt-BR decente**. Roda em fila (BullMQ/Redis); GPU no VPS acelera, mas CPU serve para MVP assíncrono (ata não precisa ser instantânea).
- **Escape/abstração:** manter interface `AsrProvider` para trocar por **Deepgram/AssemblyAI** se a qualidade/latência exigir e o cliente permitir dado fora. **Aposta honesta:** começar self-hosted; medir WER em pt-BR real; só migrar para API se doer. Diarização fina (voz→pessoa) é ML de verdade e fica na Fase D — no MVP, diarização = **casar turno de fala com nome da janela** (§5.3), não biometria.

### 5.3 Montagem — ASR → Claude → ata premium + To-Dos + crachá
1. **Transcrição** (nossa ASR) → texto com timestamps.
2. **Claude Opus** monta **ata premium** (decisões, tópicos, próximos passos) + **extrai To-Dos** (Haiku pode fazer a extração barata sobre o transcript pronto). Piso de créditos alto para a ata.
3. **To-Dos → Microsoft To Do** via `Tasks.ReadWrite` (já temos; o app já fala `/me/todo/lists` em `cr_tarefas`). A criação roda **pelo app** (token delegado do usuário), não pelo backend.
4. **Crachá (speaker-ID) — faseado:**
   - **Fase C:** identidade em tempo real por **active-speaker** — injeção de script + `MutationObserver` no WebView2 do Navigator (o Teams roda no nosso webview, `browser.rs`) e/ou **UIA** lida pelo companion (nome do participante + indicador de quem fala). Casa **nome ↔ turno de fala** → "Fulano disse…", To-Dos atribuídos. Sem treinar voz.
   - Ancorar nomes na **attendance report** do Graph (barata) quando existir.
   - **Fase D:** diarização voz→pessoa mais fina.

### 5.4 Privacidade do áudio (trilho inegociável)
Áudio bruto **efêmero** — vive só o necessário para transcrever, nunca persistido em claro além disso; consentimento **explícito e visível** para todos os participantes; indicador de "IA ativa"; retenção mínima configurável e purga. Conteúdo (transcript/ata) transita usuário→backend→Claude e **não é logado**. Checar base legal/residência antes de mandar áudio/transcript para fora (discovery §10 Q5).

### 5.5 Esforço & risco (franco)
| Item | Esforço | Risco |
| --- | --- | --- |
| Graph recording → ASR → ata | **Médio** | Baixo-médio: depende de reunião gravada e de escopo já concedido; download de recording é assíncrono (chega no fim). |
| Companion Delphi (WASAPI + IPC) | **Alto** | Médio: 2º executável, instalador, permissão de captura, pipeline de streaming. WASAPI/UIA são estáveis. |
| ASR self-hosted (qualidade pt-BR) | **Médio-alto** | Médio: WER real pode decepcionar → escape para API. GPU no VPS é custo. |
| Crachá active-speaker (DOM/UIA) | **Médio** | **Alto no DOM** (o Teams muda e quebra o seletor) → preferir UIA; tratar como best-effort. |
| Diarização voz→pessoa (Fase D) | **Alto** | Alto: ML de verdade; não prometer no MVP. |

---

## 6. Master-user híbrido (3 camadas)

O "master" tem autoridade de **comprar créditos** e **distribuir cota**. As três camadas, em ordem de confiança:

1. **Auto-detecção pelo papel de admin M365** (bootstrap/sugestão). Com `Directory.Read.All` + `RoleManagement.Read.Directory` (**já concedidos**, doc de escopos), o backend/app resolve se o usuário logado tem papel administrativo — **Global Administrator**, **Privileged Role Administrator**, **Billing Administrator** — via `GET /me/memberOf` (filtrando `directoryRole`) ou `roleManagement/directory/roleAssignments` pelo `principalId` (= `oid`). Se sim, é **candidato a master** automaticamente no 1º acesso.
2. **Delegação no app.** O master reconhecido pode **promover** outros usuários a master/gestor-de-créditos pelo painel Astro (`POST /api/astro/master/delegate`). Cobre o caso real "quem paga é o financeiro, não o Global Admin".
3. **Fallback de designação no backend.** Se nenhum papel M365 for detectável (ou o escopo faltar num tenant específico), o **primeiro usuário do tenant que compra** vira master (primeiro-comprador), estado que **só o backend Astro conhece**. Garante que sempre há um master, sem depender de admin consent.

**Regra de projeto:** o master é **estado próprio do Astro** (camada 3 é o alicerce, sempre funciona); o papel M365 (camada 1) é **sinal de bootstrap/sugestão**, não fonte única de verdade. Assim não ficamos reféns de nenhuma configuração de papéis do cliente. Tabela `AiTenantMaster { tenantId, userId, source: role_m365|delegated|first_buyer, at }`.

---

## 7. Isolamento por tenant + privacidade

- **Partição por `tenant_id` em tudo:** `AiWallet`, `AiUserBudget`, `AiLedgerEntry`, `AiUsage`, `AiCheckoutIntent`, `AiTenantMaster` e o índice **RAG** (Fase D) carregam `tenantId` como chave e **toda query filtra por ele** (idealmente Postgres Row-Level Security por `tid` do token). Nunca cruzar dados entre organizações.
- **`tenantId`/`userId` sempre do token** (§3.6), nunca do corpo — fecha o buraco do Suzette de aceitar `accountId` no body.
- **Chave Claude/ASR só no VPS** — nunca no cliente (público, PKCE), nunca no repo/bundle. Varredura de segredos no CI.
- **Conteúdo sensível (e-mail/reunião):** transita usuário→backend→provedor, **não persistido em claro** além do necessário; **nada de logar corpo**. Retenção só de métrica (tokens/feature/custo). Áudio de reunião efêmero, consentimento visível.
- **Residência de dados:** se um tenant exigir tudo dentro do M365/região, a abstração `LlmProvider` permite **Azure OpenAI/Bedrock regional**; e a ASR self-hosted já mantém o áudio no nosso VPS. Confirmar por cliente (decisão do Wagner).

---

## 8. Fatiamento incremental (slices de arquitetura)

Alinhado ao discovery §9 e ao ritmo de ~3 issues por release. Cada slice é entregável e demoável; **provar o billing barato (e-mail) antes de subir o custo (reunião)**.

- **Slice A — Motor de créditos + e-mail-assist (MVP de receita).**
  Backend Astro no VPS (Fastify + Postgres + proxy Claude + medição + carteira/ledger por tenant + trial grant); auth desktop→backend (rota B → A); tela `astro` com saldo/histórico/compra; **ligar o e-mail-assist real** no lugar do mock (`use-chat.ts`/`ai-kit.tsx`). *Prova que o app se paga.*

- **Slice B — Distribuição + mais e-mail + meeting-assistant premium (o diferencial).**
  Checkout/gateway + **pool livre** com alertas de saldo; resumo de thread + triagem; **meeting-assistant = Graph recording (gravada) / companion Delphi WASAPI (ao vivo) → nossa ASR → Opus = ata premium + To-Dos** que batem o Teams; trilho de privacidade/consentimento montado; áudio efêmero; transcript nativo em paralelo só como benchmark. *O produto que justifica a venda.*

- **Slice C — Master-user + cotas + "crachá" ao vivo + To-Dos/agenda.**
  Master híbrido (3 camadas, §6) + **cota por usuário**; **identidade de falante** (active-speaker via WebView2/UIA casando nome↔fala na ata); To-Dos → Microsoft To Do (`Tasks.ReadWrite`); briefing pré-reunião. *Governança + o "cara, crachá".*

- **Slice D — Óculos completo + robustez + RAG.**
  Diarização voz→pessoa mais fina; captura pela WebView2 como plano B; tempo real fluido; **busca semântica (RAG particionado por tenant)**; assistente de documento. *A visão ambiciosa, sobre billing e privacidade já provados.*

---

## 9. Decisões abertas (do Wagner — herdadas do discovery §10)

Técnicas resolvidas neste doc: stack do backend, auth desktop→backend, pipeline do meeting-assistant, master híbrido, isolamento. **Continuam do Wagner:** unidade de crédito/mental de preço (P1/P2/P3), pedir ou não escopos novos agora (o de recording já veio; falta o `Astro.Use`), tabela de preço + margem-alvo + **gateway** (Stripe? PIX como o Suzette? WooCommerce?) + moeda, granularidade da distribuição (recomendo pool livre no MVP), provedor & residência de dados por cliente, tamanho do trial, e nome/ícone (já definido: **Astro**).

---

## 10. Resumo de uma linha

Astro = **carteira de créditos pré-pagos por tenant** (modelo Suzette de `pricing.ts`/`domain.ts` transplantado, *conta→tenant*/*filial→usuário*), servida por um **backend Node/Fastify no VPS Hostinger** que guarda a chave Claude, mede tokens e cobra; o **desktop autentica com o token M365 delegado** (escopo `Astro.Use`, `tid`+`oid` via JWKS) sem senha paralela; o **e-mail-assist** destrava primeiro (front pronto em `use-chat.ts`, hoje mock); o **meeting-assistant** é o diferencial — **Graph recording quando gravada, companion Delphi WASAPI quando ao vivo → nossa ASR self-hosted → Claude Opus = ata premium + To-Dos** que batem o transcript ruim do Teams, evoluindo para o "crachá" via active-speaker/UIA; **master híbrido** (papel M365 + delegação + primeiro-comprador) e **isolamento/privacidade por tenant** como trilho inegociável.
