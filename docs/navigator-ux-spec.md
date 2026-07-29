# Navigator (Cruiser) — New Features — Design Spec

Issue #172 · GALAXIE Toolbox / Navigator (internal name **Cruiser**)
Stack: Tauri 2 (multi-webview, feature `unstable`) + React 19 + TypeScript + Tailwind v4 + shadcn/new-york + **reui** registry (`radix-nova`)
Status: research + design only (no code). The "revolution" the PO asked for.

> Read alongside `docs/bridge-people-ux.md` (#143) — same depth, same component-map discipline, same INVEST slicing.

---

## 0. TL;DR — key decisions

1. **The revolution is two things, not ten: a Command Palette spine + Sleeping Tabs.** Everything the PO listed (history, most-visited, bookmarks, actions) hangs off the palette; the RAM problem is solved by tab lifecycle. Chase those two and the rest falls into place. The generic "add browser features" reading is the trap.
2. **Sleeping tabs is the headline and the hardest part — and it's an *architecture* decision, not a UI one.** Today every tab is a live WebView2 that `browser_esconder_todas` merely `.hide()`s — **hidden ≠ freed**. The RAM never comes back. The fix: after idle/threshold, **destroy** the inactive webview (`wv.close()`) but keep its tab chip + a snapshot `{url, title, favicon, scroll}`, and recreate it on click via the existing `browser_abrir`. WebView2 under Tauri has **no cheap freeze** — destroy-and-recreate is the honest lever. This is §3, the technical core.
3. **Command palette (`Ctrl/Cmd+K`) is built on what's already there.** The Launcher (`navegador.tsx`) already uses shadcn `command` (cmdk) with an omnibox (`browser.interpretar`) + M365 apps + "mais usados". Promote it from "shown only when no tab is active" to a **global overlay available over a live webview** — with one critical trick (§4): a native WebView2 paints *on top of* the DOM, so the palette must `browser.esconderTodas()` (or shrink the active webview) while open, then restore on close.
4. **"Histórico vira uma tab no command" / "mais acessados vira item no commander" — taken literally.** History and Top-sites become **groups inside the palette** (plus a full History view). Raycast/Arc-style mode prefixes (`>` actions, `@` open tabs, `#` history) make one box do everything.
5. **Tab reorder + groups reuse the *custom* tab strip, not a registry block.** The strip in `navegador.tsx` is bespoke by necessity (it reserves the top band the webviews position under). Drag-reorder = reui **`sortable`** (dnd-kit, confirmed in registry); groups = colored, named, collapsible clusters. Reorder is *pure chip order* — the webviews all share one content rect, so reordering costs nothing at the webview layer.
6. **Bookmarks import = read the other browser's `Bookmarks` JSON file. No automation, no scraping, no passwords.** Chrome/Edge store bookmarks as a plain JSON tree in the user profile; a Rust `std::fs` read + a preview `tree` (reui **`tree`**, confirmed) is the whole feature.
7. **Passwords: we do NOT build a password manager.** WebView2 (the Edge engine) already has one, backed by **Windows Credential Manager / DPAPI**. The secure design is to *expose Edge's own autosave* and deep-link to the Windows vault — the app **never sees plaintext, never autofills via injected JS**. Most of this feature is explicitly **out of scope by design** (§7).
8. **Reuse, don't invent.** Every surface maps to a real reui or shadcn component (§11). MVP is 100% free-tier: reui `sortable`/`tree`/`data-grid`/`badge`/`frame` are free; the palette, menus, dialogs, switches are standard shadcn (several already installed).

> **My opinion, on the record:** the single most differentiating move for *this* user — who lives in Outlook/Teams/SharePoint inside an enterprise desktop shell — is **M365-aware Workspaces**: tab groups that are pre-seeded and colour-coded by M365 context (a "Client X" workspace = its SharePoint + a Teams channel + a shared mailbox tab, restored together). It's tab groups (§5) + bookmarks (§6) + sessions, aimed at the actual job. Specced as the natural evolution of Slice 3; flagged, not gold-plated.

---

## 1. Architecture reality (the constraint that shapes every decision)

The Navigator is **not** a webview-of-webviews or an iframe host. Anchoring symbols (all real, today):

| Layer | File / symbol | What it does |
| --- | --- | --- |
| Rust webview mgr | `src-tauri/src/browser.rs` — `browser_abrir`, `browser_trocar`, `browser_layout`, `browser_fechar`, `browser_esconder_todas`, `esconder_menos`, `rotulo` | Each tab is a **native child webview** (`win.add_child`, feature `unstable`) positioned by **logical-pixel coordinate**. `esconder_menos` only calls `wv.hide()` — the webview stays alive in RAM. |
| Rust ↔ session | `src-tauri/src/lib.rs` — `sincronizar_navegador`, `abrir_app_interno`; `src-tauri/src/estado.rs` — `ler/salvar_conta_navegador` | All tabs share **one WebView2 cookie jar**; on account switch the jar is wiped (`clear_all_browsing_data`). This is why web logins persist between tabs. |
| TS bridge | `src/lib/browser.ts` — `abrir/trocar/layout/fechar/esconderTodas`, `interpretar`, `Retangulo` | Sends the DOM-measured rect to Rust. `interpretar` is the omnibox brain (URL vs Bing search). |
| React shell | `src/screens/navegador.tsx` — `NavegadorScreen`, `Launcher`, `medir()`, the `ResizeObserver` | Draws the tab strip (custom), measures the content area with `getBoundingClientRect`, and re-sends the rect on every resize / sidebar toggle / tab switch. |
| App state | `src/App.tsx` — `abas: AbaBrowser[]`, `abaAtiva`, `abrirAppAqui`, `abrirUrlLivre`, `fecharAba` | Tab list + active id live here. `AbaBrowser = { id, nome, url }`. |

**Three consequences that every feature below must respect:**

- **Z-order:** native webviews render *above* the React DOM. Any DOM surface that must appear over page content (command palette, error card, crash overlay, "unsaved changes" dialog) requires the active webview to be **hidden or shrunk first**. This is repeated throughout — it is *the* recurring gotcha.
- **Layout is manual:** any change to the tab-strip height (pins row, group headers collapsing, a favourites bar) changes the content rect. The existing `ResizeObserver` on the content area already refires `browser.layout` — so as long as strip changes flow through normal layout, repositioning is free. Design *within* that mechanism.
- **RAM is per-tab and never reclaimed today.** `AbaBrowser` grows unbounded; each entry is a full Edge/Chromium instance. This is the PO's exact complaint. §3 is the answer.

---

## 2. Research — modern-browser features, filtered to *this* user

Not a catalogue. Each row is judged against one persona: an **M365 power-user in an enterprise desktop shell** (multi-tenant, keyboard-heavy, memory-conscious, mostly opening Outlook/Teams/SharePoint + a handful of web tools).

| Feature | Who nails it | Why it matters *here* | Verdict |
| --- | --- | --- | --- |
| **Sleeping / discarded tabs** | Edge ("sleeping tabs"), Chrome (Memory Saver) | Directly the PO's pain. This shell is meant to be *lighter* than Edge, not another RAM hog. | **MVP — Slice 1** |
| **Command palette** | Arc (Cmd-bar), Vivaldi (Quick Commands), Raycast | Keyboard user; the Launcher is already 80% of it. Unifies every other feature into one box. | **MVP — Slice 2** |
| **Tab groups** | Chrome, Edge | Client/project separation; foundation for M365 Workspaces. | **Slice 3** |
| **Tab reorder (drag)** | All | Table stakes; cheap here (chip-only). | **Slice 3** |
| **Pinned tabs** | All | Outlook/Teams stay put and **never sleep** — protects live Teams calls. | **Slice 1/3** |
| **Import bookmarks (Chrome/Edge)** | All | User is migrating *from* those browsers; one-time land-grab of their links. | **Slice 4** |
| **Bookmarks / favourites bar** | All | Fast re-open of the same 6 tools. | **Slice 4** |
| **History (searchable)** | All | "That SharePoint doc from Tuesday." Surfaces in the palette. | **Slice 5** |
| **Most-visited / speed-dial** | Edge, Vivaldi | Real "mais acessados" (today `MAIS_USADOS` is a hardcoded M365 list, not usage). | **Slice 5** |
| **Save passwords** | All | Wanted — but the secure answer is *delegate to Edge/DPAPI*, not build it. | **Slice 5, mostly out of scope (§7)** |
| **Private / incognito tab** | All | Privacy hygiene + a clean-session tab for a second account. | **Slice 5** |
| **M365-aware Workspaces / sessions** | Arc (Spaces) | **The differentiator.** Restore "Client X" = its SharePoint + Teams + mailbox together. | **Post-Slice 3, flagged** |
| Vertical tabs | Edge, Arc | Tempting (app is already sidebar-shaped) but doubles the webview-positioning math. | **Later / optional** |
| Split view | Edge, Vivaldi | Two live webviews side-by-side = 2× RAM + 2× rect math. Against the memory goal. | **Skip for now** |
| Reader mode | Edge, Safari | Rare for M365 SaaS surfaces. | **Skip** |
| Web-store extensions | Chrome/Edge | Enormous scope, security surface. | **Skip** |

---

## 3. Memory / tab lifecycle strategy — *the* technically important part

### 3.1 The four states of a tab

| State | Webview | Tab chip | RAM | When |
| --- | --- | --- | --- | --- |
| **Active** | alive, visible, positioned | highlighted | full | the one tab in focus |
| **Background** | **alive, hidden** (today's only non-active state) | normal | **full — the leak** | any non-active tab, currently |
| **Asleep (discarded)** | **destroyed** (`wv.close()`) | dimmed + moon/Zzz icon | ~0 | idle past timeout, or evicted by the live-tab cap |
| **Pinned** | alive, hidden when not active | pin icon, compact | full (by choice) | user-pinned; **never auto-sleeps** |

The whole win is moving tabs from **Background → Asleep**. There is no separate "frozen" state: WebView2 through Tauri gives us no cheap JS-suspend / process-freeze primitive, so **"sleep" literally means destroy the webview and recreate it later**. Be honest about this trade-off rather than pretend we can freeze in place.

### 3.2 Eviction policy (all heuristic, no per-webview byte accounting)

We deliberately do **not** try to read per-webview memory (WebView2's shared/split process model makes it unreliable and platform-specific). Instead, cheap, legible heuristics:

- **Idle timeout:** a Background tab untouched for `idleMinutes` (default **30**) → sleep.
- **Live-tab cap:** keep at most `maxLive` webviews alive (default **5**, incl. active + pinned). Opening past the cap sleeps the **least-recently-used** non-pinned Background tab.
- **Never-sleep set:** the **active** tab, all **pinned** tabs, and any tab the user flagged "keep awake" (e.g. a Teams call, a long web form).
- **Manual:** right-click → *Colocar para dormir* / *Suspender as outras* (sleep-all-but-this).

All three thresholds live in Settings (§7 pattern), plus a master **"Economia de memória"** on/off.

### 3.3 Restore-on-reactivate

Clicking a sleeping chip → `browser_abrir(id, snapshot.url, rect)` (recreates the webview) → the existing `Loader2` overlay covers the reload. Snapshot kept per tab:

```ts
interface AbaBrowser {           // extends today's { id, nome, url }
  id: string; nome: string; url: string;
  favicon?: string;              // for chip + speed-dial (needs nav events, §8)
  estado: "ativa" | "fundo" | "dormindo" | "fixada";
  ultimoAcesso: number;          // LRU + idle timer
  scrollY?: number;              // best-effort restore (§3.4)
  fixada?: boolean;
  grupo?: string;                // §5
}
```

### 3.4 The honest cost, and how we soften it

Destroying a webview **reloads the page on wake** → any *in-page unsaved state* (a half-typed reply in webmail, an un-submitted form) is lost. Mitigations, in order of value:

1. **Never sleep the active tab** (you're looking at it) and **never sleep pinned tabs** (where the user parked live work).
2. **Grace window:** don't auto-sleep a tab younger than `minAgeMinutes` (default 5) or one the user typed into recently (heuristic: last-focus recency).
3. **"Keep awake" affordance** on any tab (right-click / hover pin) for the "I'm mid-form" case.
4. Ship a **spike** to have the sleeping webview `postMessage` its `scrollY`/simple field state before close (a Rust `browser_snapshot(id)` that runs a tiny script); if it proves flaky across M365 origins, drop it — scroll restore is a nice-to-have, not a blocker.

### 3.5 Backend surface this needs (naming consistent with `browser.rs`)

- **Reuse** `browser_fechar` for the destroy, but the front must **keep the chip** (today `fecharAba` removes it). So: a thin new command **`browser_suspender(id)`** = same as `fechar` semantically but named for intent, *or* just call `fechar` and let App state mark the chip `dormindo`. MVP: no new Rust needed — sleep = `browser.fechar` + set `estado:"dormindo"`; wake = `browser.abrir`. Clean.
- Optional later: **`browser_snapshot(id)`** (scroll/field capture, §3.4) and a nav-event stream (§8, needed for favicon/history anyway).

### 3.6 Visuals

- Sleeping chip: `opacity-60`, a `Moon`/`Zzz` lucide glyph replacing the favicon, tooltip **"Dormindo — clique para reativar"** (reuse the existing `Tooltip`). **Text, not colour-only** (a11y).
- A small `badge` on the strip: *"3 dormindo"* / a leaf/memory glyph, so the saving is *visible* — the feature only feels good if the user sees it working.
- Waking uses the existing centered `Loader2` spinner already in `NavegadorScreen`.

---

## 4. Command palette — the "command / commander" backbone

### 4.1 What it is

Promote today's `Launcher` `Command` from "only when no tab is active" to a **global overlay** (`Ctrl/Cmd+K`) that opens **over a live webview**, plus its current role as the empty-tab landing. One box, many sources.

### 4.2 The z-order trick (mandatory, concrete)

A native WebView2 draws above the DOM, so a naive `Dialog` palette would open *behind* the page. On palette open:

1. call `browser.esconderTodas()` (hide the active webview) **or** shrink its rect to a sliver;
2. render the palette `Dialog` over the now-visible React background (the app already has the starfield `Estrelas` + `bg-popover` card styling from `Launcher`);
3. on select/escape, restore the active webview via `browser.abrir/trocar` with the measured rect.

This mirrors what `NavegadorScreen` already does when `ativa === null`. It must be spelled out for the implementer — it is the one non-obvious thing.

### 4.3 Sources (palette groups) + mode prefixes

| Group | Content | Prefix |
| --- | --- | --- |
| **Ações** | Nova aba, Fechar aba, Reabrir fechada, Dormir todas, Importar favoritos, Limpar histórico, Nova aba privada | `>` |
| **Abas abertas** | switch to any open/sleeping tab (fuzzy by title/url) | `@` |
| **Aplicativos** | the M365 catalogue (`APPS`, reused as-is) | — |
| **Favoritos** | bookmarks (§6) | `*` |
| **Histórico** | recent visits (§8) — *"histórico vira uma tab no command"* | `#` |
| **Mais acessados** | top sites (§8) — *"item no commander"* | — |
| **Ir para / Pesquisar** | the omnibox: `browser.interpretar(q)` → URL or Bing | (default) |

Built on the **installed** shadcn `command` (cmdk) + `dialog` for the overlay + `kbd` hints for shortcuts. The existing `filter` and `CommandGroup`/`CommandItem` structure in `Launcher` is the seed — the palette is a superset, so **factor the Launcher into a shared `<Paleta>`** used in both places (empty-tab and overlay), not a fork.

### 4.4 Why this is the spine

History, most-visited, bookmarks, apps, open tabs, and actions all become *rows in one list*. The PO's scattered wishes ("history could be a tab in command", "most-visited an item in commander") are literally this design. Ship the spine early (Slice 2) with Actions + Open tabs + Apps + Omnibox; later slices *plug into it* rather than building new surfaces.

---

## 5. Tab management — reorder, groups, pin

### 5.1 Reorder (drag)

- Component: reui **`sortable`** (`@dnd-kit/core` + `sortable` + `utilities`, confirmed in registry). Applied to the **existing custom strip** in `navegador.tsx`.
- On drop → reorder the `abas` array in `App.tsx`. **No webview work**: all tabs share one content rect, so reordering is chip-order only — zero cost at the native layer, and no rect recompute.
- a11y: dnd-kit's keyboard sensor gives arrow-key move + screen-reader announcements for free — use it (the strip becomes a proper `tablist`).

### 5.2 Pin

- Pinned = compact (favicon only, no label/close), anchored left, **never auto-sleeps** (§3), and **persisted across sessions** (`abas` snapshot to disk, `estado.rs` JSON pattern — like `conectados.json`).
- Toggle via right-click (reui/shadcn `context-menu`) or hover pin button.

### 5.3 Groups (and the Workspaces evolution)

- A group = **name + colour**, rendered as a coloured left border / header on a run of chips, **collapsible** (`accordion`/`collapsible`). Collapsing changes strip height → the `ResizeObserver` refires `browser.layout` → webviews reposition automatically. **No new positioning code** — it rides the existing mechanism (call this out).
- Colours come from a **token palette** (Tailwind v4 vars) with verified light/dark contrast — never hardcoded hex.
- Persist groups with the tab snapshot.
- **Workspaces (flagged evolution):** a named group can be *saved and restored as a set* and pre-seeded from M365 context (a "Client X" workspace opening its SharePoint + Teams + shared mailbox). This is groups + bookmarks + session-restore pointed at the real job — the differentiator from §0. Design the group model now (name/colour/urls) so a workspace is just "a group you can save and reopen."

### 5.4 Strip overflow

Today the strip scrolls horizontally with the `+` outside the scroll. With pins + groups it gets busier: keep horizontal scroll for MVP; a **"Buscar abas"** entry in the palette (`@` prefix) is the real answer to "too many tabs" (better than a dropdown), and it's free once §4 ships.

---

## 6. Bookmarks / favourites

### 6.1 Import from Chrome / Edge — no automation, no passwords

Chromium browsers store bookmarks as a **plain JSON tree** in the user profile:

- Edge: `%LOCALAPPDATA%\Microsoft\Edge\User Data\<Profile>\Bookmarks`
- Chrome: `%LOCALAPPDATA%\Google\Chrome\User Data\<Profile>\Bookmarks`
- (`Default`, plus `Profile 1`, `Profile 2`, … — enumerate profiles; the file has no extension.)

New Rust command **`browser_importar_favoritos(navegador, perfil)`** = `std::fs::read` + parse the JSON (`roots.bookmark_bar`, `roots.other`, `roots.synced`, nested `children`). **Pure file read** — no browser automation, no scraping, and it touches **only** the bookmarks file, never `Login Data`/`Cookies`. State that boundary in the code and the consent copy.

**Never blind-import.** Show a **preview `tree`** (reui **`tree`**, `@headless-tree/core`, confirmed) with folders checkable; import only what's ticked. Present it as a normal action ("Importar favoritos…"), reached from the palette or Settings.

### 6.2 Store + manage

- Storage: local **`favoritos.json`** (mirror the `estado.rs` / `conectados.json` pattern — it's not a secret).
- Manage UI: reui **`tree`** for folders + reui **`sortable`** for reordering within/between folders + `context-menu` to rename/delete/open. Add-current-page from the omnibox / a star button.

### 6.3 Surfacing

- Primary: the palette **Favoritos** group (`*`).
- Optional **favourites bar**: a thin row under the tab strip. It **costs vertical space + a rect recompute** (rides the `ResizeObserver`), so **off by default**, toggle in Settings. A star/bookmarks button that opens a `tree` popover is the lighter default.

---

## 7. Passwords / credentials — secure design, and what's deliberately *out of scope*

### 7.1 Hard stance

- We do **not** build a credential store.
- We do **not** autofill via injected JS.
- We **never** store, display, or transmit plaintext passwords.
- The app's *own* auth (Graph OAuth refresh token) already lives in the **Windows Vault** via `auth.rs` (`restaurar` / `limpar_refresh`) — that is the app session, a separate thing from arbitrary website logins.

### 7.2 What "salvar senhas" actually means here

Each tab is **WebView2 = the Edge engine**, which **already has a password manager** backed by **Windows Credential Manager / DPAPI** (encrypted at rest, tied to the Windows user account). The secure, honest feature is to **let Edge's own autosave do its job** and get out of the way:

- A Settings toggle **"Salvar senhas de sites (via Windows/Edge)"** that flips WebView2's `IsPasswordAutosaveEnabled` / `IsGeneralAutofillEnabled` (needs a WebView2 settings hook — `webview2-com` crate — so it's a **technical spike**, see 7.4).
- A **"Gerenciar senhas salvas"** link that deep-links to Windows Credential Manager / Edge settings — management happens in the OS, not in our UI.
- Copy that states plainly: *stored by Windows, encrypted with DPAPI, tied to your Windows sign-in; GALAXIE Toolbox never sees them.*

### 7.3 Explicitly out of scope (by design, for security)

Cross-device sync · a master password · viewing/exporting passwords in-app · importing saved passwords from other browsers · any DOM autofill scripting. If the WebView2 hook proves infeasible in MVP, the **honest fallback** is what already happens: **the shared WebView2 session remembers each site's own login** (§1 cookie jar) — so we simply document that and **defer explicit password-save** rather than ship anything insecure.

### 7.4 Technical note

Confirm whether Tauri exposes WebView2 environment/settings toggles (`ICoreWebView2Settings::put_IsPasswordAutosaveEnabled`) before promising the toggle. Treat as a spike inside Slice 5; if it doesn't land, the fallback in 7.3 stands and the toggle is dropped.

---

## 8. History + most-visited

### 8.1 Prerequisite: navigation events (be explicit)

Today the front gets **no navigation callbacks** — webviews are native and self-navigate. History, favicons, and real most-visited all **depend on capturing navigation**. Required plumbing: hook the webview's navigation/page-load (Tauri webview `on_navigation` / a WebView2 `NavigationCompleted` handler) → emit `{tabId, url, title, favicon, at}` to the front. This is a **shared dependency** of favicon chips (§3.6) and history — call it out as the enabling work.

### 8.2 Capture + store

- Record `{url, title, favicon, visitedAt}` per navigation (skip **private tabs**, §8.5).
- Store in **`tauri-plugin-sql`** (SQLite) for real search/aggregation, or `historico.json` if we want to avoid a new plugin for MVP — SQLite is the right call once volume grows.

### 8.3 Most-visited (real "mais acessados")

- Derive from history: count by origin over a window, rank. This is the **real** thing the PO wants — distinct from today's hardcoded `MAIS_USADOS` (which is a curated M365 launcher list and should stay as the **Aplicativos** group). Add a genuine **Mais acessados** group sourced from usage.

### 8.4 Surfaces

- Palette: **Histórico** group (`#`) + **Mais acessados** group (§4).
- Full **History view**: reui **`tree`** grouped by day (Hoje / Ontem / …) or **`data-grid`** with search + date facet (reuse the #143 data-grid pattern) — pick `tree` for the calendar-ish grouping, `data-grid` if power search wins.
- **Launcher speed-dial:** top-sites as tiles on the empty-tab, above the omnibox (favicons from §8.1).

### 8.5 Privacy

- **Nova aba privada:** a webview on a **separate ephemeral data partition** (its own WebView2 user-data folder, discarded on close) — not recorded, cookies not shared. A distinct chip treatment (incognito glyph).
- **Limpar histórico** with a time-range `dialog` (última hora / hoje / tudo).
- Respect the existing **account-switch wipe** (`sincronizar_navegador`) — clearing web sessions should also clear history for that account, to match the multi-tenant privacy model already in place.

---

## 9. States

DOM overlays (error, crash, unsaved-changes) hit the **same z-order rule as the palette (§4.2)**: hide/shrink the active webview before showing them.

| State | Treatment | Component |
| --- | --- | --- |
| **Tab loading** | centered spinner over the content rect (exists today) | `Loader2` (lucide) |
| **Page failed / offline** | overlay card "Não foi possível carregar" + **Recarregar** (re-`abrir` same url) + **Abrir no navegador padrão** (`open_url`) | `alert` + `button` |
| **Webview crashed** (WebView2 process gone) | "Esta aba parou de responder." + **Recarregar** / **Fechar** | `alert` (destructive) + `button` |
| **Sleeping tab** | dimmed chip + moon glyph + tooltip; wakes on click | `badge` / `Tooltip` + `Loader2` on wake |
| **No tabs (empty)** | the Launcher / palette landing (exists) + speed-dial | shared `<Paleta>` + `command` |
| **Import: browser not found** | "Não encontramos o Chrome/Edge neste computador." | `alert` + `icon-tile` |
| **Import in progress** | tree with per-folder progress | `tree` + `progress` |
| **Private tab** | incognito chip treatment; palette shows "Navegação privada" hint | `badge` |
| **Blocked popup / new-window** | toast "Abrimos em uma nova aba" (route `window.open` into a new tab, not a native popup) | `sonner`/toast |
| **Memory saver active** | strip badge "N dormindo" | `badge` |

---

## 10. Accessibility + theming

- **Keyboard (a browser must be keyboard-first):** `Ctrl+K` palette · `Ctrl+T` nova aba · `Ctrl+W` fechar · `Ctrl+Tab` / `Ctrl+Shift+Tab` ciclar · `Ctrl+1..9` ir para aba N · `Ctrl+Shift+T` reabrir fechada · `Alt+←/→` voltar/avançar (needs nav control, §8.1). Register globally at the shell so they work even while a webview has focus (a WebView2-focus caveat to verify — may need an accelerator handler).
- Tab strip = proper `role="tablist"` / `tab`; dnd-kit keyboard sensor for reorder; every chip focusable; close buttons already have `aria-label`.
- **Sleeping / private states conveyed by text + icon, never colour alone.** Group colours must clear contrast in **both** themes (token palette, verified) and pair with the group *name*.
- Palette = focus-trapped `dialog`; results announced; the omnibox row already labels its intent (`Ir para` / `Pesquisar`).
- Everything themed via Tailwind v4 tokens (`bg-popover`, `border-border`, `text-muted-foreground` — as `navegador.tsx` already does). Favicon fallback = the existing `Globe` glyph. Respect `prefers-reduced-motion` for the palette open + wake transitions.

---

## 11. Component map (UX element → component → notes)

| UX element | Component (exact) | Registry / install | Free? | Notes |
| --- | --- | --- | --- | --- |
| Command palette (spine) | **`command`** (cmdk) + **`dialog`** | shadcn — **`command` already installed** | ✅ | Promote `Launcher`; factor a shared `<Paleta>` |
| Keyboard hints in palette | **`kbd`** | reui `kbd` (or styled `<kbd>`) | ✅ | Small; styled element fine if reui `kbd` gated |
| Tab reorder (drag) | **`sortable`** | **`@reui/sortable`** (dnd-kit) — confirmed 200 | ✅ | On the existing custom strip; chip-order only |
| Tab right-click / pin / group menu | **`context-menu`** | shadcn | ✅ | Sleep, pin, group, close others |
| Tab group container | **`collapsible`** / **`accordion`** | shadcn | ✅ | Collapse rides the `ResizeObserver` |
| Sleeping / private / count chips | **`badge`** | **`@reui/badge`** — confirmed | ✅ | Text + icon, not colour-only |
| Bookmarks / history tree | **`tree`** | **`@reui/tree`** (headless-tree) — confirmed | ✅ | Import preview + manage + history-by-day |
| History (power search view) | **`data-grid`** | **`@reui/data-grid`** — confirmed (#143) | ✅ | Alt to tree; search + date facet |
| Settings panels / cards | **`frame`** | **`@reui/frame`** — confirmed (#143) | ✅ | Memory-saver + passwords + import settings |
| Memory-saver / password toggles | **`switch`**, thresholds **`slider`**/**`input`** | shadcn | ✅ | maxLive / idleMinutes / master toggle |
| Import / clear-history dialogs | **`dialog`** / **`alert-dialog`** | shadcn | ✅ | Clear-history is destructive → `alert-dialog` |
| Errors / crash / offline / permission | **`alert`** + **`icon-tile`** | `@reui/alert`, `@reui/icon-tile` | ✅ | Same as #143 empty/error visuals |
| Import progress | **`progress`** | shadcn | ✅ | Per-folder / overall |
| Popup-redirected / saved toasts | **`sonner`** (toast) | shadcn | ✅ | `window.open` → new tab notice |
| Tab loading / wake spinner | `Loader2` (lucide) | — | ✅ | Already in `NavegadorScreen` |
| Tooltips / buttons / separators | `tooltip`, `button`, `separator` | shadcn — installed | ✅ | Shell glue |
| Favicon fallback | `Globe` (lucide) | — | ✅ | Already used for web tabs |

No Pro-tier block is required for the MVP. (Contrast with #143, which leaned on Pro reference blocks.) `sortable`, `tree`, `data-grid`, `frame`, `badge` are the free reui pieces; the rest is standard shadcn, much of it already in the app.

---

## 12. Incremental slicing (feeds PO sub-issues of #172 — ~3-issue cadence)

Each slice is independently shippable and demoable. Ordered by *pain first, then leverage*.

**Slice 1 — Sleeping Tabs (the anti-RAM MVP).**
Tab lifecycle: idle-timeout + live-tab-cap eviction → destroy (`browser.fechar`) inactive non-pinned webviews, keep the chip as `dormindo` with a snapshot, wake on click via `browser.abrir`. **Pin** tabs (never sleep, persisted). Sleeping-chip visuals + "N dormindo" badge + Settings (maxLive / idleMinutes / master toggle). *Demo: open 10 tabs, watch RAM fall.* **This is the headline; it's foundational (state model) and it's the loudest complaint.**

**Slice 2 — Command Palette spine.**
`Ctrl+K` global overlay over a live webview (with the §4.2 hide/restore trick). Factor `Launcher` → shared `<Paleta>`. Groups at launch: **Ações**, **Abas abertas** (`@`), **Aplicativos** (reuse `APPS`), **Ir para / Pesquisar** (`browser.interpretar`). *Ships the spine that later slices plug into.*

**Slice 3 — Tab reorder + groups + pins polish.**
reui `sortable` drag-reorder; colour+name **groups** (collapsible, token colours); persist order/groups/pins across sessions. Seeds the **Workspaces** evolution (design the group model to be saveable/restorable). *Ships tab ergonomics.*

**Slice 4 — Bookmarks.**
Rust `browser_importar_favoritos` (read Chrome/Edge `Bookmarks` JSON, enumerate profiles) → checkable `tree` preview → `favoritos.json`. Manage via `tree` + `sortable` + `context-menu`; add-current-page. Surface in the palette **Favoritos** group (`*`); optional favourites bar (off by default). *Ships the migration land-grab.*

**Slice 5 — History, Most-visited & Privacy (+ password spike).**
Navigation-event plumbing (§8.1, also lights up favicons) → SQLite history → palette **Histórico** (`#`) + real **Mais acessados** groups + full History view + speed-dial. **Private tab** (ephemeral partition) + **Limpar histórico**. Fold in the **passwords spike** (§7): WebView2 autosave toggle + deep-link, or document the honest fallback and defer. *Ships the biggest new data layer + closes the PO's list securely.*

**Order rationale:** RAM pain is loudest *and* foundational, so first. The palette spine is cheap (Launcher already exists) and everything else surfaces through it, so second. Tab ergonomics need no new plumbing, so third. Bookmarks add file-IO + `tree`, so fourth. History needs nav-event plumbing and the largest store, so last — and it carries the password work, deliberately minimised for security. Passwords are never a slice of their own: the secure design is *mostly not building it.*
