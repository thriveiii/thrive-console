# EDITOR_UNIFY_TRACE

READ-ONLY evidence for the Unified Operations Editor (`UNIFIED_EDITOR_DESIGN_SPEC.md`): one "New message"
entry, one centered window with a mode selector, one upload engine, the drawer retired. No code, no design
change. Every claim cited `file:line` on origin/main (`9ab80cf`). The live shell is `library/board.html`, built
by `buildBoard()` in `tools/bundle.js` (which inlines the six `tools/board-*.src.js` sources and holds the
drawer + card chrome inline).

Today there are THREE header entries (`tools/bundle.js:1676-1698`): New message (`#newMsgBtn` -> `openNewMessage`),
Upload campaign (`#uploadBtn` -> `openUpload`), Library (`#libBtn` -> `openLibraryView`); plus card-tap ->
`openDrawer`. The unify collapses these into one entry + one window + one upload engine.

---

## 1. NEW MESSAGE compose (Mode A source) - `tools/board-newmsg.src.js`

The editor as a standalone overlay `#nmScrim`/`#nmPanel`. End to end:

- **Open:** `openNewMessage()` (`:147-162`) closes any open card drawer and empties `#drawer` (so its
  `#edSubj/#edBody/#edPreview` cannot linger as duplicate ids, `:155-156`), mints a FRESH slug `nmNewSlug()`
  (`:157`, `:33-37`), clears the stored draft pointer (`:158`), then mounts `nmPanelHtml(slug,{})` and wires
  (`:161`). Always an empty compose.
- **Markup:** `nmPanelHtml(slug,data)` (`:73-84`) mounts, in order: `editorHtml(slug,row,{opp:{data}})` (the
  shared editor - subject `#edSubj`, body `#edBody`, signature `#edSig`, insert-link `#edLink`, checklist,
  exact-send preview `#edPreview`; `board-editor.src.js:113-147`), then `recipientHtml(...)` (the SAME `#recIn`
  field the drawer mounts, `:80`; `board-recipient.src.js:55-68`), then the Send button `#nmSend` (`:81`) and
  the status line `#nmStatus` (`:82`).
- **Nodes:** recipient `#recIn`; subject `#edSubj`; body `#edBody`; signature `#edSig` (+ "Use my signature"
  `#edSigFill`); send `#nmSend`; message preview `#edPreview`.
- **Send gate:** `sendReady(slug)` = subject AND body AND a valid recipient (`:91`); `sendApplyGate` toggles
  BOTH `#nmSend` and the drawer's board Send `#drawer .act[data-act="send"]` (`:92-96`). `nmTick` runs
  `edTick` (preview + checklist) then `sendApplyGate` (`:98`).
- **Exact-send preview:** `edRenderPreview(slug)` -> `edCompileFrom` -> `sendCompile` sets `#edPreview` srcdoc
  (`board-editor.src.js:170-175`) - byte-identical to what `runSend` POSTs.
- **Draft persistence:** `nmSaveNow` (`:108-129`) writes subject/body/signature/recipients to a lightweight
  `console_opps` row via `oppUpsert` (`:47-61`), debounced (`nmScheduleSave` `:100-103`); durable from the first
  character, resumed by tapping its board card, not the button. `closeNewMessage` (`:168-174`) flushes a pending
  save for a non-empty compose, drops an empty one.
- **Send:** `unifiedSend(slug)` (`:187-215`) - the ONE send path for both surfaces: gate on subject+body+
  recipient (`:190-191`), persist via `oppUpsert` (`:197`), `reloadBoardData` (`:199`), then the UNCHANGED L5
  `runSend(slug)` (`:204`); surfaces the result string in `#nmStatus` (`:206`). `sendMode` stays personal (no
  `data.source`).

## 2. UPLOAD CAMPAIGN (`upCommit` flow) - `tools/board-upload.src.js`

- **Open:** `openUpload()` (`:554-561`) mounts `upPanelHtml()` (`:543-551`) into `#upScrim`/`#upPanel`: a hint,
  a file input `#upFile` (`.zip,.html,.htm`), and `#upResult`.
