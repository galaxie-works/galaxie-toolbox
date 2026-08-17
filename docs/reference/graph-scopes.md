# Escopos Microsoft Graph — referência

Referência dos **escopos delegados** do Microsoft Graph concedidos ao app **GALAXIE** no tenant **Galaxie Works Ltd**. Use para consultar, na hora, se um escopo está disponível, se exige consentimento de admin e o que ele permite.

- **Fonte:** Entra ID → app registration → API permissions.
- **Atualizado:** 2026-08-03 · **101 escopos** · todos **Delegated** (`/me`), *public client* + PKCE (sem secret).
- **Histórico de contagem:** 53 → 63 → 75 → 77 → 84 → 87 → 101.

## Como ler

- **Todos os 101 já estão concedidos** (admin consent do tenant). As tabelas listam o que está disponível hoje.
- Coluna **Admin**: `✔` = exigiu consentimento de admin (**já dado**); `—` = user-consentable. **`✔` não significa "não concedido"** — significa apenas que precisou de admin, e o admin já consentiu.
- ⚠️ **Concedido ≠ requisitado.** O app só recebe no token os escopos listados em `src-tauri/src/config.rs` — hoje `SCOPES_BASE` (user-consentable) e `SCOPES_ORG` (admin consent), compostos por `scopes_para(tenant)`. Um escopo concedido que não esteja nessa lista **não vem no token** até ser adicionado **e** o usuário **relogar** (refresh com escopo novo). Adicionar um escopo já concedido **não** dispara novo consent.

**Requisitados hoje** (`config.rs` → `SCOPES_BASE` `:113` + `SCOPES_ORG` `:120`; conta pessoal/Google recebe só o BASE):

`SCOPES_BASE` — user-consentable, é o que **toda** conta recebe (inclusive pessoal/Google):

```
openid  profile  offline_access  User.Read  Mail.ReadWrite  Mail.Send
Calendars.ReadWrite  Tasks.ReadWrite  Files.ReadWrite  People.Read
Contacts.ReadWrite
```

`SCOPES_ORG` — exigem **admin consent**; só entram no pedido de conta **org contratada**:

```
User.Read.All  Directory.Read.All  Sites.Read.All  OrganizationalBranding.Read.All
Calendars.ReadWrite.Shared  MailboxSettings.ReadWrite
Mail.Read.Shared  Mail.ReadWrite.Shared  Mail.Send.Shared  Contacts.ReadWrite.Shared
MultiTenantOrganization.Read.All  Application.Read.All  ServicePrincipalEndpoint.Read.All
OrgSettings-AppsAndServices.Read.All  OrgSettings-Forms.Read.All
OrgSettings-Microsoft365Install.Read.All  OrgSettings-Todo.Read.All
OrgSettings-Todo.ReadWrite.All
```

> Esta é uma cópia de conveniência. **A fonte é o `config.rs`** — se divergir, o código manda.

---

## Correio · Mail / Exchange (18)

| Escopo | O que permite | Admin |
|---|---|:--:|
| `Mail.Read` | Ler o correio do usuário | — |
| `Mail.ReadBasic` | Ler correio básico do usuário | — |
| `Mail.ReadWrite` | Ler e escrever o correio do usuário | — |
| `Mail.Send` | Enviar e-mail como o usuário | — |
| `Mail.Read.Shared` | Ler correio do usuário e de caixas compartilhadas | — |
| `Mail.ReadBasic.Shared` | Ler correio básico do usuário e compartilhado | — |
| `Mail.ReadWrite.Shared` | Ler e escrever correio do usuário e compartilhado | — |
| `Mail.Send.Shared` | Enviar e-mail em nome de terceiros | — |
| `Mail-Advanced.ReadWrite` | Ler/escrever correio, incl. modificar mensagens não-rascunho | ✔ |
| `Mail-Advanced.ReadWrite.Shared` | O mesmo, sobre todo correio acessível ao usuário | ✔ |
| `MailboxFolder.Read` | Ler as pastas da caixa | — |
| `MailboxFolder.ReadWrite` | Ler e escrever as pastas da caixa | — |
| `MailboxItem.Read` | Ler os itens da caixa | — |
| `MailboxItem.ReadWrite` | Ler e escrever itens da caixa | ✔ |
| `EAS.AccessAsUser.All` | Acessar caixas via Exchange ActiveSync | — |
| `EWS.AccessAsUser.All` | Acessar caixas via Exchange Web Services | — |
| `IMAP.AccessAsUser.All` | Acesso de leitura/escrita a caixas via IMAP | — |
| `ExchangeMessageTrace.Read.All` | Pesquisar o rastreamento de mensagens | ✔ |

