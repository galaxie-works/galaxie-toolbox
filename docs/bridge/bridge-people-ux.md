# Bridge — "People" module — Design Spec

> 📌 **Design spec original. Estado atual: ENTREGUE e em produção** — o módulo People está no app (contatos M365, categorias, organizações). Este doc é a intenção de design; o comportamento real está no código e evoluiu além dele (ver também `people-nav-detail-ux.md` e `people-bulk-edit-research.md`).

Issue #143 · GALAXIE / Bridge email client
Stack: React 19 + TypeScript + Tailwind v4 + shadcn / **reui** registry · Microsoft Graph (delegated)
Status: research + design only (no code). Seed of a future CRM.

---

## 0. TL;DR — key decisions

1. **People is a full-content-area module, not a 4th mail pane.** When the user clicks *People* in the Bridge sidebar, the module takes over the entire content area to the right of the sidebar and **hides the mail list + reading pane**. The sidebar stays. Rationale below (§2).
2. **Master–detail inside the module.** Left: a contact list (reui `data-grid`, list-density preset). Right: a contact profile panel (reui `frame` + `avatar` + `badge`). On narrow widths it collapses to list → push-detail.
3. **Reuse, don't invent.** Every surface maps to a real reui component. The PO's four cited screens are **Pro-tier reui blocks** (`solution-crm-3`, `profile-1`, `solution-users-2`, `card-42`) — install from the registry with the license key, do not rebuild them by hand. Where a Pro block is overkill for the lean MVP, the free primitives below cover it 1:1.
4. **"Enrich" is an explicit, per-contact, opt-in action** that merges Graph `/me/people` + org directory (`/users/{id}`) signals into the sparse `/me/contacts` record. It never auto-writes without the user confirming.
5. **Hover-card (card-42 / `c-hover-card-3`) is a later story**, not MVP. It is specced here so the data shape is designed for it from day one.

> Registry note: `solution-crm-3`, `profile-1`, `solution-users-2`, `card-42` are **premium blocks** and require `REUI_LICENSE_KEY` (Pro or Ultimate) in `.env.local`. The 20 base components (`data-grid`, `frame`, `avatar`, `badge`, `hover-card`, `filters`, `autocomplete`, `phone-input`, `icon-stack`, `icon-tile`, `timeline`, …) and every `c-*` example are **free**, no license needed. The MVP is fully buildable on free primitives; the Pro blocks are an accelerant / reference for layout, not a hard dependency.

---

## 1. Research — reui reference mapping

The PO cited four preview URLs. Their live previews are client-rendered (not readable as static HTML), but the reui registry resolves what each one *is* and which primitives compose it. Summary of what each reference contributes and how it maps to People:

| PO reference (Pro block) | What it is | What we take from it | Install id |
| --- | --- | --- | --- |
| `solution-crm-3` | A CRM workspace screen: contact/lead table with filters, status badges, avatars, and a side detail. | The **overall People layout**: filter bar + dense list + detail. Reference for column choice and toolbar. | `@reui/solution-crm-3` |
| `profile-1` | A person profile page: header with photo/name/title, meta cards, tabbed sections. | The **contact detail/profile** structure: identity header + field cards + tabbed activity. | `@reui/profile-1` |
| `solution-users-2` | A users/team directory (card grid + table toggle) with avatar, role, email, row actions. | The optional **"Cards" view** of the contact list and the row-action pattern. | `@reui/solution-users-2` |
| `card-42` | A compact profile/hover card: avatar, name, title/company, email, quick actions. | The **future To/Cc/Bcc hover-card** (later story). | `@reui/card-42` |

Free primitives these blocks are built from (and what we actually install for MVP):

