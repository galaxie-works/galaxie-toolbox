# WORKFLOW.md — GALAXIE Toolbox (processo canônico do time)

> **Este documento é a ÚNICA fonte de verdade do processo de trabalho do time.**
> Ele **supersede/anula** qualquer outra descrição de workflow — inclusive as seções de processo do `AGENTS.md` e os `*Context.md`/identidade de cada agente onde conflitarem. Em caso de divergência, **este arquivo vence**. Atualizado 2026-08-17.

---

## 1. Time e raias (anti-colisão)

| Agente | Papel / raia |
|---|---|
| **Wagner** | **PO** — dono do produto; escreve/aprova épicos e US; testa em runtime; corta release. |
| **Polaris** | **Orquestrador + integrador + dono do board.** Move cards, integra PRs por merge local, coordena o time. |
| **Confucius** | Dev — **Rust / backend / Remote / auth / config**. |
| **Vega** | Dev — **frontend / Bridge / preview / Explorer-UI**. |
| **Sirius** | Dev — **UX-detail / i18n / ícones / nomenclatura / atalhos / command**. |
| **Lúmen** (Codex) | **QA backend** — Rust, `services/`, segurança, CI/CD, contratos de crate. |
| **Lúmen II** (Claude) | **QA frontend** — React/TS, UX-detalhe, a11y, i18n, testes de componente. |
| **Orion** (Codex) | Dev — **Graph / People / Agenda + cobertura de teste Rust**. |
| **Altair** | **Software architect** — decisões técnicas transversais, seams, contratos, segurança de fronteira. Desenha/recomenda (doc), **não coda feature**. |

**Comunicação inter-agente é SÓ pela issue #133** (a war room). Zero `send_message` (congela agente). Todo agente lê a #133 todo tick, anuncia entregas lá, tira dúvida lá (com o Polaris, não direto com o Wagner).

---

## 2. Hierarquia Scrum: ÉPICO → US → TASK

| Nível | O que é | Dono |
|---|---|---|
| **ÉPICO** | Issue com **`ÉPICO`** na descrição. Grande demais pra 1 PR. | **PO** (Wagner; ou Polaris via skill `agile-product-owner`) |
| **US** (User Story) | O épico **fatiado em issues-filhas** (sub-issues), **cada uma com história + DoD + critérios de aceite (Given/When/Then)**. | **PO** |
| **TASK** | As **PRs**. Cada PR aponta pra **uma US**: `Closes` quando a entrega **fecha** a US; `Ref` quando é **fatia** de uma US que continua aberta (ver §4.2 e §5). | **Devs** |

**A US TEM que existir ANTES da task/PR.** A história diz *o que desenvolver pra resolver o quê*, com AC/DoD. Sem ela, a PR resolve o que o dev bem entender (sem DoD/AC), a gente fica refém das entregas e o **release notes** vira caos (PR sem issue; épico com 0 US e mil PRs).

**Regras:**
- Antes de trabalhar uma fatia, **existe a US-filha** (sub-issue do épico) com história+AC+DoD. O Polaris escreve (via `agile-product-owner`) **OU** o dev escreve quando tem autonomia — mas **tem que existir**.
- **Proibido PR sem US.** O Polaris **barra na integração** um PR que não referencia US alguma (nem `Closes`, nem `Ref`) e cobra a criação da US antes. **Fatia com `Ref` é legítima** — o que é proibido é PR órfã.
- US pequena o suficiente = 1 PR resolve. US grande = vira épico e fatia de novo.

---

## 3. Board (GitHub Projects #3) — colunas e quem move

`galaxie-works` é conta **USER** (não org). Board é **GraphQL**; resto **REST** (evita rate limit). PAT via `GH_TOKEN`.

**Fluxo:** `Backlog → Ready → In progress → In review → Done → QA Approved → PO Approved → Released to Production` (+ `Rejected`).

> ⚠️ **Semântica corrigida pelo PO em 2026-08-17.** Palavras dele: *"Released to production = teve corte de versão · **done = vc fez merge pra qa validar** · qa approved = eu olho · po approved = pronto pra cortar versão"*. A descrição anterior desta seção (que mandava o item **seguir em In review** depois de integrar) **está anulada** — ver §4.0, que é a fonte de verdade da semântica.
>
> 🤖 **Automação do Projects: "PR merged → In Review".** Ela existe pra quando o merge fecha o PR. Com o merge **local** do Polaris ela é intermitente, então **o Polaris move o card à mão pra `Done` ao integrar** — não confiar na automação. **NÃO reativar "closed/merged → Done"** (pularia o gate de QA).

