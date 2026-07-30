# Navigator — Spike de senhas (S5 / #177)

> Recorte aprovado pelo PO (spec §7). **Não** construímos um gerenciador de
> senhas. Este documento é o entregável do spike: o que é viável via
> WebView2/DPAPI, o fallback honesto, e o que fica deliberadamente fora de
> escopo. Nenhum código de credencial em texto plano foi (ou será) adicionado ao
> app nesta slice.

## 1. Decisão de arquitetura

Cada aba do Navigator é um **WebView2 nativo** = a própria engine do Edge, que
**já tem um gerenciador de senhas** respaldado pelo **Windows Credential Manager
/ DPAPI** (criptografado em repouso, atrelado à conta Windows do usuário). O
design seguro é **deixar o autosave do Edge fazer o trabalho** e sair do caminho:

- O app **nunca** vê texto plano.
- O app **nunca** faz autofill via JS injetado.
- O app **nunca** armazena, exibe ou transmite senhas.

## 2. O que é viável (e como)

### 2.1 Toggle "Salvar senhas de sites (via Windows/Edge)"

A engine expõe as flags via `ICoreWebView2Settings`:

- `put_IsPasswordAutosaveEnabled` (interface `ICoreWebView2Settings4`, SDK
  ≥ 1.0.774) — liga/desliga o oferecimento de salvar senhas.
- `put_IsGeneralAutofillEnabled` (mesma interface) — autofill de formulários
  comuns (endereço etc.), não senhas.

Para chegar nessas settings a partir do Tauri:

1. Tauri 2.x (feature `unstable`, já ligada aqui) expõe o handle nativo do
   webview via `Webview::with_webview(|w| …)`. No Windows, `w.controller()`
   devolve o `ICoreWebView2Controller`.
2. Do controller: `controller.CoreWebView2()?.Settings()?` e faz `cast` para
   `ICoreWebView2Settings4` (crate **`webview2-com`** + `windows`), então
   `SetIsPasswordAutosaveEnabled(true/false)`.

Isso é um **hook nativo pequeno** em `src-tauri/src/browser.rs`, chamado logo
após `add_child` para cada aba nova, lendo o estado de um toggle em Settings.

### 2.2 "Gerenciar senhas salvas" — deep-link para o cofre do Windows

O gerenciamento (ver/editar/apagar) acontece **no SO, não na nossa UI**:

- Windows Credential Manager: `control.exe /name Microsoft.CredentialManager`
  (ou `rundll32.exe keymgr.dll,KRShowKeyMgr`).
- As credenciais web do Edge/WebView2 ficam no "Gerenciador de Credenciais →
  Credenciais da Web", protegidas por DPAPI.

Um link em Configurações abre essa tela do Windows. Copy honesta: *guardadas
pelo Windows, criptografadas com DPAPI, atreladas ao seu login do Windows; o
GALAXIE Toolbox nunca as vê.*

## 3. O que verificar antes de prometer o toggle (o núcleo do spike)

1. **Acesso ao handle nativo:** confirmar que `Webview::with_webview` está
   disponível/estável na versão de Tauri usada (2.11.3, feature `unstable`) e
   que devolve o `ICoreWebView2Controller` no Windows.
2. **Versão da interface:** `IsPasswordAutosaveEnabled` exige
   `ICoreWebView2Settings4`. Confirmar que o WebView2 Runtime resolvido pelo
   wry/tauri suporta o cast (Evergreen atual: sim; validar no ambiente-alvo).
3. **Custo de dependência:** adicionar `webview2-com` + `windows` ao
   `Cargo.toml`. Confirmar que casa com a árvore que o Tauri 2.11 já resolve
   (mesma lógica do comentário do `Cargo.toml` sobre não duplicar crates).

Se os três passarem, o toggle é um PR pequeno e seguro. **Não** foi feito nesta
slice para não arriscar o gate de build com um pipeline nativo novo — vira issue
própria pós-#177.

## 4. Fallback honesto (se o hook não vier no MVP)

Todas as abas compartilham **um único cookie jar do WebView2** (spec §1). Ou
seja: **a sessão já lembra o login de cada site** entre abas — o essencial que o
usuário quer ("não relogar toda hora") já funciona sem tocar em senhas. Se o
hook de settings se mostrar inviável, a resposta honesta é **documentar isso e
adiar o save explícito de senha**, sem enviar nada inseguro. O toggle é
descartado, não improvisado.

## 5. Fora de escopo — deliberado, por segurança

Nunca, em nenhuma versão sob este design:

- Sync de senhas entre dispositivos.
- Master password / cofre próprio.
- Ver, copiar ou exportar senhas dentro do app.
- Importar senhas salvas de outros navegadores.
- Qualquer autofill via scripting/DOM.
- O app ver, armazenar ou transmitir texto plano de credencial.

## 6. Recomendação

1. Manter esta slice **sem** manuseio de credencial (estado atual: cumprido —
   não há campo de senha nem autofill em lugar nenhum do app).
2. Abrir issue própria pós-#177: spike de ~1 dia validando o §3; se verde,
   implementar o toggle (§2.1) + deep-link (§2.2).
3. Até lá, o fallback do cookie jar (§4) cobre o caso de uso real.

## 7. Relação com o plumbing de histórico (§8.1)

A captura de navegação desta slice é feita na **camada React** — nos pontos onde
o app comita uma URL num webview (abrir app M365, traçar rota na omnibox, abrir
favorito). Isso registra histórico real e alimenta "mais acessados" sem tocar em
Rust. A **sub-navegação dentro da página** (clicar um link no Outlook/SharePoint)
só chega ao front com um hook nativo `on_navigation`/`NavigationCompleted`
emitindo `{tabId, url, título, at}` (spec §8.1) — mesmo ponto de extensão que,
no futuro, também acende favicons por aba. Fica registrado como a evolução
natural desta base, fora do escopo mínimo do #177.
