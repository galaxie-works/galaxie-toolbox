# galaxie-remote-broker-client (S7)

Cliente **Rust** do broker pipe **congelado** do S7 —
`\\.\pipe\Galaxie.Remote.System.v1` (#690, passo 1 da §9 do design worker↔owner).
É o lado **owner** (Tauri) falando com o broker **Delphi**, que é quem detém
SCM, sessão e IPC. Serve só pro **bootstrap** do worker privilegiado:
**não carrega mídia nem signaling**.

## Tipos públicos

| Tipo | Papel |
|---|---|
| `BrokerTransport` | trait do transporte — o núcleo é testável com mock, sem broker |
| `BrokerClient<T>` (`src/lib.rs:166`) | fala o protocolo v1 sobre um transporte qualquer |
| `DesktopMode` (`:24`) | `auto` · `default` · `winlogon` (`wire_name` é o valor de fio) |
| `ServiceStatus` (`:86`) | resposta do `service.status` |
| `AgentEnsure` (`:106`) | resposta do `agent.ensure` |
| `BrokerErrorBody` (`:67`) · `BrokerClientError` (`:125`) | erro do broker vs erro do cliente |
| `windows_pipe` | transporte de named pipe real, atrás de `cfg(windows)` |

Métodos do protocolo v1: `hello`/`helloAck`, `service.status`, `agent.ensure`,
`agent.stop`, `desktop.setMode`.

## Postura de parsing (design §5)

**Nossas requests são estritas; as respostas do broker são lidas tolerantes a
campos novos** — é fronteira de outro time (o Delphi). Em particular, o campo
aditivo `{ workerPipe, nonce, workerPid }` do `agent.ensure` já é aceito aqui e
**ainda não landou do lado Delphi** (§10 do design).

## Cuidado ao mexer

`desktop.setMode` **não preserva a sessão**: o broker **para e relança** o worker.
Todo estado do worker é transiente por construção — ver
[`docs/remote/remote-s7-worker-session-channel.md`](../../docs/remote/remote-s7-worker-session-channel.md)
(errata do §4.5) antes de assumir continuidade.

Núcleo (protocolo + cliente) é platform-agnostic: `cargo test -p galaxie-remote-broker-client`
roda em qualquer ambiente.
