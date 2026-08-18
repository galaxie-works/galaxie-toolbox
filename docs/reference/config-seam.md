# Seam de configuração e escopo por tenant

> **Estado:** referência do que **está construído** no `feat/bridge-email-client` (medido em `46ede70`). Descreve contrato e invariantes; o comportamento real vive no código, e cada afirmação aqui aponta o `arquivo:linha` que a sustenta.
>
> Cobre as decisões de **#555** (reset de sessão na troca de conta), **#556/#560** (config na nuvem, escopo por owner) e **#700/PS5** (`OrgStatus` e claim de domínio). Nasceu do achado **DOC-13** da auditoria #994: essas decisões só eram recuperáveis lendo os testes.

---

## 1. Por que existe

O app persiste duas coisas muito diferentes no mesmo lugar:

- **preferência do usuário** — tema, idioma, zoom, assinaturas, ordenação. Segue a *pessoa*, deve sobreviver a logout e aparecer em qualquer máquina.
- **estado de um tenant** — caixas compartilhadas, calendários selecionados, contatos, orgs, abas abertas. Pertence à *conta atual* e **não pode** atravessar uma troca de conta.

Misturar os dois é vazamento de dado entre contas. O seam existe para que essa fronteira seja **um lugar só**, não uma regra que cada slice novo precisa lembrar.

## 2. O contrato

`src/store/config-backend.ts` define três interfaces pequenas e um tipo:

| Símbolo | Papel | Linha |
|---|---|---|
| `AppPersistido` | união dos `*Persistido` de todos os slices — o estado durável do app | `config-backend.ts:14-24` |
| `ConfigBackend` | seam **assíncrono**: `load` · `save(patch)` · `clear` | `:27-31` |
| `ConfigSnapshot` | leitura **síncrona**, exigida pelo boot do Zustand (sem flash de hidratação) | `:34-36` |
| `KeyValueStorage` | subconjunto do Web Storage que o adapter local precisa | `:39-43` |
| `LocalCacheCodec` | mapeamento 1:1 entre `AppPersistido` e as **chaves legadas** do `localStorage` | `:46-50` |

O `ConfigSnapshot` separado é o detalhe que explica o desenho: o Zustand `persist` precisa de leitura síncrona no boot, mas a nuvem só responde depois. Daí a camada (§4) em vez de um backend único.

## 3. Os backends

| Classe | Onde | O que é |
|---|---|---|
| `LocalCacheBackend` | `config-backend.ts:56-83` | `localStorage` via codec; é **snapshot síncrono no boot** e `ConfigBackend` nas reconciliações |
| `OneDriveJsonBackend` | `onedrive-config-backend.ts:214` | `toolbox.json` na OneDrive do usuário (Graph delegado) |
| `GoogleDriveJsonBackend` | `:289` | mesmo papel no `appDataFolder` do Google Drive (revision faz papel de `eTag`) |
| `RoteadorCloudBackend` | `:345` | escolhe o backend de nuvem pelo **provider** da conta ativa |
| `LocalStorageConfigPatchQueue` | `:389` | fila offline de patches, **isolada por conta**, sobrevive a restart |
| `LayeredBackend` | `:468` | orquestra local + nuvem: grava local na hora, envia à nuvem com debounce, reconcilia |

O codec local (`local-cache-backend.ts`) preserva as **chaves legadas** e suas migrações — é por isso que ele é grande e literal. Não é duplicação do estado: é o tradutor entre o formato antigo em disco e o `AppPersistido` de hoje.

### 3.1 O que sobe pra nuvem

`CHAVES_CONFIG_NUVEM` (`onedrive-config-backend.ts:17-46`) é a lista explícita — grupo A do #556 mais `organizations` (#560). **Estado de sessão e cache visual ficam deliberadamente de fora.**

Duas regras não-óbvias:

- **o `logo` das orgs nunca sobe.** `projetarConfigNuvem` (`:63`) zera o campo antes de enviar: é um data-URI pesado, re-hidratado localmente. A verdade da org é nome/domínios/website/notes/membros.
- **merge é last-write-wins por campo**, com `updatedAt` por chave (`UpdatedAtConfigNuvem`, `:49`) — não por documento. Um `412` recarrega e refaz o merge campo a campo, sem perda silenciosa (testes em `config-backend.test.ts:486-528`).

## 4. Escopo por owner

`LayeredBackend` é ativado com uma **string de conta**, não com um e-mail:

```
`${provider}:${email.toLowerCase()}`     // index.ts:240
```

O prefixo de provider é do **#697** e não é cosmético: Google e Microsoft com o mesmo e-mail **não** podem compartilhar cache nem fila offline.

O dono do cache local fica em `CONFIG_CACHE_OWNER_KEY` (`galaxie-toolbox.config-cache-owner.v1`, `index.ts:139`).

## 5. As DUAS limpezas — não confundir

Esta é a parte que mais se erra ao mexer aqui. São funções diferentes, gatilhos diferentes, alvos diferentes.

### 5.1 `resetSessaoCompleta()` — `index.ts:288-310`

**Gatilho:** *fronteira de conta* — login novo e logout. **Nunca** no restore da mesma conta.
**Alvo:** todo o estado **tenant-scoped**.
**Preserva de propósito:** config/prefs — tema, idioma, som, fundo, zoom, sidebar, assinaturas/templates, ordenação e filtros salvos.

Zera, em um lugar só:

