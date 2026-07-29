# Atoms — Galaxie Apps home / user dashboard — Design Spec

Issue #181 · GALAXIE Toolbox
Stack: Tauri 2 + React 19 + TypeScript + Tailwind v4 + shadcn/new-york + **reui** registry + **animate-ui** (motion). Microsoft Graph (delegated).
Status: research + design only (no code).

> Read alongside `docs/bridge-people-ux.md` (#143) and `docs/navigator-ux-spec.md` (#172) — same depth, same component-map discipline, same INVEST slicing, same "reuse-don't-invent" rule.

---

## 0. TL;DR — key decisions

1. **Atoms is the new front door, and Bridge gives back the greeting.** Atoms is the app's **initial screen** (`tela` default flips from `"control-room"` to `"atoms"` in `App.tsx:72`). It is the home Bridge *used* to be before Bridge narrowed to mail/agenda/people. Concretely: the `saudacao: "Olá, {nome}"` greeting that today lives in `control-room` strings (`strings.ts:284`) is the seed of Atoms' header — the dashboard is the greeting **plus** the "what needs me now" surface.
2. **The MVP is a presentation layer over Graph calls that already ship.** This is the single most important finding and it de-risks the whole issue: `cr_reunioes`, `cr_email`, `cr_agenda`, `cr_tarefas`, `cr_contadores` **already exist, already run under the 429 pool/retry, and already back Bridge.** Agenda (`/me/events`), unread+flagged mail (`/me/messages`), and Microsoft To Do (`/me/todo/lists`, wired in `graph.rs:889`) are **obtainable today, no new scopes, no new Rust.** Atoms Slice 1 is mostly wiring existing data into cards. Be loud about this: it's why the MVP is small.
3. **Widgets rank by a dumb, legible attention score — no AI in the MVP.** The "atoms bringing what matters" is a deterministic rule (urgency + recency + deadline + unread), §3. AI-driven prioritization is **#180 (Galaxie AI)** — referenced, *not* built here. The MVP must feel smart without a model, so the rule has to be readable enough that the user trusts why a thing surfaced.
4. **Bento grid of widget cards on the existing starfield.** Each widget = a reui **`frame`** card in a responsive bento/masonry grid over the app's existing `<Estrelas />` (already painted in `SidebarInset`, `App.tsx:401`). No new chrome — Atoms is a new *content view* like Apps or OneDrive, rendered in the same `ScrollArea` main.
5. **A widget is a doorway, not a destination.** Clicking a mail card → Bridge (`setTela("control-room")`); an event → Bridge agenda; a To Do toggles in place; an app tile → `abrirAppAqui`. Atoms **reuses the screens that already exist** via the callbacks already in `App.tsx` (`onNavegar`, `abrirAppAqui`, `abrirUrlLivre`). Atoms navigates the shell; it does not re-implement mail or calendar.
6. **The two seed components map cleanly and are the only new installs for the MVP+1.** animate-ui **`playful-todolist`** = the To-dos widget (Slice 2); **`notification-list`** = the unified "atenção agora" feed (Slice 3). Both are community components **not yet in the repo** (`src/components/animate-ui/components/community/` is empty) → install from the registry, do not hand-rebuild.
7. **Be honest about the two hard sources.** **Teams chats** need `Chat.Read` (delegated) — feasible but **not a granted scope today** and requires investigation (§2.4). **OneDrive sync problems are not Graph at all** — they're a *local client* signal readable from the Tauri/Rust side (sync-root state / `FileSyncClient`), a spike, not an API call (§2.5). Neither is MVP. Say so plainly rather than drawing a card we can't fill.

> **My opinion, on the record:** the highest-value atom for *this* user — a multi-tenant M365 consultant living in Outlook — is not a prettier calendar, it's the **"o que exige você agora" triage line**: the merge of *flagged/unread mail that's aging*, *the next meeting inside 30 min with a Join button*, and *an overdue To Do* into **one ranked list** (§3, the `notification-list`). That's the differentiator over just opening Outlook. It's specced as Slice 3 and it's the reason the attention model (§3) is designed in Slice 1 even though the feed ships later.

---

## 1. What Atoms is (and the sidebar move)

### 1.1 Sidebar entry — Galaxie Apps > Atoms, above Bridge
- New child in the **`galaxie`** group (`navegacao.ts:64-74`), inserted **first**, above `control-room` (Bridge):
  ```
  galaxie:  Atoms ●  →  Bridge  →  Navigator  →  Comms  →  Astro  →  Pulsar
  ```
- New `Tela` value `"atoms"` (`navegacao.ts:26`) + a `TELAS.atoms` entry (`titulo:"atoms", secao:"galaxie", icone: AtomIcon`).
- Icon: **lucide-animated `atom`**, wrapped exactly like the other Galaxie icons in `marca-anim.tsx` — a new `AtomIcon` following the `IconeAnim` pattern (ref-controlled, animates on row hover, `currentColor` for light/dark). Do **not** invent a bespoke icon; reuse the established wrapper (`marca-anim.tsx:25`).
- New dictionary keys `t.nav.atoms` (pt-BR/en) and an `t.atoms.*` block (greeting, empty/"tudo em dia" copy, widget titles), mirroring the existing `controlRoom` block.

### 1.2 Default screen
- `useState<Tela>("control-room")` → **`"atoms"`** (`App.tsx:72`). On login/restore the user lands on Atoms.
- **Keep Bridge keep-alive.** Bridge is mounted-always/hidden (`App.tsx:472`, the #25 keep-alive) precisely so returning to it is instant. Atoms clicking through to Bridge benefits from this for free — the mail client is already warm behind the dashboard.
- Atoms itself renders in the standard `ScrollArea` main (like `apps`/`onedrive`), **not** keep-alive-hidden — it's cheap and its data should refresh on each visit.

### 1.3 Relationship to the `em-breve` placeholders
Comms/Astro/Pulsar are `EmBreveScreen` placeholders (`App.tsx:537-557`). Atoms is the opposite: a real, shipping screen. Its **empty/"tudo em dia" state** (§6) should feel intentional and calm, *not* reuse the dashed "coming soon" placeholder card — that's for unbuilt products.

---

## 2. Widget taxonomy — the signals that matter at boot

Judged against one persona: an **M365 power-user / IT consultant in an enterprise desktop shell** who opens the app to answer *"what needs me before I start?"* Each row is priced by value-at-boot and by honesty of data source.

| Widget / atom | Signal it answers | Graph (delegated) source | Obtainable today? | Verdict |
| --- | --- | --- | --- | --- |
| **Agenda — próximo + hoje** | "Where do I need to be, and when's the next call?" | `cr_agenda(inicio,fim)` → `/me/events` window; `cr_reunioes` → next ≤6 / 7 days; `cr_evento_corpo` → Join URL | **Yes — wired** (`api.ts:330`, `graph.rs:785`). Calendars.Read granted. | **MVP — Slice 1** |
| **E-mail — não-lidos & sinalizados** | "What's piling up / flagged for me?" | `cr_email` → inbox unread + latest unread (`graph.rs:840`); `cr_contadores` → flagged/attachments count (`api.ts:1167`) | **Yes — wired.** Mail.Read granted. | **MVP — Slice 1** |
| **To-dos (Microsoft To Do)** | "My open tasks across lists." | `cr_tarefas` → `/me/todo/lists` + tasks `status ne 'completed'` (`graph.rs:889`) | **Yes — wired.** Tasks.ReadWrite granted (so **complete-in-place** is possible). | **MVP+1 — Slice 2** (seed: `playful-todolist`) |
| **Atenção agora (unified feed)** | "The one ranked list of what's urgent across sources." | Derived — merges the three above via the §3 score. No new source. | **Yes** (composition of wired sources). | **Slice 3** (seed: `notification-list`) |
| **Anotações (OneNote / notes)** | "Recent notebook / quick note." | `/me/onenote/pages?$orderby=lastModifiedDateTime` — **not wired**; OneNote scope needed | **Investigate.** Not granted, extra scope. | **Later** |
| **Teams chats (não lidos)** | "Unread DMs / mentions." | `/me/chats`, `/chats/{id}/messages` — **not wired**; **Chat.Read delegated required** | **No, needs scope + investigation** (§2.4). Delegated-only, no app-only path. | **Later — flagged** |
| **OneDrive sync problems** | "Is my local sync stuck/erroring?" | **Not Graph.** Local client state from the Tauri/Rust side (sync root / Cloud Files API). | **Client-side spike** (§2.5). | **Later — flagged** |
| **Apps rápidos / speed-dial** | "Jump straight into a tool." | Reuse `APPS` (`lib/apps.ts`) → `abrirAppAqui`. | **Yes** (static catalogue, already rendered in Apps screen). | **Optional — Slice 5** |
| **Arquivos recentes** | "What did I touch last?" | `/me/drive/recent` — **not wired** (OneDrive screen reads folders/quota, not recents) | Investigate; low urgency vs. mail/agenda. | **Later** |

### 2.4 Teams chats — the honest read
Delegated `Chat.Read`/`Chat.ReadBasic` can list chats and unread state, but: (a) it's **not in the 53 granted scopes** for this app, so it needs a consent round-trip; (b) unread-count per chat is awkward (`/me/chats?$expand=lastMessagePreview` + read-state heuristics), not a clean counter like mail. **Verdict: not MVP.** Spec a placeholder-shaped slot so the grid reserves room, but gate the whole widget behind a scope check + "Conectar o Teams" affordance (the same pattern Bridge uses for People access, `App.tsx:480`).

### 2.5 OneDrive sync problems — not an API, a local probe
This is the one Wagner named that is **categorically not Graph**. Sync health lives on the machine: the OneDrive client's status (icon overlay state, `%LOCALAPPDATA%\Microsoft\OneDrive\logs`, or the Windows Cloud Files / `StorageProviderSyncRootManager` state). The app is already a Tauri/Rust host that reads local FS and Windows state (see `caminhos-longos` long-paths, `graph.rs` neighbours), so a **Rust command `atoms_onedrive_sync()`** returning `{ estado: "ok"|"pausado"|"erro", pendentes, ultimoErro }` is the right shape — a **spike**, not a Graph call. Until it lands, don't fake it with a green check.

---

## 3. The attention model — how atoms decide what rises

No AI (that's #180). A deterministic, **legible** score per item so the user can trust ordering. Each signal is normalized to an `AtomItem`:

```ts
interface AtomItem {
  id: string;
  origem: "agenda" | "email" | "todo";  // + "teams" | "onedrive" later
  titulo: string;
  quando?: number;         // epoch: event start, mail received, task due
  score: number;           // computed, see below
  acao: () => void;        // click-through (see §5)
}
```

**Score = the max of a few plain rules, highest wins the top of the feed:**

| Rule | Fires on | Weight intuition |
| --- | --- | --- |
| **Iminência** | event starting within 30 min | Highest — a call in 10 min beats everything. Ramps as start approaches. |
| **Prazo estourado** | To Do past due, or dueToday | High — overdue tasks are load-bearing. |
| **Sinalizado** | flagged mail (`cr_contadores.flagged`) | Medium-high — the user flagged it *on purpose*. |
| **Não-lido recente** | unread mail in last N hours | Medium, decays with age (a 3-day-old unread isn't "now"). |
| **Hoje** | any event later today, any task due today | Low baseline — present but not shouting. |

Rules, not weights-you-tune-forever: keep it to ~5 clauses, each expressible in one sentence of UI copy ("Começa em 10 min", "Venceu ontem", "Você sinalizou"). The **reason string is shown on the item** (§4 `notification-list`), so ordering is self-explaining. Ties break by `quando` ascending (soonest first). Recompute on a light interval (e.g. 60 s) + on window focus — cheap, since it's arithmetic over already-fetched data, no extra Graph calls.

> Design the `AtomItem` + score in **Slice 1** (even though the merged feed ships in Slice 3) so the individual widgets and the later feed share one ranking brain — same discipline as #143 designing `resolvePerson` before the hover-card needed it.

---

## 4. Layout

### 4.1 The canvas
- Atoms renders inside the existing main `ScrollArea` (`App.tsx:518`) over `<Estrelas />` — the starfield is already there behind every screen; Atoms just doesn't cover it edge-to-edge. Widget cards use the app's translucent surface tokens (`bg-card/…`, `bg-popover`, `border-border`) so stars read *through* the gaps, the way `Launcher` already layers on the starfield (`navegador.tsx`).
- **Header band:** the greeting (`Olá, {nome}` — reuse the `controlRoom.saudacao` string, moved/copied to `t.atoms`), a subtle date/"tudo em dia" line, and a light density/refresh affordance. This is the emotional anchor — keep it airy.

### 4.2 The bento grid
- Responsive **bento**: CSS grid, `auto-fit minmax(~320px, 1fr)`, cards spanning 1–2 columns by importance. Agenda + the attention feed are the tall/wide anchors; email counts, to-dos, sync are smaller tiles. On narrow widths (sidebar expanded, small window) it collapses to a **single column, ranked top-to-bottom by the §3 score** — on a phone-narrow shell you scroll the most-urgent first, which is exactly right.
- **Density:** dashboard is *airier* than Bridge's dense lists — generous `frame` padding, calm. The density contrast between Atoms (breathe) and Bridge (dense grid) is the craft, same principle as #143 §8.
- **Where the seeds sit:**
  - **`playful-todolist`** → the To-dos card body (Slice 2). Its check-off animation is the one *playful* moment; earns its place because completing a task is the one satisfying action on a dashboard.
  - **`notification-list`** → the "Atenção agora" anchor card (Slice 3) — the ranked `AtomItem[]` feed, each row with title + reason string + timestamp, click-through per §5.

### 4.3 Motion
- Card entrance: a gentle staggered blur-in reusing the app's existing `SoftBlurIn` (`App.tsx:20`, already used on the restore screen) — atoms "assembling" as data lands, on-brand with the name. All gated by `prefers-reduced-motion`.
- Per-widget loading resolves independently (skeleton → content) so the grid doesn't wait on the slowest Graph call — each card owns its own async, mirroring how `carregarDetalhes` streams site numbers in one-by-one (`App.tsx:203`).

---

## 5. Navigation — every widget is a doorway

Atoms holds **no** mail/calendar logic; it calls the shell callbacks that already exist:

| Widget interaction | Action | Reuses |
| --- | --- | --- |
| Click a mail row / "7 não-lidos" | `onNavegar("control-room")` → Bridge, ideally focused on Inbox | `setTela` (`App.tsx:398`), Bridge keep-alive |
| Click an event / "Entrar" | `onNavegar("control-room")` → Bridge agenda; Join URL → `abrirUrl(joinUrl)` opens Teams | `cr_evento_corpo.joinUrl`, `abrirUrl` (`App.tsx:300`) |
| Toggle a To Do | complete in place via a new `cr_tarefa_concluir` (Tasks.ReadWrite already granted) — optimistic, rollback on error | `playful-todolist` state |
| Click an app tile | `abrirAppAqui(app)` → opens as Navigator tab | existing `App.tsx:269` |
| Click a Teams/OneDrive item (later) | Teams → `abrirAppAqui(teams)`; OneDrive → reveal in Explorer | `abrirAppAqui`, `revelarNoExplorer` (`api.ts:1382`) |

Add a small `onNavegar` extension so Bridge can accept a *sub-target* (Inbox vs Agenda) — Bridge already has internal view state; Atoms just needs to ask it to open on the right pane. If that plumbing is more than trivial, MVP fallback is "open Bridge" (no sub-focus) and refine later — do not block Slice 1 on deep-linking into Bridge.

---

## 6. States (per widget, independent)

| State | Treatment | Component |
| --- | --- | --- |
| **Loading** | per-card skeleton (header + rows); grid never blocks on the slowest call | shadcn `skeleton` |
| **Empty — "tudo em dia"** | the *good* empty: a calm illustration + "Sem nada urgente agora" per card, and a whole-dashboard "Tudo em dia ✨" when every source is clear. This is a **feature, not a void** — the reward for an M365 user is seeing zero fires. | `icon-stack` (already in repo, `components/reui/icon-stack.tsx`) |
| **Empty — source truly empty** | "Nenhuma tarefa", "Agenda livre hoje" — distinct copy from "tudo em dia" | `icon-stack` + card `emptyMessage` |
| **Error (one Graph call failed)** | inline, per-card: "Não foi possível carregar a agenda" + Retry; **other cards stay up** (isolate failures) | `alert` (`components/reui/alert.tsx`) + `button` |
| **No permission (per source)** | the source's card shows which scope is missing + "Conectar" that routes to the existing consent flow (`onGrantPeopleAccess` pattern, `App.tsx:480`) — never silent consent | `alert` + `icon-tile` |
| **Teams / OneDrive (pre-build)** | reserved slot with a "Em breve / Conectar" affordance, gated by scope/spike | `icon-tile` |
| **Offline** | cards show last-known data with a muted "desatualizado" note | `alert` |

Permission handling is explicit and per-source: Mail/Calendar/Tasks scopes are already granted, but each card still degrades gracefully if its token lacks the scope — same discipline as #143 §5.

---

## 7. Accessibility + theming

- **Keyboard:** the grid is a landmark region; each widget is a labelled card; every row/item is a real focusable control (button/link), tab order follows the §3 rank (most-urgent first). The attention feed announces new/urgent items politely (`aria-live="polite"`), never assertively.
- **Not colour alone:** urgency is conveyed by the **reason string + icon + position**, not just a red dot — an overdue task reads "Venceu ontem", not merely a colour. Badge/urgency colours from Tailwind v4 tokens with verified light/dark contrast (same rule as #172 §10).
- **Theme + starfield:** every surface via tokens (`bg-card`, `bg-popover`, `border-border`, `text-muted-foreground`); cards must stay legible over the moving starfield in **both** themes — verify contrast of muted text against the `radial-gradient` backdrop. Respect `prefers-reduced-motion` for both the starfield parallax (already a concern in `stars.tsx`) and the card blur-in.
- **Greeting** is decorative-plus-informative: the `{nome}` is real content, not `aria-hidden`.

---

## 8. Component map (UX element → component → notes)

| UX element | Component (exact) | Registry / install | In repo today? | Notes |
| --- | --- | --- | --- | --- |
| Sidebar "Atoms" entry | app nav item + **`AtomIcon`** (lucide-animated `atom`) | lucide-react `atom` via `IconeAnim` wrapper | wrapper ✅ (`marca-anim.tsx`), icon new | First child of `galaxie`, above Bridge |
| Widget card container | **`frame`** (`Frame`/`FrameHeader`/`FrameTitle`) | `@reui/frame` | ✅ (`components/reui/frame.tsx`, used by Bridge) | One reui surface for every widget — don't mix Card/Frame |
| To-dos widget | **`playful-todolist`** | `@animate-ui/components-community-playful-todolist` | ❌ install | Slice 2; complete-in-place (Tasks.ReadWrite) |
| Atenção-agora feed | **`notification-list`** | `@animate-ui/components-community-notification-list` | ❌ install | Slice 3; renders ranked `AtomItem[]` |
| Urgency / count chips | **`badge`** | `@reui/badge` | ✅ | "7 não-lidos", "Começa em 10 min" — text+icon |
| Empty / "tudo em dia" / no-perm visuals | **`icon-stack`**, **`icon-tile`** | `@reui/icon-stack`, `@reui/icon-tile` | ✅ | Both already in repo |
| Per-card errors / permission / connect | **`alert`** | `@reui/alert` | ✅ | Inline, non-modal; isolate per source |
| Loading | **`skeleton`** | shadcn | ✅ | Per-card, independent async |
| Greeting blur-in / card entrance | **`SoftBlurIn`** | in-repo (`components/smoothui`) | ✅ | Reuse the restore-screen effect |
| Starfield backdrop | **`Estrelas`** / animate-ui `stars` | in-repo | ✅ | Already painted in `SidebarInset` |
| App speed-dial tiles (optional) | reuse **`AppsScreen`** cell + `urlIcone` | in-repo (`lib/apps.ts`) | ✅ | Slice 5; `abrirAppAqui` |
| Agenda / mail / task data | `cr_agenda`, `cr_email`, `cr_reunioes`, `cr_tarefas`, `cr_contadores` | in-repo (`lib/api.ts`) | ✅ | **No new Graph work for MVP** |

Only **two new registry installs** for the MVP+attention-feed arc (`playful-todolist`, `notification-list`). Everything else is already in the app. Contrast with #143 (leaned on Pro blocks) and #172 (free reui + shadcn) — Atoms is the leanest of the three because its data layer already exists.

---

## 9. Incremental slicing (feeds PO sub-issues of #181 — ~3-issue cadence)

Each slice is independently shippable and demoable. Ordered *destination first, then depth, then the hard sources last*.

**Slice 1 — Atoms shell + the two highest-value read-only widgets.**
New `atoms` screen, sidebar item above Bridge, default `tela = "atoms"`, greeting header on the starfield, bento grid scaffold. Two widgets wired to **existing** Graph calls: **Agenda (próximo evento + hoje)** and **E-mail (não-lidos + sinalizados)**. Click-through to Bridge. Design the `AtomItem` + §3 score now. Loading/empty/"tudo em dia"/error/no-permission states per card. *Demo: launch the app, land on a live dashboard with your next meeting and unread count — zero new backend.* **This is the destination; it's small precisely because the data already ships.**

**Slice 2 — To-dos widget (the playful seed).**
Install `playful-todolist`; render `cr_tarefas` (`/me/todo/lists`); **complete-in-place** via a new `cr_tarefa_concluir` (Tasks.ReadWrite already granted), optimistic with rollback. Due-today/overdue feed the §3 score. *Ships the one satisfying interaction on the dashboard.*

**Slice 3 — "Atenção agora" unified feed (the differentiator).**
Install `notification-list`; merge Agenda + Mail + To Do `AtomItem[]` through the §3 attention score into one ranked stream with per-item reason strings and click-through. `aria-live` polite updates; 60 s + focus recompute. *Ships the "what needs me now" line that beats just opening Outlook.*

**Slice 4 — The hard sources: OneDrive sync health + Teams chats.**
Rust `atoms_onedrive_sync()` local probe → sync-health card (ok/paused/error/pending). Teams: `Chat.Read` consent round-trip behind a "Conectar o Teams" gate → unread-chats card. Both were flagged non-MVP for honest reasons (§2.4/§2.5); this slice does the investigation + spikes. *Ships the two signals that need real new plumbing.*

**Slice 5 — Personalization + polish.**
Add/remove/reorder widgets (persisted bento layout, mirror the `estado.rs` JSON pattern), density toggle, app speed-dial tile, optional Notes/Recent-files widgets pending scope investigation. *Turns the fixed dashboard into the user's dashboard.*

**Order rationale:** the destination and its cheapest, already-obtainable widgets first (Slice 1 is almost free); the playful task interaction second (one new install, write path); the unified attention feed third because it's the differentiator but depends on the widgets + score existing; the genuinely new plumbing (local sync probe, Teams consent) fourth so it never blocks the shipping dashboard; personalization last. AI-driven prioritization stays out entirely — that's #180. Same shape as #143/#172: read before write, destination before inline depth, honest deferral of what needs scope or spikes.
