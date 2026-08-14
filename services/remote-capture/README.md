# GALAXIE Remote capture

Pipeline Windows do GALAXIE Remote: captura a tela, codifica H.264 e entrega
access units prontas ao transporte.

## Pipeline

- Windows Graphics Capture (WGC) e o backend primario, com cursor configuravel,
  dirty regions e timestamp monotônico vindo da captura.
- Desktop Duplication (DXGI) e usado quando WGC nao consegue iniciar e recria a
  duplicacao depois de `DXGI_ERROR_ACCESS_LOST`.
- Media Foundation e descoberto em runtime. O frame BGRA vira NV12 com D3D11
  VideoProcessor e entra no MFT como textura DXGI; nao ha readback de pixels no
  caminho hardware.
- OpenH264 e o fallback de software para maquinas sem MFT compativel ou para uma
  falha runtime do encoder quando `EncoderPreference::Auto` esta ativo.

O perfil remoto padrao e 1920x1080, 60 fps, CBR 12 Mbps, low latency, zero
B-frames e uma reference frame.

## Contrato S1 -> S2

`CodedFrame` segue o contrato congelado com `remote-transport`: H.264 Annex-B,
timestamp monotônico em microssegundos e flag IDR. Um IDR publicado inclui os
SPS/PPS cacheados. A entrega usa `SyncSender<CodedFrame>` bounded.

O canal reverso coalesce pedidos em uma unica
`EncoderCommand::RequestKeyframe`; Media Foundation usa
`CODECAPI_AVEncVideoForceKeyFrame` e OpenH264 usa seu force-intra nativo.

Quando o PR do S2 estiver integrado, `contract.rs` deve reexportar os tipos de
`services/remote-transport` em vez de manter a copia temporaria 1:1.

## Multi-monitor

`windows::enumerate_monitors()` expõe cada tela com um `id` opaco derivado do
device path do Windows, rótulo, resolução, posição física (inclusive origins
negativos) e flag de primária. O handle `HMONITOR` nunca cruza a fronteira.

Para uma sessão com troca de tela, crie o control-plane e passe o lado host ao
pipeline:

```rust,no_run
use galaxie_remote_capture::{canal_de_monitores, PipelineConfig};
use galaxie_remote_capture::windows::run_pipeline_with_monitors;

# let (frames, _rx) = galaxie_remote_capture::contract::canal_de_frames(8);
# let (_commands, command_rx) = galaxie_remote_capture::contract::canal_de_comandos();
let (controller, host) = canal_de_monitores(8);

std::thread::spawn(move || {
    run_pipeline_with_monitors(PipelineConfig::default(), frames, command_rx, host)
});

controller.selecionar("opaque-monitor-id")?;
# Ok::<(), Box<dyn std::error::Error>>(())
```

O host publica `MonitorList` e `MonitorActive` com o shape congelado da #732;
o bridge do DataChannel os transporta como `ControlMessage` no opcode `0x01`.
`MonitorActive.info` é o `ScreenInfo` que deve atualizar o injetor de input. A
sentinela `MONITOR_TODOS = "*"` está reservada, mas este backend anuncia
`virtual_desktop: false` e degrada a seleção de `*` para a tela primária.

## Gates e probe

```powershell
cargo fmt --manifest-path services/remote-capture/Cargo.toml -- --check
cargo clippy --manifest-path services/remote-capture/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path services/remote-capture/Cargo.toml

# Encoder automatico + WGC com fallback DXGI
cargo run --release --manifest-path services/remote-capture/Cargo.toml --example capture_probe

# Matrizes explicitas para QA
cargo run --release --manifest-path services/remote-capture/Cargo.toml --example capture_probe -- hardware wgc
cargo run --release --manifest-path services/remote-capture/Cargo.toml --example capture_probe -- hardware dxgi
cargo run --release --manifest-path services/remote-capture/Cargo.toml --example capture_probe -- software wgc

# Enumeração e troca real de monitor
cargo run --release --manifest-path services/remote-capture/Cargo.toml --example monitor_probe -- wgc
cargo run --release --manifest-path services/remote-capture/Cargo.toml --example monitor_probe -- dxgi
```

O probe roda tres segundos, pede um novo keyframe durante a sessao e verifica
Annex-B, contagem de IDRs, fps efetivo e latencia de encode avg/p95/max.