- **Parse (shared):** `upOnFile` -> `upBuildPlan(files)` (`:213`). `upReadFiles` unzips (`upReadZip`
  `:49`/`upInflateRaw`), splits html PAGES from text; `upParseSections`/`upExtract`/`upEmailFrom` pull each
  message's subject/body/recipient email; pages become rows and are MATCHED to message units by token overlap
  `upRankTokens` with `bestScore >= 2` (`:249,252`); an unmatched page gets a `no_message` warning (`:261`), a
  duplicate slug a `dup_slug` warning (`:224`). NOTHING is written until approve (`:568`).
- **Review row:** `upResultHtml` (`:533-542`) -> `upRowHtml(r)` (`:522-532`): shows slug/title + warning chips,
  then the recipient email + subject as METADATA (`:526-528`), then the MESSAGE body as TEXT via `upFrame`
  (`:530`, `upFrame` `:510` = an escaped `<pre>`). **It does NOT render `r.page.html`** - no page iframe (the
  reported bug; F2 fixed only the Library review, not this one).
- **Commit:** `upApprove` (`:575-597`) -> `upCommit(plan)` (`:337-368`): per row, `oppUpsert` (a card, source
  "upload", recipients from `r.email` with the B2 suppression strip `:347`, a fresh `upNewCycle` `:355`), then
  `pageUpsert` (`:357`), then `pagePublishRelay(slug, withBeaconClient(html,cycle))` (`:360`). Commit-ok ->
  `ok++/published`; a timeout is treated as likely-landed success (`:363`); fail only on a real relay error
  (`:364`).
- **Publish-truth (F1):** `upApprove` runs `upActivateBackground(res.published)` (`:579`, `:380`) - a
  backing-off verify that stamps `live_verified_at` on ok; a miss leaves the drawer page section in the neutral
  `up_state_going_live` (never RED), per F1.
