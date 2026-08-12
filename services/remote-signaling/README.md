# GALAXIE Remote signaling

Servidor de signaling próprio do GALAXIE Remote. O processo escuta HTTP/WebSocket
sem TLS dentro da rede Docker; o Traefik do VPS termina TLS e publica a rota WSS.

## Endpoints

- `GET /healthz` — liveness sem autenticação.
- `GET /v1/server-key` — chave pública Ed25519 que o cliente deve pinar.
- `GET /v1/ws` — upgrade WebSocket do protocolo v1.

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

## Configuração

O processo falha fechado quando os dois segredos não estão presentes.

| Variável | Obrigatória | Padrão |
| --- | --- | --- |
| `GALAXIE_REMOTE_SIGNING_KEY_FILE` | sim | — |
| `GALAXIE_REMOTE_TURN_SECRET_FILE` | sim | — |
| `GALAXIE_REMOTE_BIND` | não | `0.0.0.0:8787` |
| `GALAXIE_REMOTE_TURN_URLS` | não | STUN/TURN no host de telemetria, porta 3478 |
| `GALAXIE_REMOTE_CODE_TTL_SECONDS` | não | `600` |
| `GALAXIE_REMOTE_MAX_CODE_TTL_SECONDS` | não | `900` |
| `GALAXIE_REMOTE_TURN_TTL_SECONDS` | não | `3600` |
| `GALAXIE_REMOTE_RATE_LIMIT_MESSAGES` | não | `120` |
| `GALAXIE_REMOTE_RATE_LIMIT_WINDOW_SECONDS` | não | `60` |

As variantes sem `_FILE` existem apenas para desenvolvimento local. Produção monta
Docker secrets somente-leitura em `/run/secrets`.

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
