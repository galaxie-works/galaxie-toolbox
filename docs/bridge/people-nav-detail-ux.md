# Bridge — People: detail hierarchy, Outlook navbar & Organizations — Design Spec

> 📌 **Design spec. Estado atual: ENTREGUE** — detail hierarchy, navbar estilo Outlook e Contacts | Organizations estão no app. Doc de intenção; comportamento real no código.

Issues #203 (detail CTA/toolbar/frame/responsive) · #204 (Outlook-style navbar) · #205 (Contacts | Organizations, CRM seed)
GALAXIE Toolbox / Bridge · Tauri 2 + React 19 + TS + Tailwind v4 + shadcn + **reui** (`@reui`, free tier)
Status: design only (no production code). PO feedback on the shipped People module (v0.29/0.30).

> Read alongside `docs/bridge/bridge-people-ux.md` (#143 — the original People spec) and `docs/navigator/navigator-ux-spec.md` (#172). Same discipline: every surface maps to a real installed component; nothing invented. These three issues are **one information architecture** — the module nav (#204) contains the People module, which contains the Contacts/Organizations sub-nav (#205), whose detail pane is the thing #203 fixes. Design them together.

Anchored in the real code: `src/components/people/people-view.tsx` (`PeopleView`, `PeopleDetail`, `PeopleRowActions`, `PeopleCard`, `BulkEnrichReview`), `src/screens/control-room.tsx` (the Bridge sidebar `aside`, the `Linha` folder rows, the People/Agenda footer buttons, `bridgeView`), `src/store/people-slice.ts` (`PeopleSlice`), `src/lib/people.ts` (`PeopleContact`, `mergePeopleRecords`, `resolvePerson`).

---

## 0. TL;DR — the decisions, on the record

1. **Detail has exactly ONE filled/roxo primary at rest: `Compose email`.** Everything else — Edit, Enrich, Copy, Open in Outlook — is a **secondary/ghost action in a real `Toolbar`**. The two "Enrich" buttons and the three competing primaries are deleted. Enrich stops being a header primary; it lives in the toolbar (secondary) plus the *single* sparse-state callout, and its review panel is the only place an Enrich button may look filled — because at that moment the panel is the focused task.
2. **The redundant `Frame` around the detail goes.** The detail already has its own identity header; wrapping it in a bordered `Frame` + nested bordered `FramePanel`s is double chrome. Replace with **one bordered pane** (same `rounded-xl border bg-card` the list pane already uses — master/detail symmetry) whose inner sections are separated by `Separator`, not by nested borders. Airy, single moldura.
3. **Responsiveness is measured on the *module*, not the *window*.** The `min-[1400px]` viewport cliff is why the split "desalinha" at different zooms and after sidebar collapse. Switch to a **container query** + **`ResizablePanel`** with hard min-widths, so the split reflows to the space the module actually has.
4. **#204 navbar = a module switcher, not footer buttons.** Promote **Mailbox · People · Agenda** to sibling nav items at the **top** of the Bridge sidebar (Outlook's module bar). The mailbox selector + folder tree become *children of Mailbox* (render only when Mailbox is active). Unify `bridgeView` to `"mail" | "people" | "agenda"` and retire the loose footer buttons and the `agendaAberta` overlay.
5. **#205 Organizations = an app-owned entity, not a Graph one.** Graph has **no CRM "organization"** (its `organization` resource is *your tenant*; users only carry a `companyName` *string*). So Organizations is ours: keyed by **email domain**, membership is **domain-derived + manually overridable**. Sub-nav **Contacts | Organizations** sits at the top of the People module (`Tabs`). This is the CRM seed that meets Astro (#180).
6. **Reuse only.** `Toolbar`, `Tabs`, `ResizablePanel`, `ButtonGroup`, `Dialog`, `Separator`, `DropdownMenu`, `Alert` are **already installed**; `data-grid`, `frame`, `badge`, `avatar`, `icon-stack` are the reui pieces already in People. Zero new dependencies for the whole spec.
7. **Order: #203 → #204 → #205.** The detail is a *visible shipped bug* (fix first, cheapest, most embarrassing). The navbar is the IA frame everything sits in (second). Organizations is net-new surface + a data layer (largest, last). Matches the ~3-issue release cadence.

---

## 1. Issue #203 — Contact detail (most urgent)

### 1.1 What's wrong today (verbatim → code)

In `PeopleDetail` (`people-view.tsx`):

- **Two Enrich buttons.** One in `FrameHeader` (lines ~549–556, `<Button onClick={enrich}>` default variant = filled) **and** one inside the sparse-state `Alert`'s `AlertAction` (lines ~631–638). → "aparecem 2 enrich".
- **Three filled primaries competing.** `Button` with no `variant` renders the default (roxo) style. In one viewport the user sees: header **Enrich** (filled) + identity-row **Compose email** (filled, line ~596) + the preview panel's **Apply / "Apply to this session"** (filled, lines ~738–745). → "3 botões primários kkk".
- **Redundant frame.** The detail is `<Frame stacked>` (line ~504) — a bordered container — and it *also* renders an identity header (avatar/name/title). Each field group is a bordered `FramePanel`. Border-on-border-on-border.
- **Responsive cliff.** The split is a hard `min-[1400px]` switch (list `min-[1400px]:basis-[38%]`, detail `min-[1400px]:basis-[62%]`; below that, detail replaces list). Panes have no min-width floor, so at odd zooms / after sidebar collapse they crush and misalign.

### 1.2 CTA hierarchy — the perfect path

**Rule: one filled primary per visual region; the detail header is one region, the enrich review panel is another; the two never show two filled buttons at once.**

Resting detail (no edit, no preview open):

```
┌ detail header (sticky) ─────────────────────────────────────────────┐
│ [Avatar]  Name                                   [ Compose email ▸ ] │  ← the ONE filled primary
│           Job title · Company                    ┌ Toolbar ────────┐ │
│           [Org] [Frequent] [source]              │ ✎  ✦  ⧉  ↗   ⋯  │ │  ← all ghost/secondary
│                                                  └─────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

- **`Compose email`** — the durable primary. Writing to a contact is the 90% action; it stays filled, always, top-right of the header. (Today it's buried in the identity row; promote it to the header's single primary.)
- **Action `Toolbar`** (secondary, ghost icon buttons, with tooltips + `aria-label`), left→right:
  - **Edit** (`Pencil`) — enters edit mode (§1.4). Disabled with a tooltip when `!contact.contactId || writeAvailable !== true` (reuse the `DicaSomenteLeitura` span-wrap pattern from `control-room.tsx`).
  - **Enrich** (`Sparkles`) — opens the review panel. This is the *only* persistent Enrich entry point; the header Enrich button is **deleted**.
  - **Copy** (`Copy`) — dropdown or direct: copy primary email / copy vCard (later). 
  - **Open in Outlook** (`ExternalLink`) — `outlook.office.com/people/` (already wired in `PeopleRowActions`).
  - **⋯ overflow** (`MoreHorizontal`) — low-frequency: Copy vCard (later), Delete contact (later), Assign to organization (→ #205 cross-link).
- **Sparse-state callout** (`Alert variant="info"`, unchanged position): keeps **one** button, styled **`secondary`** (not default) so it never competes with Compose. It's the *recommended* enrich entry when `sparse === true`; the toolbar Enrich is the *always-available* one. They are the same action — only one is visually salient at a time, and neither is filled.
- **Enrich review panel** (the existing preview `FramePanel`): while open it is the focused region, so its **Apply** is `default` (filled) — the single primary *of that panel*. `Cancel` is `outline`. The session-only variant becomes copy inside the read-only `Alert`, not a second filled button. Because opening the panel scrolls it into focus and it reads as a mini-form, one filled Apply there is correct and no longer "competes" — there is no other filled button in that region.

Net effect: at any instant the eye finds **one** filled roxo button. "2 enrich + 3 primaries" → **1 primary + a quiet toolbar**.

### 1.3 The action toolbar — exact component

Use the **installed** `Toolbar` (`src/components/ui/toolbar.tsx`, Radix `@radix-ui/react-toolbar` — roving tabindex, arrow-key nav for free). Compose stays a standalone `Button` (filled) *outside* the toolbar so the toolbar is uniformly secondary.

```
<div className="flex items-start justify-between gap-3">   // header actions row
  …identity…
  <div className="flex items-center gap-2">
    <Button onClick={compose}> <Mail/> Compose email </Button>   // primary
    <Toolbar aria-label="Contact actions">
      <ToolbarButton …Edit/><ToolbarButton …Enrich/>
      <ToolbarSeparator/>
      <ToolbarButton …Copy/><ToolbarButton …Outlook/>
      <ToolbarSeparator/>
      <DropdownMenu>…⋯…</DropdownMenu>
    </Toolbar>
  </div>
</div>
```

- Toolbar buttons: `variant="ghost" size="icon-sm"`, each with `Tooltip` + `aria-label` (labels are the strings already in `t.controlRoom.people*`). Icon-only at rest; on the widest tier the two most-used (Edit, Enrich) may show labels.
- On narrow widths the whole actions block **wraps below** the identity (see §1.5) and Compose becomes full-width; the toolbar stays a single ghost row.
- `ButtonGroup` is the alternative if a *segmented* look is wanted, but `Toolbar` is the honest a11y choice for an action bar — pick `Toolbar`.

### 1.4 Edit flow — view → edit → save/cancel (reuses #170)

The inline edit from #170 already exists in `PeopleDetail` (`editing`, `draft`, `saveContact`, `resetDraft`, `PhoneInput`, optimistic `updatePeopleContact` + rollback). The spec only **relocates the trigger and clarifies the states** — no new edit engine.

| State | Header primary | Toolbar | Body | Exit |
| --- | --- | --- | --- | --- |
| **View** | `Compose email` | Edit · Enrich · Copy · Outlook · ⋯ | read-only sections | — |
| **Edit** | `Save` (filled, `Spinner`+`Save` while saving; disabled if `!draft.name.trim()`) | replaced by **`Cancel`** (outline) only | name → `Input`, emails/phones/company → inputs + `PhoneInput` (as today) | Save = validate → PATCH → toast → View; Cancel = `resetDraft` → View |
| **Edit (locked)** | Edit disabled | tooltip "This person is not an editable Microsoft contact" | — | — |

Rules: entering Edit hides Compose and the rest of the toolbar (edit is a mode, one primary = Save). Validation is the existing email/phone check (`peopleInvalidEmail` / `peopleInvalidPhone`) surfaced in the destructive `Alert`. Keep the optimistic update + rollback. This is exactly the perfect path Wagner asked for: **Edit is one obvious toolbar button → a clean two-button (Save/Cancel) mode → back to view.**

### 1.5 Remove the redundant frame — what replaces it

Drop the outer `<Frame stacked>` in `PeopleDetail`. Structure becomes:

```
<div className="…rounded-xl border bg-card…">          // the ONE moldura = the detail pane (matches the list pane)
  <div className="sticky top-0 …bg-card/95 backdrop-blur border-b">   // detail header (identity + Compose + Toolbar)
     …identity + actions…
  </div>
  <ScrollArea className="min-h-0 flex-1">              // airy body
     <section> Emails </section>   <Separator/>
     <section> Phones </section>   <Separator/>
     <section> Company & role </section>   <Separator/>
     <section> Recent interactions (Timeline) </section>
     {sparse && <Alert info … single secondary button/>}   // callout
     {preview && <div className="focused review card"/>}    // the one filled-Apply region
  </ScrollArea>
</div>
```

- The **detail pane div** (the 62% column) gains `rounded-xl border bg-card` — today only the list pane has it; giving the detail the same makes the master/detail read as two matched surfaces (fixes the "moldura duplicada" *and* the visual asymmetry).
- Inside, **no nested bordered `FramePanel`s** for ordinary field groups — use plain `<section>` + `Separator`. Reserve a bordered card **only** for the enrich review (it *should* stand out as a focused task) and destructive/error `Alert`s.
- Header is **sticky** so Compose + Toolbar stay reachable while scrolling the body — the toolbar Wagner "misses" is always present.
- If you prefer to keep `Frame` semantics, use `<Frame variant="ghost">` (drops its border) — but the plain-div-in-bordered-pane is cleaner and matches the list side exactly.

### 1.6 Responsive master–detail — kill the 1400 cliff

Two changes:

1. **Measure the module, not the window.** Wrap the master-detail region in a **container** (`@container/people`) and switch layout on *container* width. The sidebar collapse and window zoom both change the module's width; a viewport media query ignores the sidebar and mis-fires — that's the "quebra em zooms diferentes".
2. **Make the split a `ResizablePanelGroup`** (already used in the mail 3-pane, `control-room.tsx`) with **hard min-widths**, so neither pane can crush.

| Tier (container width) | Layout |
| --- | --- |
| **`< ~48rem` (narrow / compact)** | single column, **push-detail**: list fills; selecting a contact pushes the detail over it with a `‹ Contacts` back button (today's `onBack`, but driven by container width, not `min-[1400px]`). |
| **`≥ ~48rem` (wide)** | side-by-side `ResizablePanel`: list `defaultSize≈38 minSize` clamped so it never goes below **~340px**; detail `defaultSize≈62` with **min ~420px**. `ResizableHandle` lets the user tune the ratio; Radix handle is keyboard-accessible. |

- Drop `min-[1400px]` everywhere in `PeopleView`; derive `selected && stacked` from the container tier. The back button shows only in the compact tier.
- Min-widths are the actual fix for "desalinhando": panes stop collapsing below legible width; overflow scrolls within a pane instead of squashing the layout.
- Cards view (`peopleView === "cards"`) keeps its responsive grid; only the master/detail *shell* changes.

---

## 2. Issue #204 — Outlook-style navbar

### 2.1 Today

`control-room.tsx` sidebar `aside`: `SeletorCaixa` (mailbox picker) → New Mail → folder tree (`Linha`) → `Separator` → **People** ghost button → **Agenda** ghost button, both pinned to the footer. `bridgeView` is `"mail" | "people"`; Agenda is a *card overlaid on the mail area* gated by a separate `agendaAberta` boolean. People/Agenda read as afterthoughts, not peers of Mail.

### 2.2 The IA — a module switcher on top

Promote **Mailbox · People · Agenda** to a **module nav** at the **top** of the sidebar (Outlook's module bar). They are siblings; the folder tree belongs to Mailbox.

```
┌ Bridge sidebar ─────────────┐
│  ▣ Mailbox      ●            │   ← module nav (3 items, icon+label, active=secondary)
│  ◍ People                    │
│  ▤ Agenda                    │
│ ───────────────────────────  │   ← Separator
│  [ Minha caixa ▾ ]           │   ← Mailbox-only: SeletorCaixa (#111)
│  [ ✎ New Mail        ⌄ ]     │   ← Mailbox-only
│  Mail:  Inbox · Drafts · Sent │   ← Mailbox-only: folder tree (Linha)
│  Others: Archive · Junk …     │
└──────────────────────────────┘
```

- **Items:** `Mailbox` (`Mailbox`/`Inbox` icon), `People` (`Users`), `Agenda` (`CalendarDays`) — all lucide icons already imported. Item = `icon + label`, full-width, left-aligned.
- **Active state:** reuse the folder active treatment exactly — `bg-secondary font-medium text-secondary-foreground`; inactive `text-muted-foreground hover:bg-accent/50`. **Text + icon, never colour-only** (a11y). One item active at a time.
- **Contextual body:** the `SeletorCaixa` + New Mail + folder tree render **only when the active module is Mailbox**. When People or Agenda is active, that block is hidden and the module owns the content area (People already does this; Agenda now matches).
- **Collapsed sidebar:** the three items become `size-9` icon-only with right-side `Tooltip`s (the exact `Tooltip > TooltipTrigger asChild > Button` pattern already used for the collapsed folders/People).

### 2.3 State change — unify `bridgeView`

- Extend `bridgeView` to **`"mail" | "people" | "agenda"`**. Retire the `agendaAberta` boolean and the "Agenda card overlaid on mail" arrangement — Agenda becomes a full module view like People (it *is* what "navbar coeso" means: three mutually-exclusive modules).
- Wiring maps cleanly onto what exists: `onSelectPeople` → `setBridgeView("people")` (already there); add `onSelectMailbox` → `setBridgeView("mail")`; `onSelectAgenda` → `setBridgeView("agenda")`. The current `AgendaConteudo` renders in the content area when `bridgeView === "agenda"` instead of as a right-side card.
- **Migration note (flag):** today Agenda can sit *beside* mail. Making it a peer module means it takes the content area. That's the coherent Outlook model and the spec recommends it — but it's a real behavioural change, so it's called out. If the team wants to keep "peek Agenda while in mail," that's a separate follow-up; the default here is the clean three-module switch.

---

## 3. Issue #205 — People: Contacts | Organizations (CRM seed)

### 3.1 Sub-nav

At the **top of the People module content** (not the sidebar — the sidebar nav is #204's module switcher; this is one level down), a **`Tabs`** row: **Contacts** | **Organizations**.

- Component: **`Tabs`** (installed, `ui/tabs.tsx`) — `TabsList` / `TabsTrigger`, left-aligned in the People header area next to the title. (`ButtonGroup` is the segmented alternative; `Tabs` wins for the semantic role + keyboard support.)
- **Contacts** = today's `PeopleView` (list + detail, unchanged bar the #203 fixes).
- **Organizations** = the new view, same master-detail shell.
- Persist the active sub-tab in the people slice (`peopleTab: "contacts" | "organizations"`).

### 3.2 Data model — where an org comes from

**There is no Graph CRM organization.** Microsoft Graph's `organization` resource is *your own tenant*; directory users carry only a `companyName` **string** and an email **domain** — no linkable company entity. So Organizations is an **app-owned entity**, keyed by domain, session-cached for MVP (mirroring the People session cache in `people-slice.ts`), persisted later.

```ts
interface PeopleOrg {
  id: string;               // app-generated (e.g. "org:galaxie.works")
  name: string;             // "Galaxie Works"
  domains: string[];        // ["galaxie.works"] — the JOIN KEY to contacts
  website?: string | null;
  notes?: string | null;
  logo?: string | null;     // later: derived from domain (favicon/clearbit-style), optional
  memberIds: string[];      // contacts explicitly ADDED (incl. off-domain, e.g. a gmail freelancer)
  excludedIds: string[];    // contacts on a matching domain the user explicitly REMOVED
  createdAt: number;
  updatedAt: number;
}
```

**Membership = domain-derived + manual override (hybrid):**

- **Derived (suggested, instant value):** a contact whose primary email domain ∈ `org.domains` is an auto-member. Create "Acme" with domain `acme.com` → every `acme.com` contact populates immediately, no manual tagging.
- **Manual (authoritative):** `memberIds` adds contacts on other domains; `excludedIds` removes a domain-matched contact the user doesn't want.
- **Effective members** = `{contacts whose domain ∈ domains} \ excludedIds ∪ {memberIds}`.
- **Seeding a new org from a domain cluster:** pre-fill `name` from the most common `companyName` among that domain's contacts; suggest `domains` from existing contact domains (a `datalist`). Creating an org is then ~one click from a cluster.

Helper: `resolveOrg(orgs, domain)` in a new `src/lib/organizations.ts`, sibling to `resolvePerson`. A `derivedMembers(org, contacts)` selector computes the effective set. Store: a new `organizations-slice.ts` mirroring `people-slice.ts` (session MVP; `organizacoes.json` persistence + `crOrgs*` API later).

### 3.3 Screens

1. **Organizations list (master).** Same shell as Contacts. `data-grid` (installed) or `Frame` cards: **Logo/Name · Domain(s) · #Members** (later: last interaction). Toolbar: search (`Autocomplete`) + **`New organization`** (the list's single filled primary). Empty state = `IconStack` + "Create an organization to group your contacts."
2. **Organization detail.** Same airy pattern as the #203 contact detail: sticky header (logo/name/domain/website) + **action `Toolbar`** (Edit · Assign contacts · Open website · ⋯) with **one** filled primary = **`Assign contacts`** (or `Compose to all`, later). Body sections: **Members** = a compact contact list (reuse the contact-row renderer / a mini `data-grid`) with per-row "remove from org"; **Details** (domains, website, notes).
3. **Create / Edit organization.** A **`Dialog`** (installed): `name`, `domains` (chip input — reuse the token pattern from `Filters`, or a simple input-splits-on-Enter), `website`, `notes`. Edit reuses the same dialog.
4. **Assign contacts.** A **`Dialog`**: searchable checkbox list of all contacts (reuse the People `Autocomplete` + checkbox rows from `BulkEnrichReview`), **domain-matched contacts pre-checked**. Confirm → updates `memberIds`/`excludedIds`.

### 3.4 Cross-links (the CRM seed)

- **Contact detail → Organization:** in the contact's Company & role section, render the resolved org as a **`Badge`/link**; clicking switches to Organizations and opens that org. Add "Assign to organization…" in the contact detail ⋯ overflow.
- **Org detail → contact:** clicking a member row opens the contact detail (switch sub-tab to Contacts, select the person).
- This is exactly the People→CRM evolution (#180 Astro): the domain join + explicit membership + the two-way link are the seed; interactions rollup and org-level timelines come later.

---

## 4. Component map (UX element → component → install/status)

| UX element | Component (exact) | Status | Notes |
| --- | --- | --- | --- |
| Module nav (Mailbox/People/Agenda) | app shell nav items (`Button`) + lucide `Mailbox`/`Users`/`CalendarDays` | in-app | Reuse folder active style; text+icon; collapsed = icon+`Tooltip` |
| People sub-nav (Contacts/Organizations) | **`Tabs`** (`TabsList`/`TabsTrigger`) | **installed** (`ui/tabs.tsx`) | `ButtonGroup` is the segmented alt |
| Detail action toolbar | **`Toolbar`** + `ToolbarButton`/`ToolbarSeparator` | **installed** (`ui/toolbar.tsx`, Radix) | Ghost icon buttons + tooltips + `aria-label` |
| Detail primary CTA | **`Button`** (default/filled) | installed | The ONE primary: Compose (contact) / Assign contacts (org) |
| Overflow menu | **`DropdownMenu`** | installed | ⋯ low-frequency actions |
| Detail surface (frame removed) | bordered `div` pane + `Separator` sections + `ScrollArea` | installed | One moldura = the pane; parity with list pane |
| Master/detail split | **`ResizablePanelGroup`/`ResizablePanel`/`ResizableHandle`** + `@container` | **installed** (`ui/resizable.tsx`) | Min-widths ~340/420px; container-query stack↔split |
| Sparse / read-only / error callouts | **`Alert`** (`@reui/alert`) | installed | Single secondary button in the info callout |
| Enrich review (focused card) | **`FramePanel`** (bordered) | installed | The one region where Apply may be filled |
| Contact list / Org list | **`data-grid`** (`@reui/data-grid`) | installed | Dense, virtualized (as today) |
| Row/card avatar, badges, empty | **`avatar`**, **`badge`**, **`icon-stack`** | installed | As current People |
| Create/Edit org · Assign contacts | **`Dialog`** + `Checkbox` + `Autocomplete` | installed | Domain-matched pre-check; chip input for domains |
| Org↔contact cross-link | **`Badge`** (as link) | installed | Two-way navigation |
| Edit inputs (edit mode) | `Input`, **`PhoneInput`** (`@reui/phone-input`) | installed | Reuse #170 draft/validation/rollback |

**No new dependency for any of the three issues.**

---

## 5. States, a11y, light/dark

- **CTA discipline as an invariant:** at most one filled `Button` per region. A quick audit rule for Codex: in `PeopleDetail`, `grep` for `<Button` with no `variant` — there must be exactly one in the resting header (Compose) and one in an open review panel (Apply). Everything else carries `variant="ghost"|"outline"|"secondary"`.
- **Toolbar a11y:** Radix `Toolbar` gives roving tabindex + arrow-key nav; every icon button needs `aria-label` + `Tooltip`; disabled Edit uses the span-wrap tooltip (native disabled buttons swallow events).
- **Nav a11y:** active module/sub-tab conveyed by **text + icon + background**, never colour alone; `Tabs` is a proper `tablist`; the module nav items are `aria-current`-marked.
- **Resizable a11y:** the `ResizableHandle` is keyboard-operable (Radix); provide `aria-label`.
- **Edit mode announced:** switching to edit moves focus to the name `Input`; validation errors in a live `Alert`.
- **Light/dark:** everything themed via Tailwind v4 tokens (`bg-card`, `border-border`, `text-muted-foreground`, `bg-secondary`) — no hex. Verify the sticky header's `bg-card/95 backdrop-blur` and the org logo fallback contrast in both themes. Respect `prefers-reduced-motion` on the push-detail transition.
- **Empty/error/permission** states reuse the existing `PeopleEmpty` / `PeoplePermissionEmpty` / `Alert` set; Organizations gets its own empty ("no organizations yet") and derives permission from the same People scopes (no new Graph scope — it's app data over already-loaded contacts).

---

## 6. Slicing & order (feeds the ~3-issue cadence)

### Slice A — #203 Contact detail (FIRST — visible shipped bug)
Codex order, fastest-win first:
1. **CTA hierarchy cleanup.** Delete the header Enrich button; make Compose the single header primary; downgrade the sparse-callout button to `secondary`; keep Apply filled *only* inside the review panel. → immediately kills "2 enrich + 3 primaries" with the least code.
2. **Action `Toolbar`.** Edit · Enrich · Copy · Open-in-Outlook · ⋯, ghost icon buttons with tooltips; relocate the Edit trigger here.
3. **Edit-flow states.** View→Edit (Save/Cancel) using the existing #170 `editing`/`draft`/`saveContact` — just the new trigger + the two-button mode + locked tooltip.
4. **Frame removal.** One bordered detail pane (parity with list) + `Separator` sections + sticky header + `ScrollArea`.
5. **Responsive.** `ResizablePanel` split + `@container` stack breakpoint + min-widths; drop every `min-[1400px]`.

### Slice B — #204 Outlook navbar
Module nav (Mailbox · People · Agenda) at the sidebar top; fold `SeletorCaixa` + New Mail + folder tree under the Mailbox module; extend `bridgeView` to `"mail" | "people" | "agenda"`; retire the footer buttons + `agendaAberta` overlay; collapsed-rail tooltips.

### Slice C — #205 Organizations
`Tabs` sub-nav (Contacts | Organizations); `organizations-slice` + `lib/organizations.ts` (`PeopleOrg`, `resolveOrg`, `derivedMembers`), session MVP; Organizations list + detail (same #203 detail pattern) + Create/Edit `Dialog` + Assign-contacts `Dialog`; domain-derived + manual membership; contact↔org cross-links. *Later:* `organizacoes.json` persistence, logo enrichment, org-level interaction rollup (CRM, #180).

**Order rationale:** #203 is a shipped, visible defect — cheapest to fix and the loudest embarrassment, so first, and step 1 alone removes the worst of it. #204 is IA glue that every module (including People) sits inside, so second. #205 adds a new surface *and* a new data layer, so it's the largest and lands last — and it's the one that graduates People into the CRM the roadmap is aiming at.
