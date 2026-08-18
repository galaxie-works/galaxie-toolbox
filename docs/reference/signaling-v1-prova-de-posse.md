# #1049 — threat-model do registro de device no `/v1/ws`

> Medido no `feat` `d8c1b1d`, **18/08/2026**. Números e linhas aqui são contexto
> perecível: re-derive por símbolo antes de codar.
>
> Item de DoD do #1049 (*"threat-model/desenho da mitigação revisado e
> registrado pelo Altair"*) — bloqueava a implementação do `Confucius`.

---

## 1. O que a re-derivação mudou: **não há nada a construir, só a ligar**

O card descreve o trabalho como *"exigir prova de posse"* e *"cliente persiste a
chave privada (não descarta)"*. Medido, os **dois lados já existem, prontos e
testados** — e **nenhum dos dois está ligado**:

| peça | onde | estado |
|---|---|---|
| assinar a PoP no cliente | `src-tauri/src/remote_identity.rs` (394 linhas, L1 do #1129) — `sign_registration()` + comando `remote_sign_register` | ✅ pronto. Chave privada em custódia no Rust, cifrada com DPAPI-NG, **nunca cruza pro WebView**; nonce e timestamp cunhados no Rust (anti-replay) |
| verificar a PoP no servidor | `galaxie_remote_net::identity::verify_registration` (`remote-net/src/identity.rs:52`) | ✅ pronto, e **já usado** pelo caminho v2 (`remote-net/src/authority.rs:316`) |
| **o fio entre os dois** | `/v1/ws` | ❌ **não existe** |

O cliente segue chamando `gerarPublicKey()` (`src/lib/remote-signaling.ts:175`,
usado em `:309`), que gera um par no WebCrypto e **descarta a privada**. Nenhum
arquivo `.ts` referencia `remote_sign_register` ou `remote_device_public_key`.

> Isto é a **quinta** aparição do padrão que este board vem colecionando:
> **componente construído e testado, sem consumidor.** Igual ao RB4/RB5 do
> #1070. A dívida não é a capacidade que falta — é o fio que ninguém puxou.

**Consequência de escopo:** a US é bem menor do que parece. Não é projetar
protocolo nem mexer em cripto; é **ligar duas pontas que já falam a mesma
língua** (o `sign_registration` do cliente e o `verify_registration` do servidor
compartilham o mesmo `registration_bytes` domínio-separado, do mesmo crate).

---

## 2. O buraco, e por que são DUAS ameaças, não uma

`services/remote-signaling/src/lib.rs:209` — o handler `Register` valida só
**formato**: `valid_device_id` e `decode_public_key` (32 bytes base64). Não há
desafio, nem resposta, nem verificação de posse. Em seguida ele:

1. `state.attest_key(...)` — o **servidor assina** uma atestação ligando
   `device_id + public_key + timestamp` (`state.rs:473`);
2. `state.ice_servers(...)` — **cunha credencial TURN** a partir do
   `turn_secret` (`state.rs:495`);
3. `state.register(...)` — `devices.insert(device_id, …)` (`state.rs:405-424`),
   que **substitui a entrada existente** e devolve o `outbound` antigo.

Isso são duas ameaças distintas, com mitigações diferentes:

### T1 — sequestro de sessão (a que o card nomeia)

Quem souber o `device_id` de um device **ativo** manda um `Register` e o
`devices.insert` desloca o legítimo. Pareamento e ofertas passam a ser
entregues ao atacante.

**Mitigação:** exigir PoP no re-registro de `device_id` ativo. É exatamente o AC
do card.

### T2 — relé aberto (a que o card **não** fecha)

Um `device_id` **inventado** — que nunca existiu — também recebe atestação
assinada e **credencial TURN válida**. Não precisa adivinhar nada de ninguém.

⚠️ **Medido por mim, não inferido:** registrei contra o servidor de produção com
um `device_id` inventado e 32 bytes aleatórios como `public_key`, e recebi
credencial TURN válida.

**O AC do card não cobre isto.** Ele pede PoP *"para um `device_id` já ativo"* —
um id novo continua passando. Fechar T1 e declarar a US pronta deixaria o relé
aberto.

> Já houve mitigação **de impacto** no coturn (PR #1185: `denied-peer-ip`,
> `no-loopback-peers`, quotas, e rotação do `static-auth-secret`). Isso limita o
> que se faz com a credencial; **não** impede que ela seja emitida.

---

## 3. A decisão que o card pede: reforçar `/v1/ws` — **não** migrar para `/v2/ws`

O AC pede a escolha documentada antes da implementação. **Reforçar o v1**, e o
motivo é medido, não estético:

**O `/v2/ws` não entrega `ice_servers`.** `services/remote-signaling/src/v2.rs`
não tem uma única ocorrência de `ice_servers`/`IceServer`. Ele já tem
enrollment/auth OPAQUE (`DeviceEnrollBegin/Finish`, `AuthBegin/Finish`), mas não
sabe entregar credencial TURN.

E as duas peças que faltam são cards **abertos e não iniciados**:

- **#1132** — matrícula (enrollment) do device no `/v2/ws` via OPAQUE — `OPEN`
- **#1133** — entregar `ice_servers` no `/v2/ws` (servidor) — `OPEN`

⇒ **Migrar hoje quebraria o relay que acabou de passar a funcionar.** A migração
depende de duas US que ninguém começou; o buraco está vivo em produção desde a
v0.44.0.

**O v2 continua sendo o destino.** O reforço do v1 é deliberadamente mínimo —
uma verificação, sem protocolo novo — justamente para não virar argumento para
manter o v1 vivo depois que o v2 estiver completo.

---

## 4. Desenho da mitigação

### 4.1 Servidor (`/v1/ws`)

No handler `Register`, **antes** de atestar/cunhar/inserir:

1. **`device_id` já ativo** (`state.is_registered` / `devices.contains_key`) →
   PoP **obrigatória**. Sem assinatura válida: recusa, e o device legítimo
   **não** é deslocado. Fecha **T1**.
2. **`device_id` novo** → PoP **também obrigatória**, verificada contra a
   `public_key` do próprio `Register`. Fecha **T2** parcialmente: já não basta
   inventar um id, é preciso possuir a chave que se apresenta.

⚠️ Ser honesto sobre o limite do (2): PoP contra a chave apresentada prova
**posse**, não **autorização** — um atacante gera um par próprio e passa. O que
(2) elimina é o custo-zero (32 bytes aleatórios) e dá um identificador estável
para quota/abuso. **Fechar T2 de verdade exige autorização de identidade, que é
o OPAQUE do v2 (#1132).** Registrar isto aqui para ninguém tratar o v1 reforçado
como "relé fechado".

Reusar `verify_registration` — o mesmo que o v2 já chama. Zero cripto nova.

### 4.2 Cliente

Trocar `gerarPublicKey()` (`src/lib/remote-signaling.ts:175`) pela chamada ao
comando **`remote_sign_register`**, que já devolve `(device_id, public_key,
nonce, timestamp, signature)`.

Ganho colateral que vale nomear: a chave privada **deixa de existir no
WebView**. Hoje ela é gerada lá e descartada; depois, nunca esteve lá.

### 4.3 Ordem

1. **Cliente primeiro**, mandando a PoP — o servidor ainda a ignora.
2. **Depois** o servidor passa a exigir.

Inverter derruba todo cliente já instalado (a v0.44.0 está no ar e não assina
nada). Como o servidor é nosso e o cliente é distribuído, a janela tem de ser
aberta pelo lado que atualiza sozinho.

---

## 5. O que este doc NÃO decide

- **Compatibilidade com a v0.44.0 já instalada.** Enquanto houver cliente antigo
  em campo, exigir PoP o desconecta. É decisão de PO (janela de atualização
  forçada vs. período de tolerância), não minha.
- **A implementação.** Raia do `Confucius` — aqui só o desenho, como o card pede.

---

## 6. Adendo (18/08, `8f08136`) — **T2 não precisa esperar a janela do PoP**

O `Polaris II` recomendou **v0.45 assina / v0.47 exige** e escalou o corte para o
`Wagner`, nomeando o trade: *"tolerância mais longa = T2 aberto mais tempo"*.

O trade é real, mas **é mais barato do que parece** — porque T1 e T2 têm
constrangimentos de rollout diferentes, e **só T1 depende do cliente**.

| | o que fecha | precisa de cliente novo? |
|---|---|---|
| **T1** sequestro | PoP no re-registro de `device_id` ativo | **sim** — é o que abre a janela |
| **T2** relé aberto | limitar a **cunhagem** de credencial | **não** — é servidor puro |

### 6.1 O que NÃO serve: baixar o TTL

O caminho óbvio seria encurtar `turn_credential_ttl` (hoje **1800s**,
`config.rs:76`). **Não serve**, e o próprio código explica por quê
(`config.rs:70-75`): não existe renovação nem `restartIce` — *"zero
`restartIce`/`iceRestart` em TS ou Rust"* —, então **uma sessão RELAYED morre ao
atingir o TTL, sem recuperação**. Baixar o número antecipa a morte de sessão
legítima; a correção é a renovação (#1148), que está aberta.

Registro isto porque era a minha primeira ideia, e ela quebraria o relay que
acabou de passar a funcionar.

### 6.2 O que serve: orçamento próprio para o `Register`

Hoje o `Register` divide um balde **genérico por IP** com todo o resto:
`allow_message(client_ip)` — **120 mensagens / 60s** (`config.rs:80-84`,
`lib.rs:98` e `:140`). Ping, offer e `Register` custam o mesmo, e cada
`Register` devolve uma credencial TURN de 30 minutos.

Mas **a casa já tem o padrão certo para ação sensível**: o `allow_redeem`
(SEC13, `state.rs:358`) é um limitador **dedicado, por IP, com backoff que
escala**. O `Register` — que é o que cunha credencial — não tem nenhum.

**Proposta:** um `allow_register` espelhando o `allow_redeem`. Um cliente
legítimo registra **uma vez por sessão**, não 120×/min; um orçamento apertado
não incomoda ninguém real e derruba a cunhagem em massa a partir de um host.

- **Servidor puro** — nenhum cliente em campo quebra, então **não espera a
  janela do PoP**: vale a partir do próximo deploy.
- **Ortogonal** ao PoP: quando o server-enforce entrar (v0.47 ou onde o `Wagner`
  cortar), os dois compõem.
- **Compõe com o coturn**: as quotas aplicadas no #1185 limitam o que se faz com
  a credencial; este limita **quantas são emitidas**.

### 6.3 O limite honesto disto

Rate limit por IP **não para atacante distribuído** — quem tiver muitos IPs
continua cunhando. O que ele faz é tirar o custo-zero: de *"um host emite 120
credenciais por minuto"* para *"um punhado"*.

**T2 só fecha de verdade com autorização de identidade** — o OPAQUE do v2
(#1132), como já está na §4.1. Isto é **redução de exposição durante a janela**,
e deve ser lido assim; não é o fecho.

### 6.4 Recomendação ao PO

A escolha da janela não muda. O que muda é **o preço dela**: com o §6.2,
escolher tolerância mais longa deixa de significar *"T2 totalmente aberto até
v0.47"*. Se o `Wagner` preferir a janela mais confortável, este é o item que
torna a escolha barata — e é uma fatia de servidor, pequena, sem coordenação com
release de cliente.
