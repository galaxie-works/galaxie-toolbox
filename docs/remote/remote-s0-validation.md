# Remote S0 — evidência de validação

Execução UTC: `2026-08-12`. VPS: Hostinger KVM SP da telemetria.

## Signaling/WSS

- `GET /remote/healthz`: HTTP 200, corpo `ok`.
- `/remote/v1/server-key`: Ed25519, protocolo 1, chave pública de 32 bytes.
- Dois clientes WebSocket reais conectaram por TLS ao endpoint público, registraram
  IDs/chaves, verificaram o pin e a atestação, parearam com código one-time e trocaram
  offer, answer e ICE.
- Um frame JSON malformado retornou `invalid_frame`; a mesma conexão seguiu utilizável.
- Código consumido não pôde ser reutilizado; expiração também é coberta pelo teste
  automatizado com relógio real.
- O rate-limit por IP original encaminhado pelo Traefik disparou no endpoint público.

Saída sanitizada:

```text
probe_ok wss_tls=yes peers=2 malformed_frame=survived pin=verified attestation=verified code=single_use signaling=offer_answer_ice
rate_limit_ok active=yes messages_before_limit=108
```

## STUN/TURN

- Probe STUN externo ao VPS recebeu `Binding Success` e `XOR-MAPPED-ADDRESS` com o
  endereço reflexivo público do cliente.
- Coturn criou allocations no IP público dentro do range `49160–49200`.
- O relay foi testado entre duas redes Docker isoladas: uclient numa rede, peer UDP
  noutra e coturn no host como único relay. Foram enviados/recebidos 20/20 pacotes,
  com zero perda.

Saídas sanitizadas:

```text
stun_ok family=ipv4 reflexive_ip=189.29.x.x reflexive_port=<ephemeral>
turn_relay_ok isolated_networks=2 messages=20 loss=0_percent
```

## Hardening/deploy

- `galaxie-remote.service`: active/enabled.
- Signaling: usuário não-root UID/GID 10001, filesystem read-only, capabilities vazias,
  sem porta publicada diretamente.
- Coturn: usuário `nobody`, filesystem read-only, somente `NET_BIND_SERVICE`, range de
  relay limitado a 41 portas UDP.
- Secrets: arquivos root:20000 modo 0440, montados apenas nos dois containers; nenhum
  valor entrou em log, Git ou comando publicado.
- UFW ativo: apenas 22/TCP, 80/TCP, 443/TCP, 3478/TCP+UDP e 49160–49200/UDP.
- Backup anterior ao deploy: `/var/backups/galaxie-remote/20260812T001112Z`.
- OpenObserve e Traefik existentes permaneceram ativos e sem alteração de configuração.

## Gates locais

- `cargo fmt --check`: verde.
- `cargo clippy --all-targets -- -D warnings`: verde.
- `cargo test`: 5 testes verdes (2 unitários + 3 de integração); cobertura inclui
  fluxo entre dois sockets, pin/assinatura Ed25519, expiração/uso único do código,
  frame malformado sem queda e rate-limit.
- Busca por `.unwrap()`/`.expect()`: nenhuma ocorrência no serviço.
- `pnpm install --frozen-lockfile`: verde, sem alteração do lockfile.
- `pnpm exec tsc -p tsconfig.app.json --noEmit`: verde.
- `pnpm build`: verde (Vite, 5,37 s; apenas avisos preexistentes de bundle).
- `cargo check --manifest-path src-tauri/Cargo.toml`: verde (1 min 09 s).
