# CAMPAIGN_COMMIT_TRACE

End-to-end trace of the full-campaign commit, with the fix in the same branch.
Cited `file:line` against `origin/main`, and the write path was confirmed by a
probe that drives the REAL window Full-campaign commit and dumps the exact
`console_opps` bodies + reopens a committed card.

## The headline (proven, not asserted)

On current `main`, board.html's full-campaign commit DOES write the message.
The probe committed a 4-folder campaign and captured, for every card:

```
slug=bards-alley  outreach_subject='The Del Ray opening'  outreach_text (len 128)  recipients=[{addr: contact@bards-alley.com,...}]  source=upload
slug=clay-cafe    outreach_subject='Your studio online'   outreach_text (len 124)  recipients=[{addr: hello@clay-cafe.example,...}]
slug=rise-dance   outreach_subject='Easier booking'       outreach_text (len 127)  recipients=[{addr: front@rise-dance.example,...}]
slug=gov-rfp      outreach_subject='RFP follow-up'        outreach_text (len 116)  recipients=[{addr: proc@agency.example,...}]
```

and reopening a committed card loads its subject + body + recipient back into
compose. So the board.html commit is NOT dropping the message today.

## 1. What the campaign commit writes, per row (owCommitCampaignAll -> upCommit)

`owCommitCampaignAll` (`tools/board-upload.src.js:1471`) validates
(`libCollectRows`, `:1475`) then calls `upCommit(plan)` (`:1477`). `upCommit`
(`:360`) builds, per row (`:367`-`:370`):

```
var data = { source:"upload", page_title:r.title,
  outreach_subject:r.subject || "", outreach_text:r.body || "",
  recipients: (r.email && !isSuppressed(r.email)) ? [{ addr:r.email, name:"", lang:"en" }] : [] };
```

and writes it with `oppUpsert(r.slug, { business:r.title||r.slug, data:data, up, cycle })`
(`:379`), then `pageUpsert(r.slug, html)` (`:380`), then `pagePublishRelay` (`:383`).
So the opp write DOES carry `outreach_subject` (= r.subject), `outreach_text`
(= r.body), and `recipients` (= r.email). The values come from the plan row,
which the parser/pairing populated.

## 2. Field-by-field: Mode A vs the campaign commit

A hand-composed Mode A message writes via `nmSaveNow`
(`tools/board-newmsg.src.js:163`), at `:172`-`:173`:

```
var next = Object.assign({}, data, { outreach_subject:subj, outreach_text:body, sig:sig, recipients:recips });
oppUpsert(slug, { business:nmBusiness(subj), data:next, up });
```

Both go through the SAME `oppUpsert` (`board-newmsg.src.js:47`, merge-duplicates
upsert). Field by field:

| data field         | Mode A (nmSaveNow)      | campaign (upCommit)                 | same? |
| ------------------ | ----------------------- | ----------------------------------- | ----- |
| outreach_subject   | subj (#edSubj)          | r.subject                           | YES   |
| outreach_text      | body (#edBody)          | r.body                              | YES   |
| recipients         | sendToList()            | [{addr:r.email,name:"",lang:"en"}]  | YES   |
| sig                | edSignature()           | (not written)                       | NO    |
| source / page_title| (absent)                | "upload" / r.title                  | extra |
| data merge         | Object.assign(existing) | fresh object (replace)              | NO    |

So the message fields the detail/compose view reads - `outreach_subject`,
`outreach_text`, `recipients` (editorHtml `board-editor.src.js:120`-`:121`,
Recipients tab reads `data.recipients`) - are written IDENTICALLY by both paths.
The only differences: the campaign path omits `sig` and replaces (not merges)
the data. Neither drops subject/body/recipient. The `sig` omission is correct
for a campaign - the zip .md is the complete message, so appending the operator's
signature would double-sign.

## 3. Where the body goes (the exact line)

The zip .md is parsed into a unit `{subject, body, email}` (`upExtract`
`board-upload.src.js:139`; email via `upEmailFrom` `:131`). `upBuildPlan` attaches
it to the page row - by SHARED FOLDER (`board-upload.src.js`, the FOLDER-FIRST
pass) or the token ranker - setting `r.subject = u.subject; r.body = u.body;
r.email = u.email;`. At commit, `r.body` is written at `upCommit:368`
(`outreach_text:r.body || ""`). That is the body-write; reverting it to `""` is
the fails-when-broken lever, and the test confirms every card loses its body.

## The real root of the LIVE "empty card, page present"

The commit writes `outreach_text:r.body || ""` - so if the row's message never
ATTACHED (`r.subject`/`r.body`/`r.email` empty), the commit writes an EMPTY
message but STILL writes the page (`pageUpsert`/`pagePublishRelay` run
regardless): a card with a page and no message. That is exactly the reported
symptom. Two causes, both addressed:

1. The message not attaching was the ZIP_MESSAGE pairing bug (a per-folder .md
   whose heading/filename drifts from the folder never paired). That is fixed on
   `main` by the shared-folder pairing (docs/traces/ZIP_MESSAGE_TRACE.md). With
   it, a per-folder message attaches, so the commit writes it - proven above. A
   LIVE console still showing empty cards is running a build from before that
   pairing fix was deployed.
2. `upCommit` had NO guard against writing a page-bearing card with an empty
   message - so any row that fails to pair (or a folder that genuinely has a
   page but no .md) commits a silent empty card. That is the residual defect this
   branch closes.

## The fix (this branch)

- NO EMPTY CARDS, EVER: `upCommit` now skips a row whose message is empty (no
  subject AND no body), counts it `incomplete`, and returns the names;
  `owCommitCampaignAll` reports "N had no message and were not imported: ..."
  (`ow_no_msg_n`). A page with no message is never written as an empty card and
  never silently dropped.
- The message write stays the full Mode A shape (subject + body + recipients);
  `sig` stays omitted by design (the zip .md is the complete message).

## Test (fails-when-broken)

`tools/campaign_commit_message_test.py`: imports a 4-message-folder campaign (each
.md opens with a heading that MISMATCHES its folder, so only the pairing can
attach it) plus a 5th page-only folder, and asserts:
- every one of the 4 cards has `data.outreach_subject` AND `data.outreach_text`
  AND `data.recipients` on the opp (not just the page), with the right recipient;
- reopening a committed card loads its subject + body + recipient into compose;
- the page-only folder is NOT written as an empty card, and the status names it.
Proven fails-when-broken by (a) reverting the body-write (`outreach_text:""`) so
all 4 body assertions fail, and (b) removing the guard so the message-less folder
commits an empty card.
