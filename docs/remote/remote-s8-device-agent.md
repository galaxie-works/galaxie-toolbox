# Remote S8 — Onde mora o cliente do device (DECISÃO)

> **Status:** **DECIDIDO** — @Altair (architect), 2026-08-15, dentro do frame do
> Wagner (str0m + coturn + HW H.264, Windows-first, iroh no backlog #945).
> Responde a pergunta do #691 que ficou aberta no fecho do S7 (#690, doc
> [`remote-s7-worker-session-channel.md`](./remote-s7-worker-session-channel.md)):
> **quem hospeda o `remote-net::worker::WorkerClient` no device.** Este doc também
> **corrige dois pontos do doc do S7** (§6) — não implementado ainda.

## 1. A pergunta

O crate `galaxie-remote-net` (S8, `Galaxie.Remote.Net.v2`) tem o cliente do device
pronto — `WorkerClient` (registro assinado, heartbeat, recebimento de
`session.request` com ticket verificado: `services/remote-net/src/worker.rs:47-168`).
**Ninguém no device o consome:** nenhum `Cargo.toml` fora do `remote-signaling`
(servidor) depende do `galaxie-remote-net`. Sem decidir onde ele roda, o S7 fica
sem interlocutor: o worker privilegiado não sabe com quem falar.

Candidatos levantados: **broker Delphi (Sessão 0)** vs **worker Rust (sessão
interativa)**.

## 2. Decisão

**Nenhum dos dois. Entra um terceiro processo: `galaxie-remote-device.exe` —
daemon Rust, `LocalSystem`, Sessão 0, lançado e supervisionado pelo broker.**

Ele hospeda o `WorkerClient`, guarda a identidade do device e passa a ser o
**owner do canal S7 no modo não-supervisionado** — o mesmo papel que o Tauri faz
no modo supervisionado, **sobre exatamente o mesmo contrato**.

```
  S0 (nuvem)
     │  Galaxie.Remote.Net.v2 (WSS pinado, Ed25519, ticket)
     │
  ┌──┴──────────────────────────┐        ┌──────────────────────────────┐
  │ galaxie-remote-device.exe   │        │ GalaxieRemoteSystem.exe      │
  │ SYSTEM · Sessão 0 · sempre  │───────▶│ broker Delphi · SCM · Sess.0 │
  │ WorkerClient + identidade   │ pipe   │ (pipe congelado v1, intacto) │
  └──────────┬──────────────────┘  v1    └──────────────┬───────────────┘
             │ Galaxie.Remote.Worker.Session.v1         │ CreateProcessAsUser
             │ (canal do S7 — owner = daemon)           ▼
             └────────────────────────────▶ galaxie-remote-agent.exe
                                            SYSTEM · sessão interativa
                                            (str0m + capture + input)
```

## 3. Por que não o worker interativo — ele é **transiente por construção**

Não é opinião, está no broker:

- **`desktop.setMode` MATA e relança o worker** (`RemoteSystem.Session.pas:355-378`:
  `StopAgent` seguido de `EnsureAgent`). Toda troca login↔UAC↔desktop derrubaria a
  conexão S8 e forçaria re-registro.
- **Troca de sessão ativa mata e relança o worker** (`RemoteSystem.Session.pas:386-410`,
  `Tick`: se `FSessionId <> CurrentSession`, reinicia). Logon/logoff/fast-user-switching
  = presença S8 caindo.

Um device que precisa estar **registrado e alcançável sem usuário logado** não pode
ter sua presença amarrada a um processo que reinicia a cada mudança de desktop.

## 4. Por que não o broker Delphi

O `WorkerClient` é **async/tokio** (`worker.rs:110-144`: `tokio::select!` +
`tokio::time::interval`) sobre WSS com **pin de certificado** (`transport.rs`),
**Ed25519** (`identity.rs`), verificação de **ticket assinado** (`ticket.rs`) e
**OPAQUE** (`opaque.rs`). Hospedar isso no broker significa **reimplementar em
Delphi um crate Rust já pronto e testado** — o pior tipo de reescrita: cripto,
sem ganho, com o original vivo ao lado. O Delphi do Wagner continua no que é bom:
SCM, sessão, token, pipe.

