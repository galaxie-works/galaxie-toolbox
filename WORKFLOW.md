# WORKFLOW.md — GALAXIE Toolbox (processo canônico do time)

> **Este documento é a ÚNICA fonte de verdade do processo de trabalho do time.**
> Ele **supersede/anula** qualquer outra descrição de workflow — inclusive as seções de processo do `AGENTS.md` e os `*Context.md`/identidade de cada agente onde conflitarem. Em caso de divergência, **este arquivo vence**. Atualizado 2026-08-15.

---

## 1. Time e raias (anti-colisão)

| Agente | Papel / raia |
|---|---|
| **Wagner** | **PO** — dono do produto; escreve/aprova épicos e US; testa em runtime; corta release. |
| **Polaris** | **Orquestrador + integrador + dono do board.** Move cards, integra PRs por merge local, coordena o time. |
| **Confucius** | Dev — **Rust / backend / Remote / auth / config**. |
| **Vega** | Dev — **frontend / Bridge / preview / Explorer-UI**. |
| **Sirius** | Dev — **UX-detail / i18n / ícones / nomenclatura / atalhos / command**. |
| **Lúmen II** | **QA** — gate de runtime/verificação antes de o PO pegar. |
| **Altair** | **Software architect** — decisões técnicas transversais, seams, contratos, segurança de fronteira. Desenha/recomenda (doc), **não coda feature**. |

**Comunicação inter-agente é SÓ pela issue #133** (a war room). Zero `send_message` (congela agente). Todo agente lê a #133 todo tick, anuncia entregas lá, tira dúvida lá (com o Polaris, não direto com o Wagner).

---

## 2. Hierarquia Scrum: ÉPICO → US → TASK

| Nível | O que é | Dono |
|---|---|---|
| **ÉPICO** | Issue com **`ÉPICO`** na descrição. Grande demais pra 1 PR. | **PO** (Wagner; ou Polaris via skill `agile-product-owner`) |
| **US** (User Story) | O épico **fatiado em issues-filhas** (sub-issues), **cada uma com história + DoD + critérios de aceite (Given/When/Then)**. | **PO** |
| **TASK** | As **PRs**. Cada PR **`Closes` uma US**. | **Devs** |

**A US TEM que existir ANTES da task/PR.** A história diz *o que desenvolver pra resolver o quê*, com AC/DoD. Sem ela, a PR resolve o que o dev bem entender (sem DoD/AC), a gente fica refém das entregas e o **release notes** vira caos (PR sem issue; épico com 0 US e mil PRs).

**Regras:**
- Antes de trabalhar uma fatia, **existe a US-filha** (sub-issue do épico) com história+AC+DoD. O Polaris escreve (via `agile-product-owner`) **OU** o dev escreve quando tem autonomia — mas **tem que existir**.
- **Proibido PR de fatia sem US.** O Polaris **barra na integração** um PR que não fecha uma US e cobra a criação da US antes.
- US pequena o suficiente = 1 PR resolve. US grande = vira épico e fatia de novo.

---

## 3. Board (GitHub Projects #3) — colunas e quem move

`galaxie-works` é conta **USER** (não org). Board é **GraphQL**; resto **REST** (evita rate limit). PAT via `GH_TOKEN`.

**Fluxo:** `Backlog → Ready → In progress → In review → QA Approved → PO Approved → Done → Released to Production` (+ `Rejected`).

| Coluna | Significado | Quem move pra cá |
|---|---|---|
| **Backlog** | Não priorizado. | PO/Polaris |
| **Ready** | Escopado, pronto pra pegar (US com AC). | PO/Polaris |
| **In progress** | Sendo trabalhado. | Dev ao começar |
| **In review** | Entregue, precisa de gate. | **Polaris ao integrar um item completo** |
| **Rejected** | Reprovado (QA ou PO). | Lúmen ou Wagner |
| **QA Approved** | Lúmen aprovou; **aguardando o olho do PO**. | **Lúmen** (In review → aqui) |
| **PO Approved** | Wagner validou em runtime. | **Wagner** |
| **Done** | Concluído/aprovado, **ainda não numa versão cortada**. | Polaris |
| **Released to Production** | Shipou numa versão publicada. | **Polaris ao cortar release** |

---

## 4. Gate de QA (Lúmen II) — dirigido por COLUNA

1. **A Lúmen gata SÓ o que está em `In review`.** Nunca `In progress`.
2. Ela move **In review → QA Approved** (passou) ou **Rejected** (reprovou). Só isso com o card.
3. Se ela **não fecha o runtime sozinha** (cega a pixel/cross-layer), move pra **QA Approved COM nota "runtime/visual pendente PO"** — o Wagner testa a partir de QA Approved. **Não existe estado "checkpoint".**
4. **A Lúmen NUNCA pinga o Wagner** (direto ou #133) pra testar. O Wagner sabe que precisa olhar quando (a) a issue está em **QA Approved** (onde ele SEMPRE pega), ou (b) o **Polaris fala com ele**. A **coluna** é a comunicação.
5. **Fatia = US-filha** → percorre as colunas sozinha e vai pro olho do Wagner **em QA Approved**. O épico fica In progress até as US fecharem. Não se roteia fatia órfã pro Wagner.

---

## 5. PR e integração

- **Todo PR traz `Closes #<US>`** no corpo (1ª linha). O **default branch é `feat/bridge-email-client`**, então `Closes` **preenche a caixa Development** da issue **e auto-fecha** a US no merge.
- **Exceção `Ref` (merge ≠ done):** se o item precisa de **gate de runtime/QA DEPOIS de integrar** (ex.: preview no empacotado, risco tipo #873), o PR usa **`Ref #NNN`, NÃO `Closes`** — senão a issue fecha antes da prova. Design/spec de issue aprovada também vai com `Ref`.
- **Devs abrem PR; NÃO mergeiam.** **O Polaris integra** por **merge local** (worktree off `feat`, `git merge --no-ff`, gate, `push HEAD:feat`, move o card, limpa a worktree). Nunca `gh pr merge`.
- **Gate de integração (Polaris):** `pnpm exec tsc -b` (exit 0) · `pnpm test` (`node --test`) · **`cargo check` SEM env OpenSSL** quando mexe em Rust (pega str0m/openssl vazando). CRLF: `core.autocrlf=true` na worktree.

---

## 6. Definition of Done

**VERDE ≠ PRONTO.** DoD = **funciona com dado real** + cada **critério de aceite** da US satisfeito + gate verde + **i18n pt/en** (toda string user-facing no `t.*`) + sem UI inventada (usar o componente de referência do registry, não espelhar à mão). Code review + tsc/cargo é necessário, **não suficiente**.

---

## 7. Release

Ao cortar release: bump de versão nos **4** lugares (`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `Cargo.lock` entry `name="app"`) → notas minuciosas → **tag `vX.Y.Z` na `feat`** (o `release.yml` dispara no push da tag, builda/assina/publica no repo de distribuição). Os itens shipados vão **Done/PO Approved → Released to Production**.

---

## 8. Protocolo de entrega (todos)

Ao entregar: **comenta a issue** + **posta na #133** + **move o card**. Nunca idle silencioso; raia zerada = pinga o Polaris ("livre, próximo?"). Conferir-o-existente **antes** de construir/recomendar (ler o código real, citar arquivo:linha).
