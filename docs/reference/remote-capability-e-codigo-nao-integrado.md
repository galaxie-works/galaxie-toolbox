# #1070 — decisões de arquitetura: capability e código não-integrado

> Medido no `feat` `2e54030`, **18/08/2026**. Números aqui são contexto
> perecível: re-derive por símbolo antes de codar.
>
> Pedido por `Confucius` na #133: RB4/RB5 (wirar ou parquear) e RB6/RB7 (tipo
> único de capability). Este doc decide os quatro.

---

## 1. O achado que muda a ORDEM: RB6 não pode ser feito sem RB7

Os três vocabulários de capability não divergem só em número de campos.
**Divergem em polaridade de default** — e o que gateia o fio é o mais permissivo.

| tipo | campos | `Default` | consumidor no app |
|---|---|---|---|
| `Capabilities`<br>`remote-net/src/protocol.rs:55` | **5** — screen, input, file_transfer, clipboard, audio | `derive(Default)` → tudo `false` = **DENY** | **nenhum**. Vive em `authority.rs`; é o que o ticket S8 assina, e **não cruza a fronteira IPC** |
| `RemoteCapabilities`<br>`src-tauri/src/remote.rs:133` | **2** — screen, input | — (só `Deserialize`) | é o que o **front** manda pelo IPC |
| `CapabilityPolicy`<br>`remote-transport/src/control.rs:150` | **2** — clipboard, file_transfer | **escrito à mão** → `true`/`true` = **ALLOW** | **nenhum** — só reexport em `lib.rs:54` |

E o runtime real descarta tudo:

```rust
// src-tauri/src/remote.rs:1126
ControlFrame::Control(_) | ControlFrame::Chunk { .. } => {}
```

### A consequência, que é de segurança

Hoje **nada é aplicado**, porque os frames de controle e chunk são jogados fora
inteiros. O gate `CapabilityPolicy::permite` existe e nunca roda.

No instante em que alguém ligar os frames — que é exatamente o ponto do RB6 —
o gate que passa a valer é o `CapabilityPolicy`: **2 dos 5 conceitos, e
default-ALLOW**. Clipboard e transferência de arquivo ficariam **abertos por
default**, e o que o ticket S8 assinou nunca chegaria ao ponto de decisão.

> **Fazer o RB6 antes do RB7 troca "descarta tudo em silêncio" por "permite
> clipboard e arquivo por default".** O segundo é pior que o primeiro.

### Decisão

1. **RB7 primeiro, RB6 depois.** Ordem dura, não preferência.
2. **Tipo único = `Capabilities`** (5 campos, `derive(Default)` = deny),
   reexportado de `remote-net`. É o único dos três que já tem os 5 conceitos e
   a polaridade certa, e é o que o ticket assina — unificar nos outros dois
   inverteria o default.
3. **Matar o `impl Default for CapabilityPolicy` escrito à mão.** É ali que a
   polaridade inverte. Se `CapabilityPolicy` sobreviver como tipo, vira wrapper
   sobre `Capabilities`; o `Default` sai junto.
4. **`RemoteCapabilities` (IPC) passa a carregar os 5 campos**, senão o que o
   front pede continua sem relação com o que o ticket concedeu.
5. Só então o RB6: `remote.rs:1126` deixa de descartar — loga e chama
   `permite()`.

---

## 2. RB4 e RB5 — parquear com MARCA, não apagar

`Confucius` colocou os dois como "wirar/plugar OU marcar não-integrado/parquear".
Medido:

| | tamanho | consumidor em produção | CI |
|---|---|---|---|
| **RB5** `services/remote-broker-client` | **546 linhas** | **zero** no repo inteiro (busquei `.rs` e `.toml` fora do próprio crate) | ✅ `cargo test` roda (`ci.yml:192-194`) |
| **RB4** `PipeServer` (`remote-system-agent/src/pipe_server.rs:218`) + `validar_hello` (`session_channel.rs:156`) | — | só dentro de `#[cfg(test)]` | ✅ o crate roda no CI (`ci.yml:185-187`) |