## 5. Forma do daemon: **filho supervisionado do broker**, não um segundo serviço

- Reusa o padrão de supervisão que **já existe e já foi testado** (`LaunchAgent` /
  `Tick` / `StopAgent`) — e é mais simples que o do worker: **não precisa** de
  `SetTokenInformation(TokenSessionId)` nem `WTSQueryUserToken`; é `CreateProcess`
  puro no contexto do próprio serviço (SYSTEM, Sessão 0).
- **Um serviço instalado**, um `--install`/`--uninstall`, um caminho de path fixo,
  um fluxo de assinatura — em vez de dois serviços pra instalar, atualizar,
  assinar e diagnosticar.
- **Zero protocolo novo entre daemon e broker:** o daemon é só **mais um cliente do
  pipe congelado v1** (`hello` → `agent.ensure`). A DACL já o aceita (SYSTEM está
  na lista, `README.md:38-40`), e a validação de Authenticode/diretório vale pra
  ele porque ele fica no mesmo diretório fixo do serviço.

## 6. Correções ao doc do S7 (erros meus, achados ao ler o broker)

1. **§4.5 estava errado.** Eu escrevi que a troca de desktop via `desktop.setMode`
   re-atacha "sem derrubar a sessão de transporte" — **não é o que o broker faz**:
   `SetDesktopMode` para e relança o worker (`Session.pas:355-378`), matando a
   sessão. **Correção:** sessão não-supervisionada roda o worker em **`--desktop auto`**,
   e o worker **segue o desktop de input sozinho** (`services/remote-system-agent/src/lib.rs:287-311`:
   `OpenInputDesktop` + `SetThreadDesktop` a cada 250 ms quando o nome muda) — sem
   reinício, sem broker no caminho. **`desktop.setMode` fica proibido durante sessão
   ativa** (é ferramenta de pinagem fora de sessão).
2. **§4.4 estava impreciso.** Eu disse que as mensagens `signal` do canal virariam
   "vestigiais" quando o S8 ligasse. Falso: elas **continuam sendo o caminho** — só
   troca o dono da ponta (daemon no lugar do Tauri). O canal não muda; muda quem é
   o owner.

Ambas entram como errata neste doc; o doc do S7 permanece válido no resto (as 4
decisões e a autoridade de capabilities por ticket seguem de pé — e ficam **mais**
fortes: o ticket agora chega ao worker por um processo SYSTEM, nunca por processo
de usuário).

## 7. Identidade do device (onde a chave vive)

- `DeviceIdentity` (Ed25519, `identity.rs:9-40`) é **gerada dentro do daemon** e
  nunca sai dele. O app Tauri **não vê** a chave privada — mantém a postura de
  "o app nunca manipula credencial".
- Persistência: `windows_secret.rs` (DPAPI-NG, descritor `LOCAL=machine`, **sem
  fallback em texto claro** por design), blob no diretório fixo do serviço.
- ⚠️ **Achado de segurança:** `LOCAL=machine` é **desprotegível por qualquer
  processo local** — o descritor não distingue SYSTEM de usuário comum. Logo **a
  ACL do arquivo é o gate real**: o blob precisa de ACL **SYSTEM (+Administradores)
  apenas**, herança desligada, criado pelo daemon. DPAPI-NG aqui protege contra
  cópia do disco pra outra máquina, **não** contra leitura local por usuário.

## 8. Enrollment — o que cruza IPC (e o que não cruza)

`device.register` (Ed25519, daemon) e o **enrollment OPAQUE da senha permanente**
(`opaque.rs:52-90`, `ClientRegistrationFlow` — fluxo do **usuário**) são coisas
diferentes. Portanto:

- A **senha permanente nunca cruza IPC local**: o fluxo OPAQUE roda no app, com o
  usuário logado, contra o S0.
- O daemon precisa apenas de **dados de provisionamento não-secretos**: endpoint,
  pin do certificado, `deviceId`, `ownerId`/`orgId`, chave pública de ticket do
  servidor.
