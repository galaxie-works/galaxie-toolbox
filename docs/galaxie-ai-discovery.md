# Galaxie AI — Discovery / Estratégia de Produto + Arquitetura

> 📌 **Snapshot de discovery (2026-07/08). Estado atual: NÃO construído** — aguardando go/no-go do PO (#180/#196). Arquitetura/estratégia proposta; ver também `astro-architecture.md` e `astro-financial-model.md`.

Issue #180 · GALAXIE Toolbox / **Galaxie AI** (novo item de Galaxie Apps)
Stack: Tauri 2 (multi-webview, feature `unstable`) + React 19 + TypeScript + Tailwind v4 + shadcn/reui · Microsoft Graph **delegado (`/me`)**, multi-tenant (tenant detectado pelo domínio)
Status: **discovery + estratégia** (sem código). Foco: **produto + arquitetura + modelo de negócio** — não só UI.

> Leia junto de `docs/bridge-people-ux.md` (#143) e `docs/navigator-ux-spec.md` (#172) — mesma disciplina de mapeamento pro código real e mesmo fatiamento INVEST. Aqui o eixo é **como o app se sustenta e gera renda**, não uma tela.
>
> **Este documento NÃO fecha preço nem estratégia.** Traz o modelo do Suzette com números reais como *referência*, recalcula pro Galaxie, e apresenta **opções** — as decisões de preço, master-user e escopo do meeting assistant são do Wagner (ver §10, perguntas abertas).

---

## 0. TL;DR — decisões-chave (a validar)

1. **Galaxie AI é um recurso pré-pago de créditos de IA, não um app de tela.** Vira um item do grupo **Galaxie** na sidebar (ao lado de Bridge, Navigator, Comms, Astro, Pulsar — `src/lib/navegacao.ts`), mas o coração é um **backend Galaxie** que guarda a chave do LLM, mede consumo e cobra. O app desktop **nunca** vê a chave de IA.
2. **O modelo do Suzette se transplanta quase 1:1.** No Suzette: *dono do restaurante compra créditos → distribui entre filiais*. No Galaxie: *dono da organização compra créditos → distribui aos usuários*, com a **organização = tenant M365** como chave natural da carteira (o app já resolve o `tenant_id` real pelo domínio, `auth::detectar_tenant`). Filial→usuário; conta→tenant.
3. **Provider: modelos Claude mais recentes por padrão, com roteamento por tarefa.** O Suzette usa OpenAI `gpt-5.4-nano`; o Galaxie troca por **Claude** (Haiku para classificação/rascunho barato, Sonnet como default do e-mail, Opus para síntese pesada de ata). A fórmula de custo→crédito do Suzette é reaproveitada; só mudam os preços de tabela do provedor (§5).
4. **"Usuário master" da org: recomende, não decida.** A aposta mais limpa é **derivar do papel no tenant M365** (Global Admin etc. via Graph directory roles) para *bootstrap*, e deixar o master **delegar** no app. Três opções em §4. Custo honesto: exige **escopos novos** (`RoleManagement.Read.Directory`/`Directory.Read.All`) com **admin consent** — hoje não concedidos.
5. **Meeting assistant ("óculos de IA"): o produto é BATER o transcript porcaria do Teams.** Capturamos o **áudio bruto** da reunião — via **companion Delphi (WASAPI loopback)** [1ª classe] e/ou captura na WebView2 do Navigator — e rodamos **nossa própria ASR de qualidade + Claude** pra gerar **ata premium + To-Dos + identificação de falante**. O transcript nativo do Graph é só **baseline/benchmark e fallback**, nunca dependência (§7). "Cara, crachá e voz" chega faseado; a **ata premium** já sai no MVP.
6. **Duas capacidades de IA imediatas, resto no mapa.** (1) **IA no e-mail** (Bridge já tem o *scaffolding* do editor Plate com AI — hoje **mock**, `src/components/editor/use-chat.ts`), (2) **meeting assistant**. O §6 mapeia as "infinitas possibilidades" priorizadas por valor×viabilidade.
7. **Reuse, don't invent + privacidade no centro.** Conteúdo de e-mail e de reunião é **sensível**: nunca sai do caminho usuário→backend Galaxie→provedor, nunca é logado em claro, e o meeting assistant é **opt-in explícito e visível** para todos os participantes. Este é o trilho ético do produto.

---

## 1. Realidade da arquitetura hoje (a restrição que molda tudo)

Âncoras reais no código — Galaxie AI tem que respeitar cada uma:

| Camada | Arquivo / símbolo | O que é hoje | Consequência pro Galaxie AI |
| --- | --- | --- | --- |
| Auth delegada | `src-tauri/src/auth.rs` — `interactive_login`, `refresh`, `detectar_tenant`, `TokenStore` | Authorization Code + PKCE, **public client sem secret**; token só em memória + sessão DPAPI. `detectar_tenant` lê o OIDC do domínio e extrai o **GUID real do tenant**. | O **tenant_id** é a **chave de organização** da carteira de créditos, já disponível e confiável. O app é *public client* → **não pode** guardar chave de LLM. Precisa de backend. |
| Escopos | `src-tauri/src/config.rs` — `SCOPES` | Delegado `/me`. Hoje pede `User.Read User.Read.All Files.ReadWrite Sites.Read.All Calendars.Read Mail.ReadWrite Mail.Read.Shared ... Mail.Send People.Read Contacts.ReadWrite`. | Nada de IA aqui ainda. Meeting/master-user exigem escopos **novos** (§4, §7) — admin consent. |
| Navegador embutido | `src-tauri/src/browser.rs` — `browser_abrir`, `browser_layout`, `esconder_menos` | Cada aba do Navigator é um **webview NATIVO filho** (WebView2), posicionado por coordenada. O Teams web roda **aqui dentro** (`src/lib/apps.ts` id `teams` → `teams.cloud.microsoft`). | É **nosso** WebView2 — dá pra injetar script/observar DOM (§7b). É a diferença entre "Teams externo" e "Teams que hospedamos". |
| Editor com IA (mock) | `src/components/editor/plugins/ai-kit.tsx`, `src/components/editor/use-chat.ts` | Editor Plate com `AIChatPlugin` apontando pra `/api/ai/command` — mas o transport é **`fakeStreamText` (mock)**: "*Remove it when you implement the route /api/ai/command*". | O **front do e-mail-assist já existe**; falta o backend real. Menor caminho até a 1ª feature. |
| Calendário/reunião | `src-tauri/src/graph.rs` — `calendarView` com `$select=...,onlineMeeting`, lê `onlineMeeting.joinUrl` | Control Room já lê eventos e sabe se é online + `joinUrl`. | Hook natural pro meeting assistant: evento → `onlineMeeting` → (com escopo novo) transcript. |
| Grupo de produtos | `src/lib/navegacao.ts` — `NAV[0].itens[0]` (`titulo: "galaxie"`) | Produtos Galaxie: `control-room` (Bridge), `navegador` (Navigator), `comms`, `astro`, `pulsar`. | **Galaxie AI** entra aqui como novo `filho` (nova `Tela`), com ícone de marca próprio. |

**Três verdades que decidem o desenho:**
- **Não há backend hoje.** O app fala só com o Graph. Créditos, medição e chave de LLM **exigem um serviço Galaxie** (o Suzette já provou isso: `suzette-local-server.mjs` é exatamente esse proxy). Sem ele, não há monetização segura.
- **O app é público (PKCE, sem secret).** Chave de IA no cliente = chave vazada. **Regra dura:** a chave vive **só** no backend Galaxie.
- **O tenant é identidade de organização de graça.** `auth.rs` já entrega `tenant_id` + domínio. A carteira de créditos se ancora nisso sem inventar cadastro.

---

## 2. O legado Suzette — o modelo que vamos adaptar (achados reais)

Suzette é a assistente de IA ("Sous-Chef") do OnlyChefs. Nos diretórios apontados há **duas gerações** de monetização; a que interessa é a **de créditos gerenciados pela plataforma**.

**Arquivos-âncora** (todos em `...\Customer\onlychefs\onlychefs-4-front\`):
- `src/app/features/suzette-ai-credits/pricing.ts` — **constantes de preço + fórmula custo→crédito** (o arquivo mais load-bearing).
- `.../suzette-ai-credits/types.ts` — schemas de carteira, ledger, orçamento por filial, checkout, pacotes.
- `.../suzette-ai-credits/domain.ts` — débito de crédito, compra, **distribuição por filial**.
- `.../suzette-ai-credits/mock-data.ts` — os 3 pacotes de venda com preços reais + trial.
- `server/suzette-local-server.mjs` — **proxy backend**: chave OpenAI, chamada `/v1/responses`, intents de compra PIX/WooCommerce.
- Docs de produto: `...\onlychefs-4-documentation\...\sistema-filial\20-suzette-ia-e-companion.md`, `26-...rag-operacao.md`, `27-...plano-execucao-checklist.md`.

### 2.1 Modelo de créditos (comprar + distribuir)
- Uma **conta** (restaurante, ex. `acct_bellaroma`) tem **uma carteira** (`SuzetteWallet`) com `balanceCredits` + `totalContextCredits`. A conta tem N **filiais**; cada filial tem um **`SuzetteBranchBudget`** (`creditLimit`, `usedCredits`, `active`).
- **Distribuição** (`domain.ts`): `updateBranchBudgetPercent` aloca **um % da carteira total** por filial, com clamp pra soma das ativas não passar de 100%; toda mudança grava ledger `branch_budget_change`. Na compra, os limites de filial são **re-escalados proporcionalmente** ao novo total.
- **Gate de uso** (`canUseSuzette`): exige **saldo da carteira** E **orçamento restante da filial** (`creditLimit - usedCredits`) cobrindo o custo estimado.
- **Ledger** (`SuzetteCreditLedgerEntry`): `trial_grant | purchase | usage | refund | adjustment | branch_budget_change`.
- **Trial:** ativar a Suzette dá **250 créditos grátis** (`trial_grant`).
- **Master = dono da conta** (`ownerUserId = usr_owner`): a carteira é da conta; o owner compra e distribui pra baixo. Consumo por usuário é reportado (`SuzetteUserUsage`), mas a **cota é imposta na filial**, fundeada pela carteira da conta.

### 2.2 Precificação (números verbatim do `pricing.ts`)
Base de custo do provedor:
```
model: "gpt-5.4-nano"
inputPricePerMillionUsd: 0.2
cachedInputPricePerMillionUsd: 0.02
outputPricePerMillionUsd: 1.25
operationalUsdBrlRate: 5.5      // USD→BRL
```
Derivação da unidade de crédito:
- Ação média = **2000 input + 800 output** tokens.
- Custo bruto = (2000×0.2 + 800×1.25)/1e6 = **US$ 0,0014** → ×5,5 = **R$ 0,0077** por ação média.
- `SUZETTE_CREDIT_UNIT_BRL = custoAçãoMédia / 25` ≈ **R$ 0,000308 por crédito** → **1 ação média ≈ 25 créditos**.
- `SUZETTE_DEFAULT_MARKUP_MULTIPLIER = 1` (sem markup na medição — **a margem está no preço do pacote**).

**Pacotes de venda ("formatos de venda")** — vendidos por SKU WooCommerce:

| Código | Nome | Créditos | Preço | BRL/crédito | ≈ ações |
| --- | --- | --- | --- | --- | --- |
| essential | IA Essencial | 5.000 | **R$ 49** | R$ 0,0098 | ~200 |
| pro | IA Pro *(melhor custo-benefício)* | 15.000 | **R$ 99** | R$ 0,0066 | ~600 |
| turbo | IA Turbo | 40.000 | **R$ 199** | R$ 0,004975 | ~1.600 |

**Margem efetiva:** crédito vendido a ~R$ 0,005–0,0098, custo bruto ~R$ 0,000308/crédito → **markup embutido de ~16× a ~32×** (maior no Essencial, menor no Turbo). É a margem que sustenta o app.

- **Pisos mínimos por feature** (`SUZETTE_FEATURE_MINIMUM_CREDITS`) — cobra o mínimo mesmo se o custo bruto for menor: `menu_description:20`, `marketplace_coupon:25`, `marketing_campaign_draft:50`, `inventory_insight:50`, `menu_bulk_update:100`, `pricing_simulation:100`, `pricing_bulk:200`, `conversation_help:0`.

### 2.3 Medição de tokens (por request)
- Captura `inputTokens`, `cachedInputTokens`, `outputTokens`. Custo = `(input-cached)×0.2 + cached×0.02 + output×1.25` /1e6 (USD) → ×5,5 (BRL).
- `créditos = ceil(custoBrl × markup / creditUnitBrl)`, depois `max(créditos, pisoDaFeature)`.
- Grava `SuzetteAiUsage` + ledger `usage` (campos `openai_cost_usd/brl`, `markup_multiplier`, `credits_charged`, `model`, `feature_key`) → sinaliza um contrato de **DB/API real** por trás do mock. Debita a carteira e incrementa `usedCredits` da filial.
- O server lê `usage.input_tokens` / `...cached_tokens` / `output_tokens` **da resposta real do provedor**.

### 2.4 Chave / provedor
- Provedor **OpenAI** (`gpt-5.4-nano`), `api.openai.com/v1/responses`. **Chave só no backend** (`SUZETTE_OPENAI_API_KEY` em `.env.local`, chamada real atrás de flag `SUZETTE_OPENAI_REAL`, senão mock).
- **Discrepância registrada:** os docs de PO (20 & 26) descrevem um modelo *anterior* em que **o restaurante põe a PRÓPRIA chave OpenAI** (sem créditos/carteira). O `suzette-ai-credits` é o modelo *posterior*, gerenciado pela plataforma, que **revende consumo como crédito**. Para o Galaxie, **o modelo de créditos é o certo** (BYO-key não monetiza e transfere risco de custo pro cliente).

---

## 3. Modelo de créditos/billing adaptado pro Galaxie

Transplante direto, trocando os substantivos:

| Suzette | Galaxie AI |
| --- | --- |
| Conta (restaurante) | **Organização = tenant M365** (chave = `tenant_id` de `auth.rs`) |
| Filial | **Usuário** (ou grupo/departamento — ver §10 Q4) |
| Dono do restaurante (`ownerUserId`) | **Usuário master da org** (§4) |
| Carteira da conta | **Carteira do tenant** (`balanceCredits`, `totalCredits`) |
| Orçamento por filial (% da carteira) | **Cota por usuário** (%, ou limite fixo, ou pool livre) |
| SKU WooCommerce + PIX/cartão | **Gateway de pagamento Galaxie** (ver §10 Q3) |

**Entidades (contrato de backend):**
- `AiWallet { tenantId, balanceCredits, totalCredits, createdAt }`
- `AiUserBudget { tenantId, userId, limitCredits|percent, usedCredits, active, disabledReason }`
- `AiLedgerEntry { id, tenantId, type: trial_grant|purchase|usage|refund|adjustment|budget_change, credits, meta, at }`
- `AiUsage { tenantId, userId, feature, model, inputTokens, cachedInputTokens, outputTokens, costUsd, costBrl, markup, creditsCharged, at }`

**Regras herdadas do Suzette (mantêm):** gate duplo (saldo do tenant **E** cota do usuário); re-escala proporcional das cotas na compra; ledger para toda mutação; **trial grant** na ativação (ex.: X créditos grátis por tenant — número é decisão do Wagner); **pisos mínimos por feature** (uma ata de reunião longa deve ter piso alto; um "melhora este parágrafo" no e-mail, piso baixo).

**Idempotência de compra:** o Suzette guarda `creditedIntentIds`/`checkoutIntentId` pra não creditar duas vezes num callback duplicado — **copiar isso**, é dinheiro real.

**Distribuição — 3 políticas a oferecer ao master (decisão do Wagner, Q4):**
- **Pool livre** (mais simples): todo mundo consome da carteira do tenant até acabar. Sem cota. Bom pra orgs pequenas.
- **Cota por usuário** (modelo Suzette): % ou limite fixo por pessoa; protege contra um usuário torrar tudo.
- **Cota por grupo/departamento**: aloca por grupo M365 (já temos `TeamMember.Read.All`/grupos), o gerente distribui dentro.

Recomendação: **começar em Pool livre + alertas de saldo** (Slice A), adicionar **Cota por usuário** quando houver dor real (Slice C). Não construir os três de cara.

---

## 4. Quem é o "usuário master" da organização?

O Wagner não sabe como registrar isso. É a pergunta certa — e há resposta boa, com custo honesto.

**Contexto:** o app é multi-tenant, delegado. A carteira é do tenant. Alguém precisa ter autoridade de **comprar créditos** e **distribuir**. Esse é o master.

### Opção A — Derivar do papel no tenant M365 (auto-detecção) — *recomendada como bootstrap*
O Graph expõe os **papéis de diretório**. Um usuário é candidato a master se tiver papel administrativo — ex.: **Global Administrator**, **Privileged Role Administrator**, ou papéis de billing (**Billing Administrator**).
- **Como:** `GET /me/memberOf` filtrando `directoryRole`, ou `roleManagement/directory/roleAssignments` filtrando o `principalId` do usuário, ou checar `GET /me` + `directoryRoles`.
- **Escopo necessário:** `Directory.Read.All` **ou** `RoleManagement.Read.Directory` — **admin consent obrigatório**, **hoje NÃO concedido** (a lista granted do AGENTS.md §1.1 não inclui nenhum dos dois). É um pedido novo ao admin do cliente.
- **Prós:** zero cadastro manual; quem manda no tenant manda na carteira; alinhado com "administrado pelo tenant". **Contras:** nem todo comprador é Global Admin (às vezes é o financeiro); alguns tenants têm muitos admins.

### Opção B — Designação no backend Galaxie (primeiro-comprador / manual)
O **primeiro usuário do tenant que compra créditos** vira master; ele pode promover outros no painel do Galaxie AI.
- **Prós:** nenhum escopo Graph novo; funciona em qualquer tenant; independe de como o cliente organiza papéis. **Contras:** precisa de um "momento zero" seguro (e se o primeiro a comprar for um usuário comum?); é estado que **só** o backend Galaxie conhece.

### Opção C — Híbrido (bootstrap por papel, delegação no app) — *recomendada como destino*
Bootstrap pela **Opção A** (se conseguirmos o escopo, o primeiro admin M365 a entrar é reconhecido como master automaticamente); daí o master **delega** papéis de master/gestor-de-créditos a quem quiser, **guardado no backend Galaxie** (Opção B). Se o escopo de roles não vier, cai só na Opção B (primeiro-comprador).

**Recomendação:** projetar o backend com **master como estado próprio do Galaxie** (Opção B como alicerce, sempre funciona) e usar o **papel M365 só como sinal de bootstrap/sugestão** (Opção A, quando o escopo existir). Assim não ficamos reféns de um admin consent que pode demorar. **Decisão do Wagner:** pedir ou não `Directory.Read.All` agora (Q2).

---

## 5. Provedor de LLM + preço (opções, decisão do Wagner)

Wagner quer **modelos Claude mais recentes por padrão**. A **fórmula custo→crédito do Suzette é agnóstica de provedor** — só trocamos os preços de tabela e (opcionalmente) roteamos por modelo.

**Roteamento por tarefa (recomendado)** — não usar o modelo caro pra tudo:
- **Haiku (mais recente)** — classificação, detecção de intenção, rascunho curto, extração de To-Dos de um transcript já pronto. Barato, rápido.
- **Sonnet (mais recente)** — **default do e-mail-assist** (responder/reescrever/resumir thread). Equilíbrio.
- **Opus (mais recente)** — síntese pesada: **ata perfeita** de reunião longa, sumário executivo multi-thread. Caro, usar com piso de créditos alto.

> Os preços exatos das tabelas Claude devem ser confirmados na página oficial da Anthropic no momento da implementação (mudam ao longo do tempo). Como **ordem de grandeza atual**: Haiku ~US$1/M in · ~US$5/M out; Sonnet ~US$3/M in · ~US$15/M out; Opus ~US$15/M in · ~US$75/M out. **Não use estes números como definitivos — confirme.** O ponto estratégico: **output de Sonnet/Opus é ~10–60× o `gpt-5.4-nano` do Suzette**, então a unidade de crédito e/ou o preço de pacote precisam ser recalibrados pra manter margem.

**Recalibração da unidade de crédito (mesma mecânica do Suzette):**
- Definir "ação média" por feature (e-mail-assist ≈ 1500 in + 500 out em Sonnet; ata ≈ 20k in + 3k out em Opus).
- Custo bruto BRL da ação (com USD→BRL configurável, hoje 5,5). Ex. e-mail em Sonnet: (1500×3 + 500×15)/1e6 = US$ 0,012 → R$ 0,066. Ata em Opus: (20000×15 + 3000×75)/1e6 = US$ 0,525 → **R$ 2,89** por ata. (Números ilustrativos — dependem dos preços reais e do tamanho médio.)
- `creditUnitBrl = custoAçãoDeReferência / N` (Suzette usou N=25). Manter markup **no preço do pacote**, como o Suzette.

**Opções de preço a decidir (Wagner):**
- **P1 — Espelhar o Suzette** (pacotes R$ 49 / 99 / 199), recalibrando quantos créditos cada um dá pra caber a margem com preços Claude. Simples, familiar.
- **P2 — Pacotes maiores/mais caros** já que síntese de reunião consome muito mais token (ata Opus custa ~R$ 3 de bruto). Pacotes tipo R$ 99 / 249 / 599.
- **P3 — Créditos + roteamento transparente**: features caras (ata Opus) custam visivelmente mais créditos; features baratas (e-mail Haiku/Sonnet) quase nada. Deixa o cliente "sentir" o custo e escolher.
- **Markup-alvo:** o Suzette embutiu 16–32×. Recomendo mirar **margem-alvo por feature** (ex.: 3–5× sobre custo bruto para features caras de reunião, mais alto para as baratas) em vez de um multiplicador único — reuniões são caras e um 20× ali pode assustar. **Decisão do Wagner (Q3).**

**Cache de prompt:** o Suzette já modela `cachedInputTokens` (Anthropic também tem prompt caching). Para o e-mail (system prompt + assinatura repetidos) e para RAG, o cache derruba o custo de input — **modelar desde o dia 1** (a fórmula do Suzette já tem o campo).

---

## 6. Mapa de features de IA (priorizado por valor × viabilidade)

As "infinitas possibilidades", ancoradas no que o app **já tem** (Graph + Bridge + Navigator + Control Room):

| # | Feature | Valor | Viabilidade | Depende de | Fase |
| --- | --- | --- | --- | --- | --- |
| 1 | **E-mail assist** (responder/reescrever/ajustar tom, resumir 1 e-mail) | Alto | **Alta** — front já existe (mock em `use-chat.ts`); só backend + Mail já lido | Backend + créditos | **A (MVP)** |
| 2 | **Resumo de thread longa** (Bridge) | Alto | Alta — Bridge já carrega a conversa | Backend + créditos | A/B |
| 3 | **Triagem/rotulagem inteligente** da inbox (prioridade, "precisa resposta") | Alto | Alta (Haiku barato) | Mail.Read | B |
| 4 | **Meeting assistant** — **ata premium + To-Dos** de áudio bruto (nossa ASR + Claude, batendo o Teams) | **Altíssimo** | Média-alta com companion Delphi | §7c | **B** |
| 5 | **"Cara, crachá e voz"** — nome↔turno de fala (active-speaker/UIA) → diarização própria | Altíssimo (o "óculos") | **Média (crachá) / Baixa (voz biométrica)** | §7b/§7c | **C→D** |
| 6 | **To-Dos → Microsoft To Do/Planner** (a IA cria as tarefas) | Alto | Alta — já temos `Tasks.ReadWrite` | Tasks | C |
| 7 | **Agenda inteligente** (preparar briefing pré-reunião: quem, últimos e-mails, pendências) | Alto | Média — junta Calendar+Mail+People | Graph combinado | C |
| 8 | **Busca semântica** sobre e-mails/arquivos (RAG) | Alto | Média — precisa embeddings + índice | Backend RAG | D |
| 9 | **Compositor a partir de bullet points** / follow-up automático | Médio | Alta | Backend | B |
| 10 | **Assistente de documento** (Word/OneDrive via Plate editor) | Médio | Média | Files + editor | D |
| 11 | **Redação multilíngue** (pt↔en, o app já é bilíngue) | Médio | Alta | Backend | B |

**Sequência recomendada:** provar o **motor de créditos com o e-mail-assist (barato, front pronto)** → thread/triagem → **meeting assistant premium (companion Delphi + ASR próprio + Claude)** → crachá ao vivo/To-Dos/agenda → RAG/óculos. Cada fase valida o billing antes de subir o custo por chamada.

---

## 7. Meeting assistant — viabilidade REAL e honesta

O sonho do Wagner: uma IA que **escuta a reunião, identifica quem fala ("cara, crachá e voz"), e monta ata perfeita + To-Dos**.

### 7.0 A tese do produto: BATER o transcript nativo do Teams
Correção importante do PO: **o transcript nativo do Teams é porcaria** — nas reuniões reais "parece de analfabeto". Isso **não** nos atrapalha; é a **oportunidade**. O valor de venda do Galaxie AI é entregar uma **ata premium, muito melhor que a nativa**. Logo:

- **O produto = capturar o ÁUDIO BRUTO da reunião + rodar NOSSA transcrição de qualidade (ASR bom) + Claude (modelos mais recentes) pra gerar ata + To-Dos + identificação de falante.** É isso que supera o Teams.
- **O Graph transcript entra no doc como "por que existimos" (baseline ruim que batemos)** e, no máximo, como **fallback** quando não dá pra capturar áudio — **não** como dependência nem caminho principal.

O Teams abre **dentro do Navigator**, numa **WebView2 que NÓS controlamos** (`browser.rs`, `apps.ts` id `teams`) — isso ajuda na **identidade** de quem fala (DOM/active-speaker) e é uma via alternativa de captura. As fontes de captura, por prioridade:

### (c) Companion Delphi — WASAPI loopback + UI Automation — **caminho de 1ª classe (o motor)**
Um **helper nativo (Delphi 13)** — força real do ecossistema do Wagner — que conversa com o Galaxie por IPC (localhost/named pipe/arquivo). É o **coração da captura**:
- **Áudio bruto:** **WASAPI loopback** grava o **áudio do sistema** (tudo que sai pela placa = **todos** os falantes da reunião), independente do Teams e da qualidade dele. É a via **mais confiável e de maior qualidade** de "escutar a reunião" — e a única que nos dá o **sinal bruto** pra rodar ASR próprio.
- **ASR próprio:** o áudio vai pra um **motor de transcrição de qualidade** (ex.: Whisper-class local, ou ASR de provedor). É aqui que ganhamos do Teams — modelo melhor, pontuação, vocabulário, pt-BR decente.
- **Identidade:** **UI Automation (UIA)** lê a janela do Teams (nomes dos participantes, indicador de active-speaker) no nível do SO, mais estável que raspar DOM. Casa **nome ↔ turno de fala**.
- **IPC:** o companion streama áudio/parciais pro backend/app; o Galaxie roda ASR+Claude e devolve ata/To-Dos. Mesmo padrão que o Wagner já cogitou pros system tools/hardware monitor (serviços nativos ↔ Tauri).
- **Esforço:** **alto** (segundo executável, instalador, permissão de captura, pipeline de ASR, diarização). **Privacidade:** **a mais sensível** — gravamos áudio de reunião (§8): consentimento explícito e visível de todos, indicador de gravação, retenção mínima, **áudio bruto nunca persistido além do necessário**.
- **Veredito:** **é o motor do produto.** É o que entrega a **ata premium** que supera o Teams, funciona em **qualquer** reunião (com/sem transcrição nativa, até fora do Teams) e é onde o "cara, crachá e voz" fecha (áudio do WASAPI + nome do UIA).

### (b) Captura de mídia na WebView2 do Navigator — via alternativa/complementar
Como o Teams web roda no **nosso** WebView2, há duas coisas úteis:
- **Identidade em tempo real (forte):** injetar script + `MutationObserver` sobre os tiles de vídeo pra emitir "**quem está falando agora**" pelo realce de **active-speaker** + nome no DOM. Isso dá o "crachá" ao vivo **sem tocar em áudio**, e complementa o companion.
- **Captura de áudio pela webview (possível, mais frágil):** `getDisplayMedia` (com áudio de aba/sistema) ou `AudioWorklet` injetado podem capturar áudio — útil onde **não** dá pra instalar o companion Delphi (ex.: máquina sem admin). Mas esbarra em permissão de mídia, foco, e no DOM ofuscado/volátil do Teams (quebra a cada update).
- **Esforço:** médio (identidade) a alto (áudio confiável). **Privacidade:** média-alta se capturar áudio (mesmo trilho do §8).
- **Veredito:** **camada de IDENTIDADE de primeira** (active-speaker ao vivo) + **plano B de captura** onde o companion não puder rodar. A webview diz *quem*; o áudio (companion, de preferência) diz *o quê*.

### (a) Graph transcript nativo — **baseline que batemos / fallback só**
O Teams gera transcript/gravação quando ligados, e o Graph expõe: `GET /me/onlineMeetings/{id}/transcripts` + `.../content` (VTT com nome do falante), `.../recordings`, `attendanceReports`; o evento já dá `onlineMeeting.joinUrl` (`graph.rs`) que resolve o `onlineMeeting`.
- **Por que NÃO é a solução:** a **qualidade é ruim** (relato real do PO) — é justamente o que prometemos superar. Além disso exige **escopos novos** (`OnlineMeetingArtifact.Read.All`/`OnlineMeetingTranscript.Read.All`, parte **application-only**, **admin consent**, **hoje não concedidos**), **depende de transcrição LIGADA** e sai **só no fim** (não ao vivo).
- **Uso legítimo:** (1) **benchmark** — comparar nossa ata com a nativa mostra o ganho (argumento de venda); (2) **fallback** quando não há como capturar áudio (sem companion, sem permissão de mídia) e o transcript nativo existe; (3) **attendance report** como fonte barata da **lista de participantes** (nomes/e-mails) pra ancorar o "crachá".
- **Veredito:** **é o "por que existimos", não uma dependência.** Não construir o produto em cima disso.

### Comparação
| | (c) Companion Delphi | (b) WebView2 | (a) Graph transcript |
| --- | --- | --- | --- |
| Papel | **motor (áudio bruto + ASR próprio)** | identidade ao vivo + plano B de captura | baseline/benchmark + fallback |
| Áudio da reunião | **WASAPI loopback (robusto, alta qualidade)** | `getDisplayMedia` (frágil) | não capturamos — transcript pronto (ruim) |
| Qualidade da ata | **premium (nosso ASR + Claude)** | premium se capturar áudio | **ruim (nativa do Teams)** |
| Quem fala | UIA + active-speaker | **active-speaker ao vivo (DOM)** | nomes no VTT/attendance |
| Tempo real | **sim** | sim (identidade) | não (só no fim) |
| Esforço | alto | médio-alto | baixo |
| Fragilidade | média (UIA/WASAPI estáveis) | **alta (DOM muda)** | baixa (API), mas conteúdo ruim |
| Privacidade | **mais sensível (grava áudio)** | média-alta se áudio | melhor (dado já no M365) |
| Bloqueio | instalar companion + consentimento | permissão de mídia + DOM | escopos+admin consent+transcrição ligada |

### Recomendação faseada (honesta, sem fantasia)
1. **Fase B — MVP do meeting assistant = companion Delphi + ASR próprio + Claude.** Captura WASAPI loopback → nossa transcrição → **ata premium + To-Dos** (Claude Opus/Sonnet). Já entrega o diferencial que **supera o Teams**. Marcar o áudio bruto como efêmero (§8). Opcional: rodar o Graph transcript nativo em paralelo **só pra benchmark** ("olha o quanto melhoramos").
2. **Fase C — "Crachá" ao vivo.** Somar a **identidade** — active-speaker via WebView2 (b) e/ou UIA do companion — casando **nome ↔ turno de fala** na ata ("Fulano disse…", To-Dos atribuídos). É o "cara, crachá e voz" chegando de forma incremental, sem treinar biometria de voz.
3. **Fase D — Óculos completo / robustez.** Diarização voz→pessoa mais fina, captura pela WebView2 como plano B (máquinas sem companion), reuniões fora do Teams, tempo real fluido. Construir só depois que billing + Fases B/C estiverem provados. **Exige o trilho de privacidade/consentimento do §8 montado.**

**Sem fantasia:** o **áudio bruto de qualidade** é o pré-requisito de tudo — sem ele, ficamos reféns do transcript ruim do Teams. Por isso o **companion Delphi é 1ª classe, não gambiarra**. Diarização perfeita voz→pessoa é ML de verdade (Fase D); o atalho honesto pro "crachá" é **casar o nome da janela (UIA/active-speaker) com o turno de fala** (Fase C). O valor de 80% — **ata premium + To-Dos que batem o Teams** — sai já na **Fase B**.

---

## 8. Arquitetura, chaves, privacidade e segurança

**Onde a chave de IA vive:** **só no backend Galaxie** — nunca no cliente (público, PKCE, sem secret; `config.rs`). O desktop chama o backend Galaxie autenticado; o backend chama a Anthropic. É exatamente o padrão do `suzette-local-server.mjs` (proxy segura a chave + mede + cobra), agora como serviço hospedado, não local.

**Fluxo:**
```
Bridge/Navigator (Tauri, token Graph do usuário)
      │  1) request assinado (Bearer do usuário Galaxie / token de app)
      ▼
Backend Galaxie AI  ── valida tenant+usuário, checa saldo/cota, escolhe modelo
      │  2) chama Anthropic com a CHAVE (só aqui)
      ▼
Anthropic (Claude)  ── retorna + usage (tokens)
      │  3) mede tokens → custo → créditos, debita carteira, grava ledger
      ▼