> O app é **Graph-only**: apesar de concedidos, `IMAP`/`EWS`/`EAS` **não são usados** (arquitetura delegada `/me`).

## Teams / Chat (13)

| Escopo | O que permite | Admin |
|---|---|:--:|
| `Chat.Create` | Criar chats | — |
| `Chat.Read` | Ler as mensagens de chat do usuário | — |
| `Chat.ReadBasic` | Ler nomes e membros das threads de chat | — |
| `Chat.ReadWrite` | Ler e escrever mensagens de chat do usuário | — |
| `Chat.ReadWrite.All` | Ler e escrever todas as mensagens de chat | ✔ |
| `ChatMessage.Read` | Ler mensagens de chat do usuário | — |
| `ChatMessage.Send` | Enviar mensagens de chat | — |
| `ChatMember.Read` | Ler os membros dos chats | ✔ |
| `ChatMember.ReadWrite` | Adicionar/remover membros de chats | ✔ |
| `Team.ReadBasic.All` | Ler nomes e descrições dos times | — |
| `TeamMember.Read.All` | Ler os membros dos times | ✔ |
| `TeamsActivity.Read` | Ler o feed de atividade do Teams | — |
| `TeamsUserConfiguration.Read.All` | Ler configurações de usuário do Teams | ✔ |

## Calendário / Bookings (9)

| Escopo | O que permite | Admin |
|---|---|:--:|
| `Calendars.Read` | Ler os calendários do usuário | — |
| `Calendars.ReadBasic` | Ler detalhes básicos dos calendários | — |
| `Calendars.ReadWrite` | Acesso total aos calendários do usuário | — |
| `Calendars.Read.Shared` | Ler calendários do usuário e compartilhados | — |
| `Calendars.ReadWrite.Shared` | Ler e escrever calendários do usuário e compartilhados | — |
| `Schedule.Read.All` | Ler itens de agenda (schedule) | ✔ |
| `Bookings.Read.All` | Ler informações do Bookings | — |
| `Bookings.ReadWrite.All` | Ler e escrever informações do Bookings | — |
| `BookingsAppointment.ReadWrite.All` | Ler e escrever compromissos do Bookings | — |

## Reuniões online · Teams (6)

| Escopo | O que permite | Admin |
|---|---|:--:|
| `OnlineMeetings.Read` | Ler as reuniões online do usuário | — |
| `OnlineMeetings.ReadWrite` | Ler e criar reuniões online do usuário | — |
| `OnlineMeetingArtifact.Read.All` | Ler artefatos das reuniões online | — |
| `OnlineMeetingRecording.Read.All` | Ler todas as gravações de reuniões online | ✔ |
| `OnlineMeetingTranscript.Read.All` | Ler todas as transcrições de reuniões online | ✔ |
| `OnlineMeetingAiInsight.Read.All` | Ler todos os AI Insights de reuniões online | ✔ |

## Contatos / Pessoas / Usuários / Diretório (19)

