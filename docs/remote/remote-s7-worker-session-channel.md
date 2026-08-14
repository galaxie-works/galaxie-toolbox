# Remote S7 — Canal autenticado worker↔owner (PROPOSTA pro Wagner)

> **Status:** DESIGN/SPEC pra revisão do PO. **Não implementado.** Nada de Delphi
> aqui — só o lado Rust + o contrato do seam. Confucius escopa; Wagner decide a
> arquitetura antes de qualquer código. (#690, épico Remote #682.)

## 1. Contexto — o que JÁ existe (não re-desenhar)

O S7 já tem, construído e testado pelo Orion:

- **Broker Delphi** (`GalaxieRemoteSystem.exe`, `LocalSystem`/Sessão 0): descoberta
  de sessão, pipe protegido, ciclo de vida do worker, instalação SCM,
  `SetTokenInformation(TokenSessionId)` + `CreateProcessAsUser` pra lançar o worker
  na sessão interativa ativa em `winsta0\default`/`winsta0\winlogon`.
- **Worker Rust** (`galaxie-remote-agent.exe`): verifica identidade SYSTEM, faz
  `SetThreadDesktop` no desktop de input, emite `DesktopState`, espera o
  stop-event. **É o host privilegiado onde a sessão remota deve rodar.**
- **Broker pipe CONGELADO** (`\\.\pipe\Galaxie.Remote.System.v1`): JSON UTF-8,
  64 KiB, `hello/helloAck` (nonce), métodos `service.status` / `agent.ensure` /
  `agent.stop` / `desktop.setMode`. **Sem payload genérico, sem credencial, sem
  mídia — de propósito.**

## 2. O gap real (o único aberto neste seam)

O README do helper declara honestamente:

> *"Wiring the existing capture, transport and input crates requires a separately
> frozen authenticated worker-session channel with the S8/Tauri owner."*

O broker pipe **deliberadamente não carrega** signaling/mídia/input. Mas no modo
**não-supervisionado**, a sessão remota (str0m transport + `remote-capture` +
input) **tem que rodar DENTRO do worker SYSTEM** — não no processo Tauri (que roda
como o usuário logado e não alcança o secure desktop). Falta o **canal que leva o
material de sessão do owner (Tauri/S8) pra dentro do worker** e traz vídeo/eventos
de volta.

Hoje o `src-tauri/src/remote.rs` roda a sessão **no processo Tauri** (supervisionado):
`RuntimeSession` com `UdpSocket` real, `SessionConfig{ice_servers}`, `apply_signal`
(offer/answer/ICE), pump (`receive_udp`/`drain_capture`/`atender_timeout`/`drain_transport`).
No modo S7 essa MESMA lógica precisa executar no worker, alimentada por um canal
local em vez dos `Channel`/`Receiver` do Tauri.

## 3. Princípio de design

**O broker pipe continua sem tocar mídia/signaling.** Ele só faz o *bootstrap* e
*relaya as coordenadas de conexão* do canal de sessão. O material de sessão flui
num **canal dedicado worker↔owner**, autenticado, separado do broker pipe. Assim a
fronteira congelada do S7 fica intacta e o novo canal é frozen à parte.

## 4. O canal — `Galaxie.Remote.Worker.Session.v1`

### 4.1 Transporte
- **Named pipe dedicado por sessão**, criado **pelo worker**:
  `\\.\pipe\Galaxie.Remote.Worker.<sessionId>.<nonce>` — message-mode, UTF-8 JSON
  pro plano de controle; **quadros de vídeo/áudio em frames binários** (length-
  prefixed) no mesmo pipe ou num pipe irmão `...\.media` (decisão em §7).
- **DACL:** `SYSTEM` + o **Logon SID da sessão ativa** apenas. Clientes de rede e
  outras sessões negados. Mesma postura do broker pipe.

### 4.2 Bootstrap + autenticação (via broker, sem vazar material)
1. O owner (Tauri) chama `agent.ensure {sessionId}` no **broker pipe** (já existe).
2. **Extensão proposta ao broker** (mínima, aditiva): a resposta de `agent.ensure`
   passa a incluir `{ workerPipe, nonce, workerPid }` — as *coordenadas* do canal
   de sessão, geradas pelo worker e repassadas pelo broker. **Nenhum SDP/ICE/
   credencial trafega aqui** — só o nome do pipe + um nonce de uso único.
3. O owner conecta no `workerPipe` e manda `hello {ownerPid, sessionId, nonce}`. O
   worker valida: nonce bate, PID do cliente na sessão certa, Authenticode do owner
   (fail-closed, igual ao broker). Responde `helloAck {nonce}`.
4. Só após o `helloAck` o worker aceita `session.*`.

### 4.3 Mensagens (plano de controle, JSON)
Espelham o modelo que o `remote.rs` já usa (`RemoteSessionEvent`/`RuntimeCommand`),
pra a lógica de sessão ser **reusada**, não reescrita:

| Direção | Método/Evento | Payload |
|---|---|---|
| owner→worker | `session.start` | `{ role, capabilities, iceServers, sessionId }` |
| owner→worker | `signal` | `{ kind: offer\|answer\|iceCandidate, ... }` |
| owner→worker | `input` | `{ event }` (só controller→host) |
| owner→worker | `session.end` | `{ reason }` |
| worker→owner | `signal` | offer/answer/ICE do lado do worker (pro owner levar ao S0) |
| worker→owner | `session.state` | `{ state, detail? }` |
| worker→owner | `stats` | `{ bitrateBps, rttMs, frames }` |
| worker→owner (binário) | `video`/`audio` | frame length-prefixed (raw, como o `on_video` de hoje) |

O **owner continua sendo a ponte pro S0**: o signaling WebSocket segue no TS/S0; o
owner só *encaminha* os sinais entre o S0 e o worker por este canal. Nenhum
segredo/rota nova sai do owner.

### 4.4 Ciclo de vida
- `session.start` → o worker instancia o `Transport` (str0m) + liga `remote-capture`
  (que ele já pode capturar do desktop atachado) + injeta input; roda o mesmo pump
  do `remote.rs`.
- Troca de desktop (login/UAC) usa o `desktop.setMode` **do broker** (já existe) —
  o worker re-atacha `winsta0\winlogon` sem derrubar a sessão de transporte.
- `session.end` ou queda do pipe → teardown limpo; o worker volta a idle mas segue
  vivo (o broker decide `agent.stop`).

### 4.5 Segurança (fail-closed, herdada do S7)
- Sem comando genérico / sem path de executável / sem credencial no canal.
- `iceServers` são dados de conexão (TURN efêmero do coturn), não segredo
  persistente — ok trafegar; **tokens de auth do S8 NÃO** (ficam no owner).
- Validação de PID/sessão/Authenticode no `hello`, fail-closed.
- Limite de mensagem 64 KiB no controle; frames de mídia com teto explícito.

## 5. Contrato Rust proposto (sketch — não implementado)

Crate sugerido: reusar `remote-system-agent` (o worker) + um módulo novo
`session_channel` atrás de `#[cfg(windows)]`. Tipos espelham os do `remote.rs`
(mesmo enum de sinal do `remote-transport::SignalMessage`) pra zero divergência:

```rust
// remote-system-agent/src/session_channel.rs  (PROPOSTA)
pub enum OwnerToWorker {
    Start { role: Papel, capabilities: Capabilities, ice_servers: Vec<IceServer>, session_id: String },
    Signal(SignalMessage),              // reusa remote_transport::SignalMessage
    Input(InputEvent),                  // reusa remote_transport::InputEvent
    End { reason: String },
}

pub enum WorkerToOwner {
    Signal(SignalMessage),
    State { state: SessionState, detail: Option<String> },
    Stats(StatsSnapshot),               // reusa remote_transport::stats
    // vídeo/áudio vão em frame binário, fora do enum JSON
}
```

A lógica de sessão (o `RuntimeSession` do `remote.rs`) é **extraída** pra um núcleo
compartilhado (owner e worker chamam o mesmo pump), variando só a **fonte dos
comandos** (Tauri `Channel` no supervisionado; este pipe no worker). Isso evita dois
loops de sessão divergentes — mesma lição do seam #684 (um contrato, não cópia).

## 6. Não-objetivos
- **Nada de Delphi** nesta proposta (é do Wagner). O broker só ganha um campo
  aditivo na resposta de `agent.ensure` (coordenadas do canal).
- Não toca a fronteira congelada do broker pipe nem o `remote-net` (S8, enrollment/
  auth — canal separado).
- Não implementa; não pede/persiste o certificado EV (gate do PO).

## 7. Decisões que são do Wagner (PO)
1. **Mídia no mesmo pipe** (length-prefixed control+binário) **ou pipe irmão** `...\.media`? (Sugiro pipe irmão: separa o hot-path binário do controle JSON.)
2. Estender `agent.ensure` **ou** um método novo `session.open` no broker pra as coordenadas do canal?
3. Extrair o `RuntimeSession` do `remote.rs` pra um núcleo compartilhado agora (refactor) **ou** duplicar no worker e consolidar depois?
4. Vídeo do worker→owner→S0, **ou** o worker fala WebRTC direto (o `Transport` já é sans-I/O; o worker tem socket próprio)? — impacta se o owner é relay de mídia ou só de signaling.

## 8. Resumo
O S7 privilegiado (broker+worker+desktop) está construído. O único seam aberto é
**este canal autenticado** que planta a sessão de transporte dentro do worker
SYSTEM sem furar a fronteira congelada do broker. Proposta acima: named pipe
dedicado por sessão, bootstrap/nonce via broker, mensagens espelhando o
`remote.rs`, núcleo de sessão compartilhado. **Aguardo o call do Wagner nas 4
decisões da §7 antes de qualquer código.**
