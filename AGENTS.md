# AGENTS.md — GALAXIE Toolbox

Instruções operacionais para agentes (Claude e afins) que trabalham neste repositório.
Escopo atual em foco: **Bridge** (cliente de e-mail dentro do app) + track paralelo de migração.

## 1. O app em uma frase
Tauri 2 + React 19 + TypeScript + Tailwind v4. Fala com **Microsoft Graph delegado (`/me`)** — **não há IMAP**. Login sempre na página oficial da Microsoft; o app **nunca** vê a senha/MFA/token do usuário.

## 2. Board de trabalho (GitHub Projects) — a fonte da verdade
Board **"Galaxie Toolbox"** = `https://github.com/users/galaxie-works/projects/3`.

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
- **Higiene:** após merge, deletar a branch (`gh pr merge --delete-branch`), e periodicamente varrer branches órfãs no origin (`gh api repos/.../branches`).
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
