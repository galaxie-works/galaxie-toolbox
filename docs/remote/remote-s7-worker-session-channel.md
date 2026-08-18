# Remote S7 — Canal autenticado worker↔owner (DESIGN FECHADO)

> **Status:** **DECIDIDO** — as 4 questões da §7 estão resolvidas pelo architect
> (@Altair, 2026-08-15) dentro do frame fixado pelo Wagner (str0m + coturn + HW
> H.264, Windows-first, iroh no backlog #945, RASystem não adotado). Proposta
> original do @Confucius (#937/#690). **Ainda não implementado** — este doc é o
> contrato que o @Confucius implementa. Nada de Delphi aqui: só o lado Rust + o
> seam. As pendências que sobraram pro PO estão na §10 (nenhuma bloqueia o
> começo da implementação).

## 1. Contexto — o que JÁ existe (não re-desenhar)

O S7 já tem, construído e testado pelo Orion:

- **Broker Delphi** (`GalaxieRemoteSystem.exe`, `LocalSystem`/Sessão 0): descoberta
  de sessão, pipe protegido, ciclo de vida do worker, instalação SCM,
  `SetTokenInformation(TokenSessionId)` + `CreateProcessAsUser` pra lançar o worker
  na sessão interativa ativa em `winsta0\default`/`winsta0\winlogon`.
- **Worker Rust** (`galaxie-remote-agent.exe`): verifica identidade SYSTEM, faz
  `SetThreadDesktop` no desktop de input, emite `DesktopState`, espera o
  stop-event (`services/remote-system-agent/src/lib.rs:270-313`). **É o host
  privilegiado onde a sessão remota deve rodar.**
- **Broker pipe CONGELADO** (`\\.\pipe\Galaxie.Remote.System.v1`): JSON UTF-8,
  64 KiB, `hello/helloAck` (nonce), métodos `service.status` / `agent.ensure` /
  `agent.stop` / `desktop.setMode` (allowlist fechada em
  `services/remote-system-helper/src/RemoteSystem.Protocol.pas:172-178`, com
  testes adversariais em `services/remote-system-helper/tests/`). **Sem payload
  genérico, sem credencial, sem mídia — de propósito.**

## 2. O gap real (o único aberto neste seam)

O README do helper declara honestamente
(`services/remote-system-helper/README.md:49-57`):

> *"Wiring the existing capture, transport and input crates requires a separately
> frozen authenticated worker-session channel with the S8/Tauri owner."*

O broker pipe **deliberadamente não carrega** signaling/mídia/input. Mas no modo
**não-supervisionado**, a sessão remota (str0m transport + `remote-capture` +
input) **tem que rodar DENTRO do worker SYSTEM** — não no processo Tauri (que roda
como o usuário logado e não alcança o secure desktop). Falta o **canal que leva o
material de sessão do owner (Tauri/S8) pra dentro do worker**.

Hoje o `src-tauri/src/remote.rs` roda a sessão **no processo Tauri** (supervisionado):
`RuntimeSession` com `UdpSocket` próprio (`remote.rs:469-476`), `SessionConfig{ice_servers}`,
`apply_signal` (offer/answer/ICE), pump (`receive_udp`/`drain_capture`/`atender_timeout`/`drain_transport`).
No modo S7 essa MESMA lógica precisa executar no worker, alimentada por um canal
local em vez dos `Channel`/`Receiver` do Tauri.

## 3. Princípio de design

**O broker pipe continua sem tocar mídia/signaling.** Ele só faz o *bootstrap* e
*relaya as coordenadas de conexão* do canal de sessão. O material de sessão flui
num **canal dedicado worker↔owner**, autenticado, separado do broker pipe. Assim a
fronteira congelada do S7 fica intacta e o novo canal é frozen à parte.

## 4. O canal — `Galaxie.Remote.Worker.Session.v1`

### 4.1 Transporte
- **Named pipe único e dedicado por sessão**, criado **pelo worker**:
  `\\.\pipe\Galaxie.Remote.Worker.<sessionId>.<nonce>` — message-mode, UTF-8 JSON,
  **teto de 64 KiB por mensagem** (mesma postura do broker pipe).
  **Não trafega mídia** (ver **D2**, §7) — logo não há pipe irmão `.media`, nem
  frame binário, nem length-prefix.
- **DACL:** `SYSTEM` + o **Logon SID da sessão ativa** apenas. Clientes de rede e
  outras sessões negados. Mesma postura do broker pipe.

### 4.2 Bootstrap + autenticação (via broker, sem vazar material)
1. O owner (Tauri) chama `agent.ensure {sessionId}` no **broker pipe** (já existe).
2. **Extensão aditiva ao broker** (ver **D3**, §7): a resposta de `agent.ensure`
   passa a incluir `{ workerPipe, nonce, workerPid }` — as *coordenadas* do canal
   de sessão, geradas pelo worker e repassadas pelo broker. **Nenhum SDP/ICE/
   credencial trafega aqui** — só o nome do pipe + um nonce de uso único, com
   **TTL curto (≤ 10 s)** e descartado no primeiro uso.
3. O owner conecta no `workerPipe` e manda `hello {ownerPid, sessionId, nonce, ticket?}`.
   O worker valida: nonce bate e não expirou, PID do cliente na sessão certa,
   Authenticode do owner (fail-closed, igual ao broker). Responde `helloAck {nonce}`.
4. Só após o `helloAck` o worker aceita `session.*`.

### 4.3 Autoridade de capabilities (correção de fronteira — ver §8)
O worker roda como **SYSTEM**; o owner roda como o **usuário logado**. Logo o
worker **não pode aceitar o owner como autoridade** sobre o que a sessão pode
fazer (input, clipboard, file-transfer, áudio) no modo não-supervisionado:

- **Não-supervisionado:** o `hello` **exige** `ticket` — o session ticket assinado
  do S8 (`services/remote-net/src/ticket.rs:13-25`: `TicketClaims{ session_id,
  device_id, controller_id, capabilities, issued_at, expires_at, … }`, Ed25519 com
  domain separation). O worker verifica assinatura + `session_id` + expiração e
  **deriva as capabilities do ticket**. O que o owner pedir em `session.start` só
  pode **restringir**, nunca ampliar. Sem ticket válido → fail-closed, sessão
  recusada.
- **Supervisionado (attended):** a autoridade é a **presença local** já provada no
  handshake (nonce do broker + PID/sessão + Authenticode); `ticket` é opcional e
  as capabilities vêm do `session.start` do owner.
- O canal fala o `Capabilities` do `remote-net`
  (`services/remote-net/src/protocol.rs:55-61`: `screen, input, file_transfer,
  clipboard, audio`) — **não** o `RemoteCapabilities` de 2 campos do
  `remote.rs:102-107` — pra o seam não precisar de segunda migração quando
  clipboard/file-transfer (#688) e áudio (#689) chegarem.

### 4.4 Mensagens (plano de controle, JSON — é tudo que o canal carrega)
Espelham o modelo que o `remote.rs` já usa (`RemoteSessionEvent`/`RuntimeCommand`),
pra a lógica de sessão ser **reusada**, não reescrita:

| Direção | Método/Evento | Payload |
|---|---|---|
| owner→worker | `session.start` | `{ role, capabilities, iceServers, sessionId }` (capabilities ⊆ ticket) |
| owner→worker | `signal` | `{ kind: offer\|answer\|iceCandidate, ... }` |
| owner→worker | `session.end` | `{ reason }` |
| worker→owner | `signal` | offer/answer/ICE do worker (pro owner levar ao S0) |
| worker→owner | `session.state` | `{ state, detail? }` |
| worker→owner | `stats` | `{ bitrateBps, rttMs, frames }` |

**Não existe** no canal: `video`, `audio`, `input`. Vídeo/áudio saem do worker
**direto por WebRTC** (D1) e o input do controlador chega **pelo DataChannel de
controle do próprio str0m** (`remote.rs:783-810` já decodifica e injeta) — o owner
não é rota de input no modo não-supervisionado.

O **owner é a ponte pro S0 apenas no signaling**. ⚠️ **Errata (#691, ver
[`remote-s8-device-agent.md`](./remote-s8-device-agent.md) §6):** eu havia escrito
que essas mensagens `signal` virariam *vestigiais* quando o S8 ligasse —
**errado**. Elas continuam sendo o caminho; o que muda é **quem é o owner**: no
não-supervisionado o papel sai do Tauri e vai pro daemon `galaxie-remote-device`
(SYSTEM, Sessão 0). O contrato deste canal não muda. **O design não depende do
processo do usuário estar vivo** para a mídia.

### 4.5 Ciclo de vida
- `session.start` → o worker instancia o `Transport` (str0m) sobre o **`IoDriver`**
  (`services/remote-transport/src/driver.rs:31-120`) + liga `remote-capture` (que
  ele já pode capturar do desktop atachado) + injeta input.
- Troca de desktop (login/UAC): ⚠️ **Errata (#691, ver
  [`remote-s8-device-agent.md`](./remote-s8-device-agent.md) §6.1).** Eu havia
  escrito que `desktop.setMode` re-atacha "sem derrubar a sessão de transporte" —
  **o broker não faz isso**: `SetDesktopMode` para e relança o worker
  (`services/remote-system-helper/src/RemoteSystem.Session.pas:355-378`), matando a
  sessão. **Correto:** sessão roda com `--desktop auto` e o **worker segue o
  desktop de input sozinho** (`services/remote-system-agent/src/lib.rs:287-311`),
  sem reinício; `desktop.setMode` fica **proibido durante sessão ativa**.
- `session.end`, queda do pipe **ou expiração do ticket** → teardown limpo (com
  release das teclas/botões presos, como o `release_pressed` do `remote.rs:901-917`);
  o worker volta a idle mas segue vivo (o broker decide `agent.stop`).

## 5. Contrato Rust (a implementar)

Módulo novo `session_channel` no crate do worker (`remote-system-agent`), atrás de
`#[cfg(windows)]`. Tipos espelham os do `remote.rs` (mesmo enum de sinal do
`remote-transport::SignalMessage`) pra zero divergência:

```rust
// remote-system-agent/src/session_channel.rs
pub enum OwnerToWorker {
    Start { role: Papel, capabilities: Capabilities, ice_servers: Vec<IceServer>, session_id: String },
    Signal(SignalMessage),              // reusa remote_transport::SignalMessage
    End { reason: String },
}

pub enum WorkerToOwner {
    Signal(SignalMessage),
    State { state: SessionState, detail: Option<String> },
    Stats(StatsSnapshot),               // reusa remote_transport::stats
}
```

Sem `Input` e sem frame binário (D1/D2). O `Capabilities` é o do `remote-net`
(§4.3). Desserialização do envelope com limite de 64 KiB e **`deny_unknown_fields`
nas mensagens do canal**; a resposta do **broker**, ao contrário, é lida
**tolerante a campos novos** (é fronteira de outro time — Delphi do Wagner).

## 6. Não-objetivos
- **Nada de Delphi** nesta proposta (é do Wagner). O broker só ganha um campo
  aditivo na resposta de `agent.ensure` (coordenadas do canal).
- Não toca a fronteira congelada do broker pipe nem o protocolo `Galaxie.Remote.Net.v2`
  (S8, enrollment/auth — canal separado).
- Não implementa; não pede/persiste o certificado EV (gate do PO).
- Não liga o `WorkerClient` do S8 no device — isso é #691.

## 7. As 4 decisões — RESOLVIDAS

### D1 — Mídia: **WebRTC direto do worker** (o owner NÃO é relay de mídia)
- O `Transport` é sans-I/O e a sessão **já possui socket próprio** hoje
  (`remote.rs:469-476`); no worker isso não muda — ele só passa a ser o dono do
  socket. Nada em str0m exige que o processo do usuário esteja no caminho.
- Relay pelo owner colocaria um processo **não-privilegiado do usuário** no
  hot-path de uma sessão que existe justamente para funcionar **sem usuário
  logado**: quando ninguém está logado, não há Tauri — a mídia morreria com ele.
- Custo de cópia real: o teto de frame hoje é **16 MiB** (`remote.rs:29`); relayar
  H.264 por named pipe é uma cópia a mais por frame no caminho crítico, sem ganho.
- **Consequência assumida:** o worker passa a linkar
  `galaxie-remote-transport` (features `webrtc` + `input`) e `galaxie-remote-capture`
  — hoje ele depende **só de `serde`/`windows`**
  (`services/remote-system-agent/Cargo.toml:7-21`). Isso põe **str0m/OpenSSL e Media
  Foundation dentro de um binário SYSTEM**. Mitigações **obrigatórias**: manter o
  worker sem comando genérico/sem path de executável (como hoje), assinatura
  Authenticode no gate de release, e o build do worker com as mesmas features
  do app (nada de `default-features` novo entrando por transitividade).

### D1-bis — `remote-net` ganha **feature-gates**; o binário SYSTEM consome só o núcleo leve
*(decisão de 2026-08-15, provocada pelo @Confucius no passo 2: o §4.3 manda o canal
usar `Capabilities`/`TicketClaims` do `remote-net`, mas o crate **não tem features** —
depender dele hoje arrasta tokio + tokio-tungstenite + rustls + opaque-ke + argon2
pra dentro do worker SYSTEM.)*

**Decisão: feature-gate o `remote-net`, com `default` = núcleo leve.** Não duplicar
os tipos (isso violaria a lição do #684, que é a base do §4.3) e não engolir a
árvore inteira.

| Feature | Módulos | Deps que entram | Quem liga |
|---|---|---|---|
| `default` (núcleo) | `protocol`, `ticket`, `identity`, `windows_secret` | `base64`, `ed25519-dalek`, `rand`, `serde`, `serde_json`, `thiserror`, `zeroize`, `windows-sys` | **worker SYSTEM** (`remote-system-agent`) |
| `client` | `worker`, `transport` | `tokio`, `tokio-tungstenite`, `rustls`, `webpki-roots`, `url`, `futures-util`, `sha2` | **daemon** `galaxie-remote-device` (#691) |
| `authority` | `authority`, `opaque` | `opaque-ke`, `argon2` | **S0** (`remote-signaling`) |

Anotações que sustentam a decisão:

- **É o padrão da casa, não invenção:** o `remote-transport` já faz exatamente isso —
  `default = []` com `webrtc`/`input`/`audio` opt-in, justamente pra "o crate ficar
  sempre verde onde não há OpenSSL" (`services/remote-transport/Cargo.toml`, bloco
  `[features]`).
- **O corte é limpo** (verificado importe a importe): `protocol.rs` usa só `serde`;
  `ticket.rs` e `identity.rs` só `base64`/`ed25519-dalek`/`rand`/`zeroize`;
  `transport.rs`/`worker.rs` concentram `tokio`/`rustls`/`tungstenite`;
  `opaque.rs`/`authority.rs` concentram `opaque-ke`/`argon2`. Nenhum módulo leve
  importa módulo pesado.
- **Ganho fora do S7:** o `remote-signaling` (servidor) usa **só** `authority` +
  `protocol` + constantes (`services/remote-signaling/src/v2.rs:12-20`) — hoje ele
  arrasta a pilha WSS **cliente** sem usar nada dela. O gate limpa o servidor junto.
- **Torna a mitigação do D1 verificável:** "nada de `default-features` novo entrando
  por transitividade" deixa de ser recomendação e vira algo que o CI checa com um
  `cargo check -p galaxie-remote-system-agent` (sem tokio, sem OpenSSL no caminho).
- **Consequência prática pro passo 2b:** depois do gate, verificar o ticket **dentro
  do worker** custa `ed25519-dalek` — não custa runtime async. O plano do @Confucius
  (handshake puro no passo 2, `verify_and_consume` + `Capabilities` no 2b) fica
  **certo e barato**; não precisa duplicar tipo nenhum.

### D2 — **Um pipe só, de controle** (sem pipe irmão de mídia)
- É consequência direta de D1: se mídia não cruza o canal, a pergunta
  "mesmo pipe ou irmão" **deixa de existir**. O canal fica **JSON puro, 64 KiB**,
  igual ao broker — mesma postura, mesmo teto, mesmo estilo de teste adversarial.
- Ganho concreto: nenhum framing binário novo pra especificar/congelar/testar, e o
  canal inteiro cabe numa auditoria de texto.
- O único tráfego de volume no canal é `stats` (1/s, `remote.rs:33`) — irrelevante.

### D3 — Bootstrap: **estender `agent.ensure` (aditivo)**, não criar `session.open`
- A allowlist de métodos do broker é **fechada e congelada** com testes
  adversariais (`RemoteSystem.Protocol.pas:172-178` + `tests/AdversarialProtocolTests.dpr`).
  Método novo = reabrir a superfície congelada e refazer o gate adversarial.
- Já existe **precedente exato** de resposta que carrega coordenada do worker: o
  `service.status` devolve `workerPid`/`agentSessionId`/`desktopMode`
  (`RemoteSystem.Session.pas:435-447`). Campo aditivo no `result` do `agent.ensure`
  é a mesma natureza — não muda verbo, não muda quem pode chamar.
- **Honestidade sobre o custo:** aditivo ≠ grátis. (a) O lado Delphi ainda precisa
  de mudança (é do Wagner, §10). (b) **Não existe cliente do broker pipe em Rust/TS
  hoje** — só o lado Delphi implementa o protocolo; o owner vai precisar de um
  `broker_client` novo de qualquer forma, e esse custo é igual nas duas opções.

### D4 — `RuntimeSession`: **extrair DEPOIS**, mas com o I/O convergido JÁ
- Extrair antes do worker existir é refatorar código **vivo e aprovado** com um
  único call site — risco no caminho supervisionado que já funciona, sem ganho.
- **Mas "depois" sem regra vira duas cópias.** Regra dura, e é o ponto que fecha a
  decisão: **o worker NÃO reescreve o loop de socket/timeout — ele usa o `IoDriver`**
  (`driver.rs:84-120`), que já foi extraído no #685 exatamente pra isso.
  Hoje o owner **re-implementa** esse loop à mão (`remote.rs:681-693` ≈
  `driver.rs:123-133`; `remote.rs:739-759` ≈ `driver.rs:96-118`) — se o worker
  copiar o owner, viram **três** cópias do mesmo pump.
- **Dívida nomeada, com gatilho:** quando o worker landar, sai um PR próprio
  migrando o owner pro `IoDriver` (2 call sites vivos, rede de segurança = harness
  E2E do #685). A extração do núcleo de sessão de alto nível vem depois disso, se
  ainda valer.
- Nota que reduz o medo da duplicação: o worker é **sempre Host**. Metade do
  `RuntimeSession` é Controller-only (`remote.rs:487-514` worker de vídeo,
  `816-849` `send_video`) e não vai pro worker; o que ele precisa é a metade Host
  (`477-484` injector, `515-538` captura, `695-737` drain/keyframe).

## 8. Achado de arquitetura fora das 4 (aceito no design, §4.3)

A proposta original mandava `capabilities` no `session.start` **do owner**. Isso faz
um processo SYSTEM confiar num processo do usuário para decidir se pode injetar
input/ler clipboard num secure desktop — inversão de privilégio. Como o S8 **já
emite ticket assinado com capabilities** (`ticket.rs:13-25`) e o `SessionRequest`
já é `{session_id, ticket}` (`protocol.rs:122-125`), o ticket é a autoridade
natural no modo não-supervisionado. Sem isso, o canal seria o elo fraco de todo o
S7. Fica como parte do contrato (§4.3), não como pergunta.

## 9. Ordem de implementação (pro @Confucius)

1. **`broker_client` (owner, Rust):** cliente do pipe congelado v1 —
   `hello`/`helloAck`, `service.status`, `agent.ensure`. Testável hoje contra o
   broker instalado; **não depende** de nenhuma decisão do Wagner.
2. **`session_channel` (worker):** servidor do pipe da §4.1 + DACL + handshake da
   §4.2/§4.3, ainda **sem** transporte — só handshake, `session.state` e teardown.
   Testes adversariais no estilo dos do helper (nonce errado/expirado, PID de outra
   sessão, mensagem > 64 KiB, campo desconhecido, ticket inválido/expirado).
3. **Pump do worker sobre o `IoDriver`** + `remote-capture` + injector (D1/D4).
4. **Fio owner↔worker fim-a-fim** no modo supervisionado (owner ainda faz a ponte
   de signaling) — é o caminho que dá pra provar sem o S8 ligado.
5. **PR próprio:** owner migra pro `IoDriver` (gatilho de D4).
6. (#691) `WorkerClient` do S8 no lado privilegiado → `signal` do canal vira vestigial.

Os passos 1–3 podem começar **agora**: nenhum depende das pendências da §10.

## 10. O que continua sendo do Wagner (PO) — não bloqueia o início

1. **Delphi:** incluir `{ workerPipe, nonce, workerPid }` no `result` do
   `agent.ensure` (aditivo, allowlist intocada) e relayar o nonce gerado pelo
   worker. Contrato acima; implementação é dele.
2. **Certificado EV / assinatura** do worker e do broker — gate de release já
   conhecido (README do helper). Sem ele, o QA real de login/UAC segue externo.
3. Confirmar que o worker linkar str0m/OpenSSL + Media Foundation (D1) é aceitável
   na postura de supply-chain do binário SYSTEM. **Recomendação do architect: é**,
   pela alternativa ser pior (relay de mídia por processo de usuário que nem existe
   no modo não-supervisionado).

## 11. Resumo
O S7 privilegiado (broker+worker+desktop) está construído. O único seam aberto é
**este canal autenticado**. Decidido: **um named pipe de controle JSON por sessão**,
bootstrap por **`agent.ensure` estendido (aditivo)**, **mídia direto do worker por
WebRTC** (owner nunca é relay de mídia/input), **capabilities com autoridade no
ticket assinado do S8** no não-supervisionado, e **`IoDriver` como pump único**
com a extração do núcleo de sessão adiada, porém nomeada e com gatilho.
