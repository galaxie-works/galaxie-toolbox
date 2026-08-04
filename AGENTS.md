# AGENTS.md — GALAXIE Toolbox

Instruções operacionais para agentes (Claude e afins) que trabalham neste repositório.
Escopo atual em foco: **Bridge** (cliente de e-mail dentro do app) + track paralelo de migração.

> 📐 **[`Rules.md`](./Rules.md) é OBRIGATÓRIO** — regras de UI/UX, uso de componentes (não inventar UI), scrollbar/tema/persistência e **custo/eficiência do agente**. Leia antes de produzir UI ou entregar. Violou uma regra de lá → o PO reprova.

> 🔴 **MÉTODO — atualizado 03/ago/2026 (aprendido na marra: o épico Atoms saiu MEDÍOCRE por "verde = pronto").** Leitura obrigatória de todos os agentes:
> 1. **VERDE ≠ PRONTO.** `tsc`/`cargo`/CI verdes e teste sobre **mock** NÃO fecham nada. Widget que "renderiza no mock" quebra contra o Graph real (429/erro/shape) — foi o que aconteceu (5 slices com "Couldn't load" que ninguém pegou).
> 2. **Definition of Done = FUNCIONA no app REAL com dado REAL.** Se você (auth-gate) não conseguiu exercer o dado real, a entrega fica **In review** com o rótulo explícito **"NÃO verificado com dado real (auth-gate)"** — **nunca insinue "pronto"**. O **Polaris faz o live-QA** no desktop do PO (conta logada) antes de QA Approved; sem isso, não aprova.
> 3. **Confira o CONTRATO de dado real ANTES de construir** — a chamada Graph no Rust (params, forma, tratamento de erro/429), não o tipo TS + mock. Toda chamada Graph nova passa pelo **pool `graph_enviar`** (retry/429); chamada crua fora do pool estoura no boot.
> 4. **AC EXPERIENCIAIS, não estruturais.** "Componente X renderiza" é AC ruim. AC bom é verificável abrindo o app real logado: "mostra o dado real; skeleton no load; erro que RECUPERA no retry; vazio ≠ erro ≠ tudo-em-dia; transições; copy/bento certos".
> 5. **Profundidade > throughput.** Superfície flagship = UX research ANTES de codar. Não empilhar slices data-heavy sem validar a fundação de dado.
> 6. **Fix sobre algo já integrado vai em PR NOVO** (o merge local do Polaris fecha o PR → push no branch fechado não roda CI e ele pode não ver). Ou pingue "re-integra o branch X".
> 7. **UI com texto = i18n OBRIGATÓRIO na própria task (regra do PO, 04/ago).** Toda task que cria/muda UI com texto DEVE trazer, na issue: (a) **AC de i18n** — "strings via `t`; **copy pt-BR e en**; com pt-BR nenhuma string em inglês visível, en reverte 100%; aria-labels/toasts/sr-only incluídos"; (b) **a copy dos 2 idiomas escrita na própria issue** (pt-BR + en), pra o agente só ligar no `t` — não inventar nem deixar hardcoded. Assim **não se revalida o app caçando inglês num app pt-BR**. Zero string nova hardcoded. (Quem escreve a issue — Polaris/PO — já entrega a copy dos idiomas.)
> Causa-raiz detalhada: ver os retrospectos no #133 (02–03/ago) e `docs/atoms/atoms-ux-replan.md`.

## 1. O app em uma frase
Tauri 2 + React 19 + TypeScript + Tailwind v4. Fala com **Microsoft Graph delegado (`/me`)** — **não há IMAP**. Login sempre na página oficial da Microsoft; o app **nunca** vê a senha/MFA/token do usuário.

### 1.1 Permissões Graph — GRANTED vs. REQUESTED
Public client + PKCE, delegado `/me`. Distinção que importa pro roadmap:
- **GRANTED** = concedido no app registration (admin consent do tenant Galaxie Works Ltd). Disponível **sem novo consent**.
  - 📄 **Fonte única de verdade dos escopos concedidos: [`docs/reference/graph-scopes.md`](./docs/reference/graph-scopes.md)** (atualizado 2026-08-03, **101 escopos** admin-consented). NÃO duplicar a lista aqui — ela driftou (esta seção já esteve com "53"). Sempre conferir o graph-scopes.md.
  - Na tabela do graph-scopes.md, a coluna **"Admin?"** = *exige admin consent?* — **"Não" NÃO significa "não concedido"**; significa que é user-consentable. Todos os 101 já estão concedidos.
