# GALAXIE Remote SYSTEM helper (S7)

Windows-only privileged broker for GALAXIE Remote. The component is split into:

- `GalaxieRemoteSystem.exe`: Delphi/Win32 service running as `LocalSystem` in
  Session 0. It owns session discovery, the protected named pipe, worker
  lifecycle and service installation.
- `galaxie-remote-agent.exe`: fixed Rust worker launched as `LocalSystem` in the
  active interactive session. It attaches to `winsta0\default` or
  `winsta0\winlogon`. This S7 cut establishes the privileged worker host; the
  S8 owner still has to connect the authenticated `remote-capture` /
  `remote-transport` session inside that process. Media and credentials must
  never cross the broker JSON pipe.

## Frozen local IPC contract

Pipe: `\\.\pipe\Galaxie.Remote.System.v1`, message mode, UTF-8 JSON, maximum
message size 64 KiB. Remote pipe clients are rejected.

```json
{"v":1,"id":"uuid","type":"request","method":"service.status","payload":{}}
{"v":1,"id":"uuid","type":"response","ok":true,"result":{}}
{"v":1,"type":"event","event":"agent.state","payload":{}}
```

The first request must be `hello` with `{clientPid, sessionId, nonce}`. The
broker reflects the nonce in `helloAck`. Supported methods after the handshake:

- `service.status`
- `agent.ensure {sessionId?}`
- `agent.stop {sessionId}`
- `desktop.setMode {sessionId, mode: "auto" | "default" | "winlogon"}`

There is no generic command, executable path, argument list or credential in
the protocol.

## Security boundary

- Pipe DACL: `SYSTEM`, administrators and the active session Logon SID only;
  network clients are denied.
- The broker validates pipe client PID/session, installation directory and
  Authenticode before accepting commands. Validation failure is fail-closed.
- The worker path is fixed next to the service binary.
- The worker token is duplicated from the service's SYSTEM token, receives the
  target `TokenSessionId`, and is passed to `CreateProcessAsUser`. A user token
  from `WTSQueryUserToken` is used only for the session environment and Logon
  SID; it is never the worker execution identity.

## Integration gate

The frozen broker protocol deliberately has no generic payload for signaling,
credentials, media, or input. The current worker verifies its SYSTEM identity
and target session and owns desktop attachment/switching. Wiring the existing
capture, transport and input crates requires a separately frozen authenticated
worker-session channel with the S8/Tauri owner. Until that channel and the PO's
EV certificate are available, real login/UAC capture-and-click QA remains an
external gate and must not be reported as complete.

## Build

Delphi 13 / Win32:

```powershell
scripts\build.ps1
```

Rust worker:

```powershell
cargo test --manifest-path ..\remote-system-agent\Cargo.toml
cargo build --release --manifest-path ..\remote-system-agent\Cargo.toml
```

The build script stages both executables and can Authenticode-sign them when a
certificate selector is supplied by the release environment. It never reads or
stores a private-key password. EV signing remains a release gate owned by the
PO.

## Service lifecycle

Run from an elevated terminal after staging the signed binaries:

```powershell
GalaxieRemoteSystem.exe --install
GalaxieRemoteSystem.exe --start
GalaxieRemoteSystem.exe --status
GalaxieRemoteSystem.exe --stop
GalaxieRemoteSystem.exe --uninstall
```

The SCM configuration is automatic start, delayed auto-start, restart after
unexpected exits and restart after boot failure. The installed binary path is
fixed and quoted.
