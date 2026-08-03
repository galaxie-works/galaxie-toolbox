# Navigator — Research de arquitetura (#363)

> 📌 **Research/spike (#363) — read-first, débito técnico. Estado atual: backlog/idea**, não implementado. Doc de investigação.

> **Débito técnico / spike (read-first, sem implementar).** Origem: ressalva do
> Wagner ao aprovar o épico #324 — *"Tauri nunca foi construído pra se fazer um
> app navegador nele... o Navigator funciona bem, mas os débitos técnicos
> existem."* Entregável: matriz comparativa + recomendação pro PO decidir. Nada
> aqui é decisão final — é insumo. Padrão do spike de telemetria (#343).

## 1. O problema de fundo

Cada aba do Navigator é uma **WebView2 nativa** — uma janela-filha do SO (feature
`unstable` do Tauri 2), posicionada por coordenada sobre a área de conteúdo. Por
que nativo e não `<iframe>`: Outlook/Teams/SharePoint mandam `X-Frame-Options` e
recusam carregar em frame; webview nativa não é frame.

O preço: a WebView2-filha é uma **superfície do compositor do SO que pinta SEMPRE
ACIMA do DOM** (windowed hosting). Não há z-index que a coloque atrás de um
elemento HTML. Disso nasce toda a família #324:

| Sintoma | Causa | Mitigação atual |
|---|---|---|
| Menu/Sheet/paleta cortados/sumidos sob a webview | z-order always-on-top | esconder + **snapshot-to-image** (`CapturePreview`) sob o overlay (#275) |
| Tela preta no right-click / branca no History | `hide()`/`show()` sem repaint | `revelar()` — bounds-nudge força o compositor (#336) |
| Atalhos não pegam com foco na webview | teclado não sobe pro React | **accelerators Rust** (`AcceleratorKeyPressed`, COM) → evento → handler (#272) |
| Scroll perdido ao dormir aba | destroy/recreate da webview | captura contínua (`WebMessageReceived`) + restore no recreate (#202) |
| RAM não volta ao esconder aba | `hide()` ≠ freed | **destroy** (`close()`) + snapshot; recreate no clique (#173) |
| Scrollbar da página fora do padrão | é a engine, não o app | `initialization_script` injeta `::-webkit-scrollbar` (#311) |

**As mitigações funcionam** (o Wagner validou #275/#272/#310 → Released). Mas são
camadas sobre uma arquitetura que não foi desenhada pra hospedar um navegador, e
têm um **teto** + **fragilidade** documentados na §2.

## 2. O débito residual do status quo (o teto)

O que as mitigações **não** resolvem 100% — e não vão, por design:

1. **Todo overlap DOM↔webview exige orquestração manual.** Cada tooltip/menu/
   sidebar que caia sobre o rect da webview precisa registrar "esconde a webview"
   e revelar depois. É frágil: um gatilho errado **quebra a navegação inteira** —
   aconteceu um **P0** (2026-07-31, #359): esconder por estado *persistente*
   (`sidebar expanded`) em vez de *transiente* deixou a webview permanentemente
   oculta → nenhum site abria. Lição: só gatilhos transientes; mas a superfície
   de erro continua existindo a cada novo overlay do app.
2. **Snapshot é congelado, não vivo.** Sob um overlay, o usuário vê um bitmap
   estático (`CapturePreview` JPEG), não a página animando. Aceitável pra overlays
   transientes; nunca vai ser "o conteúdo continua rodando por baixo".
3. **Transição assíncrona.** `CapturePreview` é COM async (~dezenas de ms) → há
   uma micro-janela ao abrir o overlay. Mitigável (snapshot cacheado), nunca zero.
4. **Sleeping = destroy/recreate.** Não há freeze barato no WebView2 windowed sob
   Tauri. Dormir descarta a webview; acordar recarrega a URL (perde sub-navegação
   in-page, estado de formulário além do que o snapshot/scroll capturam).
5. **Foco/teclado depende de COM por aba.** Cada webview criada precisa registrar
   o accelerator handler; funciona, mas é código `unsafe` Windows-específico por
   aba.
6. **Multi-monitor / DPI / z-order com outras janelas nativas** (splash, diálogos)
   sempre exigem cuidado extra — a webview é uma janela do SO competindo no
   compositor.
7. **Só Windows.** Todas as mitigações COM (accelerators, snapshot, scroll,
   composition) são WebView2/Win32. Um dia macOS/Linux = reescrever a camada.

**Resumo:** o status quo entrega um navegador **bom o suficiente** com custo de
manutenção **contínuo e propenso a regressão** na fronteira DOM↔webview.

## 3. As opções estruturais

### Opção 1 — WebView2 windowed + mitigações (status quo)

Manter a arquitetura atual, endurecendo as mitigações.

- **z-order:** resolvido por orquestração (snapshot) — frágil, teto na §2.
- **Endurecimento possível (sem trocar de engine):** um **occlusion manager
  único** como fonte da verdade (todo overlay do app — chrome ou Navigator —
  registra num só lugar, com *fail-safe reveal* por timeout pra nunca travar
  como no P0); snapshot cacheado pra transientes; testes de "a webview sempre
  volta".
- **Custo:** baixo (é o que já existe). **Risco:** regressão recorrente na
  fronteira. **Bundle:** zero extra. **UX:** navegador dentro do app ✅.
- **Teto:** nunca será um Chrome embutido; sempre haverá bordas ásperas em
  overlays novos.

### Opção 2 — WebView2 em modo composition / visual hosting (forkar/patchar o wry)

WebView2 suporta **composition hosting** (`CreateCoreWebView2CompositionController`
+ `ICoreWebView2CompositionController` — as interfaces EXISTEM na `webview2-com`
0.38 que já usamos). Nesse modo a webview vira uma **visual** numa árvore de
composição (DirectComposition), e o DOM/app pode compor **acima** dela → **o
z-order deixa de ser um problema** (overlays, tooltips e menus renderizam por
cima nativamente, sem esconder/snapshot).

- **O bloqueio:** o **wry cria a webview em modo WINDOWED** (`add_child` → HWND
  filho). Não dá pra "castar" uma webview windowed pra composition — é outro modo
  de criação. Usar composition exige **forkar/patchar o wry** (e possivelmente o
  Tauri) pra hospedar a webview via composition controller + integrar a visual na
  janela do app.
- **Custo:** **alto** (fork de wry + manutenção: rebase a cada release do
  wry/Tauri, que se movem rápido). **Risco:** médio-alto (divergir do upstream;
  input routing/HWND-less tem suas próprias armadilhas — hit-testing, IME, DPI).
  **Bundle:** zero extra (mesma engine). **UX:** navegador dentro do app ✅, e
  **elimina a classe #324 inteira** (z-order/snapshot/occlusion).
- **É o fix estrutural "certo"** pro z-order — mas troca dívida de *orquestração*
  por dívida de *manter um fork de engine host*.

### Opção 3 — Embedding alternativo (CEF / Servo / processo de browser)

Trocar a engine: **CEF** (Chromium Embedded Framework, offscreen rendering →
pinta num texture/canvas que o app compõe), **Servo** (engine Rust, imatura), ou
orquestrar um **processo de browser separado**.

- **CEF (OSR):** controle total de compositing (z-order resolvido) e de ciclo de
  vida (freeze real, sem destroy/recreate). MAS: **+100–150 MB de binário**, build
  complexo (não é Tauri-native — precisa de bindings + gerenciar o subprocesso
  Chromium), custo de perf do OSR, e duplica a engine (o app já roda em WebView2).
- **Servo:** promissor em Rust, mas **imaturo** pra sites reais (Outlook/Teams/
  SharePoint quase certo que quebram). Fora de questão pra produção agora.
- **Processo separado orquestrado:** um browser real controlado por CDP — pesado,
  e a renderização ainda precisa aparecer no app (volta pro OSR/composition).
- **Custo:** **muito alto** (nova engine + bundle + build + manutenção).
  **Risco:** alto. **Bundle:** +++. **UX:** possível, mas desproporcional ao valor.

### Opção 4 — Janela de browser separada (não sobreposta ao DOM)

Abrir o Navigator como uma **janela do SO separada** (não embutida na área de
conteúdo). Janela nativa z-ordena normalmente → **zero conflito com o chrome do
app**.

- **z-order:** resolvido por não haver sobreposição (são janelas irmãs do SO).
- **Custo:** **baixo-médio** (Tauri já faz multi-window). **Risco:** baixo.
  **Bundle:** zero. **PORÉM UX:** **abre mão do "navegador dentro do app"** — que
  é justamente o diferencial (command palette + abas + apps M365 integrados na
  mesma superfície). Vira "mais uma janela".
- **Nicho:** boa **saída de escape** pra casos pesados (ex.: um botão "abrir em
  janela dedicada" pra um site problemático), não como arquitetura principal.

## 4. Matriz comparativa

| Dimensão | 1. Windowed + mitigações | 2. Composition (fork wry) | 3. CEF/Servo | 4. Janela separada |
|---|---|---|---|---|
| **z-order / overlays** | 🟡 mitigado, frágil | 🟢 resolvido | 🟢 resolvido (OSR) | 🟢 N/A (sem overlap) |
| **Sleeping / RAM freeze** | 🟡 destroy/recreate | 🟡 destroy/recreate | 🟢 freeze real | 🟡 idem |
| **Foco / teclado** | 🟡 accelerator COM/aba | 🟢 é DOM-adjacente | 🟢 controlado | 🟢 janela própria |
| **UX "browser no app"** | 🟢 | 🟢 | 🟢 | 🔴 perde |
| **Custo de dev** | 🟢 baixo | 🔴 alto (fork) | 🔴 muito alto | 🟢 baixo-médio |
| **Manutenção / upgrade** | 🟢 segue upstream | 🔴 rebase do fork | 🔴 engine própria | 🟢 |
| **Bundle** | 🟢 0 | 🟢 0 | 🔴 +100-150MB | 🟢 0 |
| **Risco de regressão** | 🟡 recorrente na borda | 🟡 no fork | 🔴 | 🟢 |
| **Cross-platform futuro** | 🔴 só Win (COM) | 🔴 só Win | 🟡 CEF multiplataforma | 🟢 |

## 5. Recomendação (faseada)

1. **Agora / curto prazo — Opção 1 endurecida.** O Navigator "funciona bem"
   (validado, Released). O ganho marginal de trocar de engine **não justifica** o
   custo hoje. Ação concreta: consolidar as mitigações num **occlusion manager
   único com fail-safe reveal** (o P0 mostrou que a fragilidade está no gatilho,
   não na ideia), snapshot cacheado, e uma suíte de "a webview sempre volta".
   Documentar o teto (§2) como débito conhecido e aceito.
2. **Gatilho pra reavaliar — Opção 2 (composition).** SE a fronteira DOM↔webview
   continuar gerando P0s/rejeições recorrentes (custo de manutenção > custo do
   fork), a **composition** é o fix estrutural certo e o **menos disruptivo**
   (mesma engine WebView2, mesmo bundle, elimina a classe #324 inteira). Antes de
   commitar: um **spike de 2-3 dias** validando `CreateCoreWebView2CompositionController`
   num fork do wry — hit-testing/IME/DPI são os riscos a provar. Só então decidir
   manter o fork.
3. **Rejeitar como caminho principal — Opções 3 e 4.** CEF/Servo: custo/bundle
   desproporcionais ao valor (Opção 3). Janela separada: mata o diferencial de UX
   (Opção 4) — mas **guardar a janela separada como saída de escape** por-site
   (botão "abrir em janela dedicada") é barato e útil pra casos patológicos.

**TL;DR:** ficar no windowed+mitigações **endurecido** agora; ter a **composition
(fork wry)** como plano estrutural pré-validado por spike, acionável se a dívida
de orquestração passar de um limite; CEF/Servo/janela-separada fora do caminho
principal.

## 6. Fora de escopo / a validar antes de qualquer troca

- Perf real do OSR (CEF) e do composition hit-testing no nosso hardware-alvo.
- Custo real de rebase de um fork de wry (frequência de releases que quebram).
- IME/acentuação e acessibilidade em modo composition (HWND-less).
- Nada aqui é implementação — a decisão é do PO (Wagner).