- **Recipients:** stored on the opp as `data.recipients` (from the matched message's email), suppressed
  addresses stripped (`:347`).

## 3. LIBRARY UPLOAD (`upCommitLibrary`) + Library browse - `tools/board-upload.src.js`

- **Add templates:** `openLibrary()` (`:693`) mounts the SAME upload panel; `libOnFile` (`:759-773`) runs the
  SAME `upBuildPlan` (`:762`, never forked) AND `libFetchPages()` for the existing slugs/tasks.
- **Review row:** `libResultHtml` (`:726-733`) -> `libRowHtml(r,i)` (`:706-722`): EDITABLE title `#libTitle-i`,
  slug `#libSlug-i`, task `#libTask-i` inputs, an inline error `#libErr-i`, and it **RENDERS the page** via
  `pageFrameIframe(r.page.html)` (`:720`, F2). Inline validation `libCollectRows` (`:738-758`): slug format
  `LIB_SLUG_RE`, duplicate-in-batch, and exists-in-Library `__libExisting` (`:748-750`).
- **Commit:** `libApprove` -> `upCommitLibrary(plan)` (`:784-808`): `pageUpsert(slug, html, {title,task})` ONLY
  (`:793`) - NO `oppUpsert`, NO recipients, NO card - then `pagePublishRelay` (`:794`). Commit-ok -> published;
  timeout -> confirming (`:799-800`). `libVerifyBackground` (`:812-819`) confirms live and upgrades the row;
  never downgrades (F1). Done panel `libDoneRowHtml` (`:828-848`) shows each template's live link + Copy/Open,
  or `lib_row_failed` for a genuine commit failure.
- **Browse (persistent Library surface `#libViewScrim`):** `openLibraryView`/`libRenderView`/`libRenderList`
  (`:900,907,1033`) group templates by task; `libCardHtml(p)` (`:1060-1078`) renders each card with a state
  chip (`libStateOf`/`libStateKey` `:1050-1052`, F1) and four controls: **Copy link** (`libCopyLink` `:858`),
  **Open page** (`libOpenPage` `:863`, opens the live URL), **Preview** (`libPreviewToggle` `:1088-1096`, reads
  `pageReadHtml` into an `.lv-frame` srcdoc iframe), **Promote** (`libPromoteToggle`/`libPromoteConfirm`
  `:1142,1160-1179`). Archive tab: `libArchLoad`/`libArchCardHtml`/`libRestore` (`:942,954,983`).
- **Promote to Operations:** `libPromoteConfirm(slug)` (`:1160-1179`) parses recipients (`parseAddrs`+`isEmail`,
  the SAME parser), mints a UNIQUE opp `slug + "-" + libShortId()` (`:1170`) with `published:true` +
  `data.page_slug` pointing at the shared template page, attaches recipients (`saveRecipients` `:1172`), and
  reloads. No `data.source` -> personal send shape (`:1105-1106`).
- **Duplicate handling:** at Library upload, `libCollectRows` blocks a slug that already exists
  (`__libExisting`, `lib_err_exists` `:750`) or repeats in-batch (`lib_err_dup` `:749`); promote mints a fresh
  unique opp slug each time (`:1170`), so a template fans out to many cards without collision.

## 4. DIFFERENCES between campaign upload (#2) and Library upload (#3) - the bug the one engine must unify

Both share the parser (`upBuildPlan`, `upOnFile:567` and `libOnFile:762`). They diverge everywhere after:

| Aspect | Campaign (`upRowHtml`/`upCommit`) | Library (`libRowHtml`/`upCommitLibrary`) |
| --- | --- | --- |
| Page render in review | NONE - message body as TEXT (`upFrame`, `:530`) | RENDERS page (`pageFrameIframe`, `:720`) |
| Editable fields | none (read-only rows) | title / slug / task inputs (`:710-715`) |
| Slug validation | none | format + dup-in-batch + exists-in-Library (`libCollectRows:748-750`) |
| Commit writes | `oppUpsert` + `pageUpsert` + publish (`:356-360`) | `pageUpsert` ONLY, no card (`:793`) |
| Recipients | stored on the opp, B2-stripped (`:347`) | none |
| Cycle | fresh `upNewCycle` per opp (`:355`) | none |
| Publish-truth surface | drawer page section `up_state_going_live` (`upActivateBackground:380`) | Done panel + Library chip (`libVerifyBackground:812`, `libStateOf:1050`) |
| Post-commit home | board CARDS (open drawer) | Done panel + persistent Library list (Preview/Promote) |

The core reported bug: the campaign review shows only metadata + message text and **no rendered page**, while
the Library review renders the page. One upload engine must (a) always render the page via `pageFrameIframe`,
(b) offer the same editable slug/title(/task) with validation, and (c) branch the COMMIT by mode (campaign =
card+recipients+cycle; library = page-only) rather than fork the whole review.

## 5. The DRAWER (to retire) - inline in `tools/bundle.js buildBoard`

- **Container + CSS:** `<div id="scrim" class="scrim"><div id="drawer" class="drawer" role="dialog">`
  (`:1176`); `.scrim{position:fixed;inset:0;justify-content:flex-end}` (`:989`, RTL flip `:991`),
  `.drawer{width:min(480px,100%);height:100%;border-inline-start...}` (`:992`) - the edge-pinned 480px panel.
- **Functions:** `drawerHtml(row,detail)` assembler (`:1872-1878`), `openDrawer(slug)` (`:1895-1912`, mounts +
  enriches via `fetchDetail`), `wireDrawer()` (`:1880-1894`), `closeDrawer()` (`:1913`), `refreshDrawer(slug)`
  (`:1922`).
- **Opened by:** every card tap - click + Enter/Space `openDrawer(slug)` (`:2113-2114`); `refreshDrawer` after
  a write; `libArchOpenHistory` (archive -> board drawer, `board-upload.src.js:976`); a promoted/graduated card
  is reopened by tapping it.
- **Sections it stacks** (`drawerHtml:1877`, in order): `numsHtml` (`:1761`) + `factsHtml` (`:1767`) +
  `archivedInfoHtml` -> OVERVIEW; `editorHtml` (message compose, `board-editor.src.js:113`) -> TEXT;
  `uploadActivateHtml` (page state + `#upPreview`, `board-upload.src.js:610`) -> PAGE; `recipientHtml`
  (`board-recipient.src.js:55`) + `actionsHtml` (stage moves / archive / Send, `:1832`) -> OUTREACH;
  `threadHtml` (`:1778`) + `recordHtml` (`:1799`) + `activityHtml` (`:1814`) -> HISTORY; `notesHtml` (`:1863`)
  -> DISCUSSION. The window must absorb ALL of these before the drawer is removed.

## 6. Shared mechanisms to REUSE (wire these, do not reinvent)

- **`pageFrameIframe(html)`** - `.lv-frame` srcdoc page preview (`board-upload.src.js:515`; CSS `bundle.js:1126`).
- **`#edPreview`** - exact-send MESSAGE preview via `edRenderPreview`/`sendCompile` (`board-editor.src.js:145,
  170-175`; CSS `iframe.ed-preview` `bundle.js:1165`).
- **`mergeFieldsInto`** - `{{LINK}}` + `{{ASSET_BASE}}` in the same compile step (`board-send.src.js:85`;
  tokens `MF_LINK`/`MF_ASSET` `:75`, `ASSET_BASE` `:81`, `assetBaseInto` `:84`, `liveUrl` `:33`).
- **Suppression guard (B2)** - `loadSuppressions`/`ensureSuppress`/`isSuppressed`/`suppressUnavailable`
  (`board-send.src.js:277,297,304,303`); `runSend` awaits `ensureSuppress` and filters (`:447,456`); `sendOne`
  chokepoint refuses a suppressed `art.to` (`:391`); upload strip `isSuppressed(r.email)` (`board-upload.src.js:347`).
- **Publish-truth states (F1)** - `uploadActivateHtml` `up_state_going_live` (`board-upload.src.js:610+`),
  `upActivateBackground`/`upReverify` (no RED on a miss), `libReverifyPending` (no "fault"), `libStateOf`
  (`:1050`).
- **`pageReadHtml(slug)`** - read stored `console_pages` html for a preview (`board-upload.src.js:426`).
- **`oppUpsert` / `pageUpsert` / `pagePublishRelay` / `runSend` / `sendCompile` / `parseAddrs` / `saveRecipients`**
  - the write + send + recipient primitives already shared by both paths.

---

## Capability -> current path -> target home in the new window

| Capability | Current path(s) | file:line | Target home |
| --- | --- | --- | --- |
| Compose subject/body/signature | `editorHtml` (`#edSubj/#edBody/#edSig`) | board-editor.src.js:129-142 | Mode A (message) - editor block |
| Insert opp link `{{LINK}}` | `#edLink` -> `edInsertLink` | board-editor.src.js:133,183 | Mode A - editor block |
| Recipient field + parser | `recipientHtml` `#recIn` / `parseAddrs` | board-recipient.src.js:55-68 | Mode A + promote |
| Exact-send message preview | `#edPreview` / `edRenderPreview` | board-editor.src.js:145,170 | window preview (message) |
| Send gate | `sendReady`/`sendApplyGate` | board-newmsg.src.js:91-96 | window (both modes) |
| Send | `unifiedSend` -> `runSend` | board-newmsg.src.js:187; board-send.src.js:429 | window Send (unchanged) |
| Draft persistence / resume | `nmSaveNow`/`oppUpsert`/`nmStore` | board-newmsg.src.js:108,47 | window (Mode A) |
| Zip parse + page/message match | `upBuildPlan`/`upRankTokens` | board-upload.src.js:213,249 | one upload engine |
| Upload review render (page) | `libRowHtml` renders; `upRowHtml` does NOT | board-upload.src.js:706-720; 522-530 | one upload review (always `pageFrameIframe`) |
| Editable slug/title/task + validate | `libRowHtml`/`libCollectRows` | board-upload.src.js:706-758 | one upload review |
| Commit campaign (card+recipients+cycle) | `upCommit` | board-upload.src.js:337-368 | upload engine, "campaign" branch |
| Commit library (page-only) | `upCommitLibrary` | board-upload.src.js:784-808 | upload engine, "library" branch |
| Publish-truth states | `upActivateBackground`/`libVerifyBackground`/`libStateOf` | board-upload.src.js:380,812,1050 | window page state (F1, reused) |
| Library browse / list | `libRenderList`/`libCardHtml` | board-upload.src.js:1033,1060 | Library tab/surface |
| Copy link / Open page | `libCopyLink`/`libOpenPage` | board-upload.src.js:858,863 | Library card + window page section |
| Page preview (on demand) | `libPreviewToggle`/`pageReadHtml` | board-upload.src.js:1088,426 | window + Library (reuse `pageFrameIframe`) |
| Promote to Operations | `libPromoteConfirm` | board-upload.src.js:1160 | Library card action |
| Archive / restore / history | `libArchLoad`/`libRestore`/`libArchOpenHistory` | board-upload.src.js:942,983,976 | Library archive tab -> window History |
| Opp overview (nums/facts) | `numsHtml`/`factsHtml` | bundle.js:1761,1767 | window Overview tab |
| Opp page state + `#upPreview` | `uploadActivateHtml` | board-upload.src.js:610 | window Page tab |
| Stage moves / archive / Send | `actionsHtml` | bundle.js:1832 | window Overview/Outreach |
| Reply thread / record / activity | `threadHtml`/`recordHtml`/`activityHtml` | bundle.js:1778,1799,1814 | window History tab |
| Internal notes | `notesHtml` | bundle.js:1863 | window Discussion tab |
| Card tap -> detail | `openDrawer` | bundle.js:1895,2113 | card tap -> window |

## Nothing-lost checklist (every capability in #1-#3 has a home)

- Compose (subject/body/signature/link/preview/gate/send/draft-resume) -> **Mode A** of the window (moves the
  existing editor + recipient nodes, keeps `unifiedSend`/`runSend`). KEEP.
- Zip parse + match -> **one upload engine** (the shared `upBuildPlan`). KEEP.
- Upload review: page render + editable slug/title/task + validation -> **one review** that ALWAYS renders the
  page (`pageFrameIframe`) and offers the edit/validate fields (today only Library has them). KEEP; the campaign
  side GAINS the page render + fields.
- Commit -> **one engine, mode-branched**: campaign = card + recipients + cycle (`upCommit`), library =
  page-only (`upCommitLibrary`). KEEP both outcomes.
- Publish-truth states (F1) -> reused at the window's page state. KEEP.
- Library browse + Copy/Open/Preview/Promote + archive/restore/history -> **Library tab/surface** in (or beside)
  the window. KEEP.
- Drawer opp sections (overview/text/page/outreach/history/notes) -> **window tabs** (Overview/Text/Page/
  Outreach/History/Discussion). KEEP; the drawer container/CSS/open-close-wire is RETIRED once the window hosts
  these.
- Consciously dropped: the RED `dead`/`fault` states (already retired by F1); the manual re-activate button
  (already removed); the drawer's edge-pinned `.drawer` chrome (replaced by the centered window). No compose,
  upload, publish, or Library CAPABILITY is dropped.

## Invariants' current sites (G1-G5 must preserve these)

- **B2 suppression (fail-closed):** `board-send.src.js` - `loadSuppressions:277`, `ensureSuppress:297`,
  `suppressUnavailable:303`, `isSuppressed:304`; `runSend` await+filter `:447,456`; `sendOne` chokepoint `:391`;
  upload strip `board-upload.src.js:347`.
- **F1 publish-truth:** `board-upload.src.js` - `uploadActivateHtml` `up_state_going_live` `:610+`;
  `upActivateBackground:380`; `upReverify:638`; `libReverifyPending:1004`; `libStateOf:1050`.
- **F2/F3 preview from held HTML:** `pageFrameIframe` `board-upload.src.js:515` (`.lv-frame` CSS
  `bundle.js:1126`); message preview `#edPreview` `board-editor.src.js:145,170` (CSS `bundle.js:1165`);
  `pageReadHtml:426`.
- **`{{ASSET_BASE}}` / `{{LINK}}`:** `board-send.src.js` - `mergeFieldsInto:85`, `MF_LINK/MF_ASSET:75`,
  `ASSET_BASE:81`, `assetBaseInto:84`; page publish resolves via `assetBaseInto` (`board-upload.src.js:351,791`).