O dado que inverte a recomendação óbvia: **os dois são compilados e testados
pelo CI.** Não são código não-verificado — são código **verificado e não
consumido**.

Apagar joga fora trabalho testado que o S8/S7 vão querer, e converte "ainda não
ligado" em "temos que reconstruir". Manter custa ~0, porque o CI já os cobre.

### Decisão: marcar, não apagar

**A dívida não é o código — é a ausência de marca.** O risco real que o card
nomeia é `QA Approved com código inalcançável`: alguém lê "entregue" e assume
que roda. Isso se resolve com um marcador, não com um `rm`.

- **RB5:** parquear formalmente. Comentário de módulo no topo do
  `remote-broker-client/src/lib.rs` dizendo **não-integrado**, a qual épico
  pertence (#682/S8) e o que falta para plugar. Nota na issue e no board.
- **RB4:** idem para `PipeServer`/`validar_hello`. O design do S7 (#937) está
  **CLOSED**, então o pipe tem destino definido — é espera, não abandono.

### A distinção que vale além deste card

Nem todo código morto é o mesmo, e a resposta certa muda:

| tipo de morto | resposta | exemplo |
|---|---|---|
| Codifica uma **decisão que ninguém tomou**, ou pertence a outra camada | **remover** | `contadores_sao_fato()` na F3 do #1075 — a regra de exibição pertence a quem desenha |
| Componente **construído e testado**, esperando um fio | **marcar**, não apagar | RB4, RB5 |

O que torna o segundo perigoso **não é existir** — é ser **indistinguível do
primeiro** para quem chega depois. Por isso a correção é um marcador.

E o que nunca serve, nos dois casos, é `#[allow(dead_code)]`: ele apaga a
pergunta *"quem deveria estar lendo isto?"* — que na F1 do #1075 achou um
caminho de perda de dado (transitório escalando para `DELETE` definitivo).

---

## 3. Fora do pedido: a família do #834 apareceu 3 vezes

`#834`, `#1073` e agora `#1227` (RB9) são o mesmo defeito: **comando Tauri
síncrono fazendo trabalho bloqueante na thread do IPC**. `Polaris II` anotou que
"vale um gate, mas fica pra depois".

Proposta concreta, no formato ratchet que já roda no repo (#1074 F1, #1153):
um teste que varre `src-tauri/src/*.rs` procurando `#[tauri::command]` **não
`async`** cujo corpo contenha chamada bloqueante conhecida (`.join()`,
`.lock()`, `.recv()`, `block_on`), com BASELINE explícita dos que hoje existem.
Barra o próximo na hora; a lista só encolhe.

Não abri card — é chamada do `Polaris II`. Se ele quiser, eu faço.

---

## Resumo para o board

| RB | decisão | quem |
|---|---|---|
| **RB7** | Tipo único `Capabilities` (5 campos, deny). Matar o `Default` à mão do `CapabilityPolicy`. **Antes do RB6.** | `Confucius` |
| **RB6** | `remote.rs:1126` loga + aplica `permite()`. **Só depois do RB7.** | `Confucius` |
| **RB5** | Parquear com marca de não-integrado. Não apagar — está no CI. | `Confucius` |
| **RB4** | Parquear com marca de não-integrado. #937 CLOSED ⇒ é espera. | `Confucius` |
| RB1+RB8 | Sem decisão pendente — fatia dele, pode ir agora | `Confucius` |

---

## 4. Adendo (18/08, `9143525`) — ONDE mora o tipo único

O `Confucius` implementou a parte de segurança do RB7 (o `Default` do
`CapabilityPolicy` virou DENY, PR #1232) e travou no resto com uma pergunta
que **este doc não tinha respondido**:

> `remote-net` (dono do `Capabilities`) e `remote-transport` (dono do
> `CapabilityPolicy`) são crates irmãos **sem dep entre si**. Unificar exige
> escolher a colocação.

Ele está certo — a §1 disse *"reexportado de `remote-net`"* e passou por cima do
problema. Lacuna minha; fecho aqui.

### 4.1 O que já dá para fazer HOJE, sem depender desta decisão

`src-tauri` **já depende de `galaxie-remote-net` com default features, de forma
incondicional** (`src-tauri/Cargo.toml:51` — *"LEVE do remote-net, SEM
client/authority"*).

⇒ Trocar o `RemoteCapabilities` (2 campos, `src-tauri/src/remote.rs:133`) por
`galaxie_remote_net::protocol::Capabilities` **não custa nenhuma dependência
nova**. Isso já colapsa **dois dos três** vocabulários e faz o que o ticket S8
assina finalmente cruzar a fronteira IPC — que era o buraco de segurança da §1.

**Faça esta parte primeiro**, independentemente do que se decidir abaixo.

### 4.2 O custo real da dep direta, medido

A premissa *"`remote-net` traz opaque-ke/argon2/tokio/rustls"* **não se sustenta**:
essas são todas `optional` e `default = []` (`services/remote-net/Cargo.toml`).

Deps incondicionais, medidas em `9143525` (18/08):

| crate | deps incondicionais |
|---|---|
| `remote-net` | base64, ed25519-dalek, rand, serde, serde_json, thiserror, zeroize |
| `remote-transport` | serde, serde_json, thiserror, tracing, rand, hmac, sha1, md-5 |

**Custo marginal de `transport → net` (com `default-features = false`):**
`base64`, `ed25519-dalek`, `zeroize`. Bem menor que o alegado — mas
`ed25519-dalek` (assinatura) num crate que não assina nada não é nada.

### 4.3 A decisão, e por que o desempate NÃO é o custo

O número acima é **fato perecível** (muda com um `cargo add`). O desempate tem
de ser um argumento que não expira:

> **O vocabulário de capability é o contrato ENTRE os dois crates** — o ticket
> S8 (`remote-net`) **concede**, o DataChannel (`remote-transport`) **aplica**.
> Um contrato que mora dentro de uma das partes é **exatamente como os três
> vocabulários divergiram**. Qualquer colocação dentro de um dos dois recria a
> assimetria que causou o defeito.

`remote-net` e `remote-transport` são **pares**, não camadas: um fala com o
servidor de signaling, o outro faz mídia P2P. Nenhum está naturalmente abaixo do
outro — e é por isso que a resposta é um terceiro lugar.

**Decisão: crate folha `galaxie-remote-capabilities`.** Dep única: `serde`.
Consumidores: `remote-net`, `remote-transport` e `src-tauri`. Precedente de
crate pequeno já existe na casa (`remote-system-helper`).

Custo honesto: +1 `Cargo.toml`, +1 entrada no `ci.yml` (build e cache).

**Alternativa, se `Polaris II` preferir não abrir o 7º crate:** `remote-transport`
depende de `remote-net` com `default-features = false`. Funciona, custa os três
crates da §4.2, e **aceita conscientemente** que o contrato passe a morar na casa
de uma das partes. Não recomendo, mas é sustentável — o que não é sustentável é
manter dois tipos e sincronizá-los na mão.

### 4.4 Ordem final do RB7/RB6

1. `RemoteCapabilities` → `Capabilities` no `src-tauri` (§4.1, **sem custo**)
2. crate `galaxie-remote-capabilities`; `remote-net` e `remote-transport` passam
   a reexportá-lo
3. `CapabilityPolicy` vira wrapper/alias sobre os 5 campos (o `Default` já é
   DENY desde a #1232)
4. **só então** RB6: `remote.rs:1126` deixa de descartar — loga e aplica

---

## 5. Adendo (18/08, `ba73c22`) — o gate que eu propus NÃO funciona

Na §3 propus um gate ratchet que varreria `#[tauri::command]` não-`async`
procurando chamada bloqueante **no corpo** (`.join()`, `.recv()`, `block_on`…).

**Fui medir antes de alguém construir. A proposta está errada.**

### 5.1 A medição

Em `ba73c22` (18/08), varrendo `src-tauri/src/**/*.rs`:

```
#[tauri::command] async : 167
#[tauri::command] SYNC  :  15
SYNC com chamada bloqueante NO CORPO : 0
```

Zero. O gate teria baseline vazia — o que parece ótimo, e é justamente o
problema: **ele não teria pego nenhuma das quatro ocorrências da família**.

Em todas, o bloqueio está **uma chamada de profundidade**:

| # | comando | como bloqueava |
|---|---|---|
| #834 | `fs_thumbnail` | helper de decodificação |
| #1073 | — | idem |
| #1227 | `remote_session_end` | `session.stop()` → `worker.join()` (`remote.rs:79-84`) |
| **novo** | `remote_session_start` | **o mesmo `session.stop()`** (§5.3) |

Um scan textual do corpo não vê `join()` escondido dentro de `stop()`. Construir
esse gate daria **falsa confiança** — CI verde afirmando uma propriedade que ele
não verifica. É exatamente o defeito que o #1153 achou nos ícones (`icon: true`
era afirmação do gerador, nada abria o arquivo) e que a F1 do #1075 achou no
`eh_erro_permissao` (decidir farejando texto).

### 5.2 O gate que funcionaria: estrutural, não textual

**Regra:** todo `#[tauri::command]` é `async`, salvo os que estiverem numa
ALLOW-list explícita, cada um com uma linha de justificativa.

Por que funciona onde o outro falha: ele **não precisa saber o que o comando
chama**. Se `sync` é barrado por padrão, não há como esconder bloqueio atrás de
um helper — a profundidade da chamada deixa de importar. É a mesma lição da F1:
**decidir pela forma, não farejando o texto.**

A medição diz que o custo é baixo: **12 dos 15** síncronos de hoje são
delegadores de 2 linhas (`telemetry_*`, `remote_log`, `reset_session_memo`…),
triviais de justificar. Os **3** substantivos — `remote_session_start` (43
linhas), `remote_session_input` (22), `remote_session_signal` (8) — são
exatamente onde o risco mora, que é o resultado que se quer de um gate.

Baseline = os 15 de hoje; a lista só encolhe.

### 5.3 Achado: o RB9 cobriu metade do item de DoD

O DoD do #1070 diz:

> `remote_session_end` **(e o ramo de limpeza de `remote_session_start`)**
> convertidos para `async fn` + `spawn_blocking`

A #1227 converteu o `remote_session_end`. O **ramo de limpeza do
`remote_session_start` continua síncrono** (`remote.rs:345-351`):

```rust
if active.as_ref().is_some_and(|s| s.finished.load(Ordering::Acquire)) {
    if let Some(session) = active.take() {
        session.stop("worker_finished".to_owned());   // → worker.join()
    }
}
```

…e faz isso **segurando `runtime.active.lock()`**, ao contrário do
`remote_session_end`, que solta o guard antes do `await` de propósito.

**Severidade hoje: BAIXA — e quero ser exato.** O ramo só roda quando
`finished == true`, e o worker grava isso **depois** de `run_session` retornar
(`remote.rs:368-370`). Ou seja, o join encontra a thread praticamente terminada
e volta quase imediato. **Não é o congelamento do #834.**

O que incomoda é outra coisa: **é uma armadilha a uma edição de distância.**
Basta alguém afrouxar a guarda, ou passar a gravar `finished` mais cedo, e o
`join()` volta a ser longo — na thread do IPC e com o mutex na mão. E o item de
DoD segue aberto.

**Raia:** `Confucius` (#1070). Reporto, não codo.

### 5.4 O que recomendo

1. Fechar a outra metade do item de DoD: `remote_session_start` vira `async` e o
   `stop()` do ramo de limpeza sai para `spawn_blocking`, com o lock solto antes
   do await — copiando a forma que o `remote_session_end` já tem.
2. **Só depois** o gate estrutural da §5.2, com a ALLOW-list nascendo já sem os
   comandos corrigidos.

Se `Polaris II` quiser o gate, eu faço — mas na forma da §5.2, não na que eu
mesmo propus na §3.
