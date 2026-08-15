# Spike — RASystem (CasualOffice) como base/ref do Remote #682

> **Status:** SPIKE de decisão pro Wagner. **Recomendação decisiva abaixo (§6).**
> Não altera código. (#943, épico Remote #682.)

## 1. O que é o RASystem

[CasualOffice/RASystem](https://github.com/CasualOffice/RASystem) — engine de acesso
remoto P2P em **Rust + Tauri v2**, Apache-2.0. "The remote-access engine you embed,
not the app you send users to." Screen-share + controle + voz/vídeo + contatos.

| Camada | RASystem | Nosso #682 (estado) |
|---|---|---|
| Linguagem/shell | Rust + **Tauri v2** | Rust + **Tauri v2** (igual) |
| **Transporte/NAT** | **iroh sobre QUIC** + relay cifrado (holepunch embutido) | **str0m (WebRTC)** + **coturn** (STUN/TURN) + signaling S0 |
| Captura Windows | Graphics.Capture (WGC) | WGC + **DXGI fallback** (igual+) |
| Encode Windows | **OpenH264 (software) só** | **Media Foundation HW H.264** (NVENC/QSV/AMF) + openh264 fallback |
| Decode | WebCodecs (canvas) | próprio |
| Input Windows | SendInput | enigo/SendInput (igual) |
| Áudio | Opus + WASAPI | Opus + WASAPI (igual) |
| Segurança | **PASETO v4 grants, capability-por-mensagem, consent-first, audit hash-chain** | DTLS-SRTP (str0m) + remote-net S8 (OPAQUE/ticket) |
| **Secure desktop / SYSTEM (não-supervisionado)** | **NÃO** ("no support for Windows service-mode operation or secure-desktop") | **SIM — S7 construído** (broker Delphi + worker Rust SYSTEM, `SetThreadDesktop` winlogon) |
| Plataformas | macOS (lead), Linux, **Windows = decode-only estável; encode/control não verificado** | **Windows-first**, encode+control já fiados/E2E-provados |
| Maturidade | **Alpha · 0 stars · 0 forks · instaladores não-assinados** | slices S0–S8 construídas, `--features remote` compila, E2E loopback verde |

## 2. O apelo real (o único "encurtar o stack" válido)

O ganho concreto do RASystem **não** é a mídia/captura/input (temos igual ou melhor
no Windows) — é o **iroh**: uma lib única que faz **NAT traversal + holepunch + relay
cifrado**, no lugar do nosso trio **str0m + coturn + signaling**. Nosso maior custo
**operacional** é o coturn (VPS, `telemetry`/infra, credenciais TURN efêmeras) + o
servidor de signaling. iroh colapsa isso num crate P2P com relays geridos/próprios.

## 3. Por que NÃO encurta o *nosso* caminho (contras que pesam)

1. **Windows é a plataforma menos madura do RASystem** — "encode/control awaiting
   hardware verification". Adotá-lo = **terminar o Windows deles** (encode HW,
   controle), justo o que nós **já** temos fiado e E2E-provado (#685 harness).
2. **Não faz S7 (secure desktop / serviço SYSTEM).** É o item "mais duro" do épico
   (#690) e nosso maior diferencial — **já construído** (Orion). O RASystem
   **não teria como substituir isso**; manteríamos nosso S7 de qualquer forma.
3. **Encode Windows inferior:** openh264 software vs. nosso **MF HW H.264** (latência/
   CPU). Trocar seria regressão de qualidade no nosso alvo.
4. **Custo de swap tardio:** rebasear o transporte joga fora o `remote-transport`
   (str0m), o wiring do `remote.rs`, o seam worker↔owner que acabei de desenhar
   (#937), e o contrato `CodedFrame`. Alto, com o stack já code-complete.
5. **Risco de dependência:** alpha, 0 stars, time único, sem assinatura. Apostar o
   core do produto nele agora é risco de manutenção/segurança.

## 4. O que vale ROUBAR do RASystem (independente da decisão)

- **iroh como spike SEPARADO e cirúrgico:** avaliar iroh **só pra substituir
  coturn+signaling**, mantendo nossa mídia (str0m escreve/lê de socket; iroh poderia
  ser o portador). Ganho operacional real (menos infra) sem jogar fora o resto. **É a
  única parte que merece um spike próprio** se o custo do coturn incomodar.
- **Padrões de segurança:** PASETO v4 signed grants + **capability-por-mensagem** +
  **consent-first** + **audit hash-chain** são excelentes pro nosso **S8/não-
  supervisionado** — dá pra incorporar no `remote-net` sem trocar transporte.
- **Multi-plane separation** (control/video/audio/health) — já fazemos parecido
  (datachannel + media); a nomenclatura/health-plane deles é boa referência.

## 5. Matriz de decisão

| Critério | Adotar RASystem | Manter nosso stack |
|---|---|---|
| NAT traversal / infra | **+** (iroh, sem coturn) | − (coturn a operar) |
| Encode Windows | − (software) | **+** (HW) |
| Secure desktop / S7 | − (inexistente) | **+** (construído) |
| Investimento já feito | − (joga fora S0–S8) | **+** (aproveitado) |
| Maturidade/risco | − (alpha, 0★) | **+** (nosso, provado) |
| Cross-platform futuro | **+** (mac/linux) | − (Windows-first) |

## 6. Recomendação (decisiva)

**NÃO rebasear o Remote no RASystem.** O "encurtar o stack" é ilusório pro nosso
caso: o RASystem só é forte onde já somos fortes (ou melhores — encode HW), e é
fraco/inexistente justo no que é caro e diferenciado pra nós (**S7 secure-desktop**,
Windows encode/control verificado). Trocar agora = regressão + retrabalho + risco de
alpha.

**Fazer, sim:**
1. **Manter** str0m + S7 + o design do #937 (não bloquear neles por causa deste spike).
2. **Abrir um spike ESTREITO de `iroh` vs `coturn+signaling`** — só a camada de NAT
   traversal/transporte-portador, mantendo nossa mídia. É o único ganho real do
   RASystem, e dá pra colher sem jogar fora nada. (Decisão do Wagner se prioriza.)
3. **Incorporar os padrões de segurança** do RASystem (PASETO grants, capability-por-
   mensagem, consent/audit) no **S8/remote-net**, onde ainda são abertos.

**Se o Wagner discordar** (ex.: cross-platform mac/linux virou requisito de 1ª
classe, ou o custo do coturn é proibitivo): aí o RASystem vira candidato sério — mas
mesmo assim manteríamos nosso S7 por cima (eles não têm), e seria um **épico de
migração**, não um atalho.

## 7. Pergunta pro Wagner
- O **custo operacional do coturn** (VPS/infra/manutenção) é dor real o suficiente pra
  justificar o spike estreito de iroh (§6.2)?
- **Cross-platform (mac/Linux)** é requisito de 1ª classe do Remote, ou Windows-first
  segue sendo o foco? (Muda o peso do RASystem drasticamente.)
