# GALAXIE Remote signaling

Servidor de signaling próprio do GALAXIE Remote. O processo escuta HTTP/WebSocket
sem TLS dentro da rede Docker; o Traefik do VPS termina TLS e publica a rota WSS.

## Endpoints

- `GET /healthz` — liveness sem autenticação.
- `GET /v1/server-key` — chave pública Ed25519 que o cliente deve pinar.
- `GET /v1/ws` — upgrade WebSocket do protocolo v1.
- `GET /v2/ws` — `Galaxie.Remote.Net.v2` para enrollment/autenticação não-supervisionada.

No VPS, o prefixo `/remote` é removido pelo Traefik. Portanto os endpoints públicos
são `https://telemetry.thegalaxie.cloud/remote/healthz`,
`https://telemetry.thegalaxie.cloud/remote/v1/server-key` e
`wss://telemetry.thegalaxie.cloud/remote/v1/ws`.

## Fluxo assistido v1

1. Cada peer abre WSS e envia `register` com `device_id` e chave pública Ed25519.
2. O servidor devolve uma atestação assinada da chave do peer, a chave pública do
   signaling e credenciais TURN temporárias compatíveis com o REST API do coturn.
3. O peer que receberá suporte envia `create_assisted_session` e mostra o código.
4. O operador envia `redeem_assisted_session`; o código é consumido e os dois peers
   recebem `session_paired`.
5. Somente peers pareados podem trocar `offer`, `answer` e `ice_candidate`.

O modo não-supervisionado é reservado para a story S8. Ele não compartilha nem
contorna o código one-time do modo assistido.

## Fluxo não-supervisionado v2

O worker SYSTEM mantém apenas WSS de saída. A rota v2 exige enrollment OPAQUE,
prova Ed25519 da identidade do dispositivo e emite tickets Ed25519 curtos,
single-use e vinculados a owner/org/device/controller/nonces/capabilities. A rota
v1 e o pipe local `Galaxie.Remote.System.v1` permanecem inalterados.

## Configuração

O processo falha fechado quando os três segredos não estão presentes.

| Variável | Obrigatória | Padrão |
| --- | --- | --- |
| `GALAXIE_REMOTE_SIGNING_KEY_FILE` | sim | — |
| `GALAXIE_REMOTE_TURN_SECRET_FILE` | sim | — |
| `GALAXIE_REMOTE_OPAQUE_SETUP_FILE` | sim | — |
| `GALAXIE_REMOTE_UNATTENDED_STATE_FILE` | não | `/var/lib/galaxie-remote/unattended-v2.json` |
| `GALAXIE_REMOTE_BIND` | não | `0.0.0.0:8787` |
| `GALAXIE_REMOTE_TURN_URLS` | não | STUN/TURN no host de telemetria, porta 3478 |
| `GALAXIE_REMOTE_CODE_TTL_SECONDS` | não | `600` |
| `GALAXIE_REMOTE_MAX_CODE_TTL_SECONDS` | não | `900` |
| `GALAXIE_REMOTE_TURN_TTL_SECONDS` | não | `3600` |
| `GALAXIE_REMOTE_RATE_LIMIT_MESSAGES` | não | `120` |
| `GALAXIE_REMOTE_RATE_LIMIT_WINDOW_SECONDS` | não | `60` |
| `GALAXIE_REMOTE_REQUIRE_POP` | não | `false` |

As variantes sem `_FILE` existem apenas para desenvolvimento local. Produção monta
Docker secrets somente-leitura em `/run/secrets`.

### `GALAXIE_REMOTE_REQUIRE_POP` — enforce da prova de posse (#1049)

Com `false` (default) o `Register` do v1 é aceito **com ou sem** PoP, e o servidor
apenas **conta** quantos chegam sem ela. Com `true`, `Register` sem PoP válida é
recusado.

**Ligar derruba cliente que ainda não atualizou** — por isso o default é desligado
e a janela de virada é decisão do PO, não da esteira. Virar a flag é mudar o env no
compose e reiniciar o container: **não exige build nem release nova**.

Antes de ligar, leia o número no log do serviço (é para isso que ele existe):

```
#1049 register_pop: resumo do dia  dia_utc=… com_pop=… sem_pop=… recusados=…
```

`sem_pop` em zero por alguns dias = não há mais cliente velho conectando; ligar é
seguro. Enquanto `sem_pop` for alto, ligar corta esses clientes.

O serviço também loga, **no boot**, em qual estado subiu — quem opera não precisa
inferir pelo comportamento.

Valores aceitos: `1/true/yes/on` e `0/false/no/off`. Qualquer outra coisa **para o
boot** em vez de assumir `false` — ligar por engano derruba cliente, e não ligar por
typo dá falsa sensação de proteção; os dois lados são caros demais para um default
silencioso.

**Limite honesto:** esta flag **reduz a exposição** do sequestro de registro; ela
não fecha o T1. O fecho é o OPAQUE v2 (#1132).

Gere o setup OPAQUE uma única vez, sem sobrescrever um segredo existente:

```powershell
cargo run --manifest-path services/remote-net/Cargo.toml --example generate_opaque_setup -- infra/remote/secrets/opaque_setup
```

O comando não imprime o segredo e usa modo `0600` em Unix. Em Windows, restrinja
a ACL do diretório de destino antes da geração. Não regenere depois de enrollments,
pois o setup é necessário para abrir os registros OPAQUE persistidos.

## Gates locais

```powershell
cargo fmt --manifest-path services/remote-signaling/Cargo.toml -- --check
cargo clippy --manifest-path services/remote-signaling/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path services/remote-signaling/Cargo.toml
```

Os testes de integração usam sockets reais e cobrem: dois peers, atestação Ed25519,
código one-time, expiração, uso único, relay de SDP/ICE, frame malformado e rate-limit.

Os probes operacionais não imprimem credenciais:

```powershell
cargo run --manifest-path services/remote-signaling/Cargo.toml --example remote_probe
cargo run --manifest-path services/remote-signaling/Cargo.toml --example stun_probe
cargo run --manifest-path services/remote-signaling/Cargo.toml --example rate_limit_probe
```
