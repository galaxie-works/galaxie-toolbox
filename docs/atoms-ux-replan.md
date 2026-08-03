# Atoms — Estudo + Replan profundo (pós-reprovação do PO)

Épico #181 · stories #183–187 ENTREGUES e REPROVADAS · GALAXIE Toolbox
Stack: Tauri 2 + React 19 + TS + Tailwind v4 + shadcn/new-york + reui + animate-ui · Microsoft Graph (delegado /me)
Método: UX research (skill `design:user-research`) + auditoria técnica de código real.
Leia junto: `docs/atoms-dashboard-spec.md` (a spec original — boa no plano, mal executada).

> **Veredito de uma linha:** o Atoms foi construído como *maquete sobre mock* — a spec (que é sólida) foi implementada na largura, não na profundidade. Os widgets "passam" fora do Tauri (mock em `api.ts`) e **quebram no app real** porque duas chamadas Graph centrais (`cr_email`, `cr_tarefas`) **não usam o pool de retry/429** que o resto do app usa, o widget de e-mail **derruba tudo se o contador falhar**, e o boot dispara **6 chamadas Graph de uma vez** concorrendo com o keep-alive do Bridge → tempestade de 429. A camada de UX ficou no esqueleto: sem avatar, sem bento de verdade, sem motion, sem vida. Isto aqui é o retrabalho.

---

## 0. Sumário executivo (diagnóstico em 5 bullets)

