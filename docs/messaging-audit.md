# Messaging operations audit

An end-to-end read of the messaging spine against Thyab's asks: flexible group/individual sending of
templates, campaigns and plain messages; durable save-and-return for threads and discussions; the ability
to classify them and forward them by email. Every row is evidenced with `library/app.js` line references
(verified against the tree this PR branches from). One small gap is closed here; the larger ones carry a
proposal and wait for ratification.

## Capability matrix

### Sending

| Capability | Status | Evidence |
|---|---|---|
| Individual send WITH a template | **VERIFIED** | template `#etpl` select (`compose.html:39`) → `applyTemplate` (`app.js:4840`); tokens `{{NAME}}{{BIZ}}{{LINK}}{{MONTH}}` via `mergeFieldsText/Html` (`app.js:3904/3911`) + live `resolveTokens` (`app.js:5067`); send `#eSend` → `relaySend` (`app.js:5412`) |
| Individual PLAIN send (no template) | **VERIFIED** | explicit "no template" option `plainOpt.value=""` (`app.js:4861`), `currentTpl()` returns null (`app.js:4830`), editor opens blank (`app.js:4878`); free text sends through the same path |
| Group campaign with a template (one action → many) | **GAP-LARGE** | no multi-recipient input in `compose.html`; `relaySend` has three call sites only (def + thread reply + one composer send), no send loop over recipients; a "group" is a read-only aggregation of individual sends (`campaignRecipients` `app.js:691`, `isGroupOpp` `app.js:702`) |
| Per-recipient personalization in a group send | **GAP-LARGE** | the logic exists but is unwired: `renderPersonalized` (`app.js:831`), `groupSendPlan` (`app.js:840`), `renderGroupReviewInto` (`app.js:1080`) have no caller and never run |
| Resend / follow-up on an existing opportunity | **VERIFIED (small gap closed here)** | re-open composer via `goTo("compose","slug=…")` (`app.js:7264/7273`), stock nudge template `opp-nudge`/`opp-nudge-ar` (`app.js:3833/3835`), follow-up filter/flag (`needsFollowup` `app.js:1137`, pills `app.js:2764`). Small gap: no one-tap button. **Closed in this PR** (below) |
| Arabic and English templates | **VERIFIED** | `docLang` (`app.js:7387`), `signatureFor("AR"/"EN")` (`app.js:3762`), template list filtered to the opportunity/UI locale (`app.js:4874`), per-recipient `lang` carried on the roster (`app.js:696`) |

### Threads and discussion persistence

| Capability | Status | Evidence |
|---|---|---|
| Thread survives sign-out/in and device change | **VERIFIED** | `supaHydrate` reads `console_mail`/`console_inbound` into `__supa.mail/inbound` (`app.js:2498/2500`); writes mirror through the Stage-4 queue `supaMirrorMail`/`supaMirrorInbound` (`app.js:2296/2328`); reads prefer Supabase (`getMailLog` `app.js:3926`, `getInbound` `app.js:1502`) |
| Held / matched reply states persist | **VERIFIED** | held replies live in `console_inbound`; `rematchHeld` writes results back and mirrors (`app.js:1623`, `setInbound`→`supaMirrorInbound` `app.js:1503`) |
| Comments / discussion persist | **VERIFIED** | `console_comments` hydrates (`app.js:2508`) and queues (`supaMirrorComment` `app.js:2312`) |
| Returning lands where you left | **VERIFIED (with a named limit)** | board scroll saved/restored across the card window (`app.js:9127/9134`); a card opens scrolled to its newest unseen item (`cardNewTarget` `app.js:870`, `scrollIntoView` `app.js:9153`). **Limit:** the seen/last-opened memory (`thrive_card_seen_v1` `app.js:850`) is device-local by design (not in `SYNCED_KEYS`), and there is no saved intra-thread scroll offset. This is an existing, deliberate choice, not a regression; left as-is |

### Classification

| Capability | Status | Evidence |
|---|---|---|
| Label / tag / group a thread or opportunity for retrieval (beyond lanes) | **GAP-LARGE** | no tag/label/category/folder/star/pin field on a record; the record schema (`record()` `app.js:3162`) carries no free-text label. Only retrieval affordances: pipeline `stage` filter, `status` (active/archived/followup), `template` filter, and a text search over business/location/template/slug (`initDashboard` `app.js:2722`, matcher `app.js:2751`) |

### Forwarding

| Capability | Status | Evidence |
|---|---|---|
| Forward a thread or message to an arbitrary email (e.g. a colleague) | **GAP-LARGE** | no forward/cc/bcc/share-by-email control anywhere; `compose.html` has a single `To`. The transport `relaySend` (`app.js:4479`) reads `to` from the intent unrestricted (`app.js:4483/4502`) so it *could* carry an arbitrary address, but every caller binds `to` to the opportunity's own recipient |

## Small gap closed in this PR

**One-tap Follow up.** The follow-up pieces all existed (the filter that flags a live opportunity sent 3+
days ago with no open or reply, the stock nudge template in both languages, and the composer's `?etpl=`
preselect), but acting on a flagged card meant re-opening the composer and picking the nudge template by
hand. This PR adds a **Follow up** control on a flagged card that opens the composer bound to the
opportunity with the nudge template already chosen in the opportunity's own language
(`opp-nudge` / `opp-nudge-ar`). It is pure wiring of the existing `?etpl=` preselect and the stock
template; the send path (`relaySend`) is untouched (still three call sites). Proven by
`tools/followup_wire_test.py` in both languages, plus an opportunity not due a follow-up showing no button.

## Large gaps: proposals awaiting ratification (NOT built)

Each is its own future brief. Nothing here is implemented.

1. **True one-to-many group send.** *Surface:* a "Send to all" action on a group opportunity that opens
   the existing personalized pre-send review (`renderGroupReviewInto`), then sends per recipient. *Data:*
   the `recipients[]` array already on the record; no schema change. *Effort:* medium-to-large. The render
   pieces exist (`renderPersonalized`, `groupSendPlan`), but the send loop must carry the full send
   guarantees per recipient, a per-recipient idempotency key, the durable pending row, the quota counted
   once per confirmed delivery, and per-recipient success/failure surfaced, reusing `relaySend` in a loop
   without weakening any of it. This touches the send spine, so it must not ride an audit.

2. **Classification labels.** *Surface:* a small label editor on the card (add/remove free-text labels)
   and a label filter/chips row in the library beside the existing stage/status filters. *Data:* an
   additive `labels text[]` (or a `console_labels` join table) mirrored through the Stage-4 queue like
   every other write; additive, idempotent SQL. *Effort:* small-to-medium. Retrieval reuses the existing
   `initDashboard` filter state (add a `labels` predicate to the matcher at `app.js:2751`).

3. **Forward a thread or message by email.** *Surface:* a "Forward" control on a thread message (History
   tab) and/or the discussion that opens the composer pre-filled with the quoted message and an empty,
   free **To** for a colleague's address. *Data:* none new; it reuses `relaySend` with an arbitrary `to`
   and logs the send like any other. *Effort:* small-to-medium. The plumbing already accepts an arbitrary
   `to`; the work is a safe compose surface (quote the body, clear the recipient, keep the send guarantees)
   and deciding whether a forward is recorded on the opportunity's thread or kept separate.
