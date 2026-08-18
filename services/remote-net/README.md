# galaxie-remote-net (S8)

Fronteira de rede **congelada** do GALAXIE Remote não-supervisionado —
`Galaxie.Remote.Net.v2` (épico #682, S8). Carrega **matrícula, autenticação e
controle de sessão**. Mídia e input **não** passam por aqui: seguem no caminho
WebRTC/DataChannel do S2 (`remote-transport`). Independente do pipe local do S7.

> **Escopo deste README: o que JÁ ESTÁ construído.** O que ainda é lacuna ou
> decisão futura (grants revogáveis, consent-first, audit encadeado no device)
> está em [`docs/remote/remote-s8-contrato-seguranca.md`](../../docs/remote/remote-s8-contrato-seguranca.md).
> Se os dois divergirem, **o código manda** — cada item abaixo aponta `arquivo:linha`.

## Invariantes de segurança implementados

### Ticket de sessão — `src/ticket.rs`

- **Ed25519 com domain separation.** Assina `DOMAIN ‖ claims_json`, com
  `DOMAIN = b"Galaxie.Remote.Net.v2/session-ticket\0"` (`:9`). A separação impede
  que uma assinatura deste domínio seja reaproveitada em qualquer outro.
- **Claims** (`:13-25`): `jti`, `session_id`, `device_id`, `controller_id`,
  `owner_id`, `org_id`, `device_nonce`, `controller_nonce`, `capabilities`,
  `issued_at`, `expires_at`. `deny_unknown_fields` — campo desconhecido é erro,
  não é ignorado.
- **Dois TTLs, e não são o mesmo número.** O emissor usa
  `TICKET_TTL_SECONDS = 60` (`src/authority.rs:20`); o **verificador impõe um teto
  independente de 120 s** em `validate_times` (`:150-152`), além de rejeitar
  `expires_at <= issued_at`, ticket do futuro e ticket vencido. Ou seja: mesmo que
  um emissor passe a assinar TTL maior, o consumidor recusa acima de 120 s.
- **Consumo único.** `TicketVerifier` guarda os `jti` já usados
  (`consumed: HashMap<String, u64>`, `:62-64`); reapresentar dá
  `TicketError::Replay` (`:133-136`). A tabela é coletada por expiração a cada
  verificação (`retain`, `:110`) — não cresce sem limite.
- **Binding conferido campo a campo.** `ExpectedTicket` (`:67-75`) obriga
  device/controller/owner/org, **os dois nonces** e as capabilities a baterem com
  o que o consumidor espera. Assinatura válida com binding errado é recusada
  (`TicketError::Binding`).
- **Sanitização dos ids** — `claims_are_safe` (`:163`) rejeita identificador
  malformado antes de qualquer uso.

### Identidade do device — `src/identity.rs`

- Chave **Ed25519** por device; a privada nunca sai em claro
  (`secret_bytes` devolve `Zeroizing`, `:20`).
- **Prova de posse no registro:** assina `device_id ‖ nonce ‖ timestamp` sob o
  domínio `b"Galaxie.Remote.Net.v2/device-register\0"` (`:6`), com **campos
  prefixados por tamanho** (`append_field`) — não há concatenação ambígua.
- Janela de relógio **±60 s** (`MAX_CLOCK_SKEW_SECONDS`, `:7`).
- `verify_registration` (`:53-79`) é pura: dá `Timestamp`, `Encoding` ou
  `Signature`, nunca "passa por engano".

### Autoridade (S0) — `src/authority.rs`, feature `authority`

- **Matrícula** com OPAQUE (`begin_enrollment` `:231` / `finish_enrollment` `:253`):
  o servidor **nunca vê a senha**; guarda o `password_file` do OPAQUE.
- **Registro exige prova de posse** (`register_device`, `:296-333`): device tem que
  estar matriculado e **não revogado**, e a assinatura é conferida por
  `verify_registration`. **Cache anti-replay** com chave `device_id:nonce` e
  expiração de 60 s — a assinatura sozinha não bastaria.
- **Autenticação do controlador** em duas fases (`:338` / `:396`), `AUTH_TTL_SECONDS = 60` (`:19`).
- **Sessão** só é autorizada pela autoridade (`authorize_session` `:456`,
  `authorize_session_ticket` `:467`) — é ela que emite as capabilities do ticket,
  **não** o owner local.
- **Revogação** (`revoke_device`, `:528`) e **trilha de auditoria**
  (`AuditRecord`/`AuditAction`, `:51-71`; `audit()` `:558`) para enroll, register,
  auth, sessão e revogação.
- Estado serializável (`snapshot_json` `:168` / `restore_snapshot_json` `:191`) —
  inclui os tickets já consumidos, para que um restart não reabra a janela de replay.

### Segredo em disco (Windows) — `src/windows_secret.rs`

- **DPAPI-NG** com descritor `"LOCAL=machine"` (`:15`).
- **Sem fallback em texto claro, por decisão explícita** (`:3-4`): quem chamar
  precisa falhar fechado se não conseguir proteger/recuperar.
- ⚠️ **Consequência que precisa estar clara:** `LOCAL=machine` é desprotegível por
  **qualquer** processo local da máquina. O segredo não está protegido *contra o
  host* — quem faz o isolamento de verdade é a **ACL do arquivo**. Tratar a ACL
  como parte do controle de segurança, não como detalhe de instalação.

### Protocolo — `src/protocol.rs`

- **12 métodos**, e só eles: `NetMessage` (`:26-52`) e a lista fechada
  `ALLOWED_METHODS` (`:191-204`).
- Todo payload usa `deny_unknown_fields`; envelope tipado (`Envelope<T>`, `:7`)
  com `MessageType` Request/Response/Event.
- **Teto de mensagem 64 KiB** (`MAX_MESSAGE_BYTES`, `src/lib.rs`).
- `Capabilities` (`:55-63`) tem **5 campos**: `screen`, `input`, `file_transfer`,
  `clipboard`, `audio`.

## Features (D1-bis, #955/#971)

| Feature | Módulos | Quem usa |
|---|---|---|
| `default` (vazio) | `protocol`, `ticket`, `identity`, `windows_secret` | **worker SYSTEM** (`remote-system-agent`) — só verifica ticket |
| `client` | `worker`, `transport` | daemon `galaxie-remote-device` (#691) |
| `authority` | `authority`, `opaque` | S0 `remote-signaling` |

O núcleo default **não puxa runtime async** — nada de `tokio`, `rustls`,
`opaque-ke` dentro de um binário privilegiado. Ao mexer aqui, **confira o corte**:

```
cargo check -p galaxie-remote-net                      # núcleo leve
cargo check -p galaxie-remote-net --features client
cargo check -p galaxie-remote-net --features authority
cargo tree  -p galaxie-remote-system-agent | grep -E "tokio|rustls|opaque"   # deve sair vazio
```

## Divergências conhecidas

- **`Capabilities` tem duas formas — e a menor já não descreve o produto.** 5 campos
  aqui (`protocol.rs:55-63`) contra 2 (`screen`, `input`) no `RemoteCapabilities`, que
  ainda é **duplicado** entre Rust (`src-tauri/src/remote.rs:104-107`) e TS
  (`src/lib/remote.ts:39-42`). Como **#688 (clipboard/file) e #689 (áudio) já
  entregaram** sobre o tipo de 5 campos, o `session.start` do S4 **não tem como
  declarar** capabilities que o produto já implementa. A convergência é **colapsar o
  de 2 no canônico de 5**, não o contrário.
- **Nenhum consumidor no device ainda.** Hoje só o `remote-signaling` (servidor)
  depende deste crate; o lado device entra com o daemon do #691.
