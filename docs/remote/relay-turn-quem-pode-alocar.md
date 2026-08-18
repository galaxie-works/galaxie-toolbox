# Relay TURN: quem pode alocar, e o que isso custa

**Autor:** Altair · **Medido em:** `feat` `22657de` (2026-08-18) · `Ref #1130`, `Ref #1133`, `Ref #1050`
**Gatilho:** o `Polaris` mapeou o caminho crítico do Remote e o único bloqueio restante é **o `Wagner` provisionar o relay do coturn**. Fui olhar o que acontece **no minuto seguinte** a esse relay subir.

---

## Resumo

> **Do jeito que está hoje, no minuto em que o relay subir ele é um relay ABERTO: qualquer um que alcance o endpoint de signaling tira credencial de TURN válida, sem prova de nada.**
>
> E o `turnserver.conf` não tem **quota** nem **restrição de peer** — então isso não é só conta de banda, é **pivô para a rede interna do VPS**.

Nada aqui bloqueia o `Wagner`. São **três linhas de config** que fecham o pior, e uma decisão de arquitetura (§4) que resolve a raiz depois.

---

## 1. Qualquer um tira credencial — medido

O handler de `Register` do `/v1/ws` (`services/remote-signaling/src/lib.rs:209-280`) valida exatamente três coisas antes de devolver `Registered { …, ice_servers }`:

| Passo | O que checa | O que NÃO checa |
|---|---|---|
| `valid_device_id` (`:475-480`) | 8–64 chars `[A-Za-z0-9_-]` | **formato apenas** — o id é escolhido pelo cliente |
| `decode_public_key` (`:482`) | 32 bytes base64 | **formato apenas** — 32 bytes aleatórios passam |
| `attest_key` (`:229`) | assina uma alegação | **não autentica** — já registrado no threat-model do #1049 |

**Não há prova de posse da chave, nem matrícula, nem autorização.** Um `websocat` + JSON de 3 campos devolve `ice_servers` com credencial HMAC efêmera válida.

Isso é coerente com o que eu já tinha achado no #1049 — o v1 não tem identidade — mas ali a consequência era abstrata ("sequestro de sessão"). **Aqui ela tem preço:** banda de relay é o recurso mais caro que a gente expõe.

## 2. O `turnserver.conf` não limita o estrago

Medido em `infra/remote/turnserver.conf`:

| Presente | Ausente e material |
|---|---|
| `use-auth-secret` · `stale-nonce=600` · `no-multicast-peers` · `fingerprint` · portas 49160-49200 | **`denied-peer-ip`** · **`user-quota`** · **`total-quota`** |

### 2.1 Sem `denied-peer-ip`, o relay alcança a rede interna do VPS

Um `Allocate` bem-sucedido permite ao cliente pedir que o coturn **mande pacotes para um peer arbitrário** — inclusive `127.0.0.1` e faixas RFC1918. No mesmo VPS moram o próprio signaling e a telemetria (`telemetry.thegalaxie.cloud`).

**Isso tem a forma de um SSRF, com o coturn como proxy** — e é pior que HTTP-SSRF, porque é UDP arbitrário. Serviço que só escuta em loopback por "estar protegido" deixa de estar.

### 2.2 Sem quota, a conta é o limite

Relay é egress. Sem `total-quota`, o teto de banda é o do plano do VPS, descoberto pela fatura. Relay aberto é ativo procurado para lavar tráfego justamente porque o IP é de terceiro — o nosso.

## 3. O que eu recomendo AGORA — 3 linhas, não bloqueia nada

Adicionar ao `turnserver.conf`, junto com o provisionamento do relay:

```conf
# Bloqueia pivô pra rede interna/loopback do VPS (o relay NÃO é proxy de rede interna).
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
# Teto de banda: transforma abuso em incidente barato, não em fatura.
user-quota=64
total-quota=1200
```

> ⚠️ **Os números de quota são ponto de partida, não medição.** Não medi o consumo de uma sessão real — o certo é medir uma sessão do `Wagner` sob relay e calibrar. O valor de ter os números *agora* é que o teto existe desde o primeiro dia; afrouxar depois é trivial, descobrir pela fatura não.

E o `#1050` (TLS/DTLS) continua onde está: o próprio arquivo já documenta que remover `no-tls` sem cert **derruba o relay**.

## 4. A raiz — e ela reforça a decisão do #1049

O `Polaris` mediu certo: **o `/v2/ws` não carrega `ice_servers`** (zero ocorrências em `services/remote-net/`), enquanto o `/v1/ws` carrega (`protocol.rs:41-46`). E concluiu que migrar hoje removeria o caminho da credencial.

**Concordo com a medição e discordo da leitura.** Não é *"o v2 tira a credencial"* — é *"a credencial está no lugar errado, e o v2 é o lugar certo"*:

- emitir credencial de relay **é uma decisão de autorização** — é conceder banda a um device;
- o **v1 não tem a quem conceder**: o `device_id` é sorteado pelo cliente a cada conexão (`remote-signaling.ts:322`) e nada prova posse;
- o **v2 tem**: Ed25519 com prova de posse, device matriculado e **revogável**, anti-replay (`identity.rs`, `authority.rs`).

⇒ **`ice_servers` deve ser emitido pelo v2, atrelado ao device matriculado (#1133).** Aí "relay aberto" deixa de existir por construção: sem matrícula, sem credencial — e device abusivo se revoga, em vez de rodar quota atrás dele.

**Isto não muda o #1049; reforça.** Antes o argumento era higiene de identidade. Agora é: *enquanto a credencial sair do v1, a gente paga a banda de quem quiser pedir.*

## 5. Ordem que eu recomendo

1. **Agora, com o provisionamento:** as linhas do §3. Não depende de código, não atrasa o `Wagner`.
2. **Junto do #1130:** medir uma sessão real sob relay e calibrar a quota.
3. **#1133:** `ice_servers` migra pro v2, atrelado ao device matriculado. Aí o §3 vira defesa em profundidade, não o controle principal.

**O que eu explicitamente NÃO recomendo:** segurar o relay até o #1133. Suporte assistido funcionando vale mais que a raiz fechada, **desde que o teto exista** — e o §3 é o teto.
