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
  num ambiente com toolchain OpenSSL: `cargo check --features webrtc`.

> **Estado de verificação (honesto):** o núcleo está **cargo-test verde** (5
> testes). O módulo `session` (str0m/`webrtc`) foi escrito contra a API do str0m
> 0.6 mas **não foi compilado localmente** — esta máquina não tem toolchain
> OpenSSL (perl presente, mas sem Visual Studio/nmake pro build vendored do
> `openssl-src`). Precisa de um build com OpenSSL (CI Linux) pra confirmar o
> compile do transporte. A conectividade real (ICE racing/relay, DTLS, fluxo de
> mídia) é **live-QA entre 2 máquinas** de qualquer forma (DoD).

## Papéis

- **Host:** compartilha a tela — envia vídeo (SendOnly), recebe controle.
- **Controlador:** assiste (RecvOnly) e comanda pelo datachannel.
