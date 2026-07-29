# Microsoft Graph — escopos delegados concedidos (app GALAXIE Toolbox)

Fonte: Entra ID → app registration → API permissions, **admin consent concedido para "Galaxie Works Ltd"**.
Atualizado: **2026-07-29 — 84 escopos** (53 → 63 → 75 → 77 → **84**; última rodada: **MultiTenantOrganization.*** + bloco **OrgSettings-*** (Apps&Services, Forms, M365Install, To Do RW) — settings org-wide/admin. Antes: Application/ServicePrincipal, Online Meetings, Directory/RoleManagement, Calendars).
Tipo: todos **Delegated** (o app é public client + PKCE, sem secret). "Admin?" = exige consentimento de admin.

> ⚠️ Adicionar escopo no Entra **não basta**: o app só recebe o token com o escopo se ele estiver na lista pedida em `config.rs`/auth e o usuário **relogar** (refresh com escopo novo). Muitos recursos exigem reconsentimento/novo login.

## Correio (Mail / Exchange)
| Escopo | Admin? |
|---|---|
| Mail.Read · Mail.ReadBasic · Mail.ReadWrite · Mail.Send | Não |
| Mail.Read.Shared · Mail.ReadBasic.Shared · Mail.ReadWrite.Shared · Mail.Send.Shared | Não |
| Mail-Advanced.ReadWrite · Mail-Advanced.ReadWrite.Shared | **Sim** |
| MailboxFolder.Read · MailboxFolder.ReadWrite · MailboxItem.Read | Não |
| MailboxItem.ReadWrite | **Sim** |
| EAS.AccessAsUser.All · EWS.AccessAsUser.All · IMAP.AccessAsUser.All | Não |
| ExchangeMessageTrace.Read.All | **Sim** |

## Teams / Chat  ⭐ NOVO nesta rodada
| Escopo | Admin? |
|---|---|
| Chat.Read · Chat.ReadBasic · Chat.ReadWrite · Chat.Create | Não |
| Chat.ReadWrite.All | **Sim** |
| ChatMessage.Read · ChatMessage.Send | Não |
| ChatMember.Read · ChatMember.ReadWrite | **Sim** |
| Team.ReadBasic.All · TeamsActivity.Read | Não |
| TeamMember.Read.All · TeamsUserConfiguration.Read.All | **Sim** |

## Calendário / Agendamento
| Escopo | Admin? |
|---|---|
| Calendars.Read · Calendars.ReadBasic · Calendars.ReadWrite | Não |
| Calendars.Read.Shared · Calendars.ReadWrite.Shared | Não |
| Schedule.Read.All | **Sim** |
| Bookings.Read.All | Não |

## Online Meetings (Teams)  ⭐ NOVO — chave pro #180
| Escopo | Admin? |
|---|---|
| OnlineMeetings.Read · OnlineMeetings.ReadWrite | Não |
| OnlineMeetingArtifact.Read.All | Não |
| OnlineMeetingRecording.Read.All · OnlineMeetingTranscript.Read.All · OnlineMeetingAiInsight.Read.All | **Sim** |

## Contatos / Pessoas / Diretório
| Escopo | Admin? |
|---|---|
| Contacts.Read | Não |
| User.Read · profile · email | Não |
| User.ReadBasic.All | Não |
| User.Read.All | **Sim** |
| ProfilePhoto.Read.All · ProfilePhoto.ReadWrite.All | **Sim** |
| OrgContact.Read.All · Organization.Read.All · OrganizationalBranding.Read.All · Domain.Read.All | **Sim** |
| Directory.Read.All · RoleManagement.Read.Directory | **Sim** |

## Arquivos / Sites (SharePoint / OneDrive)
| Escopo | Admin? |
|---|---|
| Files.ReadWrite · Files.ReadWrite.All | Não |
| Sites.Read.All | Não |

## OneNote (Notas)  ⭐ NOVO
| Escopo | Admin? |
|---|---|
| Notes.Read · Notes.Create · Notes.ReadWrite | Não |
| Notes.Read.All · Notes.ReadWrite.All | Não |

