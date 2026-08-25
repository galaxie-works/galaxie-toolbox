# Contrato do `Register` v2 — prova de posse do device

> **Derivado da fonte** (`services/remote-net/src/identity.rs`) em 2026-08-25, não de memória.
> Entregável nomeado no **#1129** (*"contrato do `Register` v2, a ser publicado pelo Altair"*).
> Este documento existe porque o **FE precisa dele**: não se assina Ed25519 correctamente a
> partir de prosa, e o BE funciona sem ele — foi por isso que a falta passou dias sem ser vista.

## A mensagem assinada

```text
registration_bytes =
      DOMAIN
   || len(device_id)  as u64 little-endian  ||  device_id
   || len(nonce)      as u64 little-endian  ||  nonce
   || timestamp       as u64 little-endian
```

Assinatura **Ed25519** sobre exactamente esses bytes.
Verificação: `verify_registration(public_key, device_id, nonce, timestamp, now, signature)`.

## As três propriedades — e por que nenhuma é decoração

### 1. `DOMAIN` no início — separação de domínio

Sem o prefixo, uma assinatura obtida noutro contexto **com o mesmo par de chaves** poderia ser
reapresentada aqui. O domínio amarra a assinatura a *este* uso.

### 2. Prefixo de COMPRIMENTO por campo — não concatenação

Cada campo variável entra como `len(u64 LE) || bytes`. Sem isso:

```text
device_id="ab", nonce="c"   →   "abc"
device_id="a",  nonce="bc"  →   "abc"     ← MESMOS BYTES
```

Uma assinatura válida para um par serviria ao outro. O comprimento torna a fronteira
inequívoca.

### 3. `timestamp` em little-endian, 8 bytes, sem prefixo

É largura fixa, por isso não leva comprimento.

> ⚠️ **Little-endian, não ordem de rede.** É o `to_le_bytes()` do Rust. Um cliente que use
> big-endian produz assinatura inválida e recebe **`IdentityError::Signature`** —
> **indistinguível de chave errada**. Esta nota existe para poupar essa depuração.

## Janela de relógio e anti-replay

| propriedade | valor |
|---|---|
| `MAX_CLOCK_SKEW_SECONDS` | **60** — `\|timestamp - now\| > 60` ⇒ `IdentityError::Timestamp` |
| anti-replay | par `device_id:nonce`, janela de 60 s, do lado do servidor |

O relógio do cliente importa: um device com relógio errado falha o registo por `Timestamp`.

## Erros — e o que eles deliberadamente NÃO dizem

`Encoding` · `Timestamp` · `Signature`

**Nenhum revela se o `device_id` existe.** A recusa não é oráculo de matrícula: quem tenta
registar um `device_id` alheio não aprende se ele está matriculado.

## Onde a chave vive (decisão L1, #1049)

A **chave privada do device vive no Rust**; o **WebView pede a assinatura** e nunca a segura.
O WebView monta `device_id`/`nonce`/`timestamp`, pede a assinatura ao Rust, e envia.

Isto é coerente com a fronteira do Remote: **WebView = plano de controlo** (signaling,
pareamento, estado de conexão) · **Rust = plano de dados** (`str0m`, cliente TURN, média) **+ a
chave do device**.

> ⚠️ O #1129 **não move o socket** de signaling para o Rust — move a **chave**. O DoD é explícito:
> *"teste que falha se a **chave privada** aparecer no lado TS"*.