- **REQUESTED** = subconjunto **mínimo** que a app pede no token, em `src-tauri/src/config.rs` const `SCOPES`. Adicionar um escopo já-GRANTED aqui **não** dispara re-consent (admin já consentiu); só exige o usuário **relogar** pra token novo.

**REQUESTED hoje** (`config.rs` SCOPES): `openid profile offline_access User.Read User.Read.All Files.ReadWrite Sites.Read.All Calendars.Read Mail.ReadWrite Mail.Send Tasks.ReadWrite People.Read Contacts.ReadWrite` — conferir sempre no `config.rs` (é a fonte).

**Implicações:**
- **Chat.Read (Atoms A6 / #445) JÁ está GRANTED** (graph-scopes.md, seção Teams/Chat). O blocker do widget de Teams é só **adicionar Chat.Read à const `SCOPES` + relogar** — não é consent novo de admin. (Confusão anterior: o "Admin? = Não" foi lido como "não concedido".)
- **Caixas compartilhadas** — `Mail.*.Shared` já GRANTED; adicionar à `SCOPES` + relogar.
- ⚠️ `Contacts.ReadWrite` já GRANTED (graph-scopes.md; destravou o edit de contato no People).
- **NÃO usar IMAP/EWS/EAS** apesar de granted — arquitetura é **Graph-only, delegado /me**.

## 2. Board de trabalho (GitHub Projects) — a fonte da verdade
Board **"Galaxie Toolbox"** = `https://github.com/users/galaxie-works/projects/3`.

> ⚠️ **SEMPRE verifique o board antes de cobrar/perguntar ao PO no chat.** O PO responde **movendo cards** (Status), **comentando issues** e **criando itens** no board — não no chat. Antes de pedir confirmação/decisão, cheque Status (QA Approved/Rejected), comentários novos e itens novos. Só pergunte no chat o que o board não responder.

### Fluxo de colunas (campo Status) e quem move
| Coluna | Descrição | Quem move |
|---|---|---|
| **Backlog** | não iniciado | — |
| **Ready** | pronto pra pegar | **agente** puxa de Backlog quando combinado |
| **In progress** | sendo trabalhado | **agente** ao começar a codar |
| **In review** | em revisão | **agente** ao terminar → dispara o **subagente QA** |
| **Rejected** | contém problemas | QA ou PO, se reprovar |
| **QA Approved** | QA aprovou, aguardando PO | **subagente QA** (In review → aqui se passar) |
| **PO Approved** | aprovado pra release | **usuário/PO** valida QA Approved |
| **Done - Released** | concluído/lançado | no release |

Regra: o **agente vai só até In review + QA Approved/Rejected**. Nunca move pra PO Approved — isso é do usuário (PO), que também **ajusta a Sprint** se necessário.

> ✅ **AO TERMINAR um item — protocolo OBRIGATÓRIO (regra do PO, 31/07/2026), nesta ordem:**
> 1. **Comente na issue** a evidência (o que fez, arquivos, commit, ACs traçados, builds verdes).
> 2. **Poste no #133** o progresso + declare se **vai pegar a próxima da fila** ou se está **livre pra próxima** (pra o Polaris saber o estado sem adivinhar — nada de agente idle silencioso).
> 3. **Mova o card pra In review** (`gh project item-edit --id <itemId> --project-id PVT_kwHOD_4JN84BedaN --field-id PVTSSF_lAHOD_4JN84BedaNzhY3dus --single-select-option-id df73e18b`).
>
> Aí o **Polaris pega de In review** → integra + code-QA → **QA Approved**. Semântica do board: **In progress** = ainda codando · **In review** = entregue, com o Polaris · **QA Approved** = verificado, aguardando o PO. **Não deixe item entregue parado em In progress/Ready** — mova em tempo real.

> 📣 **NUNCA fique idle em silêncio — broadcast do estado no #133 a cada mudança (reforço PO 31/07/2026):**
> - 🆓 **Livre / sem próximo claro** → **pingue pedindo o próximo** ("terminei minha fila, o que pego?"). Não sentar esperando um trigger.
> - 🚧 **Bloqueado / pendente de decisão** → poste **IMEDIATO e alto** no #133: *"BLOQUEADO no #X — preciso de \<decisão/resposta/asset\>"*. **NÃO sente em silêncio** esperando alguém adivinhar (aconteceu no #288: agente travou numa decisão e ficou parado sem avisar). O Polaris resolve decisão de **escopo/design na hora**; escala pro PO só o que é dele (destrutivo/produto).
> - **Regra de ouro:** o Polaris e o PO têm que saber teu estado **a qualquer momento, sem cutucar**. Progresso sempre visível.

> 📌 **OBRIGATÓRIO ao mover pra QA Approved: postar a EVIDÊNCIA como comentário NA issue** (`gh issue comment N`). Mover o card sem comentar faz o PO abrir a issue, não ver prova, e reprovar com *"Faltam evidências e comentários relativos ao desenvolvimento"* (aconteceu com #31/#76/#94/#96 em 2026-07-27, com código certo). O comentário deve ter: **(1) Desenvolvimento** — o que foi feito, arquivos, decisões, commit hash; **(2) QA** — `tsc`/`cargo` verdes + passos da QA visual e resultado observado + cada AC (Given/When/Then) traçado; **(3) Pro PO validar em runtime** — comportamento dependente de Graph real que o mock não exercita. ⚠️ **Mock ≠ real:** para features de interação (scroll/teclado/hover/tooltip/dados reais), exercitar esses caminhos no mock e listar o que só o PO valida no app — a QA de mock do #40 passou mas o PO achou 5 bugs de interação no app real.

> 🚀 **RELEASE de PO Approved é decisão do agente** (delegado pelo PO em 2026-07-26). Uma vez em **PO Approved**, o agente decide quando **mergear na `main`, cortar release** (bump de versão + tag + notas) e mover pra **Done - Released**, sem cobrar o PO. A autonomia começa em PO Approved (QA Approved→PO Approved continua sendo do PO). Não cortar release com código não-aprovado/rejeitado ainda na `feat` (ex.: rework com `Closes #N` já mergeado) — limpar/reworkar antes.

> 🌿 **HIGIENE DE BRANCH E DE `main` (regra do PO, 2026-08-03 — o repo chegou a 138 branches e a `main` 32 commits atrás).** O modelo é **`feat/bridge-email-client` = tronco/develop**, **`main` = release** (o workflow de Release só dispara em **push de tag `v*`** ou dispatch — push na `main` NÃO builda/publica).
> - **Deletar o branch ao integrar.** Quando o Polaris mergeia teu branch na `feat`, ele **deleta o branch remoto** no mesmo passo (`git push origin --delete <branch>`). Branch mergeado = lixo; não acumular. Worktree de agente: remover ao concluir.
> - **`main` nunca deve encalhar.** Alinhar `feat→main` (PR de merge, padrão do repo) a cada release real, e **release incremental a cada ~3 issues** — a `main` não pode passar de ~10 commits atrás da `feat`. Se a fila em QA Approved cresce sem release, o Polaris **cobra o PO** pra validar e cortar.
> - **Não deixar branch não-mergeado órfão.** Se um rework/WIP não vai ser integrado, decidir: reintegrar ou descartar explicitamente (não deixar boiando anos). O Polaris varre branches não-mergeados no sweep e cobra dono/decisão.

> 💸 **Custo / eficiência — modelo atual de integração (NÃO queimar créditos):**
> - Quem **ENTREGA** (Orion/Confucius/subagent) faz só: build local verde (`tsc` + `cargo` se tocar Rust + `vite`) + **evidência CONCISA** (o que mudou, arquivos, commit, ACs cobertos) → **PR pra `feat`** e **PARA**.
> - A **integração + code-QA + o move pra QA Approved são do Polaris** (orquestrador). Neste projeto isso **substitui** o "agente dispara subagente QA" da tabela acima — o QA é **centralizado no Polaris**. O agente que entrega **NÃO** roda subagente de QA/review próprio nem re-revisa o código inteiro linha-a-linha (duplica o Polaris e queima o limite semanal).
> - Subagente **só pra tarefa grande** (~150-400k tokens). Solo pro pequeno/mecânico. **Sem auditoria/review espontâneo**: achou algo fora do escopo → issue curta (finding) e segue. Detalhes em [`Rules.md`](./Rules.md) §11.
>
> ⚠️ **O QA valida a HISTÓRIA e os CRITÉRIOS DE ACEITE (Given/When/Then), não só code review.** Todo prompt de QA deve: ler a issue (`gh issue view N`), extrair história + cada AC, e para CADA AC traçar o caminho do código confirmando que o **Then** é satisfeito. Onde exigir runtime (login Graph), listar explicitamente os ACs que o PO precisa validar no app. `tsc`/`cargo` + code review são necessários mas **não suficientes**. Reprovar se algum AC não for atendido.
>
> ⚠️ **NÃO parafrasear os ACs no prompt do QA.** O prompt do orquestrador deve só dizer **qual issue ler** — o QA **puxa o corpo real** (`gh issue view N`), **cita verbatim** os ACs que encontrou lá (prova de que leu a fonte) e valida cada um. Se o QA não conseguiu ler o corpo (ex.: `gh` falhou), ele **REPROVA/avisa** — nunca valida de memória nem da paráfrase. (Erro pego pelo PO no #50, 2026-07-26: QA validou contra a paráfrase do orquestrador.)
>
> 🖥️ **O QA PODE validar visualmente** (ACs de layout/estrutura), sem login Graph real. O Vite dev server serve o frontend em `http://localhost:1420`; aberto **fora do Tauri** (browser), o `api.ts` usa **dados MOCK** (`inTauri()` = false). Fluxo do QA: `preview_start {url:"http://localhost:1420"}` → `read_page` (login screen) → `form_input` email + `left_click` "Sign in with Microsoft" (o mock loga qualquer email como usuário fake) → cai no Bridge com dados mock → **`read_page`** inspeciona a árvore de acessibilidade **renderizada** (posição/presença de componentes, estados colapsado/expandido, tema, labels). **`read_page` funciona headless** (não precisa da pane visível); **screenshot** só funciona com a pane exibida. **Limite:** mock ≠ Graph real — comportamento dependente de dados reais (carregar/ordenar e-mail, contadores, `$search`, fotos, autocomplete, 429/retry) continua sendo validação de **runtime do PO**. Use validação visual para todo AC de UI que o mock consiga exercer; deixe explícito quais ACs sobraram pro PO.

### IDs (para automação via `gh`/GraphQL)
- **projId**: `PVT_kwHOD_4JN84BedaN`
- **Status** (`PVTSSF_lAHOD_4JN84BedaNzhY3dus`): Backlog `f75ad846` · Ready `61e4505c` · In progress `47fc9ee4` · In review `df73e18b` · Rejected `7389544e` · QA Approved `33a59ba9` · PO Approved `9ef1bdac` · Done - Released `98236657`
- **Sprint #** (Number): `PVTF_lAHOD_4JN84BedaNzhY3pCE`
- **Priority** (`PVTSSF_lAHOD_4JN84BedaNzhY3d0o`): P0 `79628723` · P1 `0a877460` · P2 `da944a9c`
- **Size** (`PVTSSF_lAHOD_4JN84BedaNzhY3d0s`): XS `6c6483d2` · S `f784b110` · M `7515a9f1` · L `817d0097` · XL `db339eb2`
- **Estimate** (Number): `PVTF_lAHOD_4JN84BedaNzhY3d0w`

### Pegadinha do `gh` CLI + token
O `gh` está logado com um token OAuth próprio **sem `read:project`**. Para tocar no board, passe o PAT (que tem escopo `project`) via env var:
```powershell
$env:GH_TOKEN = $env:GITHUB_PERSONAL_ACCESS_TOKEN
gh project item-edit --id <itemId> --project-id <projId> --field-id <fieldId> --single-select-option-id <optId>
gh project item-edit --id <itemId> --project-id <projId> --field-id <sprintOuEstimate> --number <n>
```
O MCP oficial do GitHub **não** expõe Projects v2 — board só via `gh`/GraphQL.

## 3. Como escrever/portar stories (Product Owner)
Use o skill **`/agile-product-owner`** (INVEST + AC + pontos + prioridade). **Regra rígida, aprendida na marra:** ao **portar** uma story de um plano para uma issue, **preserve a íntegra** — nunca reduza a uma linha genérica. Cada issue de story deve conter:

1. **Cabeçalho**: Épico · Sprint · `pts` · MoSCoW · dependências.
2. **História**: "Como \<papel\> quero \<objetivo\> para \<valor\>".
3. **Critérios de aceite**: checkboxes no formato **Given/When/Then**.
4. **Notas técnicas**: componentes reui exatos, chamadas Graph (`$orderby`/`$filter`/`$search`), riscos, splits.
5. **Definition of Done** (ver §5).

Mapeamentos para os campos do board:
- **pts → Size**: 1→XS · 2/3→S · 5→M · 8→L · 13→XL. Setar também **Estimate** = pts.
- **MoSCoW → Priority**: Must→P0 · Should→P1 · Could→P2.
- **Sprint** conforme o roadmap.

## 3.1 Dúvidas de UI/UX/design → subagente de UX Research
Para **dúvidas de design** (padrão de componente, comportamento de interação, hierarquia visual, quando mostrar/esconder algo), **não decida sozinho por achismo**: levante um **subagente** com skill global de **UX Research** (ex.: `ux-researcher-designer`, `design:user-research`, `design:design-critique`, `product-designer`) pra embasar a recomendação, e traga a conclusão pro PO validar. Continua valendo a regra "não inventar UI" (usar componentes reui literais do registry).

## 4. Fluxo de desenvolvimento (padrão exemplar)
- **Assignee `galaxie-works`** em TODA issue criada.
- **Branch ATRELADA à issue**, criada ANTES de editar, com **`gh issue develop <N> --base feat/bridge-email-client --name fix/N-slug`** (ou GraphQL `createLinkedBranch`). Isso liga a branch à issue na seção **Development**. ⚠️ **`git checkout -b` NÃO atrela** — só nomeia; toda issue precisa da branch aparecendo atrelada nela.
- **PR atrelado** com `Closes #N` (fecha automático no merge). É adicional ao linked branch — juntos dão rastreabilidade issue ↔ branch ↔ PR.
- PRs vão pra **`feat/bridge-email-client`**; issues **auto-fecham só no merge à `main`** (default branch).
- **NÃO deletar a branch após o merge** (⚠️ NÃO usar `--delete-branch`). O PO exige que a seção **Development** da issue continue mostrando a branch atrelada; deletar apaga esse vínculo (foi motivo de Rejected). Como toda branch é **atrelada a uma issue** (via `gh issue develop`), elas são rastreáveis — não são "órfãs". Só varrer branches genuinamente órfãs (sem issue, pré-era do linked-branch).
- Cada feature que mereça commit, comita. `tsc` + `cargo check` verdes antes de PR.

## 5. Definition of Done
**Gate de build (necessário, NÃO suficiente):** `tsc -b` (build mode — o `--noEmit` deixa passar erro que o build de release pega) + `cargo check`/`cargo test` (se Rust) + `oxlint` + `node --test` verdes · tema **claro/escuro** ok · **sem regressão** em teclado/multi-seleção/virtualização · feedback/toast presente · escopo **mínimo** de permissão (re-consent sinalizado em escopo novo) · **componentes reui usados literalmente** (regra "não inventar UI") · **conforme [`Rules.md`](./Rules.md)**.

**Gate de realidade (o que FECHA — ver o callout 🔴 MÉTODO no topo):** cada AC verificado **no app REAL com dado REAL** (não mock). Se auth-gate impede o agente de validar, a entrega declara **"NÃO verificado com dado real"** e o **Polaris faz o live-QA** antes de QA Approved. AC experienciais (skeleton/erro-que-recupera/vazio/dado real/transições), não estruturais. **Build verde não fecha item.**

## 6. Segurança
- `CLIENT_ID` `214d735e-eb9b-4052-8851-578d3bd91627` é **público por design** (public client + PKCE).
- Rodar varredura de segredos antes de subir. Não comitar tokens/segredos.
- O app nunca manipula credenciais do usuário.

## 7. Verificar o board
```powershell
$env:GH_TOKEN = $env:GITHUB_PERSONAL_ACCESS_TOKEN
gh project item-list 3 --owner galaxie-works --format json
```