## Tarefas / Notificações / Atividade
| Escopo | Admin? |
|---|---|
| Tasks.ReadWrite | Não |
| UserNotification.ReadWrite.CreatedByApp | Não |
| Analytics.Read | Não |

## Aplicações / Service Principals do tenant
| Escopo | Admin? |
|---|---|
| Application.Read.All · ServicePrincipalEndpoint.Read.All | **Sim** |

## Org settings / Multi-tenant (admin)  ⭐ NOVO
| Escopo | Admin? |
|---|---|
| MultiTenantOrganization.Read.All | **Sim** |
| MultiTenantOrganization.ReadBasic.All | Não |
| OrgSettings-AppsAndServices.Read.All · OrgSettings-Forms.Read.All · OrgSettings-Microsoft365Install.Read.All | **Sim** |
| OrgSettings-Todo.Read.All · OrgSettings-Todo.ReadWrite.All | **Sim** |

## Admin / Relatórios / Auditoria
| Escopo | Admin? |
|---|---|
| Reports.Read.All · ServiceHealth.Read.All | **Sim** |
| AuditLogsQuery.Read.All · AuditLogsQuery-Exchange.Read.All · AuditLogsQuery-OneDrive.Read.All · AuditLogsQuery-SharePoint.Read.All | **Sim** |

## Impacto nas ideias/épicos
- **Atoms #181 (Slice 4 / #186):** `Chat.Read` **agora concedido** → o widget de **Teams chats não lidos deixa de precisar de consent round-trip** (era o principal bloqueio). `Notes.*` → o widget de **Anotações (OneNote)** vira viável (era "investigar"). Atualizar o AC da Slice 4.
- **Galaxie AI #180 — MUDANÇAS GRANDES da última rodada:**
  - **"Usuário master" da org agora tem caminho pronto:** `Directory.Read.All` + `RoleManagement.Read.Directory` (concedidos) → dá pra **derivar o master do papel de admin no M365** (opção A do discovery) **sem consent novo**.
  - **Meeting-assistant ganhou caminho oficial:** `OnlineMeetingRecording.Read.All` + `OnlineMeetingTranscript.Read.All` + `OnlineMeetingAiInsight.Read.All` → dá pra **puxar a GRAVAÇÃO oficial da reunião via Graph e rodar NOSSA ASR** (melhor que o transcript nativo, que o PO diz ser ruim) — alternativa mais limpa que a captura WASAPI/Delphi pra reuniões gravadas (o companion Delphi segue útil pra reunião ao vivo/não-gravada). `OnlineMeetingArtifact` = artefatos; `OnlineMeetings.ReadWrite` = criar/gerir.
  - `Chat.Read/ReadWrite`, `ChatMessage.*`, `TeamsActivity.Read` → IA lê/age em chats.
- **People #167 (Enrich):** `User.Read.All` + `ProfilePhoto.Read.All` → enrich por diretório (`/users/{id}`) e foto agora plenamente cobertos.
- **File previews #178:** `Files.ReadWrite` (já) → rota "Graph convert-to-PDF" confirmada.
- **Tela Apps (M365 Copilot > Apps):** `Application.Read.All` + `ServicePrincipalEndpoint.Read.All` (+ `OrgSettings-Microsoft365Install.Read.All`) → listar os **apps/service principals reais do tenant** da org (o que está de fato disponível/publicado), em vez do catálogo estático de `lib/apps.ts`. Abre uma melhoria concreta pra Apps ficar tenant-aware.
- **Astro #180 / admin da org:** `MultiTenantOrganization.*` + `OrgSettings-*` → base pra um **painel de admin/governança da org** (settings de Apps&Services, Forms, To Do org-wide, instalação M365) e pro contexto multi-tenant do modelo de créditos. `OrgSettings-Todo.ReadWrite.All` permite configurar To Do org-wide (relevante pro Atoms/To-Dos).