| Coluna | Significado | Quem move pra cá |
|---|---|---|
| **Backlog** | Não priorizado. | PO/Polaris |
| **Ready** | Escopado, pronto pra pegar (US com AC). | PO/Polaris |
| **In progress** | Sendo trabalhado. | Dev ao começar |
| **In review** | **PR aberto, aguardando a integração do Polaris.** É a **fila do Polaris** — QA não toca. | **Dev ao abrir o PR** |
| **Rejected** | Reprovado (QA ou PO). | QA ou Wagner |
| **Done** | **O Polaris integrou no `feat`** — pronto pra QA gatar. | **Polaris ao integrar** |
| **QA Approved** | QA aprovou; **aguardando o olho do PO**. | **QA** (Done → aqui) |
| **PO Approved** | Wagner validou em runtime. | **Wagner** |
| **Released to Production** | `PO Approved` **E** provado dentro de uma tag publicada. | **Polaris ao cortar release** |

### IDs para automação (`gh project item-edit` / GraphQL)

Fonte única. Recolhidos do board real (Projects **#3**, owner `galaxie-works`) — conferidos em 2026-08-16.

- **Project:** `PVT_kwHOD_4JN84BedaN` · **campo Status:** `PVTSSF_lAHOD_4JN84BedaNzhY3dus`

| Coluna | option-id |
|---|---|
| Backlog | `f75ad846` |
| Ready | `61e4505c` |
| In progress | `47fc9ee4` |
| In review | `df73e18b` |
| Rejected | `7389544e` |
| QA Approved | `33a59ba9` |
| PO Approved | `9ef1bdac` |
| **Done** | `98236657` |
| **Released to Production** | `a9368698` |

> ⚠️ **`Done` e `Released to Production` são colunas SEPARADAS.** A tabela antiga (no `AGENTS.md`) trazia 8 entradas e chamava o `98236657` de *"Done - Released"* — nome que **não existe** no board. Quem copiasse dali escrevia em `Done` achando que estava publicando, e não tinha id nenhum pra `Released to Production`. Por isso a tabela agora vive **só aqui**.
>
> Reconferir com `gh project field-list 3 --owner galaxie-works` se o board mudar.

---

## 4. Gate de QA — dirigido por COLUNA

### 4.0 Semântica das colunas (definida pelo PO, 2026-08-17)

Cada coluna tem **um significado e um dono do próximo passo**. Esta é a fonte de verdade; qualquer outro doc que divergir está errado.

| Coluna | Significa | Quem age em seguida |
|---|---|---|
| `Backlog` | não priorizado | PO / Polaris |
| `Ready` | pronto pra pegar | o dev da raia |
| `In progress` | sendo codado | o dev |
| **`In review`** | **PR aberto, aguardando integração** | **Polaris** (mergeia) |
| **`Done`** | **Polaris mergeou no `feat`** | **QA** (gata) |
| **`QA Approved`** | **QA aprovou** | **Wagner** (valida em runtime) |
| **`PO Approved`** | **Wagner validou** | **Polaris** (corta versão) |
| **`Released to Production`** | **versão cortada contendo o item** | — (terminal) |

⚠️ **`Released to Production` exige DUAS condições:** `PO Approved` **e** prova de que o commit está contido na tag (`git merge-base --is-ancestor <sha> <tag>`). Conteúdo-na-tag é **necessário, não suficiente** — não pula o gate do PO.

### 4.1 Duas QAs, uma trava por item
- **`Lúmen`** (Codex) — **backend**: Rust, `services/`, segurança, CI/CD, contratos de crate.
- **`Lúmen II`** (Claude) — **frontend**: React/TS, UX-detalhe, a11y, i18n, testes de componente.
- **PR misto** → quem chegar primeiro **anuncia a trava na #133** e gata o item **inteiro**; a outra não toca. **Uma trava por item.**

### 4.2 ⚠️ Fatia `Ref` publica veredito, mas NÃO move o card
- **PR com `Closes #NNN`** → a entrega **fecha** a US → gata e **move** o card.
- **PR com `Ref #NNN`** → é **fatia**; a US **continua aberta** → **publica o veredito na issue** e **deixa o card onde está**.
- Na dúvida, **o `Closes` no corpo do PR é o sinal**. Sem `Closes`, não move.

> Motivo: `QA Approved` é a **fila do Wagner**. Card de US inacabada ali faz o PO abrir e não achar o que validar.

### 4.3 O gate

1. **A QA gata SÓ o que está em `Done`.** Nunca `In progress`, nunca `In review` (essa é a fila do Polaris).
2. Ela move **Done → QA Approved** (passou) ou **Rejected** (reprovou). Só isso com o card.
3. Se ela **não fecha o runtime sozinha** (cega a pixel/cross-layer), move pra **QA Approved COM nota "runtime/visual pendente PO"** — o Wagner testa a partir de QA Approved. **Não existe estado "checkpoint".**
4. **A QA NUNCA pinga o Wagner** (direto ou #133) pra testar. O Wagner sabe que precisa olhar quando (a) a issue está em **QA Approved** (onde ele SEMPRE pega), ou (b) o **Polaris fala com ele**. A **coluna** é a comunicação.
5. **Fatia = US-filha** → percorre as colunas sozinha e vai pro olho do Wagner **em QA Approved**. O épico fica In progress até as US fecharem. Não se roteia fatia órfã pro Wagner.

---

## 5. PR e integração

- **Todo PR referencia uma US na 1ª linha do corpo** — com `Closes` **ou** `Ref`. PR órfã (sem nenhum dos dois) é barrada na integração (§2).
- **`Closes #<US>` — a entrega FECHA a US.** O **default branch é `feat/bridge-email-client`**, então `Closes` **preenche a caixa Development** da issue **e auto-fecha** a US no merge.
- **`Ref #<US>` — a US continua ABERTA depois do merge.** Três casos:
  1. **Fatia** de uma US multi-parte (o mais comum: #1129 L1, #1108 srflx, #1019 S1);
  2. **Gate de runtime/QA depois de integrar** (ex.: preview no empacotado, risco tipo #873) — senão a issue fecha antes da prova;
  3. **Design/spec** de issue aprovada (o doc integra; o *done* é quando a implementação landa).
- **Consequência no board (§4.2):** `Closes` move o card; `Ref` **não move**.
- **Devs abrem PR; NÃO mergeiam.** **O Polaris integra** por **merge local** (worktree off `feat`, `git merge --no-ff`, gate, `push HEAD:feat`, move o card, limpa a worktree). Nunca `gh pr merge`.
- **Gate de integração (Polaris):** `pnpm exec tsc -b` (exit 0) · `pnpm test` (`node --test`) · **`cargo check` SEM env OpenSSL** quando mexe em Rust (pega str0m/openssl vazando). CRLF: `core.autocrlf=true` na worktree.

### 5.1 Integrador reserva (fila represada)

O merge local é de **um dono só** — o que é certo, e por isso o Polaris é ponto único de falha. Quando ele para, ninguém integra e todo mundo fica executor-ready parado. Este é o caminho de exceção; ele **não substitui** o Polaris, destrava a fila até ele voltar.

**Gatilho — as três condições, juntas e verificáveis:**
1. `feat` sem commit novo há **≥ 60 min** (`git log -1 --format=%ar origin/feat/...`);
2. **≥ 3 PRs** abertas e mergeable na fila;
3. **1 ping na #133** ao Polaris **sem resposta** nesse intervalo.

**Trava (obrigatória, antes de qualquer merge):** anunciar na #133 — *"assumo como reserva o lote: #A, #B, #C"* — com a lista **explícita**. **Um reserva por vez.** Quem anuncia primeiro tem a trava; os outros não integram nada.

**Quem — e por que "não-autor":** a regra existe, mas vale saber **o que ela protege**. O §5 não tem etapa de revisão: integrar é merge + gate + push + mover card. Logo o não-autor **não** compra uma segunda opinião sobre o código — compra **reprodutibilidade do gate**: pega o verde que só existe na máquina de quem escreveu (worktree suja, artefato velho, variável de ambiente mágica). É falha real e já aconteceu aqui.

Então a regra, na ordem:
1. **Preferência forte:** integra quem **não é autor** do lote.
2. **Sempre, autor ou não:** o gate roda em **worktree limpa off `feat`**, nunca na worktree de desenvolvimento da branch.
3. **Se só o autor puder rodar aquele gate** (toolchain que ninguém mais tem): permitido **com compensação** — o lock nomeia explicitamente *"autor-integrador"*, a saída do gate (comandos + exit codes) é **colada na #133**, e um não-autor confirma a leitura. Transparência no lugar da separação.

> Antes de invocar o item 3, **verifique** se alguém mais consegue rodar o gate — a suposição "só eu tenho o toolchain" costuma ser falsa.
>
> **PR que mexe em código feature-gated precisa de gate extra.** `cargo check` default **não compila** `src-tauri/src/remote.rs` (entra o `remote_stub`; é o buraco que o #1072 fecha), então o gate padrão passaria sem olhar a mudança. Nesse caso, rodar também — receita verificada nesta máquina em 2026-08-16:
>
> ```bash
> export OPENSSL_DIR="C:\Program Files\PostgreSQL\16"   # OpenSSL do PostgreSQL
> export OPENSSL_NO_VENDOR=1
> export RC="C:/Program Files (x86)/Windows Kits/10/bin/10.0.26100.0/x64/rc.exe"
> export PATH="$(dirname "$RC"):$PATH"                     # só pro cargo test
> cargo check --features remote      # compila o remote.rs de verdade  (~36 s)
> cargo test  --features remote      # roda os testes do módulo        (rc.exe obrigatório)
> ```

**Como (idêntico ao do Polaris, §5):** worktree off `feat` · `git merge --no-ff` · gate (`tsc -b` · `pnpm test` · `cargo check` **sem env OpenSSL** se tocou Rust) · `push HEAD:feat` · **mover o card na mão para `Done`** (§4.0) · limpar a worktree.

> ⚠️ **Mover o card é o furo do merge local.** O `Closes` fecha a issue no push, mas **não move o card** — sem esse passo o board mente e a QA não enxerga o item. Destino ao integrar: **`Done`** (ver §4.0).

**Ordem do lote — medir antes, não adivinhar.** Antes de escolher a ordem, listar os hunks das PRs por arquivo compartilhado:

```
gh pr diff <n> | awk '/^diff --git.*<arquivo>/{f=1;next} /^diff --git/{f=0} f&&/^@@/{print}'
```

PRs com arquivos disjuntos entram em qualquer ordem; stack real (uma contém a outra) entra na ordem da pilha; duas tocando o mesmo arquivo entram uma por vez, com gate entre elas.

**O reserva NÃO faz:** cortar release · mover card para `QA Approved` (é gate da QA, §4) · tocar card que não integrou · rebasear branch de outro agente.

**Encerrar:** postar na #133 o que entrou e o novo head do `feat`, e **liberar a trava**. O Polaris retoma sem precisar reconstruir contexto.

### 5.2 Dívida nova nasce **gated** na PR que toca o mesmo arquivo

Quando alguém identifica trabalho novo (dívida, refactor, gate, convergência de tipo) **que edita um arquivo já tocado por PR aberta**, esse trabalho **não começa** antes daquela PR integrar. Constrói-se sobre a forma nova, não sobre a velha.

**Por quê:** construir em paralelo garante conflito de mesmo-arquivo, e o custo não é o conflito — é que **resolver conflito é onde se perde correção em silêncio** (ver o `api.ts` do #1069×#1017: `--ours` revertia um crítico, `--theirs` revertia o outro, e **os dois lados compilavam**).

**Como checar, antes de começar:**

```bash
gh pr list --state open --limit 100 --json number,files   --jq '.[] | select(.files[].path == "<arquivo alvo>") | .number'
```

Se voltar alguma PR: a US nova **nasce com a dependência escrita no corpo** (*"gated no #NNN"*), não como descoberta no meio da implementação.

> Casos reais que produziram esta regra (2026-08-16): #1067 gated no #1066 · #1019 gated nas 5 PRs do `control-room.tsx` · o gate do #1017 gated no #1079 · convergência do `Capabilities` gated no #1089.

**Não vale como desculpa pra parar:** se a PR bloqueadora demora, o certo é **cobrar a integração**, não construir em paralelo e pagar no merge.

---

## 6. Definition of Done

**VERDE ≠ PRONTO.** DoD = **funciona com dado real** + cada **critério de aceite** da US satisfeito + gate verde + **i18n pt/en** (toda string user-facing no `t.*`) + sem UI inventada (usar o componente de referência do registry, não espelhar à mão). Code review + tsc/cargo é necessário, **não suficiente**.

---

## 7. Release

Ao cortar release: bump de versão nos **4** lugares (`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `Cargo.lock` entry `name="app"`) → notas minuciosas → **tag `vX.Y.Z` na `feat`** (o `release.yml` dispara no push da tag, builda/assina/publica no repo de distribuição). Os itens shipados vão **Done/PO Approved → Released to Production**.

---

## 8. Protocolo de entrega (todos)

Ao entregar: **comenta a issue** + **posta na #133** + **move o card conforme §4.2**:
- PR com **`Closes`** (fecha a US) → move o card pra **`In review`** (fila de integração do Polaris).
- PR com **`Ref`** (fatia; a US segue aberta) → **comenta e NÃO move o card** — ele já está em `In progress` e continua lá até a última fatia.

Nunca idle silencioso; raia zerada = pinga o Polaris ("livre, próximo?"). Conferir-o-existente **antes** de construir/recomendar (ler o código real, citar arquivo:linha).