| Escopo | O que permite | Admin |
|---|---|:--:|
| `Contacts.Read` | Ler os contatos do usuário | — |
| `Contacts.ReadWrite` | Acesso total aos contatos do usuário | — |
| `Contacts.Read.Shared` | Ler contatos do usuário e compartilhados | — |
| `Contacts.ReadWrite.Shared` | Ler e escrever contatos do usuário e compartilhados | — |
| `People.Read` | Ler a lista de pessoas relevantes do usuário | — |
| `People.Read.All` | Ler a lista de pessoas relevantes de todos | ✔ |
| `User.Read` | Entrar e ler o perfil do usuário | — |
| `User.ReadBasic.All` | Ler o perfil básico de todos os usuários | — |
| `User.Read.All` | Ler o perfil completo de todos os usuários | ✔ |
| `profile` | Ver o perfil básico do usuário | — |
| `email` | Ver o endereço de e-mail do usuário | — |
| `ProfilePhoto.Read.All` | Ler a foto de perfil de usuário/grupo | ✔ |
| `ProfilePhoto.ReadWrite.All` | Ler e escrever a foto de perfil de usuário/grupo | ✔ |
| `OrgContact.Read.All` | Ler os contatos organizacionais | ✔ |
| `Organization.Read.All` | Ler informações da organização | ✔ |
| `OrganizationalBranding.Read.All` | Ler a identidade visual da organização | ✔ |
| `Domain.Read.All` | Ler domínios | ✔ |
| `Directory.Read.All` | Ler dados do diretório | ✔ |
| `RoleManagement.Read.Directory` | Ler as configurações de RBAC do diretório | ✔ |

## Arquivos / Sites · SharePoint / OneDrive (9)

| Escopo | O que permite | Admin |
|---|---|:--:|
| `Files.Read` | Ler os arquivos do usuário | — |
| `Files.Read.All` | Ler todos os arquivos acessíveis ao usuário | — |
| `Files.Read.Selected` | Ler arquivos que o usuário seleciona (preview) | — |
| `Files.ReadWrite` | Acesso total aos arquivos do usuário | — |
| `Files.ReadWrite.All` | Acesso total a todos os arquivos acessíveis | — |
| `Files.ReadWrite.AppFolder` | Acesso total à pasta do próprio app (preview) | — |
| `Files.ReadWrite.Selected` | Ler e escrever arquivos que o usuário seleciona (preview) | — |
| `Files.SelectedOperations.Selected` | Acessar arquivos selecionados em nome do usuário | ✔ |
| `Sites.Read.All` | Ler itens em todas as coleções de sites | — |

## OneNote (5)

| Escopo | O que permite | Admin |
|---|---|:--:|
| `Notes.Create` | Criar blocos de anotações do OneNote | — |
| `Notes.Read` | Ler os blocos de anotações do usuário | — |
| `Notes.Read.All` | Ler todos os blocos acessíveis ao usuário | — |
| `Notes.ReadWrite` | Ler e escrever os blocos do usuário | — |
| `Notes.ReadWrite.All` | Ler e escrever todos os blocos acessíveis | — |

## Tarefas / Notificações / Analytics / Bookmarks (7)

| Escopo | O que permite | Admin |
|---|---|:--:|
| `Tasks.Read` | Ler tarefas e listas de tarefas do usuário | — |
| `Tasks.Read.Shared` | Ler tarefas do usuário e compartilhadas | — |
| `Tasks.ReadWrite` | Criar, ler, atualizar e excluir tarefas e listas | — |
| `Tasks.ReadWrite.Shared` | Ler e escrever tarefas do usuário e compartilhadas | — |
| `UserNotification.ReadWrite.CreatedByApp` | Entregar e gerir notificações do usuário | — |
| `Analytics.Read` | Ler estatísticas de atividade do usuário | — |
| `Bookmark.Read.All` | Ler todos os bookmarks acessíveis ao usuário | — |

## Aplicações / Service Principals (2)

| Escopo | O que permite | Admin |
|---|---|:--:|
| `Application.Read.All` | Ler aplicações do tenant | ✔ |
| `ServicePrincipalEndpoint.Read.All` | Ler endpoints de service principals | ✔ |

