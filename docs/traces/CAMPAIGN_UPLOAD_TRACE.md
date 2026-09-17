# CAMPAIGN_UPLOAD_TRACE (G7-0)

Read-only trace. No code changed, no PR. Every claim below is cited by
`file:line` against `origin/main` at HEAD `b21bd97` (#310, G4.5). Note: #311
(G5, the flip that moves "Upload campaign" off the header nav) is NOT merged
here, so on this HEAD the standalone full-campaign overlay is still reachable
from the header. That matters for path 1 below.

The question this answers: uploading a FULL campaign zip (many pages) in the
Unified window, Mode B, Page tab, showed only ONE page. Why.

Short answer: the Mode B Page tab does NOT run the full-campaign path. It runs
a single-page path. It calls the shared multi-page parser `upBuildPlan`, then
throws away every page but the first, holds a one-row plan, and commits that
one row. The genuine multi-page path (`upBuildPlan` -> `upApprove` ->
`upCommit`) lives in a SEPARATE overlay that the window does not open.

---

## 1. The three paths today (function -> reachable from Mode B Page tab -> file:line)

| Path | Entry -> engine | In Mode B Page tab? | Pages committed | Cite |
| --- | --- | --- | --- | --- |
| A. FULL CAMPAIGN (multi-page zip: all pages) | header "Upload campaign" button -> `openUpload` -> `upOnFile` -> `upBuildPlan` -> `upApprove` -> `upCommit` | NO. Standalone overlay `#upScrim`, opened only from the header nav, never mounted in the window | ALL rows (`upCommit` iterates `plan.rows` via `one(i)`) | nav button `bundle.js:1771`, wired `bundle.js:1790`; `openUpload` `board-upload.src.js:554`; `upOnFile` `:564`; `upApprove` `:575`; `upCommit` `:337` (loop `:339`) |
| B. BARE PAGE + manual message (upload) | Page tab "Upload page" -> `owPageOnFile` -> `owPageSetReview` -> `owCommitCampaign` | YES (the tab's upload control) | ONE (first html row only; see section 2) | `owPageMount` `board-upload.src.js:1254`; file input wired `:1267`; `owPageOnFile` `:1214`; `owPageSetReview` `:1203`; `owCommitCampaign` `:1278` |
| C. PICK LIBRARY TEMPLATE | Page tab "Pick page" -> `owPagePickList` -> `owPagePick` -> `owPageSetReview` -> `owCommitCampaign` | YES (the tab's pick control) | ONE (one template's html copied to this opp slug) | pick button wired `bundle.js`/`board-upload.src.js:1268`; `owPagePickList` `:1226`; `owPagePick` `:1243` (reads html via `pageReadHtml` `:426`); `owPageSetReview` `:1203` |

Reachability summary of the Page tab: `owPageMount` (`board-upload.src.js:1254`)
renders exactly two controls, "Upload page" (`owPageFile`, `:1258`) and "Pick
page" (`owPickBtn`, `:1259`). So the window's Page tab offers B and C. It does
NOT offer A. Path A is only reachable from the header "Upload campaign" nav
entry (`bundle.js:1771`, `:1790`), a wholly separate overlay.

So a full campaign zip dropped into the Page tab is fed to path B, and path B
is single-page by construction.

---

## 2. Why one page showed (the exact mis-wire + the call site to change)

The Page tab DOES call the full multi-page parser. It then discards the rest.

`owPageOnFile(files)` (`board-upload.src.js:1214`):

```
Promise.all([ upBuildPlan(files), owPageLoadExisting() ]).then(function(a){
  var plan=a[0], rows=(plan&&plan.rows)||[];
  var pageRow=null; for(var i=0;i<rows.length;i++){ if(rows[i] && rows[i].page && rows[i].page.html){ pageRow=rows[i]; break; } }
  if(!pageRow){ owPageStatus(t("up_no_html"), "bad"); return; }
  owPageSetReview({ slug:__owSlug, title:pageRow.title||"", task:pageRow.task||"", page:pageRow.page });
```

`upBuildPlan` returns `{ rows: [...] }`, one row per html page in the zip
(`board-upload.src.js:266`, built at `:221`). Line `:1219` loops and keeps only
the FIRST row whose `page.html` is set (`break`), and line `:1221` passes that
single row on.

`owPageSetReview(row)` (`:1203`) then hard-codes a one-row plan:

```
__upPlan = { rows:[row] };          // board-upload.src.js:1205
```

`owCommitCampaign(slug)` (`:1278`) reads only the first row of that plan:

```
var rows=(__upPlan&&__upPlan.rows)||[]; var pr=rows[0];   // board-upload.src.js:1282
```

and commits that one page (`oppUpsert` + `pageUpsert` + `pagePublishRelay` on
`pr` alone, `:1292`-`:1294`). The Preview tab's page view repeats the same
one-row read: `var pr = (__upPlan && __upPlan.rows || [])[0];` (`bundle.js:2119`).

THE MIS-WIRE, precisely:
- Call site 1: `board-upload.src.js:1219`-`:1221` (`owPageOnFile`) collapses the
  multi-row `upBuildPlan` plan to a single `pageRow`.
- Call site 2: `board-upload.src.js:1205` (`owPageSetReview`) stores `{rows:[row]}`,
  a one-row plan, as the single review model shared by everything downstream.
- Call site 3: `board-upload.src.js:1282` (`owCommitCampaign`) commits `rows[0]`
  only, never iterating.

What it SHOULD call instead (for G7, evidence only, not done here): the
window already has a correct multi-page reference on the same file. The
standalone path holds the WHOLE plan (`upOnFile` sets `__upPlan = plan;`
unmodified, `:568`), renders every row (`upResultHtml` maps `plan.rows`, `:534`;
Library's `libResultHtml`/`libRowHtml` do the same per-row with editable
slug/title/task, `:706`), and commits every row (`upCommit` loops `plan.rows`,
`:339`; `upCommitLibrary` likewise, `:786`). G7 should have the Page tab keep
the full `upBuildPlan` plan (as `upOnFile` does), render all page rows in the
review (as `upResultHtml`/`libRowHtml` do), and have `owCommitCampaign` iterate
all rows (as `upCommit` does) rather than reading `rows[0]`. No new parser and
no new commit primitive are needed; the multi-page render and commit already
exist and are reused verbatim by paths A and Library.

---

## 3. The zip's real structure (what upBuildPlan reads)

`upReadZip` (`board-upload.src.js:49`) is a hand-rolled ZIP reader (central
directory at EOCD, per-entry local header, `method 0` stored or `method 8`
deflate via `DecompressionStream`). It keeps only entries matching
`\.(html?|md|txt|json)$` and skips directories, dotfiles, and anything else
(`:63`-`:64`). `upReadFiles` (`:75`) classifies each kept entry: `.html`/`.htm`
-> `pages`, `.md`/`.txt`/`.json` -> `texts`, everything else -> ignored
(`:83`-`:86`). A bare `.html`/`.htm` file dropped directly (not zipped) is a
single page (`:91`).

`upBuildPlan` (`:213`) then builds the plan:
- Each html page becomes one ROW, keyed by a slug derived from the file/folder
  name via `upPageSlug` (`:104`, folder wins for `index/page/opp/...` filenames).
  A second page with the same slug is flagged `dup_slug` (`:223`-`:224`).
- Every text file is parsed into message UNITS. Two shapes are auto-detected:
  1. A CONSOLIDATED file (one file, many opportunities): `upParseSections`
     (`:175`) splits on numbered headings ("## 2) Business Name - City, ST",
     `:180`, `:184`) or the shallowest heading level; each section yields a unit
     with its recipient ("Send to:" line -> `upEmailFrom`, `:194`/`:131`),
     subject ("Subject:" -> `:195`), and body (the first fenced code block ->
     `upFenceBody`, `:197`/`:168`). This is the device-proven BATCH13 shape
     (`:152`-`:159`).
  2. A PER-PAGE file (one message per file): `upExtract` (`:139`) reads
     Subject/first-heading + body + one bare email; it becomes a unit only if it
     carries a recipient email (`:237`).
- Pages are then MATCHED to units by normalized-token similarity: `upNormTokens`
  (`:112`) + `upRankTokens` (`:113`), best score wins, threshold `>= 2` (`:252`).
  A matched row takes the unit's subject/body/email/title (`:254`-`:255`); an
  unmatched row is flagged `no_message` (`:261`). A suppressed recipient is
  flagged `suppressed` (`:258`, B2). Units that match no page are silently
  ignored, per AXIOM 3 (`:264`-`:265`).

So the page <-> message <-> recipient pairing is: html file -> slug -> best
matching message section -> that section's subject/body/recipient email. A full
campaign is inherently a LIST of such rows. `upBuildPlan` returns
`{ rows: [...] }` (`:266`) - a list, never a single record. The single-record
behavior is imposed downstream, only on the Page tab, at the call sites in
section 2.

---

## 4. Render + commit for a multi-page plan

Render: each row previews from its held html as a sandboxed srcdoc iframe via
`pageFrameIframe` (`board-upload.src.js:515`), the same mechanism the editor
preview and Library use. The standalone path renders EVERY row
(`upResultHtml` maps `plan.rows`, `:534`; Library `libRowHtml` per row with
editable fields, `:706`). The Page tab's shared review component (`owPageSetReview`,
`:1207`) renders exactly one row (`libRowHtml(row, 0)`), because it was handed a
one-row plan.

Commit: `upCommit(plan)` (`:337`) handles N pages. Its inner `one(i)` recurses
over `rows` (`:339`), deduping by slug (`:342`), writing `oppUpsert` +
`pageUpsert` + `pagePublishRelay` per row (`:356`-`:360`), and returns per-row
ok/fail counts (`:340`). So the multi-page commit already exists and works.
`owCommitCampaign` (`:1278`) does NOT use it; it reads `rows[0]` (`:1282`) and
merges the one campaign into the opp's existing data (to preserve interactive
compose, `:1289`-`:1290`) with a single `pageUpsert`/`pagePublishRelay`
(`:1293`-`:1294`). It is a single-row committer by construction.

