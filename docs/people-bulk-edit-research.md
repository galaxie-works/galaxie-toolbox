# Research / Discovery — Bulk EDIT de contatos (#236)

> 📌 **Snapshot de research (#236). Conferir status das stories no board** antes de tratar como pendente — parte pode já ter shipado no People. Doc de intenção.

> **Tipo:** discovery. **Sem código de feature nesta issue** — só design doc + stories INVEST.
> **Restrição dura do PO:** 🚫 bulk **delete** jamais entra (nem escondido). Ver §4.
> **Método:** discovery ancorado no código real (`design:research-synthesis` — separar observação de interpretação, quantificar, insight→oportunidade). As "evidências" aqui são o comportamento verificado do código, não entrevistas.

---

## 0. Problema (o que o Wagner viu)

Ao marcar o checkbox do header da tabela de People/Contacts, **todas as linhas selecionam mas nenhuma ação em massa aparece**. A seleção não leva a lugar nenhum.

**Observação no código** (`src/components/people/people-view.tsx`):
- A row selection **já existe e funciona**: colunas `select` com `DataGridTableRowSelect` / `DataGridTableRowSelectAll`, `enableRowSelection`, `rowSelection` state, e `selectedContacts` derivado (linhas 1594, 1724-1727, 1734-1741, 1889-1913).
- A **única** ação que consome a seleção é o botão Sparkles (Enrich): usa `selectedContacts` se houver, senão todos (linhas 2072-2091). Não há barra de ação, contador, nem edição.

**Interpretação:** falta a camada de *bulk edit* — uma barra de ação em massa que apareça ao selecionar e ofereça operações **seguras e reversíveis**. A infraestrutura de seleção (reui data-grid row selection, padrão `c-data-grid-7`) já está montada; o trabalho é a barra + as operações.

---

## 1. Campos seguros vs. perigosos para edição em massa

### 1.1 O que o modelo tem e o que o Graph deixa escrever

`PeopleContact` (`src/lib/people.ts`) une **três origens** (`src/lib/types.ts` → `PeopleSource` + `directory`):

| Origem | Endpoint Graph | `contactId`? | Editável? |
|---|---|---|---|
| `contacts` | `/me/contacts` | **sim** | **sim** — único que grava |
| `people` | `/me/people` (grafo de relevância) | não | **não** (read-only p/ usuário delegado) |
| `directory` | `/users` (diretório do tenant) | não | **não** (precisa de admin/Directory.*) |

**Evidência dura** (`src/store/people-slice.ts`, `updatePeopleContact`, linhas 259-263):
```
if (!current?.contactId) throw new Error("This person is not an editable Microsoft contact.");
```
E no Rust (`src-tauri/src/graph.rs`): escrita é sempre `PATCH /me/contacts/{id}` com escopo **`Contacts.ReadWrite`** (`cr_people_contact_update`, `cr_people_write_available` → `token_tem_escopo("Contacts.ReadWrite")`). `crPeopleWriteAvailable()` reflete o escopo no token.

➡️ **Implicação de 1ª ordem para o bulk:** qualquer operação que grave no Graph só se aplica ao subconjunto com `contactId`. Contatos `people`/`directory` selecionados têm que ser **filtrados e reportados como "ignorados (não editáveis)"**, nunca falhar silenciosamente.

Campos que o Graph aceita no PATCH de contato (`campo_patch_valido` em `graph.rs`, linhas 3723-3736, + `PeopleContactEdit`): `displayName`, `emailAddresses`, `businessPhones`/`homePhones`/`mobilePhone`, `companyName`, `jobTitle`, `department`, `officeLocation`, `manager`, `photo`.

### 1.2 Tabela de segurança para **edição em massa**

Critério: um campo é *seguro em massa* quando um **mesmo valor** faz sentido para **muitos contatos ao mesmo tempo** e o erro é **reversível/de baixo dano**. É *perigoso* quando o valor é **identitário/único por pessoa** (setar em massa corrompe o registro).

| Campo | Seguro p/ bulk? | Por quê |
|---|---|---|
| **Organization** (app-owned, §2) | ✅ **O mais seguro** | Local, não toca o Graph, 100% reversível. Vários contatos → 1 org é o caso natural. **MVP.** |
| `companyName` (empresa) | ✅ Seguro | Compartilhado por empresa/domínio. Caso de uso central ("todos desse domínio = Acme"). Reversível via novo bulk-set. |
| `department` | ✅ Seguro | Compartilhado por equipe. Blanket-set legítimo. |
| `officeLocation` | ✅ Seguro | Compartilhado por site/andar. Blanket-set legítimo. |
| `categories` / tags | ✅ Seguro (**aditivo**) — *precisa extensão* | Multi-valor no Graph Contacts, **adicionar tag não sobrescreve nada** → menor dano possível. **Ainda não existe** no `PeopleContact` nem no backend. Ver oportunidade em §5. |
| `jobTitle` (cargo) | ⚠️ Condicional (opt-in) | Costuma ser **único por pessoa**. Blanket-set raramente é o que se quer; só ofereça com preview explícito e nunca por padrão. |
| `manager` | ⚠️ Condicional | Aqui é **string livre** (não entidade ligada). Pode ser compartilhado numa equipe, mas alto risco de virar lixo. Fora do MVP. |
| `displayName` / `name` | ❌ **Perigoso** | Identidade única. Setar em massa = destruir os registros. **Nunca.** |
| `emailAddresses` | ❌ **Perigoso** | Único por pessoa; é a chave de merge (`mergePeopleRecords` casa por e-mail). Bulk = corrupção + colisão de identidade. **Nunca.** |
| `businessPhones`/`mobilePhone`/`homePhones` | ❌ **Perigoso** | Único por pessoa. **Nunca.** |
| `photo` | ❌ Perigoso p/ bulk | Foto única por pessoa; blanket-set não faz sentido. Fora de escopo. |

**Regra de projeto:** a barra de bulk só expõe a coluna verde (Organization + company + department + officeLocation; categories quando existir). Os campos identitários (nome/e-mail/telefone/foto) **não aparecem** na UI de massa — continuam só no editar-um (`PeopleDetail`).

---

## 2. Atribuir Organization em massa

### 2.1 Como o modelo de Org funciona hoje (#205/#232)

`PeopleOrg` (`src/lib/organizations.ts`) é **app-owned e local** (Zustand persistido, `organizations-slice.ts`) — **não existe no Graph**. Estrutura: `{ id, name, domains[], website, notes, logo, memberIds[], excludedIds[], timestamps }`.

Pertencimento é **derivado** (`organizationMembers`):
> um contato pertence se **o domínio do e-mail casa** com `org.domains`, **OU** está em `memberIds` (adição explícita), **MENOS** os que estão em `excludedIds`.

Ou seja: **regra por domínio é a base; `memberIds`/`excludedIds` são overrides manuais que coexistem com ela.**

### 2.2 A primitiva de bulk **já existe** no store

`assignOrganizationContacts(id, selectedIds, contacts)` (`organizations-slice.ts`, linhas 90-110) já faz atribuição em massa como "definir o conjunto de membros":
- Para cada selecionado cujo domínio **não** casa com a org → entra em `memberIds`.
- Para cada contato de domínio casado que **não** foi selecionado → entra em `excludedIds`.

Hoje só é chamada pelo **`AssignContactsDialog`** (aba Organizations → escolher contatos de uma lista; `organizations-view.tsx` linhas 230-339). O fluxo que falta é o **inverso**: da aba **Contacts**, selecionar N linhas → jogar numa org.

Há também `addContactToOrganization(id, contactId, contacts)` (add unitário, idempotente: se o domínio já casa, não duplica em `memberIds`), usado no dropdown "..." do `PeopleDetail` (people-view linhas 744-761).

### 2.3 UX proposta do fluxo (a partir da seleção na grid)

1. Seleciona linhas → barra de massa mostra **"N selecionados"** + ação **"Atribuir a organização"**.
2. Abre um **picker de org** (reui `Command`/`Autocomplete` — mesmo vocabulário do `AssignContactsDialog`):
   - lista as `organizations` existentes (com logo/nome);
   - opção **"Criar nova organização…"** no rodapé do picker.
3. **Criar nova no fluxo:** abre o form mínimo (`createOrganization({ name, domains })`). **Pré-preencher `domains`** com os domínios distintos dos contatos selecionados (via `contactDomain`) e sugerir `name` via `suggestedOrganizationName(domain, contacts)` — que já existe. Depois cai no passo 4.
4. **Preview + confirmação** (§3): "Vai atribuir 12 contatos a **Acme**. 3 já pertencem pelo domínio (sem mudança). 1 sem e-mail entra como membro explícito." → Confirmar.
5. Grava: reusar `assignOrganizationContacts` **ou** iterar `addContactToOrganization` (aditivo — não mexe em quem não foi tocado). **Recomendo `addContactToOrganization` em loop** para o caso "adicionar a", porque `assignOrganizationContacts` **redefine o conjunto** (poda membros não selecionados via `excludedIds`) — o que não é o esperado numa ação "adicionar estes N à org".

### 2.4 Atribuição manual sobrepõe o domínio? — decisão

**Não sobrepõe: coexiste e é aditiva.**
- Adicionar contato de **outro** domínio → vira `memberIds` (a regra de domínio continua valendo para os demais).
- Adicionar contato que **já casa** o domínio → **no-op** (a lógica marca como `derived` e não duplica).
- A única forma de *remover* alguém que casa o domínio é `excludedIds` (override), acionado por uma ação "Remover da organização" — **não** faz parte de #236 e não deve ser exposto no bulk (fica no detalhe).

### 2.5 Casos de borda

- **Contato sem e-mail:** `contactDomain` = null → só entra por `memberIds` (add explícito). Funciona; sinalizar no preview.
- **Domínio casa outra org:** membership é por-org e independente; um contato pode aparecer em orgs diferentes se domínios coincidirem. Add manual à org B **não** remove da org A (não é exclusivo). Aceitável; deixar explícito no doc de handoff.
- **Selecionados são `people`/`directory` (sem `contactId`):** **irrelevante aqui** — Org é local, não precisa de contato gravável no Graph. Isso torna o assign de Org a operação **mais inclusiva e segura** de todas. É por isso que é o MVP.
- **Reexecução:** idempotente (add não duplica). Seguro repetir.

---

## 3. Padrão de UI — barra de ação em massa

**Não inventar componente.** A row selection é o padrão reui **`c-data-grid-7`** (`npx shadcn@latest add @reui/c-data-grid-7`; registryDeps: `data-grid`, `data-grid-table`, `avatar`), **já em uso** via `DataGridTableRowSelect`/`RowSelectAll`. Falta só a barra, montada com primitivas existentes no app.

**Anatomia da barra (aparece só quando `selectedContacts.length > 0`):**
- **Contador** "N selecionados" (`Badge`/texto) + botão **"Limpar seleção"** (`table.resetRowSelection()`).
- **Ações** (`Toolbar` + `Button`/`DropdownMenu`, mesmo vocabulário da toolbar do `PeopleDetail`):
  - **Atribuir a organização** (§2) — primária, sempre habilitada.
  - **Definir campo seguro** (empresa / departamento / local) — abre `Dialog` com o campo + valor.
  - *(sem delete — §4)*
- **Posição:** sticky no topo/rodapé do `FramePanel` da lista, substituindo/sobrepondo a toolbar de filtros enquanto há seleção. Não usar modal para a barra em si.
- **Contagem "editáveis":** quando a ação for de **Graph** (campos seguros), a barra/preview mostra "N selecionados · **M editáveis**" — os não-editáveis (sem `contactId`) ficam claramente fora.

**Preview antes de aplicar (obrigatório em toda operação que altera vários registros):**
- Resumo do diff: "**42** contatos receberão *empresa = Acme*. **3** ignorados (não são contatos editáveis do Microsoft). **5** já têm esse valor (sem mudança)."
- Só então **Confirmação** explícita (`Dialog` com botão de ação; nada aplica direto do menu).

**Otimista + rollback (padrão do app):**
- Espelhar `updatePeopleContact` (`people-slice.ts` 259-303): tira **snapshot**, aplica local otimista, chama o Graph, **reverte no erro**.
- **Bulk = N PATCHs independentes** (Graph não tem transação). Usar **`$batch` do Graph (até 20/req)** para reduzir round-trips.
- **Falha parcial:** rollback **só dos que falharam**; manter os que gravaram. Ao final, **toast/summary** "42 atualizados · 3 falharam · 3 ignorados". Nunca reverter tudo por causa de um.
- **Idempotência:** re-setar o mesmo valor é no-op no Graph; Org add não duplica. Reexecução é segura por design.

---

## 4. 🚫 Bulk delete — excluído explicitamente

**Restrição dura do PO: nunca habilitar bulk delete de contatos** — nem como opção escondida.

**Por quê (registro):** apagar contatos em massa é irreversível no fluxo do app (sem lixeira própria), alto raio de dano, e um clique errado no header "selecionar todos" apagaria a agenda inteira. O ganho não justifica o risco; foge do objetivo (organizar, não destruir).

**O que fazer no lugar:**
- A barra de massa **não tem** ação destrutiva. Só operações **aditivas/reversíveis** (Org, campos seguros).
- Remoção de vínculo continua **unitária e local**: "Remover da organização" via `excludedIds` no detalhe (não apaga o contato, só o tira da org).
- Excluir **um** contato de verdade, se um dia existir, mora no `PeopleDetail`, unitário, com confirmação — fora de #236.

---

## 5. Épico + Stories INVEST

### Épico
**Ações em massa seguras no módulo People** — a partir da seleção de linhas na grid, oferecer edição em massa **reversível e de baixo risco** (atribuir organização + campos seguros), com preview e confirmação, **sem nenhuma ação destrutiva**. Fecha o buraco "seleciono tudo e nada acontece".

**Fatiamento incremental:**
`S1 (barra shell)` → `S2 (Org em massa — MVP, zero-Graph)` → `S3 (campo seguro: empresa, via Graph + rollback)` → `S4 (mais campos: depto, local)` → `S5 (tags/categories — precisa backend)`. **MVP entregável = S1 + S2.**

---

**S1 — Barra de ação em massa (shell) na grid de contatos**
> Como usuário do People, quando seleciono linhas, quero ver uma barra com quantos itens selecionei e como limpar, pra saber que a seleção tem ações.
- **INVEST:** independente (sem mutação), pequena, testável, entrega valor (feedback de seleção) sozinha.
- **AC:**
  - Com ≥1 linha selecionada, aparece barra com **"N selecionados"**.
  - Botão **"Limpar seleção"** zera (`resetRowSelection`).
  - 0 selecionados → barra some, toolbar normal volta.
  - Barra some ao trocar de aba (Contacts↔Organizations) e ao refiltrar que zere a seleção.
  - Reusa a row selection `c-data-grid-7` já existente (não recria colunas).

**S2 — Atribuir organização em massa (MVP)**
> Como usuário, quero atribuir os contatos selecionados a uma organização (existente ou nova) de uma vez, com preview e confirmação.
- **INVEST:** valioso e independente (Org é local, não depende do Graph); a peça de menor risco.
- **AC:**
  - Ação "Atribuir a organização" na barra (S1) → picker de orgs existentes + "Criar nova…".
  - "Criar nova" usa `createOrganization`, pré-preenchendo `domains` a partir dos selecionados e `name` via `suggestedOrganizationName`.
  - **Preview** mostra: quantos serão adicionados, quantos já pertencem por domínio (no-op), quantos sem e-mail entram como membro explícito.
  - **Confirmação** explícita aplica via **add aditivo** (`addContactToOrganization` em loop) — **não** poda quem não foi selecionado.
  - Idempotente (reexecutar não duplica). Toast de sucesso com contagem.
  - Contatos `people`/`directory` **são incluídos normalmente** (Org não exige `contactId`).

**S3 — Definir empresa (`companyName`) em massa via Graph**
> Como usuário, quero setar a empresa de vários contatos editáveis de uma vez, com preview, confirmação e rollback em falha.
- **INVEST:** primeira operação que grava no Graph; isola o padrão de bulk-PATCH + rollback pra reusar.
- **AC:**
  - Ação "Definir empresa" → `Dialog` com input de valor.
  - Barra/preview separa **N selecionados** de **M editáveis** (com `contactId` + `Contacts.ReadWrite`); mostra "X ignorados (não editáveis)" e "Y já têm esse valor".
  - Grava via `$batch` (≤20/req) espelhando o otimista+rollback de `updatePeopleContact`.
  - **Falha parcial:** reverte só os que falharam; summary "A atualizados · B falharam · C ignorados".
  - Sem `Contacts.ReadWrite` → ação desabilitada com tooltip (mesmo tratamento do editar-um).

**S4 — Estender aos campos seguros restantes (`department`, `officeLocation`)**
> Como usuário, quero os mesmos bulk-set para departamento e local do escritório.
- **INVEST:** incremento pequeno sobre S3 (reusa o mesmo motor de bulk-PATCH).
- **AC:** ações no mesmo menu; reusa preview/confirm/rollback de S3; cada campo valida tamanho (≤512, como no backend). `jobTitle`/`manager` **não** entram (§1.2).

**S5 — Tags/categorias em massa (aditivo)** *(precisa extensão de modelo + backend)*
> Como usuário, quero adicionar uma tag/categoria a vários contatos sem sobrescrever nada.
- **INVEST:** maior (toca `PeopleContact`, `graph.rs`, `campo_patch_valido`), mas independente e altamente seguro (aditivo).
- **AC:**
  - Adiciona `categories[]` ao modelo e ao PATCH (`/me/contacts` já suporta `categories`).
  - Bulk "Adicionar tag" **acrescenta** sem remover as existentes (merge, não replace).
  - Preview mostra tags que já existem (no-op) vs. novas; mesmo padrão de rollback parcial.
  - **Fora de escopo:** remover tag em massa (fica unitário).

---

## Achados-chave (resumo pro handoff)

1. **A seleção já funciona** (reui `c-data-grid-7`); falta só a **barra de ação** — não é refazer a grid.
2. **Só contatos com `contactId` (`/me/contacts` + `Contacts.ReadWrite`) gravam no Graph.** `people`/`directory` são read-only → filtrar e reportar como "ignorados", nunca falhar mudo.
3. **Seguros p/ bulk:** Organization (local, o mais seguro), `companyName`, `department`, `officeLocation` (e `categories` quando existir). **Perigosos (nunca):** nome, e-mail, telefone, foto.
4. **Org é app-owned por domínio** e a primitiva de atribuição em massa **já existe** (`assignOrganizationContacts`/`addContactToOrganization`); atribuição manual **coexiste** com o domínio (aditiva, não sobrepõe). Usar o **add aditivo** no bulk, não o "redefinir conjunto".
5. **MVP = barra (S1) + atribuir Org em massa (S2)** — zero risco de Graph. Campos seguros via Graph vêm em S3+ com **preview, confirmação e otimista+rollback parcial** (padrão `updatePeopleContact` + `$batch`).
6. **Bulk delete: fora, por decisão do PO** — barra só tem ações aditivas/reversíveis.
