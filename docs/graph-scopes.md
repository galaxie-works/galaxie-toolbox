# Microsoft Graph — escopos delegados concedidos (app GALAXIE Toolbox)

Fonte: Entra ID → app registration → API permissions, **admin consent concedido para "Galaxie Works Ltd"**.
Atualizado: **2026-08-03 — 101 escopos** (53 → 63 → 75 → 77 → 84 → 87 → **101**). Última rodada (+14) trouxe, principalmente: a **família Files completa** (`Files.Read`, `Files.Read.All`, `Files.Read.Selected`, `Files.ReadWrite.AppFolder`, `Files.ReadWrite.Selected`, `Files.SelectedOperations.Selected`) → destrava seletor/preview granular de arquivo; **Bookings** de escrita (`Bookings.ReadWrite.All`, `BookingsAppointment.ReadWrite.All`); **Tasks** completo (`Tasks.Read`, `Tasks.Read.Shared`, `Tasks.ReadWrite.Shared`); **People.Read.All**; e **Bookmark.Read.All**.
Tipo: todos **Delegated** (o app é public client + PKCE, sem secret). "Admin?" = exige consentimento de admin (**"Não" ≠ "não concedido"** — os 101 já estão TODOS *granted*; "Não" só quer dizer que é user-consentable).

> ⚠️ Adicionar escopo no Entra **não basta**: o app só recebe o token com o escopo se ele estiver na lista pedida em `config.rs`/auth **e** o usuário **relogar** (refresh com escopo novo). Muitos recursos exigem reconsentimento/novo login.

## Correio (Mail / Exchange) — 18
| Escopo | Admin? |
|---|---|
| Mail.Read · Mail.ReadBasic · Mail.ReadWrite · Mail.Send | Não |
| Mail.Read.Shared · Mail.ReadBasic.Shared · Mail.ReadWrite.Shared · Mail.Send.Shared | Não |
| Mail-Advanced.ReadWrite · Mail-Advanced.ReadWrite.Shared | **Sim** |
| MailboxFolder.Read · MailboxFolder.ReadWrite · MailboxItem.Read | Não |
| MailboxItem.ReadWrite | **Sim** |
| EAS.AccessAsUser.All · EWS.AccessAsUser.All · IMAP.AccessAsUser.All | Não |
| ExchangeMessageTrace.Read.All | **Sim** |

## Teams / Chat — 13
| Escopo | Admin? |
|---|---|
| Chat.Read · Chat.ReadBasic · Chat.ReadWrite · Chat.Create | Não |
| Chat.ReadWrite.All | **Sim** |
| ChatMessage.Read · ChatMessage.Send | Não |
| ChatMember.Read · ChatMember.ReadWrite | **Sim** |
| Team.ReadBasic.All · TeamsActivity.Read | Não |
| TeamMember.Read.All · TeamsUserConfiguration.Read.All | **Sim** |

## Calendário / Agendamento / Bookings — 9
| Escopo | Admin? |
|---|---|
| Calendars.Read · Calendars.ReadBasic · Calendars.ReadWrite | Não |
| Calendars.Read.Shared · Calendars.ReadWrite.Shared | Não |
| Schedule.Read.All | **Sim** |
| Bookings.Read.All · Bookings.ReadWrite.All · BookingsAppointment.ReadWrite.All | Não |

## Online Meetings (Teams) — 6 — chave pro #180
| Escopo | Admin? |
|---|---|
| OnlineMeetings.Read · OnlineMeetings.ReadWrite | Não |
| OnlineMeetingArtifact.Read.All | Não |
| OnlineMeetingRecording.Read.All · OnlineMeetingTranscript.Read.All · OnlineMeetingAiInsight.Read.All | **Sim** |

## Contatos / Pessoas / Usuários / Diretório — 19
| Escopo | Admin? |
|---|---|
| Contacts.Read · Contacts.ReadWrite | Não |
| Contacts.Read.Shared · Contacts.ReadWrite.Shared | Não |
| People.Read | Não |
| People.Read.All | **Sim** |
| User.Read · profile · email | Não |
| User.ReadBasic.All | Não |
| User.Read.All | **Sim** |
| ProfilePhoto.Read.All · ProfilePhoto.ReadWrite.All | **Sim** |
| OrgContact.Read.All · Organization.Read.All · OrganizationalBranding.Read.All · Domain.Read.All | **Sim** |
| Directory.Read.All · RoleManagement.Read.Directory | **Sim** |

## Arquivos / Sites (SharePoint / OneDrive) — 9
| Escopo | Admin? |
|---|---|
| Files.Read · Files.Read.All · Files.Read.Selected | Não |
| Files.ReadWrite · Files.ReadWrite.All | Não |
| Files.ReadWrite.AppFolder · Files.ReadWrite.Selected | Não |
| Files.SelectedOperations.Selected | **Sim** |
| Sites.Read.All | Não |

