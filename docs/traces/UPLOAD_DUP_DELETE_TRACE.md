# UPLOAD_DUP_DELETE_TRACE

Read-only trace (the fix follows in the same branch). Every claim is cited
`file:line` against `origin/main` before the fix, and the duplicate-slug behavior
was confirmed empirically (a probe that uploads a 2-folder campaign whose slugs
already exist and commits it: `OPP_POSTS = []`, `PAGE_POSTS = []`).

## BUG 1: a duplicate page slug drops the message (no card, or an overwrite)

"This link name is already taken" is the client-side validation message
`lib_err_exists` set by `libCollectRows` (`tools/board-upload.src.js:773`) when the
slug is in `__libExisting` (the set of console_pages slugs already taken,
loaded by `owPageLoadExisting`/`libFetchPages`).

There are three commit paths and none preserves the message under a free slug:

1. Window Full-campaign - `owCommitCampaignAll` (`board-upload.src.js:1410`). It
   gates on the validator: `var v=libCollectRows(); if(!v.ok){ owCommitStatus(t("lib_fix_rows")); return; }`
   (`:1414`). A single taken (or in-batch duplicate) slug makes `libCollectRows`
   return `ok:false` (`:773`, `:778`), so the WHOLE batch is refused and NOTHING
   is written. Empirically: uploading a 2-folder campaign whose both slugs exist
   yields `OPP_POSTS = []`, `PAGE_POSTS = []`, status "Fix the highlighted fields
   first." The message + recipient are stuck; there is no auto-suffix, no
   update-in-place, and no per-row skip - the operator cannot commit the campaign
   at all.
2. Window single page / pick-template - `owCommitCampaign` (`:1377`), same gate at
   `:1384`. Same total block on a taken typed slug.
3. Standalone upload overlay - `openUpload -> upApprove -> upCommit` (`:360`), a
   test seam that lost its nav entry at G5. It has NO existence guard:
   `pageUpsert` (`:304`) posts with `Prefer: resolution=merge-duplicates` (`:313`),
   so a duplicate slug UPDATES (overwrites) the existing console_pages row in
   place, and `oppUpsert` overwrites the card. This never rejects, so it does not
   drop the message - but it silently clobbers whatever page previously held that
   slug (an unrelated template with the same name is overwritten with no warning).

So "the card is created but the page and its message drop, leaving an empty card"
is the union of these: the window paths refuse the whole commit (the operator is
walled off and the message is stuck), and the standalone path silently overwrites.
Neither renames to a free slug to keep the message, which is the fix.

Note on `upCommit`'s per-row chain (`:379`-`:389`): `oppUpsert(...).then(pageUpsert).then(publish, onReject)`.
The single `onReject` at `:389` catches a rejection from EITHER `oppUpsert` OR
`pageUpsert`, so IF `pageUpsert` could reject after `oppUpsert` succeeded, the card
would exist with no page (a true empty card). It does not reject on a duplicate
today (merge-duplicates upserts), but the shape is one server-side page failure
away from an empty card - another reason the commit must resolve the slug up front.

### The send guard is too weak (a card with an empty body can send)

`runSend` (`tools/board-send.src.js:429`) guards at `:439`:
`if(!(data && (String(data.outreach_text||"").trim() || String(data.outreach_subject||"").trim())))`
- it requires a subject OR a body. So a card that has a subject but an EMPTY BODY
passes and ships a hosted page with no message body. The interactive compose gate
`sendReady` (`tools/board-newmsg.src.js:146`) already requires BOTH subject AND
body AND a recipient; `runSend` should match it.

## BUG 2: Library page cards have no Delete

`libCardHtml` (`tools/board-upload.src.js:1083`) renders four actions - Copy link
(`:1091`), Open page (`:1092`), Preview (`:1093`), Promote (`:1094`) - and NO
Delete. `libViewWireCards` (`:1102`) wires exactly those four. There is no
console_pages delete anywhere in `board-upload.src.js`, so a mistaken or stale
template is stuck in the Library forever.

A reusable delete path already exists in the board shell: `restDelete(path)`
(`tools/bundle.js:2210`), a bounded DELETE with one refresh-retry, and the card
delete `oppDelete` (`:2227`) already deletes a `console_pages` row
(`restDelete("console_pages?slug=eq."+...)`, `:2232`) when a card owns its page.
The DB grant that permits it is `docs/supabase-opp-delete.sql`. `restDelete` is a
hoisted function in the same `buildBoard` IIFE the Library code is inlined into, so
it is directly callable - a Library delete is `restDelete("console_pages?slug=eq.<slug>")`,
bounded to that one page, touching no opp/card and no ledger row.

## The fix (this branch)

- BUG 1: `libCollectRows(autoSuffix)` - the campaign commit paths pass `true`, so a
  TAKEN slug is renamed to the next free one (`upFreeSlug`, e.g. bards-alley-2)
  with a visible info note, and the page + its message + recipient commit under
  that free slug. No card is ever empty; the pre-existing page is untouched. A bad
  FORMAT still blocks (a real input error). The Library upload keeps `autoSuffix`
  off, so a hand-named page still surfaces "already taken" to rename. And `runSend`
  now requires BOTH a subject AND a body, so an empty-body card can never send.
- BUG 2: a two-tap Delete on each Library card (`libDeleteToggle`/`libDoDelete`)
  that calls `restDelete("console_pages?slug=eq.<slug>")` and drops the row from the
  list - only that one page, nothing else.