- slices: mailbox, list, selection, reader, filters (consultas), compose, agenda, people, organizations, navegação (#568), reauth (#235);
- **vetores fora do store:** abas/pins/grupos do Navigator (`resetSessaoNavegador`, #821), cache de fotos, memo de branding do tenant (#541), memo de sessão do Graph no Rust (best-effort);
- **disco:** `purgarChavesTenant()` — hoje só `caixasCompartilhadas` e `agendaCalendariosSel` (`local-cache-backend.ts:196-199`), porque o resto do que é tenant-scoped ou não é persistido ou cai na limpeza 5.2.

> **Se você criar um slice com estado por-conta, o reset dele entra aqui.** O guarda é `store/reset-sessao.test.ts` (herança-zero por slice). Note o limite declarado no próprio teste: ele prova que **cada** ação de reset zera seus campos; que o seam **chama todas** é garantido pelo `tsc` e pelo live-QA de 2 contas, não pelo teste.

Invariante extra do #821, com teste próprio (`lib/lumen-821-account-switch-tabs-contract.test.ts`): **todo `resetSessaoCompleta()` é imediatamente seguido de `resetNavegadorSessao()`** — as abas internas vivem em `useState` do `App.tsx` e não são alcançadas pelo store.

### 5.2 `prepararConfiguracaoNuvem(email, provider)` — `index.ts:231-261`

**Gatilho:** *troca de dono do cache* — o `account` calculado difere do `CONFIG_CACHE_OWNER_KEY` gravado.
**Alvo:** o **cache local do que é sincronizado na nuvem**, para que as prefs da conta anterior não **semeiem** a nova.

Faz `purgarChavesConfigNuvem()` (`local-cache-backend.ts:239-249`) e repõe os defaults projetados no store, **antes de qualquer tela autenticada aparecer**. Só então ativa a camada com o novo owner.

A autoridade final não é o cache: é o arquivo no drive da conta. Se o `localStorage` estiver indisponível, o comentário no código é explícito — o isolamento continua valendo pelo arquivo remoto.

## 6. `organizations` é tenant-scoped por construção

O `toolbox.json` mora na OneDrive **do usuário autenticado**. Trocar de tenant carrega, por definição, as orgs do tenant novo — não há filtro a aplicar (`onedrive-config-backend.ts:10-16`, teste em `config-backend.test.ts:378`).

Isso vale enquanto a autoridade for o drive do usuário. **Se um dia a config passar a viver num backend de organização** (billing de org, PS7 slice 2), essa propriedade some e o escopo passa a ser responsabilidade explícita do backend novo. É o ponto do desenho que mais depende de premissa.

## 7. `OrgStatus` e claim de domínio

`OrgStatus = "contracted" | "uncontracted" | "none"` (`lib/types.ts:31`), derivado em `resolverOrgStatus` (`lib/organizations.ts:107`) a partir do **registro de orgs** — não do token:

| Conta | Domínio bate org contratada+verificada? | Resultado |
|---|---|---|
| `work` | sim | `contracted` |
| `work` | não | `uncontracted` (onboarding lead-gen, #698) |
| `personal` | sim | `contracted` — **absorção JIT** |
| `personal` | não | `none` |

O Rust/PS0 entrega `provider` + `accountKind` do token; a refinação contracted/uncontracted/none precisa da flag do admin e mora no TS.

**O gate é domínio VERIFICADO, nunca sufixo cru de e-mail.** Sem isso qualquer um com endereço `@cliente.com` se auto-promoveria ao tier da org. A prova de posse é o domain-claim do PS7 (`src-tauri/src/domain_claim.rs`): token opaco single-use + registro `galaxie-verify=…` publicado pelo admin (DNS TXT ou well-known HTTP). A slice 1 entrega o desafio e o match puro; o "marcar org contratada" + auto-join JIT + migração de config pessoal→org são slice 2.

`orgAbsorvente` (`organizations.ts:124-132`) responde *para onde* mover o estado quando essa migração existir — só conta `personal` é absorvida; a `work` já **é** a org.

## 8. Invariantes — quebrar qualquer uma é bug de vazamento

1. Estado tenant-scoped novo **tem** reset em `resetSessaoCompleta` (§5.1).
2. `resetSessaoCompleta()` nunca aparece sozinho: vem com `resetNavegadorSessao()` (#821).
3. Chave nova que deva sincronizar entra em `CHAVES_CONFIG_NUVEM` **e** em `CHAVES_CONFIG_NUVEM_LOCAL` — senão sincroniza mas não é purgada na troca de dono.
4. Identidade de conta é `provider:email`, nunca só e-mail (#697).
5. Nada de data-URI/binário sobe pro `toolbox.json` (§3.1).
6. Absorção de conta pessoal exige domínio **verificado** (§7).

## 9. Onde estão os testes

| Arquivo | Cobre |
|---|---|
| `store/config-backend.test.ts` | projeção da nuvem, strip do logo, matriz do grupo A, round-trip dos 3 backends, LWW por campo, `412` sem perda, fila offline isolada por conta, troca de tenant |
| `store/reset-sessao.test.ts` | herança-zero por slice (#555) |
| `lib/lumen-821-account-switch-tabs-contract.test.ts` | todo reset de sessão acompanhado do reset do Navigator |
| `lib/organizations-claim.test.ts` · `organizations-orgstatus.test.ts` | claim de domínio e derivação do `OrgStatus` |

## 10. Lacunas conhecidas

- **Cobertura da orquestração.** Nenhum teste carrega `resetSessaoCompleta` inteiro (alias `@/` + `persist`/`localStorage` não sobem no `node --test`). A garantia de que o seam chama *todos* os resets é `tsc` + live-QA de 2 contas. Um teste de componente com storage falso fecharia isso.
- **`CHAVES_TENANT` tem só 2 entradas.** Correto hoje, mas é a lista que envelhece calada: um slice que passe a persistir estado por-conta em chave própria sobrevive ao logout sem ninguém perceber. Vale um teste que derive a lista dos slices em vez de mantê-la à mão.
- **§6 depende de premissa.** O escopo por tenant é consequência de a config morar no drive do usuário. Backend de organização muda isso.
