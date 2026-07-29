# Bridge — File Previews (PDF · Docx · Xlsx · Pptx · Msg · Txt) — Design/Discovery Spec

Issue #178 · GALAXIE Toolbox / Bridge email client
Stack: Tauri 2 (multi-webview) + React 19 + TypeScript + Tailwind v4 + shadcn/new-york + **reui** registry
Status: research + design only (no code). Reuse-first, cost-honest.

> Read alongside `docs/bridge-people-ux.md` (#143) and `docs/navigator-ux-spec.md` (#172) — same depth, same component-map discipline, same INVEST slicing.

---

## 0. TL;DR — key decisions

1. **PDF: ship on pdf.js (free, Apache-2.0), NOT a paid SDK.** For *viewing* — the whole of #178's "visualizar" — Mozilla's pdf.js is the correct, honest MVP. It renders, paginates, zooms, searches, prints, and (critically) lets us **disable embedded PDF JavaScript** for safety. Apryse (WebViewer) and PSPDFKit/Nutrient are excellent but are **quote-based, four-to-five-figure-per-year commercial licences** aimed at *editing/annotation/redaction/measurement/forms* — none of which is MVP. They belong to the **future "editor" product** (§2, §8), not to Bridge's preview. See §3 for the full trade-off table.
2. **Office fidelity has two honest tiers; pick per-format.** (a) **Client-side libs** (docx-preview / SheetJS / a pptx renderer) — free, offline, instant, but *approximate* fidelity (esp. pptx). (b) **Graph "convert to PDF"** — upload the attachment to the user's own OneDrive (we *already* do this via `cr_compartilhar_onedrive` → "Bridge Anexos") then `GET /drive/items/{id}/content?format=pdf` and render the PDF with the **same pdf.js viewer**. This reuses existing infra + already-granted `Files.ReadWrite`, gives **Office-grade fidelity**, and needs **no LibreOffice bundle**. Recommendation: **docx/xlsx client-side for MVP; pptx via the Graph-PDF path** (client pptx renderers are weak). §4.
3. **We already own a docx engine.** `platejs` + `@platejs/docx` + `@platejs/docx-io` are **in `package.json` today** (the composer's rich-text stack). That means docx *editing* — the part Wagner flags as "another product" — has an in-house lever already, and docx *read-only preview* can even reuse Plate. We do **not** need mammoth *and* Plate; pick one (§4.1).
4. **`.msg` = an `itemAttachment`, not a file.** Outlook `.msg`/embedded messages arrive from Graph as `#microsoft.graph.itemAttachment` (a nested `message`), **not** `fileAttachment` — today's `cr_baixar_anexo` only reads `fileAttachment.contentBytes` and would fail on them. `.msg` preview = fetch the nested message (`?$expand=microsoft.graph.itemAttachment/item`) and **render it with the reader we already have** (subject/from/to + sandboxed `srcDoc` body + its own nested attachments, recursively). Almost zero new UI. §5.
5. **Where it appears: inline in the reader for light formats, a resizable side pane / Sheet for heavy ones.** txt and small PDFs render **inline under the message body** (extend the existing attachment strip). Docx/xlsx/pptx/large-PDF open a **`Preview` pane** — a right-side `Resizable` panel on desktop (both `sheet` and `resizable` are already installed and used), or a full `Sheet` overlay on narrow widths. Never a new window. §6.
6. **Security is the spine, not a footnote. Attachments are hostile input.** Every renderer runs **sandboxed, no script, no network, no OS handler**. Reuse the reader's proven pattern: DOMPurify + `<iframe sandbox>` **without `allow-scripts`** (stricter than the email body, which only gets scripts in dark mode for Dark Reader). pdf.js runs with `enableScripting:false` / `isEvalSupported:false`. "Abrir com o app do Windows" stays an **explicit, separate, user-initiated** action (today's `abrirCaminho`) — never the preview path. §7.
7. **Two small backend additions, no rewrites.** (a) `cr_ler_anexo(messageId, attachmentId)` → returns bytes **in memory / temp** (base64) *without* forcing a Downloads save (today's command always writes to Downloads). (b) Add `contentType` (+ `isInline`, `@odata.type`) to the `attachments` `$select` so the front knows *how* to render before fetching. Everything else rides existing commands. §7.4.
8. **Reuse, don't invent.** No format renderer is a "UI" we design — they're libraries dropped into a shell built from components we already have (`sheet`, `resizable`, `tabs`, `data-grid`, `badge`, `alert`, `icon-tile`, `skeleton`, `dropdown-menu`, `tooltip`). MVP is 100% free-tier. The only money question is the *future editor* (§8), and the answer there is "a separate Galaxie Apps product, evaluated then."

> **My opinion, on the record:** the single highest-leverage move is the **Graph "convert to PDF" path (§4.3)**. It turns *one* renderer (pdf.js) into a **universal high-fidelity viewer** for every Office format, reuses the OneDrive upload we already ship, escalates no permissions, and sidesteps the entire "which flaky client-side Office lib?" swamp. Client-side docx/xlsx stay as the **offline/instant fast-path**; pptx leans on the PDF path from day one. Build the pdf.js viewer once in Slice 1 and everything else plugs into it.

---

## 1. What #178 actually asks for

> "Embed a **viewer** for PDF + Office (Docx/Xlsx/Pptx) + **.msg** + .txt **inside Bridge**, for emails with attachments. Actions: **view, save, edit**."

Decompose the three verbs — they are wildly different in cost:

| Verb | Scope | Cost | Where it lands |
| --- | --- | --- | --- |
| **Visualizar** (view) | Render the file read-only, faithfully enough to *decide* on it without leaving Bridge | **Low–medium** — free libs + a shell | **This spec, Slices 1–4** |
| **Salvar** (save) | Persist the attachment to disk (Downloads / choose folder) | **Trivial** — `cr_baixar_anexo` exists today | **Slice 1** (already 90% built) |
| **Editar** (edit) | Modify the file (annotate PDF, edit docx, change a cell) and write it back | **High** — a real editor per format; PDF/spreadsheet editing is a product, not a feature | **Deliberately deferred → §8, "another product" (Wagner's own read)** |

So #178's MVP = **view + save**. Edit is scoped *out* of Bridge and *into* a future Galaxie Apps product, and this spec is explicit about the seam so the preview never accidentally grows an editor.

---

## 2. Architecture reality (what's already in the tree)

Anchoring symbols — all real, today:

| Layer | File / symbol | What it does |
| --- | --- | --- |
| Rust — read attachment | `src-tauri/src/graph.rs` — `cr_baixar_anexo(store, message_id, attachment_id, mailbox)` | GETs `/{prefix}/messages/{id}/attachments/{aid}`, decodes `fileAttachment.contentBytes` (base64), **writes to `%USERPROFILE%\Downloads`** (collision-safe), returns the absolute path. **Only handles `fileAttachment`.** |
| Rust — attachment list | `graph.rs` — `cr_email_corpo` → `AnexoEmail { id, nome, size }` via `attachments?$select=id,name,size` | Lists attachments **only when `hasAttachments`**. No `contentType`, no `@odata.type`. |
| Rust — OS open/reveal | `src-tauri/src/system.rs` — `abrir_caminho(path)`, `revelar_no_explorer(path)` | `start`/`explorer /select,` — the **explicit** "open in Windows / show in folder". Not a preview path. |
| Rust — OneDrive upload | `graph.rs` — `cr_compartilhar_onedrive` → PUT `/me/drive/root:/Bridge%20Anexos/{name}:/content` → share link | **The seed of the Graph-PDF path (§4.3).** Already uploads a file to the user's OneDrive under `Files.ReadWrite`. |
| TS bridge | `src/lib/api.ts` — `crBaixarAnexo`, `abrirCaminho`, `revelarNoExplorer`, `AnexoEnvio` | Thin `invoke` wrappers + mock fallbacks. |
| Reader — attachment strip | `src/screens/control-room.tsx` — `baixarAnexo(anexo)` (~L4220), the `det.anexos.map(...)` chip row (~L4331) | Each attachment is a `<button>` → `crBaixarAnexo` → **toast** with *Abrir arquivo* (`abrirCaminho`) / *Abrir pasta* (`revelarNoExplorer`). **This is the exact surface #178 extends.** |
| Reader — HTML body renderer | `control-room.tsx` — `CorpoMensagem` (~L662), the `<iframe srcDoc sandbox>` (~L500) | **The security template.** `DOMPurify.sanitize(corpo)` → `srcDoc` → `<iframe sandbox="allow-same-origin allow-popups">` (adds `allow-scripts` **only in dark mode** for Dark Reader). Manual height measurement, zoom, quoted-text folding. |
| Types | `src/lib/types.ts` — `AnexoEmail { id, nome, tamanho }`, `EmailDetalhe { …, anexos, webLink }` | The models to extend with `contentType`. |
| Installed libs (relevant) | `package.json` | `pdf-lib` (PDF *manipulation*, not render), `platejs` + `@platejs/docx` + `@platejs/docx-io` (docx engine), `dompurify`, `darkreader`, `@tanstack/react-table` + `@tanstack/react-virtual`, `@tauri-apps/plugin-fs` + `-dialog` + `-process`, `react-resizable-panels`. **No pdf.js, no SheetJS, no mammoth, no msg parser yet.** |

**Three consequences every feature below respects:**

- **The reader already sandboxes untrusted HTML correctly.** We do not invent a security model — we *extend* `CorpoMensagem`'s pattern to every renderer, and make it *stricter* (attachments never get `allow-scripts`).
- **Attachment bytes already flow through Rust.** We add an in-memory read (`cr_ler_anexo`) so preview doesn't litter Downloads; the existing Downloads-save stays as the "Salvar" action.
- **`pdf-lib` ≠ a viewer.** It builds/edits PDF structure; it does **not** rasterize pages. Rendering needs **pdf.js**. Don't let its presence create the illusion that PDF view is "already handled."

---

## 3. PDF — native / pdf.js vs a paid SDK (the headline cost decision)

The PO's links (Apryse blog: *native-vs-sdk*, *open-source-vs-proprietary*, *optimize-webviewer*, *measurement*, *js-pdf-editor*, *watermarks*; Nutrient's *Tauri + PSPDFKit*; `ApryseSDK/webviewer-samples`; `rudi-q/leed_pdf_viewer`; the Tauri-PDF reddit thread) are largely **vendor marketing**. Read honestly, they argue *for buying a suite you don't need yet*. Here's the calibrated trade-off.

### 3.1 The three options

| Option | Licence / cost | Renders | Annotate / redact / forms / measure / edit | Bundle weight | Verdict for #178 |
| --- | --- | --- | --- | --- | --- |
| **WebView2 native PDF** (let Edge show the PDF) | Free (OS) | ✅ good | ✗ (viewer only, no API) | 0 | **Rejected for embed.** Under Tauri's child-webview model a PDF tab is *another native webview above the DOM* — same z-order pain as the Navigator (#172 §1), no programmatic control, no sandbox knobs, no theming. Fine as the *"Abrir externamente"* escape hatch, not as the in-app preview. |
| **pdf.js** (Mozilla, Apache-2.0) | **Free, OSS** | ✅ good (canvas + text layer) | ✗ view-only (basic form fill possible; annotation is DIY) | ~1–2 MB (worker, lazy) | **✅ MVP choice.** Full control, runs in *our* DOM/iframe, `enableScripting:false` kills embedded PDF JS, themeable, search/zoom/print. Everything "visualizar" needs. |
| **Apryse WebViewer** / **PSPDFKit-Nutrient** | **Commercial, quote-based, typically four-to-five figures/yr** (per-dev or per-deployment; exact numbers are sales-gated — do **not** quote a fabricated figure to Wagner) | ✅ excellent | ✅ the whole point — annotation, redaction, forms, **measurement**, **watermarks**, **PDF editing** | 5–20 MB+ | **Deferred to the editor product (§8).** Massive overkill (and cost) for read-only preview. Justified *only* when Galaxie ships a real PDF **editor/annotator** as its own paid product — and even then, evaluate against pdf.js + a lighter annotation layer first. |

### 3.2 Recommendation

- **MVP (Slice 1):** **pdf.js**, view-only, scripting disabled. This is the entire PDF story for #178.
- **The paid SDKs are a *product* decision, not a *feature* decision.** If/when "Galaxie PDF" (annotate, sign, redact, measure — the Apryse/Nutrient feature set) becomes a product, that project runs its own build-vs-buy with real quotes. Flag it (§8); do not pre-purchase.
- **Do not** adopt WebView2-native PDF for the embed: it reintroduces the exact native-webview z-order/positioning tax the Navigator spec fights, with none of pdf.js's control.

### 3.3 pdf.js integration notes (concrete)

- Ship the **worker** (`pdf.worker`) as a local asset (Vite `?url` / bundled) — **no CDN** (offline + CSP + the "no external network for attachments" rule, §7).
- Render into a `<canvas>` **inside the sandboxed preview iframe** (or a locked-down React canvas host with CSP). Config: `isEvalSupported:false`, `enableScripting:false`, `enableXfa:false` (unless a form case appears), `disableAutoFetch`/`disableStream` acceptable since bytes are already local.
- Reuse the reader's **zoom** UX affordance and `prefers-reduced-motion`; page virtualization for large PDFs via the existing `@tanstack/react-virtual`.
- Dark mode: pdf.js has no native dark; either leave PDFs light-on-white (like the email baseline) or apply a CSS filter invert on the canvas as an opt-in — **do not** reuse Dark Reader here (it's DOM-only). Light baseline is the safe default.

---

## 4. Office (docx / xlsx / pptx) — render without Office installed

Three honest paths; the matrix (§9) picks per format.

### 4.1 Path A — client-side libraries (free, offline, instant, *approximate*)

| Format | Library | Licence | Fidelity | Notes |
| --- | --- | --- | --- | --- |
| **docx** | **`docx-preview`** (renders OOXML → HTML/CSS faithfully) *or* **`mammoth`** (docx → clean semantic HTML, drops complex layout) *or* **Plate `@platejs/docx-io`** (already installed) | MIT / BSD / MIT | docx-preview: good (keeps styles/tables/images). mammoth: medium (semantic, loses fine layout). Plate: good, and *editable-ready* | **Recommendation: `docx-preview` for read-only fidelity.** Render its HTML **into the sandboxed iframe** (it emits styled HTML — DOMPurify it first). Reserve Plate for the *edit* product (§8), don't couple preview to the editor. |
| **xlsx** | **SheetJS `xlsx`** (community build, Apache-2.0) | Apache-2.0 | Good for **data**; formatting/charts partial | Parse → cell matrix → render into a **`data-grid`** (`@tanstack/react-table` + `react-virtual`, **already installed**). Sheet tabs = shadcn `tabs`. **Values only, never eval formulas.** Large sheets virtualize for free. |
| **pptx** | (no strong free renderer) `pptxgenjs` is *generation*, not render; `pptx-preview`-class libs exist but fidelity is poor | mixed | **Weak** | **Do not promise client-side pptx.** Use Path C (Graph→PDF) for pptx, or fall back to thumbnail/"open externally" (§4.4, §9). |

Path A ships **fully offline**, which matters for a desktop tool, and is **instant** (no round-trip). Its ceiling is fidelity, worst for pptx.

### 4.2 Path B — headless LibreOffice conversion (rejected for MVP)

Bundle/spawn LibreOffice `--headless --convert-to pdf`. **Rejected:** ~300 MB+ dependency, install/packaging pain on a Tauri app, process-management + AV false-positives on Windows, slow cold start. Revisit only if fully-offline Office-grade fidelity becomes a hard requirement and the Graph path is unacceptable.

### 4.3 Path C — Microsoft Graph "convert to PDF" (recommended for fidelity) ✅

Graph converts drive-item Office files to PDF server-side: `GET /me/drive/items/{item-id}/content?format=pdf` (also supports jpg/html) returns a **real Office-rendered PDF** — the fidelity of Office itself.

**The clever part:** email attachments aren't drive items — but **we already upload files to OneDrive** (`cr_compartilhar_onedrive` → `/Bridge Anexos/`). So the flow is:

1. `cr_ler_anexo` (or reuse the upload) → PUT the attachment to a **temp** OneDrive location (e.g. `/Bridge Anexos/.preview/{uuid}.pptx`).
2. `GET …/content?format=pdf` → the rendered PDF bytes.
3. Render with the **pdf.js viewer we already built in Slice 1.**
4. **Delete the temp drive item** afterward (cleanup — `DELETE /me/drive/items/{id}`).

**Why it's strong:** Office-grade fidelity for *every* format, **one renderer** (pdf.js), **existing infra**, **no new Graph scope** (`Files.ReadWrite` already granted), **no 300 MB bundle**. **Trade-offs (be honest):** needs network; the attachment **leaves the app to the user's own tenant OneDrive** (their data, their tenant — but state it plainly in copy, use a hidden `.preview` folder, and **always clean up**); adds latency + a size ceiling (small `PUT` today is <4 MB per `cr_compartilhar_onedrive`'s own note — large files need an upload session, out of MVP scope).

### 4.4 The per-format call

- **docx:** Path A (`docx-preview`) for MVP — offline, fast, good enough. Path C available as a "Ver com fidelidade" toggle if a document renders poorly.
- **xlsx:** Path A (SheetJS → `data-grid`) — data is the point; grid is the right shape and already in-tree.
- **pptx:** **Path C (Graph→PDF)** from day one — client-side pptx isn't good enough to ship. If offline/network-blocked, degrade to **"Abrir externamente / Salvar"** with a clear reason.

---

## 5. `.msg` — Outlook message attachments

### 5.1 The type distinction (critical, and a real bug-in-waiting)

Graph exposes three attachment `@odata.type`s — today's code only understands the first:

| `@odata.type` | What it is | Today's `cr_baixar_anexo` | #178 handling |
| --- | --- | --- | --- |
| `#microsoft.graph.fileAttachment` | A real file (`contentBytes` base64) | ✅ works | PDF/Office/txt path |
| `#microsoft.graph.itemAttachment` | An **embedded Outlook item** (message / event / contact) — this is a "`.msg`" | ✗ **no `contentBytes` → fails today** | **§5.2** |
| `#microsoft.graph.referenceAttachment` | A **cloud link** (OneDrive/SharePoint), no bytes | ✗ fails today | Show as a link chip → open in Navigator / `webLink`; never download bytes |

Add `@odata.type` to the `$select` (§7.4) so the front branches correctly *before* fetching. A user forwarding an email as an attachment is common — this must not error.

### 5.2 Preview approach — reuse the reader, recursively

An `itemAttachment` message is fetched with `?$expand=microsoft.graph.itemAttachment/item` → you get a **nested `message`** with `subject`, `from`, `toRecipients`, `body`, and **its own `attachments`**. So `.msg` preview is **the reader we already have, pointed at the nested message**:

- **Header block:** De / Para / Assunto / Data — the same fields `EmailDetalhe` already carries.
- **Body:** the nested `body.content` through the **same `CorpoMensagem` sandboxed `srcDoc` pipeline** (DOMPurify, no scripts). Zero new rendering.
- **Nested attachments:** list them with the **same attachment strip** — and each can itself be previewed (recurse; cap depth to, say, 3 to bound hostile nesting).
- **True `.msg` files** (a `fileAttachment` whose name ends `.msg`, i.e. an uploaded CFB/OLE file, not an `itemAttachment`): parse with a lib — **JS `@kenjiuno/msgreader`** (MIT) or a **Rust `cfb`/`msg-parser`** crate — to extract headers/body/nested attachments, then feed the *same* reader surface. Rust-side parsing is cleaner (bytes already in Rust, keeps the OLE parser out of the renderer). Free either way.

**Net:** `.msg` is the *cheapest* high-value format because the reader is the renderer. The only real work is the type-branching and (for true `.msg` files) an OLE parser.

---

## 6. Where the preview appears

Reuse existing surfaces — both `sheet` and `resizable` are installed and already used in `control-room.tsx` / `bridge-settings.tsx`.

### 6.1 Two placements by weight

- **Inline (light formats): txt and small single-page PDFs** render **directly under the message body**, extending the current attachment strip. A chip's default click **expands an inline preview card** (collapsible), keeping the "peek" cheap. This mirrors how the body already lives inline.
- **Preview pane (heavy formats): docx / xlsx / pptx / multi-page PDF / .msg** open a **right-side `Resizable` panel** beside the reader on desktop (drag to resize, remembered width), or a **full-height `Sheet`** overlay on narrow windows (`md` and below) — the same responsive push pattern the People spec uses. **Never a separate OS window.**

```
┌ Sidebar ─┬──────────── Reader ────────────┬──── Preview pane (Resizable) ────┐
│ Mail●    │  Toolbar (Responder / …)       │  [proposta.pdf ▾]  ⤢ Salvar  ⧉ Abrir│
│ People   │  De · Assunto · Data           │  ┌─────────────────────────────┐   │
│ Agenda   │  ── body (srcDoc iframe) ──     │  │  pdf.js canvas / docx html  │   │
│          │  ── Anexos ──                   │  │  / xlsx data-grid / .msg     │   │
│          │  [▣ proposta.pdf ] [▣ plan.xlsx]│  │  reader                     │   │
│          │  [▣ fwd.msg ] [▧ link.docx]     │  └─────────────────────────────┘   │
└──────────┴────────────────────────────────┴──────────────────────────────────┘
```

### 6.2 Preview pane anatomy

- **Header:** file name + type `badge`, an attachment switcher (`dropdown-menu` when a mail has several — jump between them without closing), and the **actions** (§6.3).
- **Body:** the format renderer (pdf.js / docx-preview HTML / xlsx grid / `.msg` reader / `<pre>` for txt), always inside the sandbox boundary (§7).
- **Multi-page / multi-sheet nav:** pdf.js page rail / `tabs` for xlsx sheets — component, not custom chrome.

### 6.3 Actions per preview (view / save / edit)

| Action | Control | Behaviour | MVP? |
| --- | --- | --- | --- |
| **Visualizar** | (default, opening the pane) | Render read-only, sandboxed | ✅ |
| **Salvar** | `Download` button | `cr_baixar_anexo` → Downloads → toast (*Abrir* / *Abrir pasta*) — **today's flow, unchanged** | ✅ |
| **Salvar como…** | overflow | `@tauri-apps/plugin-dialog` save dialog → write via `plugin-fs` | Slice 1/2 |
| **Abrir no app do Windows** | overflow | `abrirCaminho` (explicit, user-initiated — the only OS-handler path) | ✅ |
| **Ver com fidelidade** | toggle (docx/pptx) | Switch Path A → Path C (Graph→PDF) | Slice 2/3 |
| **Editar** | — | **Not here.** Routes to / is reserved for the future editor product (§8) | ✗ (flagged) |

---

## 7. Security — attachments are untrusted input (the hard boundary)

Attachments come from anyone who can email the user. Treat **every byte as hostile**. The reader already gets this right for HTML bodies; previews inherit and tighten it.

### 7.1 Rendering sandbox

- **HTML-emitting renderers (docx-preview output, `.msg` body, txt-as-html):** `DOMPurify.sanitize(...)` → `<iframe srcDoc sandbox="allow-same-origin allow-popups">` — **the `CorpoMensagem` pattern, but WITHOUT `allow-scripts`.** The email body earns `allow-scripts` only in dark mode for Dark Reader; **attachment previews never do.** No embedded script from a document ever executes.
- **pdf.js:** `enableScripting:false`, `isEvalSupported:false`, `enableXfa:false`. Embedded PDF JavaScript (a real attack surface) is dead. Worker is a **local** asset, no CDN.
- **xlsx (SheetJS):** render **cell values as text only** — never evaluate formulas, never interpret `HYPERLINK`/HTML/`WEBSERVICE`. SheetJS parse options that avoid formula/HTML expansion.
- **No network from a preview.** Renderers get **local bytes** (`cr_ler_anexo`); remote images in a docx/`.msg` body follow the **same block-remote-content policy as the email body** (don't silently phone home — reuse whatever the reader does for tracking pixels). The one deliberate exception is **Path C**, which is an *explicit* upload to the *user's own* OneDrive, clearly labelled.

### 7.2 The OS-handler boundary

**Preview never invokes the OS file handler.** `abrirCaminho` (which runs the file in its native Windows app — full trust, no sandbox) stays a **separate, explicit, user-clicked** action, exactly as today. Rendering in-app must not, as a side effect, hand bytes to Excel/Acrobat/Word.

### 7.3 Path C data-egress note

Path C uploads the attachment to the user's tenant OneDrive. That's *their* data staying in *their* tenant — but it is still egress from "just viewing an email." Copy must state it ("Convertido via Microsoft 365 no seu OneDrive"), it uses a hidden `.preview` folder, and it **always deletes the temp item** after render (and on error). Path C is **opt-in per format** (default on for pptx, toggle for docx) — never a silent default for everything.

### 7.4 Backend additions (small, security-shaped)

- **`cr_ler_anexo(message_id, attachment_id, mailbox) -> { bytes_b64, content_type, name }`** — in-memory/temp read, **no Downloads write**. Handles `fileAttachment` (`contentBytes`) and, for large ones, `GET …/attachments/{id}/$value`. Keeps preview from polluting Downloads.
- **Extend the `attachments` `$select`** → `id,name,size,contentType,isInline,@odata.type` (today it's `id,name,size`). The front needs `contentType` + `@odata.type` to route (file vs item vs reference) and to pick a renderer **before** fetching bytes. Add `contentType` (+ optional `odataType`, `isInline`) to `AnexoEmail`.
- **Large-file guard:** a size cap (e.g. warn/►download-only above ~25 MB) surfaced as a state (§10). `contentBytes` inline has practical limits; huge files skip preview → save/open.
- **`.msg`/itemAttachment fetch:** a command (or a branch of `cr_email_corpo`) that `$expand`s `microsoft.graph.itemAttachment/item` and returns a nested `EmailDetalhe` for the reader.
- **Path C (later slice):** reuse/generalize `cr_compartilhar_onedrive` for the temp upload + a `cr_converter_pdf` (GET `?format=pdf`) + a `cr_apagar_drive_item` cleanup.

---

## 8. "Editar" — deliberately a separate product (Wagner's read, endorsed)

Wagner's instinct is right: **editing PDF/docx/spreadsheets is a product, not a preview feature.** Keeping it out of Bridge is the correct scope discipline. Recording the seam so it's a clean future hand-off:

- **PDF editing/annotation** = the Apryse/Nutrient feature set (annotate, redact, sign, **measure**, **watermark**, form-fill, page-edit). This is exactly what those **paid SDKs** sell and exactly why they cost four-to-five figures/yr. A **"Galaxie PDF"** product would run its own build-vs-buy: pdf.js + a DIY annotation layer + `pdf-lib` (already in-tree, *does* edit PDF structure) as the free-leaning option, vs. a paid SDK for the full suite. **Not Bridge, not #178.**
- **Docx editing** = we **already own the engine** (`platejs` + `@platejs/docx-io`, in `package.json`). A **"Galaxie Docs"**-style editor could import docx → Plate → edit → export docx. High leverage, but still its own product surface, its own issue set.
- **Spreadsheet editing** = SheetJS *community* is read-favoured; editing/writing well (formulas, formats) pushes toward SheetJS Pro or a grid product. Its own evaluation.
- **The Bridge seam:** the preview's **Editar** control, when those products exist, **routes out** (opens the file in the relevant Galaxie App) — Bridge never becomes an editor. In #178, **Editar is absent from the UI** (or a disabled "em breve" affordance), by design.

---

## 9. Format → renderer → cost → fidelity matrix

| Format | MVP renderer (recommended) | Lib / approach | Licence / cost | Fidelity | View | Save | Edit |
| --- | --- | --- | --- | --- | :--: | :--: | :--: |
| **txt** | inline `<pre>` in sandboxed iframe | native (decode + escape) | free | 1:1 | ✅ S1 | ✅ | →§8 |
| **PDF** | pdf.js canvas, scripting off | **pdf.js** (Apache-2.0) | **free** | high | ✅ S1 | ✅ | →§8 (paid SDK territory) |
| **docx** | HTML → sandboxed iframe | **docx-preview** (Path A); Path C toggle | free | good (A) / Office (C) | ✅ S2 | ✅ | →§8 (Plate in-tree) |
| **xlsx** | `data-grid` (values only) | **SheetJS** community → `@tanstack/react-table` | free (Apache-2.0) | good data / partial format | ✅ S2 | ✅ | →§8 |
| **pptx** | **Graph→PDF** → pdf.js | **Path C** (client pptx too weak) | free (uses granted `Files.ReadWrite`) | Office-grade | ✅ S3 | ✅ | →§8 |
| **.msg (itemAttachment)** | the **reader itself** (nested message) | `$expand` item → `CorpoMensagem` | free | 1:1 (it's mail) | ✅ S4 | n/a |
| **.msg (true file / CFB)** | reader, after parse | Rust `cfb`/`msg-parser` or JS `msgreader` (MIT) | free | high | ✅ S4 | n/a |
| **referenceAttachment** | link chip → Navigator / `webLink` | none (no bytes) | free | n/a | ✅ S4 | n/a |
| **(future) PDF annotate/redact/measure** | — | Apryse WebViewer / PSPDFKit-Nutrient | **paid, quote-based 4–5 figures/yr** | excellent | — | — | **§8 product** |

---

## 10. States

DOM overlays follow the reader's proven measurement/sandbox rules.

| State | Treatment | Component |
| --- | --- | --- |
| **Loading (fetch bytes)** | skeleton of the pane + spinner; keep chip responsive | `skeleton` + `Loader2` |
| **Loading (Path C convert)** | "Convertendo via Microsoft 365…" progress; cancelable | `alert`/inline + `spinner` |
| **Rendered** | the format renderer | pdf.js / iframe / `data-grid` |
| **Unsupported format** | "Não dá pra pré-visualizar `.xyz` aqui" + **Salvar** / **Abrir no Windows** | `alert` + `icon-tile` + `button` |
| **File too large** (> cap) | "Arquivo grande (N MB) — baixe para abrir" + **Salvar** | `alert` + `button` |
| **Corrupt / parse failed** | "Não foi possível ler o arquivo" + Salvar / Abrir externamente | `alert` (destructive) |
| **Password-protected** (PDF/Office) | prompt for password (pdf.js supports) or "protegido — abra externamente" | `dialog` / `alert` |
| **referenceAttachment** | "Este anexo é um link" → Abrir no Navigator | `alert` + `button` |
| **Offline + Path C needed (pptx)** | "Pré-visualização de PPTX precisa de conexão" → Salvar / Abrir | `alert` + `icon-tile` |
| **No permission** (Mail.Read / Files.ReadWrite for Path C) | explain the missing scope, route to existing consent flow (never silent) | `alert` + `icon-tile` |
| **Empty (no attachments)** | (attachment strip simply absent — today's behavior) | — |

---

## 11. Accessibility + theming

- **Keyboard:** attachment chips already focusable with `aria-label`. Preview pane is a focus region; `Esc` closes the `Sheet`/collapses inline; pdf.js page nav + xlsx grid are keyboard-navigable (`data-grid` gives arrow-key cells free). Attachment switcher is a proper `dropdown-menu`.
- **Screen readers:** each preview announces file name + type; the `.msg` reader exposes real heading structure (it's mail); grid uses table semantics; "unsupported/too-large" states are announced via `alert` roles.
- **State by text + icon, never colour alone** (type badges pair glyph + label) — the app's standing a11y rule (#172 §10).
- **Light/dark:** all chrome via Tailwind v4 tokens. **PDF/docx render on a light baseline** (like the email body baseline) — do **not** force Dark Reader onto document canvases; offer an opt-in invert for PDF only. xlsx grid uses the themed `data-grid`. Verify badge/muted contrast in dark (the standing checklist item).
- **Motion:** pane open = the app's existing transition; inline expand = a short height animation; all gated by `prefers-reduced-motion`.

---

## 12. Component map (UX element → component → notes)

| UX element | Component (exact) | Registry / install | Free? | Notes |
| --- | --- | --- | --- | --- |
| Preview pane (desktop) | **`resizable`** (`ResizablePanelGroup`) | shadcn — **installed & used** | ✅ | Right pane beside reader; remembered width |
| Preview overlay (narrow) | **`sheet`** | shadcn — **installed & used** | ✅ | Full-height push on `md`↓ |
| Inline preview (txt/small PDF) | **`collapsible`** on the attachment chip | shadcn | ✅ | Extends today's `det.anexos.map` strip |
| PDF renderer | **pdf.js** canvas in sandbox | `pdfjs-dist` (Apache-2.0) — **new dep** | ✅ | `enableScripting:false`; local worker |
| docx renderer | **docx-preview** → sanitized iframe | `docx-preview` — **new dep** | ✅ | DOMPurify its HTML; Plate reserved for edit |
| xlsx renderer | **`data-grid`** (`@tanstack/react-table` + `react-virtual`) | **installed**; parser `xlsx` (SheetJS) — **new dep** | ✅ | Values only; `tabs` for sheets |
| pptx renderer | pdf.js (via **Path C** Graph→PDF) | reuse pdf.js + Graph | ✅ | No good free client pptx |
| .msg renderer | **`CorpoMensagem`** (existing) on nested message | — (existing) | ✅ | Recursive; the reader *is* the renderer |
| true `.msg` parse | Rust `cfb`/`msg-parser` **or** `@kenjiuno/msgreader` | crate / npm — **new dep** | ✅ | Prefer Rust-side |
| HTML sanitize | **DOMPurify** | **installed** | ✅ | Same pipeline as the email body |
| Type badges / labels | **`badge`** | `@reui/badge` — confirmed | ✅ | Text + icon, not colour-only |
| Actions (Salvar / Abrir / switch) | **`dropdown-menu`**, **`button`**, **`tooltip`** | shadcn — installed | ✅ | Reuse today's toast (`Abrir` / `Abrir pasta`) |
| Sheet tabs (xlsx) / doc tabs | **`tabs`** | shadcn | ✅ | Sheet switcher |
| Errors / unsupported / too-large / no-perm | **`alert`** + **`icon-tile`** | `@reui/alert`, `@reui/icon-tile` | ✅ | Same visuals as #143/#172 |
| Loading | **`skeleton`**, `Loader2`, **`spinner`** | shadcn / lucide | ✅ | Pane skeleton + convert spinner |
| Save-as / open dialogs | `@tauri-apps/plugin-dialog` + `-fs` | **installed** | ✅ | "Salvar como…" |
| **Future** PDF editor/annotate | Apryse WebViewer / PSPDFKit-Nutrient | **paid, quote-based** | ❌ | **§8 — separate product, not #178** |

New dependencies for the MVP are all **free/OSS**: `pdfjs-dist`, `docx-preview`, `xlsx` (SheetJS community), and a `.msg`/OLE parser. Everything else is already in the tree. **No Pro-tier reui block required.** The only paid line item — a PDF SDK — is explicitly **out of scope** and belongs to a future product.

---

## 13. Incremental slicing (feeds PO sub-issues of #178 — ~3-issue cadence)

Each slice is independently shippable and demoable. Ordered by *value-per-effort*: the reader-adjacent, sandbox-reusing, no-network formats first; the network/fidelity ones later; the editor never (it leaves for another product).

**Slice 1 — Preview shell + PDF + TXT (the MVP).**
Backend `cr_ler_anexo` (in-memory read, no Downloads litter) + `contentType`/`@odata.type` in the attachment `$select` and `AnexoEmail`. Preview surface: inline-collapsible for txt/small-PDF, `Resizable` pane / `Sheet` for the rest. **pdf.js** viewer (scripting off, local worker) + **txt** `<pre>` in the strict sandbox. Wire **Salvar** (reuse `cr_baixar_anexo`) + **Abrir no Windows** (reuse `abrirCaminho`). Loading/unsupported/too-large/error/no-perm states. *Demo: open an email, click a PDF, read it without leaving Bridge.* **This ships the shell + the renderer every later slice plugs into.**

**Slice 2 — Office: docx + xlsx (client-side).**
**docx-preview** → sanitized iframe; **SheetJS** → **`data-grid`** with sheet `tabs`. Values-only, offline, instant. "Ver com fidelidade" toggle stub (lights up in S3). *Ships the two most-emailed Office formats, fully offline.*

**Slice 3 — pptx + high-fidelity Path C (Graph→PDF).**
Generalize `cr_compartilhar_onedrive` for a **temp `.preview` upload** + `cr_converter_pdf` (`?format=pdf`) + `cr_apagar_drive_item` cleanup → render through Slice 1's pdf.js. Default-on for **pptx**; toggle for docx that renders poorly. Egress copy + guaranteed cleanup (§7.3). *Ships Office-grade fidelity via one renderer, no LibreOffice bundle.*

**Slice 4 — `.msg` + reference attachments.**
Branch on `@odata.type`: **itemAttachment** → `$expand` nested message → the **existing reader** (recursive, depth-capped); **true `.msg` file** → Rust `cfb`/`msg-parser` → same reader; **referenceAttachment** → link chip → Navigator/`webLink`. Fixes the latent "forwarded-email attachment errors today" bug. *Ships the cheapest high-value format by reusing the reader.*

**Slice 5 — Polish + the editor seam (mostly NOT building).**
"Salvar como…" dialog, multi-attachment switcher, password-protected handling, per-format preferences, a11y/dark pass. **Editar stays out** — add at most a disabled "Editar (em breve)" affordance that documents the hand-off to the future **Galaxie PDF / Docs** products (§8). *Closes #178 as view+save; the paid-SDK/editor decision is explicitly deferred to a separate product with its own build-vs-buy.*

**Order rationale:** PDF+txt reuse the sandbox and touch no network → cheapest, and they build the shell everything reuses. docx/xlsx add free parsers, still offline. pptx needs the network/convert path, so it waits for that infra. `.msg` is cheap (the reader is the renderer) but needs the type-branching, so it rides after the file formats. Editing is never a slice: the correct, cost-honest design is *not building it here* — it graduates to its own Galaxie Apps product, where the paid-SDK question gets answered with real quotes, not pre-committed in an email preview.