Net: the render primitive (`pageFrameIframe`) and the multi-row commit engine
(`upCommit`) both handle N pages today. Only the Mode B Page tab wrapper
(`owPageOnFile` / `owPageSetReview` / `owCommitCampaign`) is single-row.

---

## 5. Library template memory (note for G8)

There is no per-template usage or recipient memory stored on a template.
`console_pages` columns are `slug, html, up, updated_at, live_verified_at`
plus PR-L1's `title, task, tags` (`board-upload.src.js:273`-`:280`,
`:892`). None records who used a template, when, or to whom it was sent. The
only self-memory on a template row is `live_verified_at`, the liveness stamp
(`pageStampLive` `:308`; called out as "self-memory" in
`card_fate_test.py:233`).

The only link from a campaign to a template is one-directional and lives on the
CARD, not the template: `console_opps.data.page_slug` points at the shared page
slug when a card was promoted from a template (`board-editor.src.js:90`-`:92`,
`edPageSlug`). To answer "which campaigns/recipients used template X" for G8,
you would have to scan `console_opps` for `data.page_slug === X`; the template
row itself holds no back-reference and no counter. If G8 wants template usage or
recipient memory, it needs a new column or table; nothing records it today.

---

## Deliverable summary

- Mode B Page tab wires paths B (upload single page) and C (pick library
  template). It does NOT wire path A (full multi-page campaign); path A is a
  separate header overlay (`openUpload`, still on the nav at this HEAD).
- One page showed because `owPageOnFile` (`board-upload.src.js:1219`-`:1221`)
  keeps only the first html row of the full `upBuildPlan` plan, `owPageSetReview`
  (`:1205`) stores it as a one-row plan, and `owCommitCampaign` (`:1282`) commits
  `rows[0]` only. Fix target: keep the whole plan and iterate, reusing the
  existing `upResultHtml`/`libRowHtml` render and the `upCommit` multi-row loop.
- A campaign zip is a LIST: html pages paired to message sections (recipient +
  subject + body) by token similarity; `upBuildPlan` returns `{rows:[...]}`.
- No template usage/recipient memory exists; only `live_verified_at` self-memory
  and the card-side `data.page_slug` back-link. G8 would need new storage.
