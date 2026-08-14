# galaxie-remote-transport (S2)

Transporte **WebRTC** do GALAXIE Remote (épico #682, S2). `str0m` sans-I/O: ICE
via o nosso coturn (STUN/TURN do S0), **media track** de vídeo H.264 (do encoder
S1) + **DataChannel** de controle, E2E **DTLS-SRTP**.

## Fronteiras (seams)

- **Encoder (S1) ↔ Transporte (S2):** [`CodedFrame`](src/frame.rs) — **contrato
  congelado**. `{ data: Vec<u8> (H.264 Annex-B), timestamp_us: u64 (monotônico),
  keyframe: bool }`. O S1 produz; o S2 empacota em RTP. O S2 testa com
  `DummyFrameSource`; o encoder real liga sem tocar no transporte.
- **Transporte ↔ Signaling (S0):** [`SignalingChannel`](src/signaling.rs) +
  `SignalMessage` (Offer/Answer/IceCandidate). O app pluga sobre o WebSocket do
  `galaxie-remote-signaling`.
- **Transporte ↔ Rede:** sans-I/O — o `Transport` só diz o que transmitir/quando
  (`Passo`); o app faz o UDP.

## Features / build

- **default (núcleo):** contrato de frame + signaling + stats. **Não depende de
  rede** — compila e testa em qualquer ambiente. `cargo test`.
- **`webrtc`:** puxa o `str0m`, que depende de **OpenSSL** (DTLS) no build. Ligue
  num ambiente com toolchain OpenSSL: `cargo check --features webrtc`. Local
  (Windows, sem Visual Studio): use o OpenSSL do PostgreSQL —
  `$env:OPENSSL_DIR='C:\Program Files\PostgreSQL\16'; $env:OPENSSL_NO_VENDOR='1'`.

## Driver de I/O + harness E2E (S2)

O `Transport` é **sans-I/O** (diz o quê transmitir; o app faz o UDP). O
[`IoDriver`](src/driver.rs) (feature `webrtc`) casa um `UdpSocket` real com o
`Transport` e roda o loop `passo()`/`receber_udp()`/`atender_timeout()` — é o que
o app (S4) e o harness usam pra rodar o transporte de fato.

O [`examples/e2e_dummy.rs`](examples/e2e_dummy.rs) prova o pipe inteiro num
processo só: dois `IoDriver` em **UDP loopback real**, `offer→answer→ICE→DTLS`,
`DummyFrameSource` (test-pattern) do Host + ping de controle do Controlador;
asserta conexão, round-trip de datachannel e vídeo, reporta latência/bitrate.

```text
$env:OPENSSL_DIR='C:\Program Files\PostgreSQL\16'; $env:OPENSSL_NO_VENDOR='1'
cargo run --example e2e_dummy --features webrtc
```

> **Estado de verificação (honesto):** o núcleo está **cargo-test verde** (5
> testes). A feature `webrtc` (str0m 0.6.3 + `session` + `driver`) **compila
> local** (OpenSSL do PostgreSQL). O harness `e2e_dummy` prova a **lógica do pipe**
> (SDP/ICE/DTLS/media/datachannel) de forma determinística e rodável em loopback.
> A conectividade real (ICE racing/relay, NAT simétrico → TURN, DTLS entre hosts
> distintos) é **live-QA entre 2 máquinas** — DoD explícito do S2.

## Papéis

- **Host:** compartilha a tela — envia vídeo (SendOnly), recebe controle.
- **Controlador:** assiste (RecvOnly) e comanda pelo datachannel.
