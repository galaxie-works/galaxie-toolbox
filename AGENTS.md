# AGENTS.md — GALAXIE Toolbox

Instruções operacionais para agentes (Claude e afins) que trabalham neste repositório.
Escopo atual em foco: **Bridge** (cliente de e-mail dentro do app) + track paralelo de migração.

## 1. O app em uma frase
Tauri 2 + React 19 + TypeScript + Tailwind v4. Fala com **Microsoft Graph delegado (`/me`)** — **não há IMAP**. Login sempre na página oficial da Microsoft; o app **nunca** vê a senha/MFA/token do usuário.

### 1.1 Permissões Graph — GRANTED vs. REQUESTED
Public client + PKCE, delegado `/me`. Distinção que importa pro roadmap:
- **GRANTED** = concedido no app registration (admin consent do tenant Galaxie Works Ltd). Disponível **sem novo consent** — 53 escopos delegados (lista completa abaixo).
- **REQUESTED** = subconjunto **mínimo** que a app pede no token, em `src-tauri/src/config.rs` const `SCOPES`. Adicionar um escopo já-GRANTED aqui **não** dispara re-consent (admin já consentiu); só exige o usuário **relogar** pra token novo.

**REQUESTED hoje:** `openid profile offline_access User.Read User.Read.All Files.ReadWrite Sites.Read.All Calendars.Read Mail.ReadWrite Mail.Send Tasks.ReadWrite People.Read Contacts.ReadWrite`

**GRANTED (53, todos admin-consented):** Analytics.Read · AuditLogsQuery(-Exchange/-OneDrive/-SharePoint/).Read.All · Bookings.Read.All · Calendars.Read · Chat.ReadWrite · Contacts.Read · Domain.Read.All · EAS.AccessAsUser.All · email · EWS.AccessAsUser.All · ExchangeMessageTrace.Read.All · Files.ReadWrite · Files.ReadWrite.All · IMAP.AccessAsUser.All · Mail-Advanced.ReadWrite(.Shared) · Mail.Read · **Mail.Read.Shared** · Mail.ReadBasic(.Shared) · Mail.ReadWrite · **Mail.ReadWrite.Shared** · Mail.Send · **Mail.Send.Shared** · MailboxFolder.Read(Write) · MailboxItem.Read(Write) · Notes.Create/Read/Read.All/ReadWrite/ReadWrite.All · Organization.Read.All · OrganizationalBranding.Read.All · OrgContact.Read.All · profile · ProfilePhoto.Read.All · ProfilePhoto.ReadWrite.All · Reports.Read.All · Schedule.Read.All · ServiceHealth.Read.All · Sites.Read.All · Tasks.ReadWrite · TeamMember.Read.All · TeamsActivity.Read · User.Read · User.Read.All · User.ReadBasic.All · UserNotification.ReadWrite.CreatedByApp

**Implicações:**
- **#27 (caixas compartilhadas) NÃO está bloqueado** — `Mail.Read.Shared`/`Mail.ReadWrite.Shared`/`Mail.Send.Shared` já GRANTED. Basta adicionar à const `SCOPES` + relogar; sem ação admin nova.
- **#91 (segurança no leitor):** `internetMessageHeaders` (SPF/DKIM/DMARC, Reply-To) vem com `Mail.Read`/`Mail.ReadWrite` — sem escopo novo.
- ⚠️ Reconciliar: a app pede `Contacts.ReadWrite` e `People.Read`, mas o granted mostra `Contacts.Read` (sem Write) e não lista `People.Read` — verificar antes de depender de escrita em contatos / People API.
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

> 📌 **OBRIGATÓRIO ao mover pra QA Approved: postar a EVIDÊNCIA como comentário NA issue** (`gh issue comment N`). Mover o card sem comentar faz o PO abrir a issue, não ver prova, e reprovar com *"Faltam evidências e comentários relativos ao desenvolvimento"* (aconteceu com #31/#76/#94/#96 em 2026-07-27, com código certo). O comentário deve ter: **(1) Desenvolvimento** — o que foi feito, arquivos, decisões, commit hash; **(2) QA** — `tsc`/`cargo` verdes + passos da QA visual e resultado observado + cada AC (Given/When/Then) traçado; **(3) Pro PO validar em runtime** — comportamento dependente de Graph real que o mock não exercita. ⚠️ **Mock ≠ real:** para features de interação (scroll/teclado/hover/tooltip/dados reais), exercitar esses caminhos no mock e listar o que só o PO valida no app — a QA de mock do #40 passou mas o PO achou 5 bugs de interação no app real.

> 🚀 **RELEASE de PO Approved é decisão do agente** (delegado pelo PO em 2026-07-26). Uma vez em **PO Approved**, o agente decide quando **mergear na `main`, cortar release** (bump de versão + tag + notas) e mover pra **Done - Released**, sem cobrar o PO. A autonomia começa em PO Approved (QA Approved→PO Approved continua sendo do PO). Não cortar release com código não-aprovado/rejeitado ainda na `feat` (ex.: rework com `Closes #N` já mergeado) — limpar/reworkar antes.

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
`tsc -p tsconfig.app.json --noEmit` + `cargo check` verdes · tema **claro/escuro** ok · **sem regressão** em teclado/multi-seleção/virtualização · feedback/toast presente · escopo **mínimo** de permissão (re-consent sinalizado em escopo novo) · **componentes reui usados literalmente** (regra "não inventar UI": instalar do registry e usar como veio).

## 6. Segurança
- `CLIENT_ID` `214d735e-eb9b-4052-8851-578d3bd91627` é **público por design** (public client + PKCE).
- Rodar varredura de segredos antes de subir. Não comitar tokens/segredos.
- O app nunca manipula credenciais do usuário.

## 7. Verificar o board
```powershell
$env:GH_TOKEN = $env:GITHUB_PERSONAL_ACCESS_TOKEN
gh project item-list 3 --owner galaxie-works --format json
```
