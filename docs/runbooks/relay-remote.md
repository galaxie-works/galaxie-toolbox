# Runbook — stack do Remote (signaling + TURN) no VPS

**Dono:** Altair (Arquiteto) · **Card:** #1184 · **Escrito em** 2026-08-20, a partir de medição no host, não de memória.

Fatos perecíveis (SHAs, datas, IPs) valem na data em que foram escritos. **Medir antes de agir** — este documento existe porque supor custou uma noite (#1303).

## 1. O que roda

Host `telemetry` (Ubuntu 24.04), acesso `ssh root@<ip-do-realm>`. Quatro containers, **três composes independentes**:

| container | compose | papel |
|---|---|---|
| `galaxie-remote-signaling-1` | `/docker/galaxie-remote/` | plano de controle (`/healthz`, `/v1/ws`, `/v2/ws`) |
| `galaxie-remote-coturn-1` | `/docker/galaxie-remote/` | STUN/TURN (relay) |
| `traefik-traefik-1` | `/docker/traefik/` | borda TLS; roteia `/remote` → signaling:8787 |
| `openobserve-pwch-openobserve-1` | `/docker/openobserve-pwch/` | telemetria — **compose separado** |

⚠️ **A telemetria é outro compose.** Reiniciar o Remote **não** a derruba, desde que se use o compose certo (§4).

⚠️ **A produção NÃO compila do repo.** O build vem de `GALAXIE_REMOTE_BUILD_CONTEXT=./signaling`, uma **cópia manual** dentro de `/docker/galaxie-remote/`. Isso já produziu 7 dias de deriva invisível entre o que rodava e o que o time achava que rodava (#1303). A correção está no épico **#1307**; até lá, **nunca confie no repo para saber o que está no ar** — use §3.

## 2. Portas, e por que cada uma está aberta

| porta | protocolo | por quê |
|---|---|---|
| **443** | TCP | Traefik (TLS). Única porta que o app usa para signaling |
| **3478** | UDP **e** TCP | STUN/TURN. É por onde o cliente pede a alocação de relay |
| **49160–49200** | UDP | **faixa de relay do coturn** (`min-port`/`max-port` no `turnserver.conf`). Cada sessão relayed ocupa uma porta desta faixa |

**A faixa 49160–49200 é a "exceção de portas" deste stack.** Ela é ampla de propósito — cada alocação simultânea consome uma porta — e é a razão de o coturn **não** rodar atrás de proxy: relay é UDP ponta a ponta, e passar por Traefik quebraria o caminho.

**Contenção que compensa a abertura** (`turnserver.conf`, ver #1184 e `relay-turn-quem-pode-alocar.md`):
- `denied-peer-ip` para todas as faixas privadas + `no-loopback-peers` — o relay **não é proxy para a rede interna do VPS** (senão vira SSRF com UDP arbitrário);
- `user-quota` / `total-quota` — teto de banda: abuso vira incidente barato, não fatura.

## 3. Como verificar (o que é confiável, e o que não é)

```sh
# 1. Signaling vivo, pela URL pública (atravessa o Traefik):
curl -s -o /dev/null -w "%{http_code}\n" https://<realm>/remote/healthz      # espera 200

# 2. Rota que existe no BINÁRIO no ar (não no repo):
docker exec galaxie-remote-signaling-1 sh -c \
  'grep -a -o -E "/v[12]/ws|/healthz" /usr/local/bin/galaxie-remote-signaling | sort -u'

# 3. O que a produção vai compilar no próximo deploy:
grep -rq "enrollment_ticket" /docker/galaxie-remote/signaling/ \
  && echo "fonte TEM o contrato de matrícula" || echo "fonte SEM o contrato"

# 4. Segredo do TURN alinhado entre os dois serviços (sem imprimir o valor):
docker exec galaxie-remote-coturn-1    sha256sum /run/secrets/turn_secret | cut -c1-16
docker exec galaxie-remote-signaling-1 sha256sum /run/secrets/turn_secret | cut -c1-16
# e o que o coturn REALMENTE carregou (vazio ⇒ e3b0c442… = falha silenciosa, ver §5):
docker exec galaxie-remote-coturn-1 sh -c \
  'grep static-auth-secret /run/coturn/turnserver.conf | cut -d= -f2 | tr -d "\r\n" | sha256sum' | cut -c1-16
```

### ⚠️ O que NÃO prova nada

**Testar o relay de dentro do próprio VPS não vale.** Medido em 2026-08-20: com cliente, servidor TURN e peer no mesmo host, o teste depende de hairpin do NAT para o endereço público da própria máquina e **trava sem saída**. E o `verify-turn-relay.sh` põe o peer numa rede Docker privada — que o `denied-peer-ip` bloqueia **corretamente**, devolvendo `403` no `ChannelBind`.

**Prova válida = de fora**, com cliente e peer fora do VPS. Hoje isso é o cliente de relay do **#1130** com sonda externa. **Não afrouxe o `denied-peer-ip` para "fazer o teste passar"** — seria trocar segurança real por verde de checklist.

## 4. Como reiniciar sem derrubar a telemetria

```sh
cd /docker/galaxie-remote

docker compose up -d --force-recreate signaling   # só o signaling
docker compose up -d --force-recreate coturn      # só o coturn
docker compose up -d --force-recreate             # os dois (NÃO toca openobserve nem traefik)
```

**Nunca** rode `docker compose down` na raiz de `/docker`, e **nunca** use `docker restart` esperando releitura de segredo: o coturn monta o segredo **na criação do container**. Trocou o arquivo ⇒ **recriar** (`--force-recreate`), não reiniciar.

## 5. Armadilhas medidas (custaram tempo de verdade)

1. **Entrypoint do coturn falha ABERTO** — o guard testa `[ ! -s "$f" ]` (**tamanho**, não legibilidade). Segredo ilegível ⇒ `static-auth-secret=` **vazio** ⇒ o coturn recusa toda credencial logando `Cannot find credentials of user`, que **culpa o cliente**. Card: **#1378**.
2. **Permissão do segredo:** `440`, dono `root`, grupo **20000** (o `group_add` do compose). Espelhe o `signing_key`: `chown --reference=secrets/signing_key`. Com `600` o signaling entra em **crash loop** e o coturn sobe **mudo** (item 1).
3. **Backup de segredo:** `cp -p` (com `-p`). Sem isso o dono/grupo se perde e a evidência do estado original vai junto.
4. **`allocate response received` não é sucesso** — aparece também no desafio `401`. O sinal decisivo é **`Received relay addr`**.
5. **Nunca rodar script de segredo com `sh -x`** — o `verify-turn-relay.sh` passa o `turn_secret` em `argv`, e o traço o expõe (custou uma rotação). O problema de `argv` é anterior ao `-x`: também aparece no `ps` do host.