## Org settings / Multi-tenant (7)

| Escopo | O que permite | Admin |
|---|---|:--:|
| `MultiTenantOrganization.Read.All` | Ler detalhes e tenants da organização multi-tenant | ✔ |
| `MultiTenantOrganization.ReadBasic.All` | Ler detalhes básicos e tenants ativos | — |
| `OrgSettings-AppsAndServices.Read.All` | Ler configs org-wide de apps e serviços | ✔ |
| `OrgSettings-Forms.Read.All` | Ler configs org-wide do Microsoft Forms | ✔ |
| `OrgSettings-Microsoft365Install.Read.All` | Ler configs org-wide de instalação do M365 | ✔ |
| `OrgSettings-Todo.Read.All` | Ler configs org-wide do Microsoft To Do | ✔ |
| `OrgSettings-Todo.ReadWrite.All` | Ler e escrever configs org-wide do Microsoft To Do | ✔ |

## Admin / Relatórios / Auditoria (6)

| Escopo | O que permite | Admin |
|---|---|:--:|
| `Reports.Read.All` | Ler todos os relatórios de uso | ✔ |
| `ServiceHealth.Read.All` | Ler a saúde dos serviços | ✔ |
| `AuditLogsQuery.Read.All` | Ler logs de auditoria de todos os serviços | ✔ |
| `AuditLogsQuery-Exchange.Read.All` | Ler logs de auditoria do Exchange | ✔ |
| `AuditLogsQuery-OneDrive.Read.All` | Ler logs de auditoria do OneDrive | ✔ |
| `AuditLogsQuery-SharePoint.Read.All` | Ler logs de auditoria do SharePoint | ✔ |

**Total: 101** — Mail 18 · Teams 13 · Calendário 9 · Reuniões 6 · Pessoas/Diretório 19 · Arquivos 9 · OneNote 5 · Tarefas 7 · Apps 2 · Org settings 7 · Admin 6.

---

## O que cada área destrava (notas de roadmap)

Referência rápida de como os escopos concedidos habilitam funcionalidades. Detalhe de produto vive nas issues/épicos.

- **Atoms** (#181, replanejado — ver [`atoms-ux-replan.md`](../atoms/atoms-ux-replan.md)): `Chat.Read` está concedido → o blocker do widget de Teams (A6/#445) é só adicioná-lo à `SCOPES_BASE` + relogar, **não** é consent de admin. `Tasks.Read`/`Tasks.ReadWrite` → widget de To-Dos com dado real. `Notes.*` → widget OneNote (follow-up).
- **Previews / seletor de arquivo** (#178): a família `Files.*` completa (incl. `Files.Read.Selected`, `Files.ReadWrite.Selected`, `Files.SelectedOperations.Selected`) permite **acesso granular por arquivo selecionado**, sem escopo amplo.
- **Galaxie AI** (#180): `Directory.Read.All` + `RoleManagement.Read.Directory` → derivar o "usuário master" do papel de admin no M365. `OnlineMeetingRecording/Transcript/AiInsight.Read.All` → puxar a gravação oficial via Graph e rodar ASR própria. `Chat.*`/`ChatMessage.*`/`TeamsActivity.Read` → IA lê/age em chats.
- **People** (#167): `User.Read.All` + `People.Read.All` + `ProfilePhoto.Read.All` → enrich por diretório e foto.
- **Bookings** (novo): `Bookings.ReadWrite.All` + `BookingsAppointment.ReadWrite.All` → base para um módulo de agendamento/reservas.
- **Apps tenant-aware** (M365 > Apps): `Application.Read.All` + `ServicePrincipalEndpoint.Read.All` → listar apps/service principals reais do tenant, em vez do catálogo estático.
- **Admin/governança da org** (#180 / Astro): `MultiTenantOrganization.*` + `OrgSettings-*` + `AuditLogsQuery-*` + `Reports.Read.All` → base para painel de admin, compliance e o contexto multi-tenant do modelo de créditos.
