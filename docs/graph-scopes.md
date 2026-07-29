# Microsoft Graph — escopos delegados concedidos (app GALAXIE Toolbox)

Fonte: Entra ID → app registration → API permissions, **admin consent concedido para "Galaxie Works Ltd"**.
Atualizado: **2026-07-29 — 63 escopos** (antes eram 53; +10 nesta rodada, com destaque pro bloco **Teams/Chat** e **Notes**).
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
| Calendars.Read | Não |
| Schedule.Read.All | **Sim** |
| Bookings.Read.All | Não |

## Contatos / Pessoas / Diretório
| Escopo | Admin? |
|---|---|
| Contacts.Read | Não |
| User.Read · profile · email | Não |
| User.ReadBasic.All | Não |
| User.Read.All | **Sim** |
| ProfilePhoto.Read.All · ProfilePhoto.ReadWrite.All | **Sim** |
| OrgContact.Read.All · Organization.Read.All · OrganizationalBranding.Read.All · Domain.Read.All | **Sim** |

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

## Admin / Relatórios / Auditoria
| Escopo | Admin? |
|---|---|
| Reports.Read.All · ServiceHealth.Read.All | **Sim** |
| AuditLogsQuery.Read.All · AuditLogsQuery-Exchange.Read.All · AuditLogsQuery-OneDrive.Read.All · AuditLogsQuery-SharePoint.Read.All | **Sim** |

## Impacto nas ideias/épicos
- **Atoms #181 (Slice 4 / #186):** `Chat.Read` **agora concedido** → o widget de **Teams chats não lidos deixa de precisar de consent round-trip** (era o principal bloqueio). `Notes.*` → o widget de **Anotações (OneNote)** vira viável (era "investigar"). Atualizar o AC da Slice 4.
- **Galaxie AI #180:** `Chat.Read/ReadWrite`, `ChatMessage.*`, `TeamsActivity.Read` → IA pode ler/agir em chats; `Organization.Read.All`/`User.Read.All` ajudam na questão do "usuário master" da org.
- **People #167 (Enrich):** `User.Read.All` + `ProfilePhoto.Read.All` → enrich por diretório (`/users/{id}`) e foto agora plenamente cobertos.
- **File previews #178:** `Files.ReadWrite` (já) → rota "Graph convert-to-PDF" confirmada.
