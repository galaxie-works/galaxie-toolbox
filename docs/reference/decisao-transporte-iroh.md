# Trocar o transporte do Remote por Iroh? — parecer

**Autor:** Altair · **Medido em:** `feat` `81d789d` (2026-08-18) · `Ref #1165`
**Pergunta do PO:** *"eu teria esse tipo de problema se tivéssemos partido pra Iroh?"*

> Tudo abaixo que é **nosso código** foi medido neste ref. Tudo que é **sobre o Iroh** está marcado como não medido — **não existe spike no repo** (`grep -rn iroh` → zero). Fato medido carrega ref e data; fato não medido carrega etiqueta.

---

## RECOMENDAÇÃO

**Não trocar agora — e a razão NÃO é "já investimos demais".**

1. **Primeiro consertar o que dói em qualquer transporte.** Hoje o bitrate é **fixo em 12 Mbps** e a única recuperação de perda é **pedir keyframe**. Com isso no lugar, *qualquer* transporte vai parecer ruim numa sessão de suporte real — inclusive o Iroh. Trocar antes disso é **trocar a variável errada e perder a medição**.
2. **Espinho vertical do Iroh como card separado**, com gatilho e ponto de desistência escritos (§6). O acoplamento é pequeno o bastante pra manter a opção aberta de graça.
3. **Reavaliar com número na mão** depois de (1).

---

## 1. A resposta direta ao PO

**Sim — 6 dos 10 bugs não teriam acontecido. Mas não porque QUIC seja melhor que WebRTC.**

A causa é outra, e ela é a coisa mais importante deste parecer:

> **`str0m` é sans-I/O: ele deliberadamente NÃO faz socket, NÃO faz gathering, NÃO fala com o coturn. Essa metade é nossa por desenho. O Iroh faz.**

O próprio código diz isso — `services/remote-transport/src/session.rs:216`:
> *"O str0m é sans-I/O e NÃO faz esse gathering; o [app faz]"*

Olhando a lista de bugs com essa lente, ela se reorganiza:

| Bug | Rótulo antigo | O que era de verdade |
|---|---|---|
| candidato ICE `0.0.0.0` (#1108) | "da stack" | **nosso I/O** — usamos o endereço do bind como candidato; o str0m recusou **corretamente** |
| gathering STUN (#1126) | "da stack" | **nosso I/O** — tivemos que escrever o codec STUN na mão |
| credencial TURN sem renovação (#1148) | "da stack" | **nosso I/O** — o str0m nunca falou com o coturn |
| coturn sem TLS (#1050) | "da stack" | **nossa infra** |
| PT do H.264 (#685) | "da stack" | integração — o str0m lista VP8 antes; tivemos que fixar o PT |

**O que o PO sentiu não foi "WebRTC é ruim". Foi o custo de escrever a metade que o `str0m` entrega em branco.** Essa categoria inteira desaparece com uma biblioteca que possui o I/O. É um argumento real e forte a favor do Iroh — mais forte do que "6 de 10", porque nomeia a causa.

---

## 2. O acoplamento — verificado, e menor que o denominador sugere

| | |
|---|---|
| Linhas com símbolo WebRTC/ICE/str0m | **97** |
| Rust do Remote (`services/remote-*`) | **14.376** |
| Concentração | `remote-transport/src/session.rs` **32** · `src-tauri/src/remote.rs` **30** = **64%** em 2 arquivos |

Confere com a medição do `Polaris` (98 no ref anterior). **A ressalva dele continua valendo e eu assino: 0,7% das linhas não é 0,7% do esforço** — são as linhas mais difíceis. O número derruba *"já investimos demais pra trocar"*; **não** prova que trocar é barato.

---

## 3. O achado que muda a conta: **não estamos usando a maturidade que o str0m nos dá**

O argumento mais forte pra ficar é *"o str0m entrega semântica de mídia que o Iroh não entrega"*. Fui medir quanto disso está **cobrado hoje**:

| Capacidade | Estado medido |
|---|---|
| Controle de banda (BWE) | ❌ **não habilitado** — `grep enable_bwe\|Bwe\|congestion` em todo o Remote → **zero** |
| Bitrate adaptativo | ❌ **fixo**: `bitrate_bps: 12_000_000` (`services/remote-capture/src/config.rs:40`) |
| Recuperação de perda | ⚠️ **só PLI** — `request_keyframe(None, KeyframeRequestKind::Pli)` (`session.rs:311`) é a única política nossa |
| Empacotamento RTP | ✅ do str0m (`session.rs:257-271`) |
| DTLS-SRTP | ✅ do str0m |

> ⚠️ **Não afirmo que não há NACK/RTX.** O str0m pode habilitar por padrão; eu medi que **nós não configuramos**, não o que a lib faz sozinha. Verificar no spike.

**12 Mbps fixos numa sessão de suporte pela internet é o problema dominante, e ele é independente de transporte.** Numa banda doméstica típica de upload, isso satura o link e a latência explode — com WebRTC, com QUIC, com qualquer coisa.

**Consequência para a decisão:** a "maturidade que perderíamos" é, em boa parte, **valor não realizado**. Isso enfraquece o argumento de ficar — e, ao mesmo tempo, mostra por que trocar agora seria um erro de método: a camada de mídia **já é nossa e já está inacabada**; com Iroh ela ficaria **maior e obrigatória** (empacotamento em datagrama + política de perda passariam a ser nossos também).

---

## 4. OpenSSL — o ponto mais limpo a favor do Iroh

Medido:

- O OpenSSL entra **só por causa do str0m**: `src-tauri/Cargo.toml:40-41` liga `dep:openssl` + `openssl/vendored` **dentro da feature `remote`**; a `:119-121` explica que a dependência direta existe **apenas** pra poder ligar o `vendored`.
- **O rustls já está na árvore**: `remote-net/Cargo.toml:38-39` e `remote-signaling/Cargo.toml:28-29` (rustls 0.23 + ring).

Ou seja: **a árvore já roda rustls; o OpenSSL é um corpo estranho mantido por um único consumidor.** Ele já custou caro duas vezes documentadas — build local e instalador/CI. O Iroh usa rustls (**não medido**, mas é a base do quinn), o que tornaria a árvore homogênea.

Este é o benefício mais concreto e menos especulativo da troca.

---

## 5. Os 6 pontos do card

**1. Mídia sobre QUIC datagrams — quem faz pacing/congestion/perda?**
**Nós.** Datagrama QUIC não é retransmitido; o congestionamento do quinn é pensado pra stream. Empacotar H.264 em datagramas com limite de MTU, decidir o que fazer quando cai, e adaptar bitrate passariam a ser **código nosso**. **É aqui que a decisão se perde.** Mitigação real: hoje já não usamos BWE, então a distância é menor do que parece — mas a obrigação passa a ser nossa e sem rede de segurança. **Não medido:** maturidade de crates de mídia sobre Iroh.

**2. Latência sob perda.** **Impossível responder honestamente hoje.** Não há spike, e comparar com o que temos seria comparar contra uma configuração quebrada (12 Mbps fixos). **Qualquer medição comparativa precisa vir DEPOIS do bitrate adaptativo**, senão mede o nosso bug, não o transporte.

**3. Relay — n0 público ou nosso?**
**Nosso.** É sessão de suporte de cliente B2B: tráfego por relay de terceiro muda a superfície de privacidade e cria dependência operacional que não controlamos. O relay do Iroh é auto-hospedável (**não medido**). **Consequência honesta: "o coturn some" só é verdade se aceitarmos o relay público.** Hospedando o nosso, o custo operacional não desaparece — **muda de forma** (some a credencial HMAC efêmera do #1148, fica um serviço nosso pra manter e dar TLS, que é o #1050 com outro nome).

**4. O que o Iroh NÃO resolve.**
Identidade de device e autorização continuam nossas — **#1129/#1132 valem em qualquer cenário**, e a decisão do #1049 (migrar pro `/v2/ws`) não é afetada. **Sinergia que vale registrar:** o `NodeId` do Iroh é uma chave pública **Ed25519**, a mesma primitiva da nossa identidade de device do S8 (`identity.rs`) — há chance de convergir em vez de manter dois sistemas. **Não medido**, e é uma das perguntas boas pro spike.

**5. Caminho incremental?**
**Sim, e é barato — este é o argumento que mantém a porta aberta.** O acoplamento vive em 2 arquivos; o `remote-transport` já é crate separado, com o `IoDriver` isolando I/O. Dá pra ter um `TransporteIroh` atrás da mesma fronteira e um espinho de *uma sessão, só vídeo, sem input*.

**6. Custo de NÃO trocar.**
Ficam doendo, e o PO decide com o preço na mão:
- **coturn é serviço nosso pra sempre** — TLS (#1050 SEC10), rotação de credencial, disponibilidade;
- **OpenSSL fica** no build/CI/instalador, sozinho contra uma árvore rustls;
- **a metade sans-I/O continua nossa** — cada aresta de ICE/STUN/TURN é código que a gente escreve e depura;
- **a camada de mídia é nossa de qualquer jeito** — BWE e bitrate adaptativo não vêm de graça em nenhum dos dois caminhos.

O #1148 (renovação de credencial) é **imaturidade nossa**, não dívida permanente da stack. Mas ele só existe porque escolhemos uma stack que nos entrega essa responsabilidade.

---

## 6. Se for fazer o espinho: gatilho e ponto de desistência

**Escopo:** uma sessão, vídeo só, sem input, sem áudio, LAN e depois NAT doméstico. Atrás da fronteira do `remote-transport`, sem remover o str0m.

**Desiste se:**
- empacotar H.264 em datagrama exigir código de mídia próprio além de ~2 semanas, **ou**
- a latência sob 2% de perda ficar pior que a do str0m **medido depois do bitrate adaptativo**, **ou**
- o relay auto-hospedado não for viável e a única saída for o relay público.

**Adota se:** o espinho fechar vídeo fim-a-fim atravessando NAT doméstico **sem coturn e sem OpenSSL na árvore**, com latência comparável.

**Pré-requisito inegociável:** o bitrate adaptativo entra **antes** da comparação. Sem isso, o espinho mede o nosso bug.

---

## 7. O que eu recomendo abrir como card, independente da decisão

**Bitrate adaptativo + política de perda melhor que "pede keyframe".** Vale em qualquer transporte, é a causa provável da percepção de qualidade ruim, e é pré-requisito pra qualquer comparação honesta. **É o item que eu colocaria na frente do espinho.**