- **`data-grid`** — TanStack Table v8 grid: sorting, filtering, pagination, virtualization/infinite scroll, row pinning, loading skeletons, built-in empty state (`emptyMessage`), `onRowClick`, `dense` layout, sticky header. This is the contact list. Examples `c-data-grid-1..12`.
- **`frame`** — "Container with title and actions." The detail panel and each field card. 54 examples.
- **`avatar`** — Graph photo with initials fallback. Reuse Bridge's existing avatar-from-Graph pattern. Avatar-group examples `c-avatar-22/23/24` for stacked/hover.
- **`badge`** — status/relationship chips ("Org", "External", "Frequent", enrich state). 152 examples.
- **`hover-card`** + example **`c-hover-card-3`** ("Hover card with profile information", deps `avatar` + `hover-card`) — the free equivalent of `card-42` for the later To/Cc/Bcc story.
- **`filters`** — multi-facet filter bar (company, relationship, has-phone, source).
- **`autocomplete`** — the search box over contacts.
- **`phone-input`** — phone field in edit mode (country + validation).
- **`icon-stack` / `icon-tile`** — empty-state and no-permission illustrations ("empty-state visuals").
- **`timeline`** — the "recent interactions" strip in the detail (later slice).
- shadcn **`tabs`**, **`skeleton`**, **`spinner`**, **`dropdown-menu`**, **`button`**, **`tooltip`**, **`separator`** — shell glue (already in the app).

---

## 2. Layout & navigation

### 2.1 Sidebar entry
- New item **People** in the Bridge left sidebar, **directly above "Agenda"** (order: … Mail folders → **People** → Agenda → …).
- Icon: `Users` (lucide, matching the app's lucide-react set); active state uses the same treatment as Agenda's active item — do not invent a new highlight style.
- Selecting People sets the app's primary view to `people`. Selecting Mail or Agenda restores their views. State lives at the shell level (same place Agenda's toggle lives).

### 2.2 Does People replace the 3-pane mail view? — **Yes.**
Recommendation: **People takes over the whole content area and hides the mail list + reading pane** (the sidebar persists).

Why:
- **Contacts are a different information shape than mail.** A contact list wants wide columns (name, company, email, phone) + a rich profile; forcing it into the narrow mail-list column would cramp both. The PO explicitly allows full-area takeover "as long as it's done with craft" — this is the craftful choice.
- **Cognitive mode-switch is intentional.** People is a destination ("go manage my contacts"), like Agenda, not a peek. Agenda already sets the precedent of a full-area takeover from the same sidebar region — People should mirror Agenda's shell behavior exactly for cohesion.
- **Lean interface.** One list + one detail is calmer than list + detail wedged beside two mail panes.

