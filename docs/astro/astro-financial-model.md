# Astro — Modelo Financeiro & de Monetização

> 📌 **Snapshot de discovery (2026-07/08). Estado atual: NÃO construído** — modelo proposto para o Astro (#180/#196), aguardando go/no-go do PO. Números são projeção, não realizado.

> Camada de IA pré-paga do **GALAXIE**. Backend no **VPS Hostinger do Wagner** (fixo, já pago), provider **Claude (Anthropic API)**, meeting-assistant com **ASR própria**. Este documento fecha unit economics, modelo de crédito, tabela multi-moeda, gateway, trial e viabilidade.
>
> **Status:** proposta financeira fechada (números concretos). Preços de provider e câmbio são *inputs configuráveis* — confirmar na hora de implementar (mudam). Referências reais: legado Suzette (`suzette-ai-credits/pricing.ts`), discovery `docs/astro/galaxie-ai-discovery.md`.

---

## 0. TL;DR (o que decidir e por quê)

1. **Unit economics headline:** um e-mail curto custa **~R$0,016** de provider (30 créditos); uma **ata de reunião premium custa ~R$0,66** (1.225 créditos) — **~40× mais cara** que o e-mail e **~120× mais cara** que uma triagem de inbox. A ata (Opus + ASR) é a única feature "cara"; todo o resto é ruído no custo.
2. **Modelo de crédito (sem o `N=25` do Suzette):** **1 crédito Astro = US$0,0001 de custo real de provider**. O débito é **o custo real medido** (tokens Claude + ASR), feature-agnóstico, linear. A **margem vive no preço de compra do crédito** (vendido a ~US$0,0009 → **~89% de margem**). Sem "ação média" arbitrária.
3. **Preço:** 4 pacotes multi-moeda por geo (BRL/USD/EUR), ancorados nos price-points do Suzette (R$49/99/249/999). Margem **86–90%** em todos, mesmo com desconto de volume.
4. **Gateway:** **Stripe** como primário (multi-moeda nativa + PIX + Checkout de baixíssima manutenção), com rota de fuga para **Merchant-of-Record** (Paddle/Lemon Squeezy) quando o custo de compliance fiscal cross-border (VAT/nota fiscal) passar a doer.
5. **Trial que pesca:** **"Astro Piloto" 14 dias, por tenant**, com **cotas diárias por feature** (não um saco de créditos) + **ata premium capada em 2 usos totais**. Um "bombado" não queima o wow; o usuário casual forma hábito e é fisgado em 2 semanas. Custo máximo do trial ao Galaxie ≈ **US$6/tenant**.
6. **Veredito:** **paga-se com folga.** Break-even de custo fixo ≈ **R$370/mês de receita** (~4 pacotes Pro). A arquitetura de crédito = custo real **blinda a margem** contra o risco #1 (usuário só faz ata cara): o cliente sempre paga o custo real ×10, seja qual for o mix de features.

---

## 1. Inputs de custo (confirmar sempre — mudam)

### 1.1 Preços Claude (Anthropic API, jul/2026)
Por milhão de tokens (Mtok). **Confirme na página oficial na implementação.**

| Modelo | Input | Output | Cache read (10%) | Uso no Astro |
| --- | --- | --- | --- | --- |
| **Haiku 4.5** | US$1,00 | US$5,00 | US$0,10 | triagem, e-mail curto, extração de To-Dos, classificação |
| **Sonnet 5** | US$3,00¹ | US$15,00¹ | US$0,30 | **default do e-mail-assist**, resumo de thread, ata "standard" |
| **Opus 4.8** | US$5,00 | US$25,00 | US$0,50 | **ata premium**, síntese executiva pesada |

¹ Sonnet 5 em preço introdutório **US$2/US$10 até 31/08/2026**; padrão US$3/US$15 a partir de 01/09. Modelei com o padrão (conservador). Opus 4.8 "Fast Mode" = 2× (US$10/US$50) — **não usar em ata** salvo pedido explícito. Batch API = −50%; prompt caching = −90% no input cacheado (modelar desde o dia 1 — system prompt + assinatura repetem).

### 1.2 ASR (meeting-assistant)
- **Própria, self-hosted no VPS Hostinger (Whisper-class):** custo **marginal ~US$0** — é o VPS fixo já pago. Esta é a premissa base (decisão do Wagner).
- **Benchmark de mercado (caso precise offload por CPU-bound):** Deepgram Nova-3 batch **US$0,0043/min (US$0,26/h)**; AssemblyAI Universal-2 **US$0,15/h** (+diarização US$0,02/h). Mesmo no pior caso (Deepgram), a ata continua com **>80% de margem** — a fonte de ASR é flexível sem quebrar o modelo.

### 1.3 VPS + câmbio (custos fixos / config)
- **VPS Hostinger:** fixo ~**US$30–60/mês** (já pago). Entra como **custo fixo**, não por-ação. ASR self-hosted amortizado aqui.
- **Câmbio (config, ilustrativo jul/2026):** `USD→BRL = 5,40` · `USD→EUR = 0,92`. Herdar o `operationalUsdBrlRate` configurável do Suzette (`pricing.ts` já tem o campo). Revisar mensal.

---

## 2. Unit economics por feature

Perfis de token realistas (input/output). Custo = fórmula do Suzette (`calculateOpenAiCost`), agnóstica de provider — só troca a tabela.

| Feature | Modelo | in tok | out tok | **Custo provider** (USD) | **Custo** (BRL) | **Créditos** (=custo/US$0,0001) | Valor ao cliente² (BRL) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Triagem de 1 e-mail | Haiku 4.5 | 600 | 80 | US$0,0010 | R$0,005 | **10 cr** | R$0,05 |
| **E-mail curto** (responder) | Haiku 4.5 | 1.200 | 350 | US$0,0030 | R$0,016 | **30 cr** | R$0,14 |
| E-mail c/ tom / reescrita | Sonnet 5 | 1.800 | 600 | US$0,0144 | R$0,078 | **144 cr** | R$0,65 |
| Resumo de thread longa | Sonnet 5 | 8.000 | 800 | US$0,0360 | R$0,194 | **360 cr** | R$1,62 |
| **Ata de reunião 60min** (premium) | **ASR + Opus 4.8** | 12.000 | 2.500 | **US$0,1225**³ | **R$0,66** | **1.225 cr** | **R$5,51** |

² Valor ao cliente = créditos × preço-de-venda do crédito no pacote **Pro** (R$0,0045/cr). Varia com o pacote.
³ ASR self-hosted no VPS = ~US$0 marginal. Ata single-pass 60 min. **Ata longa / refinada (2 passes / 2h) escala linear → ~US$0,30–0,44.** Com ASR via Deepgram somaria ~US$0,26.

### 2.1 A mensagem que importa
**A ata é ordem de grandeza mais cara que qualquer outra feature.** 1 ata (1.225 cr) = **~40 e-mails curtos** = **~120 triagens**. Todo o custo real do Astro está concentrado na reunião (Opus). É por isso que:
- O e-mail-assist pode ser **quase de graça** no trial (forma hábito sem sangrar).
- A ata precisa de **piso de créditos alto** e **estimativa de custo antes de rodar** (evita sticker shock em reunião de 2h).
- **Roteamento por tarefa não é luxo, é sobrevivência de margem:** mandar e-mail curto pro Opus custaria ~5× mais sem ganho de valor.

---

## 3. Modelo de crédito (o coração)

### 3.1 Definição (sem `N=25` arbitrário)
O Suzette definia `1 ação média = 25 créditos` (`SUZETTE_CREDIT_UNIT_BRL = custoAçãoMédia / 25`) — um `N` arbitrário que **desacopla** crédito de custo real. **Wagner descartou.** No Astro:

> **1 crédito Astro = US$0,0001 de custo real de provider.**
> `créditos_debitados = ceil( custo_real_provedor_usd / 0,0001 )`

O crédito **é** a unidade de custo real, linear e feature-agnóstica. Uma ata que custa US$0,1225 debita 1.225 créditos — sempre, sem tabela de "ação média". A medição lê `usage.input_tokens / cached_tokens / output_tokens` da resposta real da Anthropic (idêntico ao `server` do Suzette) + minutos de ASR se for API.

### 3.2 Onde mora a margem
A margem **não** está no débito (que é custo puro) — está no **preço de compra do crédito**:

> Custo nosso por crédito = **US$0,0001**. Vendido (bundle) a **~US$0,0009**. → **Margem ≈ 89%.**

Isto reproduz o princípio do Suzette (`SUZETTE_DEFAULT_MARKUP_MULTIPLIER = 1` na medição, margem no pacote) **mas com o crédito honesto** (= custo real, não 25× encolhido).

**Consequência estratégica (blindagem de margem):** como o débito é custo real ×1 e a venda é custo ×~9, a margem % é **a mesma qualquer que seja o mix de features**. Cliente que só faz ata cara paga muito crédito → margem 89% intacta. Cliente que só faz e-mail paga pouco → margem 89% intacta. **Não há como o mix de uso quebrar a economia.** (Diferente de "ilimitado por R$X", que sangra com power-user.)

### 3.3 Pisos por feature (herdar do Suzette)
`SUZETTE_FEATURE_MINIMUM_CREDITS` cobra o mínimo mesmo se o custo bruto for menor. Traduzir:
- `email_assist_curto: 20` · `email_tom: 50` · `resumo_thread: 200` · `triagem: 5` · **`ata_premium: 800`** (piso alto — reunião nunca sai "barata demais"). Protege contra sub-cobrança em respostas curtas do provider.

### 3.4 Como compra e como debita
- **Compra:** pacotes de crédito pré-pagos (recarga), não assinatura obrigatória. Pool no tenant (`AiWallet { tenantId, balanceCredits }`), cota por usuário definida pelo master (`AiUserBudget`) — herdado do Suzette. Idempotência de compra (`creditedIntentIds`) **obrigatória** (é dinheiro).
- **Débito:** gate duplo (saldo do tenant **E** cota do usuário) → chama Claude → mede tokens → `créditos = ceil(custoReal/0,0001)`, aplica piso → debita carteira + incrementa `usedCredits`. Grava ledger `usage` com `costUsd/costBrl/creditsCharged/model/feature`.
- **Cache = bônus ao cliente:** prompt caching derruba o custo real → debita menos créditos → cliente paga menos, **nossa margem % não muda**. Ótimo argumento de retenção.

---

## 4. Tabela de preços multi-moeda

Preço por **geo do cliente** (psychological pricing, não conversão FX crua). Todos com margem 86–90%.

| Pacote | Créditos | **BRL** | **USD** | **EUR** | R$/cr | ≈ e-mails curtos | ≈ atas premium |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Astro Start** | 10.000 | **R$49** | **US$9** | **€9** | R$0,0049 | ~330 | ~8 |
| **Astro Pro** ⭐ | 22.000 | **R$99** | **US$19** | **€19** | R$0,0045 | ~730 | ~18 |
| **Astro Turbo** | 60.000 | **R$249** | **US$49** | **€45** | R$0,00415 | ~2.000 | ~49 |
| **Astro Scale** | 260.000 | **R$999** | **US$199** | **€189** | R$0,00384 | ~8.600 | ~210 |

⭐ "Melhor custo-benefício" (espelha o `pro` do Suzette).

### 4.1 Margem por pacote (verificação)
Custo nosso/crédito = US$0,0001 (R$0,00054 @ 5,40). Menor pacote (mais barato/crédito no Scale):

| Pacote | Preço/cr (BRL) | Custo/cr | **Margem** |
| --- | --- | --- | --- |
| Start | R$0,0049 | R$0,00054 | **89%** |
| Pro | R$0,0045 | R$0,00054 | **88%** |
| Turbo | R$0,00415 | R$0,00054 | **87%** |
| Scale | R$0,00384 | R$0,00054 | **86%** |

**Break-even de uso: nunca** — cada crédito é vendido com ~8× de folga sobre o custo. O único break-even relevante é o de **custo fixo** (§6).

---

## 5. Gateway — recomendação

**Requisito do Wagner:** o mais fácil de manter, rápido, multi-moeda por geo.

### 5.1 Recomendação: **Stripe** (primário)
| Prós | Contras |
| --- | --- |
| Multi-moeda nativa (135+ moedas, apresenta preço local) | Cross-border: +1,5% (cartão int'l) +1% (conversão FX) |
| **Checkout / Payment Links = quase zero código pra manter** | **Você é o merchant of record** → VAT-UE / nota-fiscal-BR por sua conta (a real manutenção) |
| **PIX suportado no Brasil** + cartão + wallets | Métodos locais LatAm mais finos que um especialista |
| Idempotência nativa (casa com `creditedIntentIds` do Suzette) | — |
| Webhooks robustos pra creditar carteira; melhor doc/manutenção do mercado | — |
| Ótimo pra **recarga one-time** (não força assinatura) | — |

**Por que primário:** recarga pré-paga = compra one-time simples; Stripe Checkout hospedado praticamente não tem superfície de manutenção; multi-moeda + PIX cobrem o requisito. Taxa ~3–5% é irrelevante contra 87% de margem.

### 5.2 Rota de fuga: **Merchant-of-Record** (Paddle / Lemon Squeezy / Polar)
Quando o custo de **compliance fiscal cross-border** (VAT-UE, impostos globais) virar a dor de manutenção real:
- **Prós:** o MoR **é** o vendedor legal → recolhe VAT/imposto no mundo todo por você = **a menor manutenção possível** pra venda internacional; multi-moeda embutida; uma integração.
- **Contras:** headline maior (~5% + US$0,50); **PIX/Brasil mais fraco**; menos controle; payout com atraso.

**Decisão:** começar **Stripe** (Astro nasce Brasil-cêntrico — herança BRL/PIX do Suzette — e o modelo é recarga simples). Documentar migração pra MoR como gatilho quando a fatia UE/global crescer e o overhead de VAT superar a economia de taxa do Stripe. **Não** construir os dois de cara.

---

## 6. Trial que pesca (sem ser abusável)

**Diretriz do Wagner:** *"não pode ser ejaculação precoce que um bombado queima os tokens; o usuário precisa ser pescado."* → O trial **não pode ser um saco de créditos** que um power-user esvazia no dia 1.

### 6.1 Desenho: **"Astro Piloto" — 14 dias, por tenant**
Não é saldo drenável. São **cotas por feature que recarregam diariamente**, com o "wow" caro capado no total.

| Feature | Limite no trial | Racional |
| --- | --- | --- |
| Triagem + e-mail curto (Haiku) | **15/dia** (recarrega) | barato, alta frequência → **forma hábito**, volta todo dia |
| E-mail c/ tom + resumo thread (Sonnet) | **5/dia** (recarrega) | valor médio, dá pra sentir o ganho |
| **Ata premium (Opus)** | **2 no total** (não diário), 60 min cada | o **wow** que bate o Teams — suficiente pra fisgar, **impossível de rodar uma operação de graça** |

**Anti-abuso (empilhado):**
- **Escopo = tenant M365 (`tenant_id`), não e-mail/usuário** → não dá pra farmar criando usuários; exige tenant corporativo real (sem tenant de consumidor grátis).
- **1 trial por `tenant_id` pra sempre.**
- **Cap por usuário dentro do trial:** nenhum usuário consome >40% da cota diária → **um "bombado" não come o trial do time** (reusa o mecanismo de cota por usuário do Suzette).
- **A alavanca cara (minutos de ata) é capada por design** (2 atas, 60 min) — o teto de custo é pequeno e conhecido.
- **Nunca mostrar "saldo drenável"** no trial — mostrar **"X de Y usos hoje"** por feature. Nunca dá a sensação de carteira queimando.

### 6.2 Gatilhos de conversão (a fisgada)
- **Depois da 1ª ata:** side-by-side **Astro vs transcript nativo do Teams** ("olha o que você ganhou") + CTA de compra.
- **Cota diária esgotada:** *"acabou por hoje — desbloqueie ilimitado com créditos"* (fricção positiva: quer mais → compra).
- **Dia 10–14:** resumo de ROI da org (*"sua equipe gerou 8 atas e 60 e-mails, ~X horas economizadas"*) + **desconto de 1ª compra** (ex.: +20% créditos no 1º pacote em 7 dias).
- **Master recebe nudge** (e-mail/dashboard) com o ROI agregado do tenant — é quem assina o cheque.

### 6.3 Custo do trial ao Galaxie (teto)
Pior caso, tenant que satura tudo por 14 dias:
- E-mail curto: 15/dia × US$0,003 × 14 = **US$0,63**
- Sonnet (tom+thread): 5/dia × ~US$0,025 × 14 = **US$1,75**
- Ata: 2 × US$0,1225 = **US$0,25**
- **Total ≈ US$2,63/tenant** (self-host ASR) · **~US$6/tenant** com folga p/ ASR-API.

**Bounded e barato** — dá pra oferecer sem medo justamente **porque não é um saco de tokens**. A ata (o wow) é capada; o e-mail (o hábito) recarrega mas é centavos.

---

## 7. Viabilidade — o app se paga?

### 7.1 Estrutura de contribuição
Por R$1 de receita: margem bruta ~87% (Claude ~13%) − gateway ~5% ≈ **R$0,82 de contribuição**. Custo fixo: VPS ~R$300/mês (já pago).

**Break-even de custo fixo ≈ R$300 / 0,82 ≈ R$370/mês de receita** = **~4 pacotes Pro** ou ~7 Start. Trivial.

### 7.2 Cenários (orgs × uso × ARPU)

| Cenário | Orgs | Gasto médio/org·mês | Receita/mês | Margem bruta (87%) | − Gateway 5% | − VPS | **Lucro/mês** |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Conservador** | 10 | R$99 | R$990 | R$861 | −R$50 | −R$300 | **~R$511** |
| **Moderado** | 50 | R$150 | R$7.500 | R$6.525 | −R$375 | −R$300 | **~R$5.850** (~R$70k/ano) |
| **Org grande única** | 1 (25 users) | R$1.556⁴ | R$1.556 | R$1.354 | −R$78 | (rateio) | **~R$1.276** |
| **Skew total em ata** | 50 | R$150 (só Opus) | R$7.500 | **R$6.525** | −R$375 | −R$300 | **~R$5.850** |

⁴ 25 usuários × (100 e-mails curtos 30cr + 8 atas 1.500cr) = 375.000 cr/mês × R$0,00415 (Turbo) = R$1.556; custo R$202.

**O cenário "skew em ata" tem a MESMA margem** que o "moderado" — prova a blindagem do §3.2: o modelo de crédito = custo real garante 87% **independente do mix**. Este é o achado central de viabilidade.

### 7.3 Riscos e mitigação (honesto)

| Risco | Severidade | Mitigação |
| --- | --- | --- |
| **Ata Opus estoura custo** (2h, multi-pass, Fast Mode) | Média | Piso alto + **estimativa de créditos antes de rodar**; "Ata Standard" (Sonnet, −40% custo) vs "Ata Premium" (Opus); cap de minutos; alerta ao master em ata anômala. Cliente paga o custo real → margem segura, risco é **só de sticker shock**. |
| **Abuso / trial farming** | Baixa | Tenant-scoped + M365 real + ata capada em 2. Teto ~US$6/tenant. |
| **Câmbio (pago Anthropic em USD, cobro local)** | Baixa | `operationalUsdBrlRate` configurável + revisão mensal. 87% de margem = BRL teria que desvalorizar ~85% pra zerar. |
| **Manutenção fiscal cross-border** (VAT/nota) | Média | Stripe agora, MoR quando a fatia global doer (§5.2). É a única manutenção real do gateway. |
| **ASR self-host CPU-bound** (VPS sem GPU) | Média | Fallback Deepgram US$0,26/h → ata ainda >80% margem. Fonte de ASR é plugável. |

### 7.4 Veredito
**O app se paga com folga e escala com margem estável.** O custo fixo é coberto por ~4 clientes; a margem de 86–90% resiste a qualquer mix de uso porque **o crédito debita custo real**. O único ponto de atenção operacional é a **ata premium** (Opus) — não pela margem (que é segura), mas por **UX de custo** (estimar antes, oferecer tier Standard, capar minutos) e por **compliance fiscal** quando internacionalizar. Nenhum desses é bloqueador; são refinamentos.

---

## 8. Resumo de uma linha
Astro = **carteira de créditos pré-pagos por tenant** onde **1 crédito = US$0,0001 de custo real** (débito = custo medido, margem ~89% no preço de compra, **sem o `N=25` do Suzette**); e-mail-assist é centavos (hábito), **ata premium com Opus+ASR é a única feature cara (~40× o e-mail)**; **Stripe** entrega multi-moeda+PIX com manutenção mínima; o **trial "Astro Piloto"** fisga com cotas diárias por feature e ata capada em 2 (à prova de bombado, teto ~US$6/tenant); e a economia **se paga a ~R$370/mês** com margem blindada contra o mix de uso.

---

### Fontes de custo consultadas (jul/2026 — confirmar na implementação)
- Anthropic Claude API pricing 2026 — Opus 4.8 US$5/US$25, Sonnet 5 US$3/US$15 (intro US$2/US$10), Haiku 4.5 US$1/US$5; cache −90%, batch −50%. (finout.io, cloudzero.com, metacto.com)
- ASR: Deepgram Nova-3 batch US$0,0043/min; AssemblyAI Universal-2 US$0,15/h; self-host Whisper ~US$0 marginal. (deepgram.com, assemblyai.com)
- Gateway: Stripe multi-moeda +1,5%/+1% cross-border, PIX BR; MoR (Paddle/Lemon Squeezy/Dodo) ~5% com VAT incluído. (dodopayments.com, transactbridge.com)
- Legado Suzette (números reais): `onlychefs-4-front/src/app/features/suzette-ai-credits/pricing.ts` + `mock-data.ts` (pacotes R$49/99/199, trial 250 cr, markup 16–32×).
</content>
</invoke>
