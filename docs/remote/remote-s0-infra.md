# Remote S0 — signaling + coturn no VPS

Runbook da infraestrutura da issue #683. A implantação compartilha o VPS da
telemetria, mas mantém processos, secrets e rollback independentes do OpenObserve.

## Topologia

```text
cliente ── WSS/443 ──> Traefik ── /remote ──> signaling:8787
cliente ── STUN/TURN 3478 TCP+UDP ───────────> coturn (host network)
cliente <──────────── relay UDP 49160-49200 ─> coturn
```

- WSS termina no Traefik com o certificado Let's Encrypt já usado pelo host.
- O signaling não publica porta no host e roda sem capabilities, read-only e como
  usuário não-root.
- O coturn usa host networking, recomendado pelo próprio projeto para ranges de
  relay, e autenticação long-term com segredo compartilhado.
- A mídia permanece DTLS-SRTP ponta a ponta. O TURN só retransmite pacotes cifrados.
- TLS aqui se aplica ao signaling WSS. TURN/TLS 5349 não é exposto nesta fase: os
  clientes usam TURN autenticado em 3478 e a mídia continua cifrada por DTLS-SRTP.

## Portas exatas

| Porta | Protocolo | Origem | Uso |
| --- | --- | --- | --- |
| 22 | TCP | IPs administrativos | SSH |
| 80 | TCP | internet | ACME + redirect HTTPS |
| 443 | TCP | internet | WSS/HTTPS via Traefik |
| 3478 | TCP + UDP | internet | STUN/TURN |
| 49160-49200 | UDP | internet | relay TURN |

Nenhuma outra porta do serviço deve aparecer em `ss -lntup` ou no publish do Docker.

## Secrets

No VPS, criar `/docker/galaxie-remote/secrets` com modo `0700`. Os arquivos abaixo
devem ter modo `0600`, sem newline significativo e nunca entram no Git:

```bash
install -d -m 0700 /docker/galaxie-remote/secrets
openssl rand -base64 32 | tr -d '\n' > /docker/galaxie-remote/secrets/signing_key
openssl rand -base64 48 | tr -d '\n' > /docker/galaxie-remote/secrets/turn_secret
chown root:20000 /docker/galaxie-remote/secrets/*
chmod 0440 /docker/galaxie-remote/secrets/*
```

O GID numérico 20000 é adicionado como grupo suplementar somente aos dois containers
que consomem esses arquivos; os secrets não ficam world-readable.

Rotacionar `turn_secret` invalida credenciais TURN ainda válidas. Rotacionar
`signing_key` muda o trust anchor e exige distribuir um novo pin aos clientes.

## Deploy

1. Confirmar que o DNS de `telemetry.thegalaxie.cloud` aponta para o VPS.
2. Fazer backup de `/docker/traefik`, `/docker/openobserve-pwch` e das regras atuais
   de firewall; não alterar esses dois stacks.
3. Copiar `infra/remote` para `/docker/galaxie-remote` e criar os secrets.
4. Instalar `galaxie-remote.service` em `/etc/systemd/system/`.
5. Validar a composição antes de subir:

```bash
cd /docker/galaxie-remote
docker compose config --quiet
docker compose build signaling
systemctl daemon-reload
systemctl enable --now galaxie-remote.service
```

6. Só depois de confirmar SSH em uma segunda sessão, aplicar o firewall:

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'Traefik ACME'
ufw allow 443/tcp comment 'Traefik HTTPS WSS'
ufw allow 3478/tcp comment 'TURN TCP'
ufw allow 3478/udp comment 'STUN TURN UDP'
ufw allow 49160:49200/udp comment 'TURN relay'
ufw --force enable
ufw status numbered
```

Em produção, restringir 22/TCP aos IPs administrativos conhecidos assim que houver
uma lista explícita aprovada; não inventar allowlist durante este S0.

## Verificação

```bash
curl --fail --silent https://telemetry.thegalaxie.cloud/remote/healthz
curl --fail --silent https://telemetry.thegalaxie.cloud/remote/v1/server-key
docker compose ps
docker compose logs --tail=100 signaling coturn
ss -lntup
```

O probe Rust de dois peers deve usar
`wss://telemetry.thegalaxie.cloud/remote/v1/ws`, verificar a atestação contra a chave
de `/remote/v1/server-key`, consumir um código uma única vez e trocar offer/answer/ICE.

Para STUN/TURN, executar clientes de teste fora do VPS. O aceite exige:

- STUN retornar o endereço reflexivo público do cliente;
- TURN alocar e retransmitir tráfego;
- repetir o TURN em dois namespaces/redes Docker sem caminho direto entre peers,
  forçando relay para simular o caso de NAT restritivo/simétrico.

Registrar somente resultado, timestamps e endereços públicos mascarados; nunca
publicar segredo TURN nem credencial temporária.

## Rollback

```bash
systemctl disable --now galaxie-remote.service
cd /docker/galaxie-remote
docker compose down
```

Remover apenas as regras UFW identificadas pelos comentários `TURN`/`STUN` e manter
22/80/443. O stack do OpenObserve e o Traefik não fazem parte do rollback desta story.