Transition: cross-fade / slide the content area (respect the app's existing view-switch transition and `prefers-reduced-motion`). The sidebar never moves, so the app never feels like it "navigated away."

### 2.3 Master–detail structure (inside the module)
```
┌ Sidebar ─┬───────────────── People (content area) ─────────────────┐
│ Mail     │  Toolbar:  [Search ⌕ autocomplete]  [Filters ▾] [View ⊞/≣] [Enrich all…] │
│ People●  │ ┌── Contact list (master) ──┐ ┌──── Contact detail (detail) ────┐ │
│ Agenda   │ │ ▢ Avatar  Name            │ │  ┌ identity header ┐             │ │
│ …        │ │           Company · email │ │  Avatar  Name · Title           │ │
│          │ │ ▢ Avatar  Name            │ │          Company   [badges]     │ │
│          │ │ … (data-grid, dense)      │ │  ─────────────────────────────  │ │
│          │ │                           │ │  frame: Emails / Phones / Org   │ │
│          │ │                           │ │  frame: Recent interactions     │ │
│          │ └───────────────────────────┘ └─────────────────────────────────┘ │
└──────────┴──────────────────────────────────────────────────────────────────┘
```
- Split ratio ~ 38% list / 62% detail on desktop; list has a comfortable min-width (~360px) so two-line rows never truncate the email.
- Selecting a row updates the detail in place (no route change needed; deep-linkable id in URL/state is a nice-to-have).
- **No selection** → detail shows a quiet placeholder ("Select a contact") using `icon-stack`, not a blank void.

### 2.4 Responsive behavior
- **≥ lg (desktop):** master–detail side by side as above.
- **md (tablet / narrow window):** single column. List fills the area; selecting a contact **pushes** the detail over it with a back affordance (‹ Contacts). This is the same push pattern Bridge should use anywhere space is tight.
- **Cards view (optional, from `solution-users-2`):** a responsive grid of contact cards (`frame` + `avatar`) as an alternative to the dense table, toggled by the ⊞/≣ control. Table is the default; cards are a preference, not a second codebase — same data, different cell renderer.

---

## 3. Contact list (master)

Component: **`data-grid`** (dense preset), rows are **two-line**.

### 3.1 Row anatomy
- **Avatar** (leading) — `avatar`, Graph photo via the app's existing avatar-from-Graph fetch; initials fallback from display name; consistent color hash for people with no photo.
- **Primary line:** Display name (semibold). Optional trailing `badge` for relationship: `Org` (in-tenant, from `/me/people` / directory), `External`, `Frequent` (high `/me/people` relevance/rank).
- **Secondary line (muted):** `Company · primary email`. If no company, show job title; if neither, show email only.
- **Trailing (hover / row actions):** quick actions via `dropdown-menu` — *Compose to*, *Copy email*, *Enrich*, *Open in Outlook*. Mirror `solution-users-2`'s row-action pattern.

Columns for the table view: **Name** (avatar+name), **Company**, **Title**, **Email**, **Phone**, **Source** (Contacts/People/Directory badge). Use `data-grid` `columnsVisibility` so power users can toggle Title/Phone off. `dense: true`, `rowBorder: true`, `headerSticky: true`.

### 3.2 Search, sort, group
- **Search:** `autocomplete` in the toolbar — matches name / email / company. Debounced; server-side against Graph where possible (`/me/contacts?$search` and `/me/people?$search=`), client filter as fallback for the already-loaded page.
- **Sort:** `data-grid` column sort. Default sort = **relevance** when the list is seeded from `/me/people` (Graph already ranks by interaction), else **A→Z by name**.
- **Grouping (light):** optional sticky A–Z section headers when sorted by name (alpha index). Keep it optional; the lean default is a flat relevance list.
- **Filters:** `filters` component — facets: Company, Relationship (Org/External), Has phone, Source (Contacts vs People vs Directory). Filters are additive chips shown under the toolbar.

### 3.3 Volume / performance
- Contacts can be hundreds–thousands. Use `data-grid` **virtualization + infinite scroll** (`DataGridTableVirtual`, `onFetchMore`, `hasMore`) bound to Graph paging (`@odata.nextLink`). Provide a stable `getRowId` (Graph contact id / person id) so selection and pinning survive re-sort.
- Pin the currently-open contact to top on narrow layouts if helpful (`rowsPinnable`) — optional.

---

## 4. Contact detail / profile

Container: **`frame`** blocks stacked; identity header modeled on the Pro **`profile-1`** block.

### 4.1 Identity header
- Large **`avatar`** (Graph photo, initials fallback).
- **Name** (title), **Job title**, **Company** (secondary).
- Relationship **`badge`**(s): Org / External / Frequent.
- Header actions (buttons): **Compose email**, **Enrich** (primary when the record is sparse), overflow `dropdown-menu`: *Edit*, *Open in Outlook*, *Copy vCard* (later).

### 4.2 Field cards (each a `frame`)
- **Emails** — one row per address, label (work/home/other), default marked; click = compose. Copy button per address.
- **Phones** — one row per number with type; `tel:` link; copy.
- **Company & role** — company, department, office/location, manager (if directory-enriched).
- **About / notes** — free text from the Contacts record (read in MVP).
- **Recent interactions** (later slice) — `timeline` of latest messages to/from this person, pulled from mail the app already has.

Field sourcing per row is labeled with a tiny source `badge`/tooltip (Contacts vs People vs Directory) so the user knows where a value came from — important for trust when data is auto-enriched.

### 4.3 "Enrich contacts" — behavior
**What it is:** contacts auto-saved by Outlook are often just *name + email*. Enrich fills the gaps.

**Where the extra info comes from (in priority order, all via already-granted Graph scopes):**
1. **`/me/people`** — Graph's people ranking already returns `jobTitle`, `companyName`, `scoredEmailAddresses`, `phones`, `personType`. Cheapest, no extra permission.
2. **Directory `/users/{id}`** (for in-tenant people) — canonical `jobTitle`, `department`, `officeLocation`, `mobilePhone`, `businessPhones`, `manager`, `photo`. Only for org members.
3. **Contact photo** `/me/contacts/{id}/photo` or `/users/{id}/photo` for the avatar.

**Interaction (per contact):**
- If a record is sparse, the detail shows a subtle **"Enrich this contact"** prompt (an `alert`/inline callout, not a modal) with the primary Enrich button in the header.
- Clicking Enrich fetches the sources, then shows a **diff/preview**: proposed additions with their source badge, each toggle-able. Nothing is written until the user confirms **Apply**.
- **Applying** writes back to the Outlook contact via `PATCH /me/contacts/{id}` (only if Contacts write scope is present; if only read scope, Enrich is **session-only augmentation** — it enriches the view but shows "Sign-in needs Contacts.ReadWrite to save" and offers copy instead of write). This respects the permission boundary — no silent writes, no scope escalation without the user.

**Bulk "Enrich all…":** toolbar action that queues enrichment across the list with a progress state; still surfaces a review step (or a per-contact confidence threshold) before any write. Later slice.

### 4.4 Edit vs read
- **MVP: read-only detail** + Enrich (which is a reviewed write). Simpler, safer, matches "lean."
- **Edit mode (later slice):** inline edit of name/emails/phones/company using `input`, `phone-input`, and Save/Cancel. `PATCH /me/contacts/{id}`. Optimistic update with rollback on error.

---

## 5. States

| State | Treatment | Component |
| --- | --- | --- |
| **Loading (list)** | Skeleton rows | `data-grid` `isLoading` + `loadingMode:"skeleton"` |
| **Loading (detail)** | Skeleton of header + cards | `skeleton` inside `frame` |
| **Empty (no contacts)** | Friendly illustration + "Your Outlook contacts will appear here as you email people" + primary "Import / Enrich" hint | `icon-stack` + `data-grid` `emptyMessage` |
| **Empty (search/filter no match)** | "No contacts match" + Clear filters | `data-grid` `emptyMessage` |
| **Error (Graph call failed)** | Inline error with Retry; keep last good data if any | `alert` (destructive) + `button` |
| **No permission** | Explain which scope is missing (People.Read / Contacts.Read[Write]) and a "Grant access" affordance that routes to the app's existing consent flow — **do not** trigger consent silently | `alert` + `icon-tile` |
| **Enrich in progress** | Per-row / header spinner, non-blocking | `spinner`, `badge` "Enriching…" |
| **Offline** | Show cached contacts read-only, banner | `alert` |

Permission handling is explicit: the module checks token scopes up front; People.Read/Contacts.Read are stated as already granted, but the UI must still degrade gracefully if a token lacks them (and Enrich-write specifically depends on `Contacts.ReadWrite`).

---

## 6. Future hover-card (To/Cc/Bcc) — **later story, specced now**

Trigger: hovering (or focusing, for keyboard/a11y) a recipient chip in a **To/Cc/Bcc** field of the composer, or a sender name in the reading pane.

Component: **`card-42`** (Pro) *or* the free **`c-hover-card-3`** ("Hover card with profile information", built on `hover-card` + `avatar`). Recommend shipping on `c-hover-card-3` first (free, same data), swap to `card-42` if its polish is wanted.

Content (compact): avatar, name, title · company, primary email, relationship badge, and 2 quick actions — **Compose** and **View in People** (opens the module with that contact selected). Resolve identity from the same People data layer (`/me/people` lookup by email, directory fallback), so the hover-card and the module share one cache.

Why later: it depends on the People **data layer** (resolver + cache) existing and on composer integration; ship the destination module first, then wire the inline affordance. Design the People contact model now so a single `resolvePerson(email)` powers both.

---

## 7. Component map (UX element → reui component → notes)

| UX element | reui component (exact) | Install | Notes |
| --- | --- | --- | --- |
| Sidebar "People" entry | (app shell nav item) + lucide `Users` | — | Above Agenda; reuse Agenda's active-item style |
| Overall People screen (reference) | **block `solution-crm-3`** | `@reui/solution-crm-3` | Pro. Layout reference for toolbar+list+detail |
| Contact list (table) | **`data-grid`** (dense, virtualized) | `@reui/data-grid` | Sort/filter/paginate/skeleton/empty/`onRowClick` built-in |
| Contact list (cards view, optional) | **block `solution-users-2`** | `@reui/solution-users-2` | Pro. Card-grid + row-action reference; toggle from table |
| Row / card avatar | **`avatar`** (+ `c-avatar-22/23/24` for groups) | `@reui/avatar` | Graph photo, initials fallback; reuse app pattern |
| Status / relationship chips | **`badge`** | `@reui/badge` | Org / External / Frequent / source |
| Search box | **`autocomplete`** | `@reui/autocomplete` | Name/email/company; Graph `$search` |
| Filter bar | **`filters`** | `@reui/filters` | Company, relationship, has-phone, source facets |
| Contact detail / profile (reference) | **block `profile-1`** | `@reui/profile-1` | Pro. Identity header + field cards + tabs reference |
| Detail panel + each field card | **`frame`** | `@reui/frame` | "Container with title and actions" |
| Section tabs in detail | shadcn **`tabs`** | (shadcn) | Details / Interactions / Notes |
| Phone field (edit) | **`phone-input`** | `@reui/phone-input` | Country + validation (later, edit mode) |
| Recent interactions | **`timeline`** | `@reui/timeline` | Later slice; from existing mail data |
| Empty / no-permission visuals | **`icon-stack`**, **`icon-tile`** | `@reui/icon-stack`, `@reui/icon-tile` | Empty-state illustrations |
| Errors / permission / enrich prompts | **`alert`** | `@reui/alert` | Inline, non-modal |
| Loading | `data-grid isLoading`, shadcn **`skeleton`**, **`spinner`** | — | Skeleton for list/detail; spinner for enrich |
| Row / header actions | shadcn **`dropdown-menu`**, **`button`**, **`tooltip`** | (shadcn) | Compose / Copy / Enrich / Open in Outlook |
| **Future** To/Cc/Bcc hover-card | **`card-42`** (Pro) or **`c-hover-card-3`** (free) | `@reui/card-42` / `@reui/c-hover-card-3` | Later story; free option recommended first |

---

## 8. Craft details

- **Density:** the list is the app's densest surface — use `data-grid` `dense: true`, 40–44px rows, two-line. The detail is airy by contrast (generous `frame` padding). The density contrast is the "craft."
- **Motion:** view takeover = the app's existing content transition; row-select = instant content swap with a 120ms fade on the detail; hover-card = reui's default hover-card in/out delay. All gated by `prefers-reduced-motion`.
- **Light/dark:** every component is themed via the app's Tailwind v4 tokens — no hardcoded colors. Avatar fallback color hash must have adequate contrast in both themes. Verify badge and muted-text contrast in dark.
- **Cohesion with Bridge shell:** keep the sidebar, top bar, and spacing scale identical to Mail/Agenda. People is a new *content* view, not a new *chrome*. Reuse the app's existing avatar-from-Graph, its Graph client/token layer, and its consent flow. Pick **one reui surface** (Frame vs Card) for the whole module and stay on it — do not mix.
- **Accessibility:** hover-card must also open on focus; row actions reachable by keyboard; list is a proper table with sortable headers; every avatar has an alt/name; enrich diff is announced. Search and filters have labels.
- **Trust:** because data is auto-collected and auto-enriched, always show provenance (source badge/tooltip) and never write without confirm. This is the seed of a CRM — get the trust model right early.

---

## 9. Incremental slicing (feeds PO user stories)

**Slice 1 — MVP: See my people.**
Sidebar *People* entry (above Agenda) → full-area takeover → `data-grid` contact list (avatar, name, company, email; search + A→Z/relevance sort) seeded from `/me/contacts` + `/me/people` → read-only `frame` detail (identity header + emails + phones + company). Loading/empty/error/no-permission states. *Ships the destination.*

**Slice 2 — Enrich (single contact).**
Per-contact Enrich: fetch `/me/people` + directory `/users/{id}`, show reviewed diff with source badges, Apply via `PATCH /me/contacts/{id}` (graceful read-only fallback). Source provenance badges throughout. *Ships the headline feature.*

**Slice 3 — List power + views.**
`filters` facets, column visibility, virtualization/infinite scroll for large lists, optional Cards view (`solution-users-2` pattern), row quick-actions (Compose / Copy / Open in Outlook). *Scales the list.*

**Slice 4 — Hover-card in To/Cc/Bcc.**
`resolvePerson(email)` data layer + `c-hover-card-3` (later `card-42`) on recipient/sender chips, with Compose / View-in-People actions. *Ships the inline CRM touchpoint.*

**Slice 5 — Edit + interactions (CRM seed).**
Inline edit mode (`phone-input`, inputs, PATCH), `timeline` of recent interactions per contact, bulk "Enrich all…". *Turns People into the CRM foundation.*

Order rationale: destination before inline affordance (hover-card needs the data layer); read before write (trust + simplicity); each slice is independently shippable and demoable, matching the ~3-issue incremental release cadence.
