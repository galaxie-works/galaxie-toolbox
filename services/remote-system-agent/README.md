# galaxie-remote-system-agent (S7)

Worker **privilegiado** da sessão interativa do GALAXIE Remote (#690, S7). Roda
como **LocalSystem**, na sessão que o broker Delphi mandou, e é o único ponto do
sistema que alcança o **secure desktop** (Winlogon/UAC) — que a sessão do usuário
não alcança.

O broker (Delphi) detém SCM, sessão e IPC; este binário **verifica** que ainda é
LocalSystem na sessão pedida, prende a thread de captura ao desktop de input
escolhido e expõe transições de estado determinísticas pro driver de
captura/transporte. **Nenhuma credencial atravessa o pipe do S7.**

## Módulos

| Módulo | Papel |
|---|---|
| `session_channel` (`src/session_channel.rs`) | canal de sessão worker↔owner: handshake e **autoridade** (passo 2 da §9) |
| `pipe_server` (`src/pipe_server.rs`) | named pipe da sessão + **DACL** + presença local (passo 2b-io) |
| `lib.rs` | `DesktopMode`, bootstrap e verificação de privilégio |

## O gate de admissão

`validar_hello` (`session_channel.rs:156`) é **puro e fail-closed**, nesta ordem:

1. nonce refletido confere · 2. nonce não expirou · 3. **o PID do owner está na
sessão alvo** (a verdade é `PID→sessão`, não o `session_id` que o cliente diz) ·
4. **Authenticode do binário do owner** · 5. ticket do S8 → válido dá autoridade
do ticket (serve o não-supervisionado); ausente só passa no *attended*; inválido
recusa sempre.

O pipe já nasce restrito por DACL a **SYSTEM + o Logon SID daquela sessão**
(`dacl_sddl`) — o atacante relevante é código na sessão do usuário, não remoto.

> ⚠️ **Hoje nada é assinado no build**, e o passo 4 recusa binário sem assinatura
> confiável — ou seja, o handshake de runtime não fecha com build de dev. Ver
> **#1052** (fixar o publisher + corrigir o TOCTOU de PID) e a US de assinatura na
> esteira, que é pré-requisito.

## Dependência enxuta, de propósito

Consome **só o núcleo leve** do `galaxie-remote-net` (`default` = protocol/ticket/
identity) — `Capabilities` + `TicketVerifier` **sem** arrastar `tokio`, `rustls` ou
`opaque-ke` pra dentro de um binário SYSTEM (D1-bis, #971). Ao mexer nas deps,
confirme o corte:

```
cargo tree -p galaxie-remote-system-agent | grep -E "tokio|rustls|opaque|openssl"   # deve sair vazio
```

Release é compilado com `lto = "thin"`, `codegen-units = 1` e `strip`.