1. **"Couldn't load" em Tasks é 429 sem rede de proteção.** `graph::cr_tarefas` (graph.rs:893) e `graph::cr_email` (graph.rs:840) usam `reqwest::blocking::Client::new()` **cru**, fora do `graph_enviar` (o pool + retry/backoff do #64 que TODAS as outras chamadas usam). No boot, o Atoms dispara 6 chamadas juntas (atoms.tsx:178-185) enquanto o Bridge keep-alive faz as próprias → 429. `cr_tarefas` devolve `Err` no primeiro 429 da lista (graph.rs:904-906) → Tasks vira "erro". O **Retry chama a MESMA função desprotegida** → 429 de novo → "Retry não faz nada".

2. **E-mail é intermitente porque um `Promise.all` acopla duas chamadas de resiliência diferente.** `carregarEmail` (atoms.tsx:151-154) faz `Promise.all([crEmail(), crContadores("inbox")])`. `crEmail` engole erros e devolve default; `crContadores` **lança** em não-200 (graph.rs:6272-6273). Quando o contador falha (429), o widget inteiro cai pra "erro" — mesmo o não-lido tendo vindo. Isso explica o "às vezes 429 não-lidos, às vezes Couldn't load" (#187).

3. **O feed "Atenção agora" tem use-story, mas a implementação o esvazia.** O e-mail sinalizado "nem aparece" (#185) porque (a) o feed só lê e-mail quando `email.fase === "ok"` — e o bug #2 mata essa fase; (b) o item sinalizado é **sintético** ("N sinalizados") e depende de `sinalizados > 0`, que vem do contador que falhou; (c) o filtro `score >= 0.3` (atoms.tsx:516) derruba não-lidos com mais de ~poucas horas (score decai 0.45→0.2 em 24h) — numa caixa com 429 não-lidos "velhos", o feed fica vazio com a caixa cheia. O feed não está errado de conceito; está subalimentado e mal calibrado.

4. **Teams: o consent nunca é pedido porque `Chat.Read` não está nos SCOPES.** `config.rs:40-42` lista os escopos de login e **não inclui `Chat.Read`**; relogar jamais o pede (#186). `cr_teams_disponivel` (graph.rs:4342) só testa presença do escopo → sempre `false`. O `TeamsWidget` (atoms.tsx:1005) mostra texto morto ("Conecte o Teams…") **sem botão, sem trigger de consent** — a string `teamsConectar` existe (strings.ts:428) e nunca é usada. Não há fluxo de consent incremental (`required_resource_scopes_missing` em auth.rs:53 não cobre Chat.Read).

5. **A UX ficou no esqueleto — "sem vida" é literal.** Header sem avatar embora `AppUser.photo` e `<Avatar>` existam (types.ts:29; usado em toasts.tsx:164). Copy ruim: `atoms.subtitulo = "What needs you right now"` (strings.ts:1623) — e a copy boa que o Wagner quer, **"Your day at a glance." / "Seu dia em um olhar."**, já existe como `controlRoom.subtitulo` (strings.ts:1670/450). Não é bento: a grade é `auto-fit minmax(320px,1fr)` uniforme (atoms.tsx:356-359), todos os cards iguais, sem hero nem spans. Motion só no greeting (`SoftBlurIn`, atoms.tsx:276); os cards entram secos — o stagger blur-in da spec §4.3 nunca foi construído. Skeleton = 3 barras cinzas genéricas (`SkeletonLinhas`, atoms.tsx:618) que o fail-fast pro erro esconde. Observabilidade zero: o log real (`GALAXIE Toolbox.log`) não tem uma linha de erro de Atoms/graph — tudo é engolido por `catch {}` (atoms.tsx:143,163,174) e `if let Ok` no Rust.

**As novas stories (1 linha de AC-chave cada):**

- **A1 — Fundação de dados resiliente:** todas as chamadas do Atoms passam pelo `graph_enviar` (pool+429) e o boot é sequenciado/deduplicado com o Bridge; **AC:** com 429 não-lidos reais, os 3 widgets carregam dado real em ≤1 boot, sem "Couldn't load".
- **A2 — Erro que recupera + telemetria:** cada widget isola falha e o Retry realmente re-tenta com backoff; erros logados. **AC:** derrubando a rede e voltando, o Retry recupera o card sem reabrir o app, e o erro aparece no log.
- **A3 — Shell flagship (avatar + copy + bento real + motion):** header com avatar, "Seu dia em um olhar", grade bento com hero, stagger blur-in respeitando reduced-motion. **AC:** avatar do usuário ao lado do título; layout com tiles de tamanhos diferentes; cards "montam" com stagger (ou aparecem instantâneos sob reduced-motion).
- **A4 — Estados vivos de cada widget:** skeleton com a forma do conteúdo, vazios distintos e calorosos, dado com hierarquia visual e cor de status. **AC:** no load vê-se skeleton com a silhueta do card; vazio ≠ erro ≠ "tudo em dia"; um e-mail sinalizado aparece com destaque visível.
- **A5 — Feed "Atenção agora" que prova valor:** feed lê itens reais (inclusive o e-mail sinalizado concreto), calibrado pra não esvaziar com caixa cheia, cada item com motivo e porta. **AC:** com 1 e-mail sinalizado + 1 reunião hoje + 1 tarefa vencida, os três aparecem ranqueados com o motivo certo e clicam pro destino.
- **A6 — Teams consent de verdade:** botão "Conectar o Teams" dispara consent incremental de `Chat.Read`; sem escopo, degrada sem mentir. **AC:** clicar "Conectar" abre o consent da MS pedindo Chat.Read; concedido, o card passa a mostrar chats reais; negado, volta ao gate sem quebrar.

Caminho deste documento: `C:\dev\gt-feat\docs\atoms-ux-replan.md`.

---

## 1. Diagnóstico — cada rejeição → causa (arquivo:linha)

### 1.1 #184 To-dos — "Nada aparece em Tasks a não ser 'Couldn't load'. Retry não faz nada." (QUEBRADO)

**Causa raiz (técnica):** `graph::cr_tarefas` (graph.rs:893) não usa `graph_enviar`. A chamada da lista (`/me/todo/lists`, graph.rs:898-903) roda em `reqwest::blocking::Client::new()` cru e **retorna `Err` em qualquer não-200** (graph.rs:904-906). No boot há contenção (ver §1.6) → 429 → `Err` → `carregarTodos` cai no `catch` (atoms.tsx:174) → estado `"erro"` → `ErroCard` "Não foi possível carregar".

**Por que o Retry não faz nada:** `onRetry` chama `carregarTodos` de novo (atoms.tsx:255), que chama a MESMA `cr_tarefas` desprotegida. Sem backoff próprio, sob 429 sustentado ele re-falha imediatamente — o usuário percebe "nada acontece".

**Por que "passa" no mock:** fora do Tauri, `crTarefas` devolve 2 tarefas fixas com `sleep(450)` (api.ts:345-354). O QA visual nunca exercita o caminho Graph real. Este é o padrão de toda a reprovação: **mock ≠ validação real** (regra que já mordeu antes).

### 1.2 #186 E-mail/Teams — "Nada aparece em Email, nem Teams… Retry não faz nada. Teams 'Connect…' mas relogar não pediu escopo."

**E-mail (técnica):** `carregarEmail` (atoms.tsx:148-166) faz `Promise.all([crEmail(), crContadores("inbox")])`. As duas têm resiliência **diferente**:
- `crEmail`→`cr_email` (graph.rs:840): cliente cru, **sem** `graph_enviar`, mas engole tudo (`if let Ok` em graph.rs:847,859) e devolve `CaixaEntrada` default. Sob 429 devolve 0 não-lidos silenciosamente — nunca "erro", mas dado errado.
- `crContadores`→`cr_contadores` (graph.rs:6236): usa `graph_enviar` (bom), mas **lança** em não-200 (graph.rs:6272-6273).

Como é `Promise.all`, o `throw` do contador **rejeita a promise inteira** → `catch` (atoms.tsx:163) → widget "erro", mesmo com o não-lido já resolvido. Daí a intermitência do #187 ("429 não-lidos" às vezes; "Couldn't load" às vezes).

**Teams (técnica):** `Chat.Read` **não está em `config::SCOPES`** (config.rs:40-42 termina em `Tasks.ReadWrite`). Logo:
1. relogar nunca pede Chat.Read (exatamente o que o Wagner viu);
2. `cr_teams_disponivel` = `token_tem_escopo("Chat.Read")` (graph.rs:4342-4343) → sempre `false` → `teamsOk === false` → renderiza `TeamsWidget`;
3. `TeamsWidget` (atoms.tsx:1005-1024) mostra só `teamsGatedDesc` — **texto morto, sem botão**. A string `teamsConectar` ("Conectar o Teams", strings.ts:428) existe mas nunca é renderizada, e não há handler de consent incremental. O gate que a spec §2.4 pediu ("igual ao `onGrantPeopleAccess`") não foi construído.

### 1.3 #185 Feed "Atenção agora" — "Não há use story válido… email sinalizado nem aparece."

**Há use-story** (a spec §0 a defende bem: a linha única "o que exige você agora" é o diferencial sobre abrir o Outlook). O problema é implementação:
- **Depende da fonte que quebrou:** o bloco de e-mail do feed só roda se `email.fase === "ok"` (atoms.tsx:482) — morto pelo bug §1.2.
- **Sinalizado é sintético e condicional:** o item é "{n} e-mail(s) sinalizado(s)" (atoms.tsx:495-506) e só entra se `sinalizados > 0`, que vem do contador que falha. Nunca mostra o **assunto real** do e-mail sinalizado.
- **Filtro corta a caixa cheia:** `filter(i => i.score >= 0.3)` (atoms.tsx:516). Não-lido pontua `0.2 + 0.25*frescor` (atoms.ts:101), i.e. 0.45 recém-chegado decaindo a 0.2 em 24h. Numa caixa com 429 não-lidos, os 5 "recentes" podem ser mais velhos que ~7h → score < 0.3 → some. Resultado: **feed vazio com a caixa transbordando** — a antítese do valor prometido.

### 1.4 #183 Shell — "Falta avatar; copy péssima; isso não é Bento Grid."

- **Avatar:** o header (atoms.tsx:274-282) renderiza só `SoftBlurIn` (título) + `<p>` (subtítulo). `AppUser.photo` (types.ts:29) e o par `Avatar`/`AvatarImage` já existem e são usados (toasts.tsx:163-164). Omissão pura.
- **Copy:** `atoms.subtitulo` = "O que precisa de você agora." / "What needs you right now." (strings.ts:403/1623). A copy que o Wagner pede — **"Seu dia em um olhar." / "Your day at a glance."** — já existe como `controlRoom.subtitulo` (strings.ts:450/1670). É trocar a fonte da string (e alinha com a spec §0.1: "Bridge devolve a saudação ao Atoms").
- **Bento:** `grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))]` (atoms.tsx:356-359) = grade responsiva **uniforme**. Todo card ocupa 1 coluna igual; não há `col-span`/`row-span`, hero, nem composição por importância. A spec §4.2 pedia "cards spanning 1–2 columns by importance" — não foi feito. O Wagner está certo: é um card-grid, não um bento.

### 1.5 #187 Personalização/polish — "superficial; transições secas; sem vida; sem skeleton; deveria ser um show."

- **Sem vida/hierarquia:** tudo é `text-muted-foreground` + `IconStack` cinza + badges minúsculos. Zero cor de status, zero destaque do que importa. Lê como tela de Configurações, não como dashboard-vitrine.
- **Transições secas:** só o greeting tem `SoftBlurIn` (atoms.tsx:276). A grade `Sortable` renderiza estática; o stagger blur-in de entrada dos cards (spec §4.3) nunca existiu. O único motion "de conteúdo" é o strike-through do to-do e o `layout` do feed.
- **"Não vi skeleton":** existe (`SkeletonLinhas`, atoms.tsx:618-626) mas (a) é 3 barras genéricas sem a forma do card, e (b) o fail-fast pro erro (§1.1/§1.2) troca skeleton→erro rápido demais pra registrar. Percepção do usuário: "não teve skeleton".
- **"Superficial":** o e-mail é uma badge "429 não lidos" que leva ao Bridge e volta pra "Inbox zero" (o vazio quando o contador zera sob 429). Sem preview de remetente/assunto, sem os 5 recentes que o backend já traz (`cr_email` popula `recentes`, graph.rs:862-874, mas o `EmailWidget` **ignora** e só mostra contagens).

### 1.6 Causa sistêmica: tempestade de boot + observabilidade cega

- **Thundering herd:** `useEffect` (atoms.tsx:178-185) dispara `carregarAgenda` + `carregarEmail` (=2 chamadas) + `carregarTodos` (=1..8 chamadas, uma por lista, graph.rs:921) + `atomsOnedriveSync` + `crTeamsDisponivel` **de uma vez**, e o Bridge está montado keep-alive fazendo os próprios `cr_*`. Pico de concorrência no exato momento em que a spec §0.2 vendia "de graça". As chamadas fora do pool (`cr_email`, `cr_tarefas`) são as que estouram.
- **Log cego:** o `GALAXIE Toolbox.log` real não tem nenhuma linha de erro de Atoms — os `catch {}` do front e os `if let Ok(...)` do Rust descartam a causa. Impossível diagnosticar em produção (contraria a nota "log robusto como Delphero"). Precisa de log no caminho de erro.

---

## 2. Visão-alvo — o que o Atoms deveria ser

### 2.1 Header (shell)
`[Avatar do usuário] Olá, {primeiroNome}  ·  Seu dia em um olhar.`
- **Avatar:** `<Avatar>` com `AvatarImage src={user.photo}` e `AvatarFallback>{user.initials}` (componentes já no repo). `size` ~40px, à esquerda do bloco título/subtítulo.
- **Copy:** subtítulo = `controlRoom.subtitulo` ("Seu dia em um olhar." / "Your day at a glance.") — corrigir `atoms.subtitulo` nas duas línguas. Manter a saudação `Olá, {nome}`.
- **Contexto vivo:** data por extenso + micro-resumo dinâmico ("3 reuniões, 2 tarefas pra hoje") em vez do subtítulo estático quando há dado. Mantém o "at a glance" verdadeiro.

### 2.2 Bento real (referência concreta, sem inventar)
- **Base:** manter o `Frame` reui (já é a superfície de todo widget) sobre CSS Grid Tailwind, mas com **spans explícitos por importância**, não `auto-fit` uniforme:
  - Desktop largo (`xl`): `grid-cols-4 auto-rows-[minmax(180px,auto)]`; **Feed "Atenção agora" = hero** `col-span-2 row-span-2`; Agenda `col-span-2`; E-mail `col-span-1`; Tarefas `col-span-1 row-span-2`; sistema/speed-dial `col-span-1`.
  - `md`: `grid-cols-2` (hero `col-span-2`).
  - `sm`/sidebar expandida: **1 coluna, ordenada pelo score §3** (mais urgente no topo) — o comportamento certo já previsto na spec §4.2, agora de fato ativado.
- **Referência de UI (não inventar):** os blocos "bento" prontos da reui são **premium/Pro** (a busca no registry retornou 17 matches todos gated). Portanto **não** dependemos deles: o bento é composição Tailwind sobre `Frame` (in-repo) — padrão shadcn/reui idiomático. Para as **linhas do feed**, referência livre concreta: `@reui/c-item-12` ("Activity feed items with avatars and actions", preview https://reui.io/preview/base/components/c-item-12) — item com avatar + ação, exatamente a forma do feed. Seeds da spec mantidos: `playful-todolist` (to-dos) e `notification-list` (feed) do animate-ui, instalados pelo registry.

### 2.3 Estados de CADA widget (skeleton / loading / erro-que-recupera / vazio / dados)
Matriz única, aplicada a Agenda, E-mail, Tarefas, Feed:

| Estado | Tratamento-alvo |
| --- | --- |
| **Skeleton (load)** | Skeleton com a **silhueta do card** (linha de título + avatar/badge + 2-3 linhas), não 3 barras genéricas. Cada card resolve seu async independente (não bloqueia no mais lento). |
| **Dados** | Hierarquia visual: número grande/destaque pro sinal-chave, cor de status (âmbar=atenção, vermelho=vencido/urgente, verde-calmo="ok"), preview real (remetente+assunto dos recentes; próximo evento com hora e botão Entrar). |
| **Erro** | Inline por-card (`Alert` reui), mensagem específica ("Não foi possível carregar a agenda") + **Retry que recupera de verdade** (§3). Outros cards seguem de pé. |
| **Vazio (fonte limpa)** | Copy calorosa e **distinta** por fonte: "Agenda livre hoje", "Caixa de entrada limpa", "Nenhuma tarefa aberta". Ilustração `icon-stack`, tom positivo. |
| **Tudo em dia (dashboard)** | O vazio *recompensa*: "Tudo em dia ✨" só quando as 3 fontes resolveram OK e estão limpas — nunca quando alguma falhou (hoje `tudoEmDia` já exige `fase==="ok"`, manter). |
| **Sem permissão** | Card mostra o escopo faltante + botão "Conectar" que dispara consent (não texto morto). |

### 2.4 Motion (respeitando reduced-motion)
- **Entrada:** stagger blur-in dos cards (reusar `SoftBlurIn` com delay incremental por índice) — "átomos se montando". Gate `useReducedMotion()` → sem stagger, aparição instantânea.
- **Conteúdo:** number tween nos contadores (0→429), strike-through do to-do (já existe), reordenação do feed com `layout` (já existe, já respeita reduced-motion em atoms.tsx:445).
- **Hover:** leve elevação/borda nos cards-porta (o clique é a ação principal).
- **Regra:** todo motion novo passa por `useReducedMotion`; nada de parallax forçado.

### 2.5 Feed "Atenção agora" — use-story explícita
- **Quando um item aparece:** ele "exige você agora" por UMA regra legível (§3 da spec/`atoms.ts`): reunião em ≤30min (`iminente`), tarefa vencida (`vencido`) ou de hoje (`prazoHoje`), e-mail que **você sinalizou** (`sinalizado`) ou não-lido recente (`naoLido`). O **motivo é mostrado** ("Começa em 10 min", "Venceu", "Você sinalizou") → ordenação auto-explicável.
- **Correções de calibração:** ver §4.5 (mostrar o e-mail sinalizado real; não esvaziar com caixa cheia).

---

## 3. Correção da fundação de dados (o coração do retrabalho)

### 3.1 Toda chamada do Atoms passa pelo pool (`graph_enviar`)
- Reescrever `cr_email` (graph.rs:840) e `cr_tarefas` (graph.rs:893) para envolver **cada** request em `graph_enviar(op, GRAPH_TETO_ESPERA_S, || …)` — igual a `cr_agenda` (graph.rs:1125), `cr_contadores` (graph.rs:6268) e todas as outras. Isso dá retry/backoff em 429 automaticamente.
- **Distinguir "vazio" de "falhou":** hoje `cr_email` engole erro e devolve 0 (mentira). Deve propagar `Err` quando a chamada de não-lidos falha, para o front mostrar erro-recuperável em vez de "Inbox zero" falso.

### 3.2 Desacoplar o widget de e-mail
- Não usar `Promise.all` que rejeita tudo junto. Buscar não-lidos+recentes e contadores **independentemente** (`Promise.allSettled` ou dois estados), de modo que:
  - contadores falhar **não** derruba o não-lido/recentes;
  - cada parte tem seu próprio skeleton/erro/retry.
- Melhor ainda: um único comando Rust `atoms_email()` que faz não-lidos + flagged num `$batch` sob `graph_enviar` e devolve `{ naoLidos, sinalizados, recentes }` — 1 request, 1 caminho de erro.

### 3.3 Sequenciar/deduplicar o boot (matar o thundering herd)
- Escalonar as cargas do `useEffect` (atoms.tsx:178-185): priorizar Agenda + E-mail; disparar Tarefas logo em seguida; `onedrive`/`teams` são best-effort com atraso.
- **Coordenar com o Bridge keep-alive:** Atoms e Bridge compartilham dados (agenda/e-mail). Introduzir um cache curto/single-flight por operação (o `graph_enviar`/pool já serializa; garantir que Atoms **reusa** o dado do Bridge quando fresco em vez de refazer). Reduz o pico de 429 na origem.

### 3.4 Retry que recupera de verdade + telemetria
- O `onRetry` deve re-chamar a versão **protegida** (pós-3.1) — aí o backoff do pool faz o Retry funcionar. Adicionar micro-jitter no front pra evitar re-disparo síncrono.
- **Log no caminho de erro:** trocar `catch {}` (atoms.tsx:143,163,174) por `catch (e) { log(e); setEstado("erro") }` e, no Rust, logar o status/corpo antes de `return Err`. Sem isso não há como o PO/Polaris validar em produção.

### 3.5 Fluxo de consent do Teams (correto)
1. **Adicionar `Chat.Read` a `config::SCOPES`** (config.rs:40-42) OU tratá-lo como escopo incremental opt-in.
2. **Botão "Conectar o Teams" real:** o `TeamsWidget` renderiza `Button` com a string `teamsConectar` (já existe, strings.ts:428) que dispara um consent incremental (`acquireToken`/authorize com `scope=Chat.Read` adicional) — padrão do `onGrantPeopleAccess` que o app já usa pra People (App.tsx).
3. **Degradação honesta:** sem o escopo, o card mostra o gate + botão; concedido, passa a ler `/me/chats` (novo comando Rust sob `graph_enviar`); negado, volta ao gate sem "Couldn't load".
4. Incluir Chat.Read em `required_resource_scopes_missing` (auth.rs:53) se for tratado como requerido, para o app sinalizar a ausência de forma consistente.

> **Nota de escopo:** Teams (A6) é a única slice que precisa de escopo/Rust novo. Agenda/E-mail/Tarefas são só resiliência + apresentação sobre o que já existe — a spec §0.2 estava certa nisso; o erro foi não blindar o caminho real.

---

## 4. Replan re-fatiado — novas stories com AC experienciais e verificáveis NO APP REAL

> Regra de ouro dos AC: **nada de AC estrutural-só** ("componente X renderiza"). Todo AC é verificável abrindo o app real logado na conta do Wagner (caixa com muitos não-lidos, agenda populada). "Passa no mock" não conta.

### A1 — Fundação de dados resiliente (bloqueia todo o resto)
Objetivo: os 3 widgets puxam dado REAL no app real, sem 429 hard-fail.
- **AC1.** Abrindo o app logado (caixa com centenas de não-lidos), em ≤1 boot os 3 cards mostram **dado real** (não-lido real, próximo evento real, tarefas reais do `/me/todo`) — nenhum "Couldn't load".
- **AC2.** `cr_email` e `cr_tarefas` passam por `graph_enviar` (verificável: sob rajada de boot repetida 5×, nenhum card falha por 429).
- **AC3.** O boot do Atoms não multiplica chamadas com o Bridge (verificável no log de rede/telemetria: sem duplicação agenda/e-mail no mesmo segundo).
- **AC4.** `cr_email` que realmente falha propaga erro (não devolve "0 não-lidos" silencioso).

### A2 — Erro que recupera + observabilidade
- **AC1.** Com a rede derrubada, cada card mostra erro específico + Retry; **religando a rede e clicando Retry, o card recupera** e mostra o dado — sem reabrir o app.
- **AC2.** A falha de um card **não** afeta os outros (derrubar só To Do não tira Agenda/E-mail do ar).
- **AC3.** Todo erro de carga gera **uma linha no log** (`GALAXIE Toolbox.log`) com operação + status HTTP (verificável abrindo o log após forçar um erro).

### A3 — Shell flagship (avatar + copy + bento + motion)
- **AC1.** O **avatar do usuário** aparece à esquerda de "Olá, {nome}" (foto real se houver; iniciais no fallback).
- **AC2.** O subtítulo é **"Seu dia em um olhar." / "Your day at a glance."** (não "O que precisa de você agora").
- **AC3.** O layout é **bento**: em tela larga há tiles de tamanhos diferentes (feed hero maior; e-mail/tarefas menores), não um grid uniforme; ao estreitar, colapsa pra 1 coluna ordenada por urgência.
- **AC4.** Ao entrar no Atoms, os cards **montam com stagger** (blur-in encadeado); com "reduzir movimento" ligado no SO, aparecem instantâneos e estáveis.

### A4 — Estados vivos de cada widget
- **AC1.** No load (rede lenta/throttle), vê-se **skeleton com a forma do card** por ≥300ms antes do conteúdo — perceptível.
- **AC2.** Vazio, erro e "tudo em dia" são **visualmente distintos** (copy + ícone diferentes); "Tudo em dia ✨" só aparece com as 3 fontes OK e limpas.
- **AC3.** O card de e-mail mostra **os recentes reais** (remetente + assunto), não só a contagem; um e-mail **sinalizado** aparece com destaque de cor/ícone.
- **AC4.** Contadores animam (tween) na primeira aparição; tarefa concluída faz strike-through e some (já existe — manter e não regredir).

### A5 — Feed "Atenção agora" que prova valor
- **AC1.** Com **1 e-mail sinalizado + 1 reunião hoje + 1 tarefa vencida** na conta real, os três aparecem no feed, ranqueados, cada um com o **motivo certo** ("Você sinalizou", "Começa em X"/"Hoje", "Venceu").
- **AC2.** O e-mail sinalizado mostra o **assunto real** (não "N sinalizados") e clica → abre o Bridge no item.
- **AC3.** Numa caixa com muitos não-lidos, o feed **não fica vazio** enganosamente: ou mostra os mais relevantes, ou mostra um resumo acionável ("12 não-lidos, 3 sinalizados") — nunca "Nada urgente" com a caixa cheia.
- **AC4.** O feed recalcula em ~60s e no focus (já existe) e anuncia mudanças com `aria-live="polite"` sem "pular" sob reduced-motion.

### A6 — Teams consent de verdade
- **AC1.** Clicar **"Conectar o Teams"** abre o consent da Microsoft **pedindo Chat.Read** (verificável: a tela de consent lista a permissão de chat).
- **AC2.** Concedido, o card passa a mostrar **chats/menções não lidos reais**; ao reabrir o app, permanece conectado.
- **AC3.** Negado/sem escopo, o card mostra o gate + botão, **sem "Couldn't load"** e sem consent silencioso.

### A7 — Personalização (herda o #187, depois da base)
- **AC1.** Reordenar/ligar/desligar widgets persiste após fechar e reabrir o app (já existe via localStorage — manter, não regredir com o novo bento).
- **AC2.** A personalização respeita o bento (spans) sem quebrar o hero.

**Ordem:** A1 → A2 → (A3 ∥ A4) → A5 → A6 → A7. A1/A2 são pré-requisito de tudo (sem dado real e erro recuperável, o resto é maquiagem). A3/A4 podem correr em paralelo (shell vs. estados). A5 depende de A1+A4. A6 é a única com escopo novo, isolada por último. A7 herda o que já funciona.

---

## 5. Checklist de validação no app real (o PO/Polaris roda ANTES de aprovar)

Rodar no app instalado (atalho do desktop, conta do Wagner — caixa com muitos não-lidos e agenda cheia). Nada aqui passa em mock.

**Fundação (A1/A2)**
- [ ] Boot limpo: os 3 cards mostram dado real (não-lido real, próximo evento, tarefas do To Do) sem nenhum "Couldn't load".
- [ ] Fechar e reabrir 3× seguidas: nenhum boot falha por 429.
- [ ] Modo avião ON → cada card mostra erro específico. Modo avião OFF → **Retry recupera** o card (sem reabrir o app).
- [ ] Derrubar só uma fonte: os outros cards continuam de pé.
- [ ] Após forçar um erro, abrir `GALAXIE Toolbox.log` e confirmar a linha de erro (operação + status).

**Shell/estados (A3/A4)**
- [ ] Avatar do usuário ao lado de "Olá, {nome}".
- [ ] Subtítulo = "Seu dia em um olhar." / "Your day at a glance.".
- [ ] Layout bento: tiles de tamanhos diferentes; feed é o maior. Estreitar a janela → 1 coluna por urgência.
- [ ] Cards montam com stagger; ligar "reduzir movimento" no Windows → aparição instantânea, sem animação.
- [ ] Com rede lenta (throttle), skeleton com a forma do card é visível antes do conteúdo.
- [ ] Card de e-mail mostra remetentes/assuntos reais; e-mail sinalizado tem destaque.
- [ ] Vazio ≠ erro ≠ "tudo em dia" (comparar as três telas).

**Feed (A5)**
- [ ] Sinalizar 1 e-mail + ter 1 reunião hoje + 1 tarefa vencida → os 3 aparecem no feed com o motivo correto.
- [ ] O e-mail sinalizado mostra o assunto real e clica pro Bridge.
- [ ] Caixa cheia de não-lidos → feed NÃO diz "Nada urgente".

**Teams (A6)**
- [ ] "Conectar o Teams" abre consent da MS pedindo Chat.Read.
- [ ] Conceder → chats reais aparecem; reabrir o app mantém conectado.
- [ ] Negar → volta ao gate, sem "Couldn't load".

**Regressão**
- [ ] Personalização (ordem/visibilidade/densidade) persiste após reabrir.
- [ ] Clicar qualquer widget leva ao destino certo (Bridge inbox/agenda; Entrar abre a reunião).

---

## Apêndice — mapa de arquivos/linhas citados

- **View:** `src/screens/atoms.tsx` — boot burst 178-185; `carregarEmail` Promise.all 148-166; `catch {}` 143/163/174; header sem avatar 274-282; grid uniforme 356-359; feed filtro `score>=0.3` 516; sinalizado sintético 495-506; `SkeletonLinhas` 618-626; `TeamsWidget` texto morto 1005-1024.
- **Modelo de atenção:** `src/lib/atoms.ts` — `pontuar` 66-113 (não-lido 97-103, iminência 75-85).
- **Prefs:** `src/lib/atoms-prefs.ts` (ok; manter).
- **API front:** `src/lib/api.ts` — `crEmail` 331 (mock 332-341), `crTarefas` 345, `crContadores` 1615, `crTeamsDisponivel` 385, `atomsOnedriveSync` 376.
- **Rust Graph:** `src-tauri/src/graph.rs` — `cr_email` 840 (SEM pool), `cr_tarefas` 893 (SEM pool; `Err` em não-200 904-906), `cr_tarefa_concluir` 956, `cr_contadores` 6236 (com pool; lança 6272-6273), `cr_teams_disponivel` 4342, `graph_enviar` 163; agenda com pool 1125.
- **Escopos:** `src-tauri/src/config.rs:40-42` (SCOPES, **sem Chat.Read**); `src-tauri/src/auth.rs:53` (`required_resource_scopes_missing`).
- **Comandos Tauri:** `src-tauri/src/lib.rs` — `cr_teams_disponivel` 668, `atoms_onedrive_sync` 677, `required_scopes_status` 172.
- **Copy:** `src/lib/strings.ts` — `atoms.subtitulo` 403/1623 (ruim); `controlRoom.subtitulo` 450/1670 ("Seu dia em um olhar"/"Your day at a glance" — adotar); `teamsConectar` 428 (existe, não usado).
- **Identidade/avatar:** `src/lib/types.ts:24-32` (`AppUser.photo`); `src/lib/toasts.tsx:163-164` (Avatar em uso).
- **Referência de UI (registry):** feed rows `@reui/c-item-12` (livre; preview https://reui.io/preview/base/components/c-item-12); bento reui é premium/Pro (não depender) → compor com `Frame` + grid Tailwind; seeds `playful-todolist` + `notification-list` (animate-ui) por install.