resposta ao app (stream) + saldo atualizado
```

**Identidade do usuário no backend:** o app já prova identidade M365 (token delegado). O backend valida esse token (audience Graph → ou um token Galaxie próprio trocado por ele) e extrai `tenant_id` + `oid` (user id) → **carteira do tenant + cota do usuário**. Sem cadastro paralelo de senha (o app **nunca** vê senha — mantém o princípio do `auth.rs`).

**Privacidade (conteúdo sensível — regra dura):**
- Conteúdo de e-mail/reunião **transita** usuário→backend→provedor e **não é persistido em claro** além do necessário pra responder. **Nada de logar corpo de e-mail/transcript.**
- **Retenção mínima:** guardar métrica de uso (tokens, feature, custo) — **não** o conteúdo. Transcript/áudio de reunião: opt-in, com retenção configurável e purga.
- **Meeting assistant é opt-in e visível:** indicador de "IA ativa/gravando" pra todos; consentimento explícito (Fase D com áudio é o ponto mais crítico — checar base legal/consentimento de todos os participantes).
- **Data residency / provedor:** confirmar com o cliente se o conteúdo pode ir pra API da Anthropic (alguns tenants exigem tudo dentro do M365 → nesses, **só a Fase (a) Graph** serve, ou Azure OpenAI/Bedrock regional). **Decisão/checagem (Q5).**
- **Isolamento por tenant:** carteira, ledger e qualquer índice RAG **particionados por `tenant_id`**. Nunca cruzar dados entre organizações.
- Rodar varredura de segredos (AGENTS.md §6); a chave Anthropic nunca entra no repo nem no bundle.

**Provider default:** Claude (Haiku/Sonnet/Opus mais recentes, §5). Manter o provedor **abstraído** no backend (o Suzette já isola isso no server) pra permitir Azure OpenAI/Bedrock quando o cliente exigir residência.

---

## 9. Fatiamento incremental (feeds PO user stories)

**Slice A — Motor de créditos + E-mail assist (MVP do modelo de receita).**
Backend Galaxie AI (proxy Claude + medição + carteira por tenant + ledger); painel "Galaxie AI" na sidebar (grupo Galaxie) com **saldo, histórico e compra**; **trial grant** por tenant; ligar o **e-mail-assist real** no lugar do mock (`use-chat.ts`/`ai-kit.tsx`) — responder/reescrever/resumir 1 e-mail. *Prova que o app se paga.*

**Slice B — Distribuição + mais e-mail + meeting assistant PREMIUM (o diferencial).**
Compra de pacotes (gateway, §10 Q3) + **pool livre** com alertas de saldo; resumo de thread + triagem; **meeting assistant = companion Delphi (WASAPI loopback) + nossa ASR de qualidade + Claude** → **ata premium + To-Dos** que **batem o transcript nativo do Teams** (§7c). Trilho de privacidade/consentimento do §8 montado; áudio bruto efêmero. Opcional: Graph transcript nativo em paralelo **só como benchmark**. *O produto que justifica a venda.*

**Slice C — Master-user + cotas + "crachá" ao vivo + To-Dos/agenda.**
Registro do **master** (§4, híbrido) + **cota por usuário**; **identidade de falante** — active-speaker via WebView2 (7b) e/ou UIA do companion casando **nome↔fala** na ata; To-Dos da ata → Microsoft To Do/Planner (`Tasks.ReadWrite` já temos); briefing pré-reunião. *Governança + o "cara, crachá".*

**Slice D — Óculos completo + robustez + RAG.**
Diarização voz→pessoa mais fina; captura pela WebView2 como **plano B** (máquinas sem companion) e reuniões fora do Teams; tempo real fluido; busca semântica (RAG por tenant); assistente de documento. *A visão ambiciosa, sobre um billing e uma base de privacidade já provados.*

Ordem: **provar o billing barato (e-mail) antes de subir o custo (reunião)**; **captura de áudio própria (companion) é o motor desde o MVP de reunião** — o Graph transcript é só baseline/fallback; **ata premium antes de crachá ao vivo antes de óculos completo**. Cada slice é entregável e demoável, no ritmo de ~3 issues por release.

---

## 10. Decisões abertas pro Wagner (uma seção de perguntas)

1. **Unidade de crédito & modelo mental** — manter a mecânica do Suzette (custo bruto → crédito, margem no pacote, `N=25`)? Ou expor "créditos por feature" (P3) pra reunião custar visivelmente mais que e-mail?
2. **Escopos novos agora ou depois?** — pedir ao admin do cliente `Directory.Read.All`/`RoleManagement.Read.Directory` (master por papel M365, §4A) **e** `OnlineMeetingArtifact.Read.All`/`OnlineMeetingTranscript.Read.All` (transcript, §7a)? Ambos exigem admin consent e são o gargalo. Recomendo pedir **os de transcript** cedo (destravam a Fase B).
3. **Preço & pagamento** — qual tabela (P1 espelhar Suzette R$49/99/199, P2 maior, P3 por-feature)? Qual **margem-alvo** (Suzette embutiu 16–32×; reunião Opus custa ~R$3 de bruto por ata — 20× ali assusta)? Qual **gateway** (Stripe? PIX como o Suzette? WooCommerce?) e **moeda** (BRL? USD? multi)?
4. **Granularidade da distribuição** — cota por **usuário** (Suzette), por **grupo/departamento** M365, ou **pool livre**? Recomendo pool livre no MVP.
5. **Provedor & residência de dados** — Claude direto na API Anthropic ok para os clientes, ou algum tenant exige conteúdo **dentro do M365/região** (→ Azure OpenAI/Bedrock, ou só a Fase 7a)? Confirmar antes de mandar e-mail/transcript pra fora.
6. **Escopo do meeting assistant** — confirmar que o MVP (Fase B) é **companion Delphi + nossa ASR + Claude = ata premium** (bate o Teams), com o Graph transcript só como benchmark/fallback? Qual **motor de ASR** (Whisper-class local no companion? ASR de provedor?) e onde ele roda (companion, backend Galaxie)? Áudio bruto **efêmero** ok? "Crachá" ao vivo (Fase C) e voz biométrica (Fase D) na ordem proposta?
7. **Trial** — quantos créditos grátis por tenant na ativação (Suzette deu 250 por conta)? Por tenant ou por usuário?
8. **Nome/ícone** do item na sidebar (o grupo Galaxie usa nomes "galácticos": Bridge, Navigator, Comms, Astro, Pulsar — "Galaxie AI" combina, mas quer um codinome de marca?).

---

## 11. Resumo de uma linha
Galaxie AI = **carteira de créditos pré-pagos por tenant** (modelo Suzette transplantado, com números reais em §2), servida por um **backend que guarda a chave Claude, mede tokens e cobra**; **e-mail-assist** destrava primeiro (front já existe, mock); o **meeting assistant** é o diferencial — **captura de áudio bruto (companion Delphi WASAPI + WebView2) → nossa ASR de qualidade → Claude = ata premium que BATE o transcript porcaria do Teams** (que fica só como baseline/benchmark), evoluindo pro "cara, crachá e voz" via active-speaker/UIA; **master-user** ancorado no papel M365 + delegação no app; **privacidade e isolamento por tenant** (áudio de reunião efêmero e consentido) como trilho inegociável. Preço, escopo e residência de dados são decisões do Wagner (§10).