## OneNote (Notas) — 5
| Escopo | Admin? |
|---|---|
| Notes.Read · Notes.Create · Notes.ReadWrite | Não |
| Notes.Read.All · Notes.ReadWrite.All | Não |

## Tarefas / Notificações / Atividade / Bookmarks — 7
| Escopo | Admin? |
|---|---|
| Tasks.Read · Tasks.Read.Shared · Tasks.ReadWrite · Tasks.ReadWrite.Shared | Não |
| UserNotification.ReadWrite.CreatedByApp | Não |
| Analytics.Read | Não |
| Bookmark.Read.All | Não |

## Aplicações / Service Principals do tenant — 2
| Escopo | Admin? |
|---|---|
| Application.Read.All · ServicePrincipalEndpoint.Read.All | **Sim** |

## Org settings / Multi-tenant (admin) — 7
| Escopo | Admin? |
|---|---|
| MultiTenantOrganization.Read.All | **Sim** |
| MultiTenantOrganization.ReadBasic.All | Não |
| OrgSettings-AppsAndServices.Read.All · OrgSettings-Forms.Read.All · OrgSettings-Microsoft365Install.Read.All | **Sim** |
| OrgSettings-Todo.Read.All · OrgSettings-Todo.ReadWrite.All | **Sim** |

## Admin / Relatórios / Auditoria — 6
| Escopo | Admin? |
|---|---|
| Reports.Read.All · ServiceHealth.Read.All | **Sim** |
| AuditLogsQuery.Read.All · AuditLogsQuery-Exchange.Read.All · AuditLogsQuery-OneDrive.Read.All · AuditLogsQuery-SharePoint.Read.All | **Sim** |

> **Total: 101** (18 Mail + 13 Teams + 9 Calendário + 6 Online Meetings + 19 Pessoas/Diretório + 9 Arquivos + 5 OneNote + 7 Tarefas + 2 Apps + 7 Org settings + 6 Admin).

## Impacto nas ideias/épicos
- **Atoms #181 (REPLANEJADO — ver `docs/atoms-ux-replan.md`, stories #440–446):** `Chat.Read` **está concedido** (admin consent; "Admin?=Não" = não exige admin, NÃO = "não concedido"). Blocker do widget de Teams (A6/#445) = só **adicionar Chat.Read à `config.rs` SCOPES + relogar** (consent incremental), não é permissão nova de admin. `Notes.*` concedido → widget OneNote viável (follow-up). `Tasks.Read`/`Tasks.ReadWrite` concedidos → widget de To-Dos com dado real.
- **File previews / seletor #178:** agora com a **família Files completa** — `Files.Read`, `Files.Read.All`, `Files.Read.Selected`, `Files.ReadWrite.Selected`, `Files.SelectedOperations.Selected` → dá pra fazer **acesso granular por arquivo selecionado** (preview/convert-to-PDF sem pedir escopo amplo). `Files.ReadWrite.AppFolder` → pasta própria do app.
- **Galaxie AI #180:**
  - **"Usuário master" da org:** `Directory.Read.All` + `RoleManagement.Read.Directory` (concedidos) → derivar o master do papel de admin no M365 (opção A do discovery) **sem consent novo**.
  - **Meeting-assistant:** `OnlineMeetingRecording.Read.All` + `OnlineMeetingTranscript.Read.All` + `OnlineMeetingAiInsight.Read.All` → puxar a **gravação oficial via Graph e rodar NOSSA ASR** (melhor que o transcript nativo). Companion Delphi segue útil pra reunião ao vivo/não-gravada.
  - `Chat.Read/ReadWrite`, `ChatMessage.*`, `TeamsActivity.Read` → IA lê/age em chats.
- **People #167 (Enrich):** `User.Read.All` + `People.Read.All` + `ProfilePhoto.Read.All` → enrich por diretório (`/users/{id}`) e foto plenamente cobertos.
- **Agendamento externo (novo):** `Bookings.ReadWrite.All` + `BookingsAppointment.ReadWrite.All` → base pra um módulo de **Bookings/agendamento** (marcar/gerir compromissos de reserva), além do calendário pessoal.
- **Tela Apps (M365 Copilot > Apps):** `Application.Read.All` + `ServicePrincipalEndpoint.Read.All` (+ `OrgSettings-Microsoft365Install.Read.All`) → listar os **apps/service principals reais do tenant**, em vez do catálogo estático de `lib/apps.ts`. Apps tenant-aware.
- **Astro #180 / admin da org:** `MultiTenantOrganization.*` + `OrgSettings-*` → base pra um **painel de admin/governança da org** (Apps&Services, Forms, To Do org-wide, instalação M365) e pro contexto multi-tenant do modelo de créditos. `OrgSettings-Todo.ReadWrite.All` permite configurar To Do org-wide (relevante pro Atoms/To-Dos).
- **Auditoria/relatórios (admin):** `AuditLogsQuery-*` + `Reports.Read.All` + `ServiceHealth.Read.All` → base pra telas de compliance/telemetria administrativa da org.