- **Superfície nova mínima:** pipe `Galaxie.Remote.Device.v1` no daemon (DACL
  SYSTEM + Logon SID da sessão ativa, JSON 64 KiB, `hello` com PID/sessão/Authenticode,
  fail-closed — mesma postura do broker), com **três** métodos: `provision`,
  `status`, `unenroll`. **Não** se estende o pipe do broker: a allowlist dele é
  congelada e coberta por teste adversarial (`RemoteSystem.Protocol.pas:172-178`) —
  mesma lógica que fundamentou o D3 do S7.
- **`provision` exige um token de enrollment de curta duração emitido pelo S0** ao
  usuário autenticado; o daemon **valida contra o S0**, não localmente. Assim,
  comprometer o pipe local não enrola o device em conta alheia.

## 9. Heartbeat, reconexão e sessão — nada novo a inventar

Já está no crate; o daemon só hospeda:
- Heartbeat de 30 s e backoff de reconexão 1 s → 60 s (`worker.rs:18-20`).
- `run(on_session)` entrega uma `AuthorizedSession { ticket, claims }` já verificada
  (assinatura, `session_id`, `device_id`, `device_nonce`: `worker.rs:147-168`).
- No `on_session`, o daemon: (1) `agent.ensure` no broker → coordenadas do canal;
  (2) conecta o canal do S7 e faz `hello` **com o `ticket`**; (3) `session.start`
  com as capabilities **derivadas do ticket** (S7 §4.3); (4) relaya `signal` entre
  S0 e worker; (5) `session.end` no fim ou na expiração do ticket.
- **Queda de sessão do Windows** (logoff/troca) mata o worker por design
  (`Session.pas:386-410`): o daemon detecta a queda do canal, encerra a sessão S8
  com motivo e fica disponível pra nova `session.request`. Recuperação é
  **re-sessão**, não reconexão de mídia — decisão consciente: mais simples e
  determinística que tentar manter transporte por cima de uma troca de desktop.

## 10. Ordem de implementação (pro @Confucius, depois dos passos 1-3 do S7)

0. **Feature-gate do `remote-net`** (D1-bis do doc do S7): `default` = núcleo leve
   (`protocol`/`ticket`/`identity`/`windows_secret`), `client` = `worker`+`transport`,
   `authority` = `authority`+`opaque`. O daemon liga **`features = ["client"]`**; o
   worker SYSTEM fica no `default`; o `remote-signaling` passa a
   **`features = ["authority"]`** (hoje arrasta a pilha WSS cliente sem usar).
1. **`galaxie-remote-device`** (crate binário novo): esqueleto SYSTEM + carga/geração
   da identidade (DPAPI-NG + ACL do §7) + `--provision-file` de teste. Sem rede.
2. **Pipe `Galaxie.Remote.Device.v1`** (`provision`/`status`/`unenroll`) + testes
   adversariais no estilo do helper (PID de outra sessão, >64 KiB, campo
   desconhecido, token de enrollment inválido/expirado).
3. **`WorkerClient` ligado** (registro + heartbeat contra o S0 de teste do #683).
4. **`on_session` → canal do S7** (fecha o fio: S0 → daemon → broker → worker).
5. **Delphi (Wagner):** lançar/supervisionar o daemon no `Tick` (mesmo padrão do
   worker, sem token de sessão).

## 11. O que fica pro Wagner (PO)

1. **Delphi:** supervisão do daemon (§5/§10.5) — além do campo aditivo do
   `agent.ensure` já pedido no doc do S7.
2. **Assinatura:** o daemon é um terceiro binário no gate de EV.
3. **Produto:** confirmar que o device **fica registrado no S0 mesmo sem ninguém
   logado** (é o que "não-supervisionado" significa) — é uma escolha de produto com
   consequência de privacidade/telemetria, não só técnica.

## 12. Resumo
O cliente S8 do device **não** mora no worker (transiente: o broker o mata a cada
troca de desktop/sessão) nem no broker Delphi (seria reescrever cripto Rust pronta).
Mora num **daemon Rust em Sessão 0, filho supervisionado do broker**, que guarda a
identidade (DPAPI-NG + ACL SYSTEM) e vira o **owner não-supervisionado do canal do
S7** — mesmo contrato, dono diferente. Superfície nova: **um** pipe de
provisionamento de três métodos. O pipe congelado do broker fica intacto.
