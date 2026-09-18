# BOARD_TRUTH_TRACE (Lane A, Step 1)

Read-only trace. No code changed, no PR. Every claim is cited `file:line` against
`origin/main` at the branch point. The question: the "replies waiting" pill reads
about 159 and climbing, but that number is inbox NOISE, not replies. Where does it
come from, what is the real-reply definition already in the codebase, and what must
the fix change.

## Short answer
The board.html "replies waiting" pill is computed 100% client-side by `buildReplies`
in the built shell, from RAW `console_inbound`, with NO noise filter and NO
subject-key link. It counts every non-auto, non-bounce inbound row that has no
server-set `opp` column as a "reply waiting". Since the relay leaves `opp` empty on
most rows, that is nearly every vendor / eVA / marketing / DMARC / notification mail
that arrives, hence 159.

The honest definition of a reply already exists twice in the repo and the counter
uses neither:
- the `console_board` view (`inbound_real` + `inbound_linked`) noise-filters and
  subject-links, but only to set a card's stage, not to produce a counter;
- the old engine `app.js` has `inboundIsNoise` + `subjectLinkOpp`, the exact
  client-side honest definition the board shell dropped.

The fix is to make the board counter apply that same definition (and add
from-address linking), so "replies" means true replies and everything else is a
quiet "inbox N".

---

## 1. Where "replies waiting" is computed, and what it counts today

The pill is client-side, not a view column.

- The counter: `buildReplies(inbound)` in the built shell,
  `tools/bundle.js:1697` (authored in the `buildBoard` block; the same code ships in
  `library/board.html`). Its rule:
  - `tools/bundle.js:1701` `if(r.kind==="auto" || r.bounce) return;` - only auto rows
    and bounces are dropped.
  - `tools/bundle.js:1703` `var opp=r.opp||""; if(!opp){ waiting++; return; }` - THE
    COUNTER. Any surviving row with an empty `opp` increments `waiting`. There is no
    reply-vs-inbox test: a vendor notification with an empty `opp` counts exactly
    like a human reply.
  - `tools/bundle.js:1704`-`:1714` rows WITH a non-empty `opp` are grouped per card,
    deduped by from-address, numbered - these become the per-card reply list/count
    (`__reps.count` / `__reps.list`).
- The feed: `fetchInbound()` reads RAW inbound, not the view -
  `tools/bundle.js:1595` `fetch(... /rest/v1/console_inbound?select=id,opp,kind,bounce,ts,data&order=ts.asc ...)`.
- The pill render: `tools/bundle.js:2345`-`:2346`
  `var waiting=(__reps&&__reps.waiting)||0; if(waiting) pills += '<span class="pill warn">'+waiting+' '+esc(t("p_waiting"))+'</span>';`
- The label: `tools/bundle.js:1312` `p_waiting:"replies waiting"` (EN),
  `tools/bundle.js:1404` `p_waiting:"ردود بانتظار الربط"` (AR).

So today "replies waiting" = count of `console_inbound` rows where `kind <> 'auto'`
AND no `bounce` AND `opp = ''`. That is the 159: inbox backlog, not replies.

The `console_board` view exposes `replied` (a boolean) and `last_reply_ts`
(`docs/supabase-board-view.sql:214`, `:172`) for per-card STAGE only. It computes NO
reply count and NO "waiting"/inbox count, so the pill cannot read it today.

---

## 2. The reply linker: linked vs waiting

There are two linkers, and they disagree because the counter uses the weaker one.

### 2a. The client counter's linker (what the pill uses) - the weak one
`tools/bundle.js:1703`. A row is "linked" iff `r.opp` (the value the relay wrote on
the row) is non-empty; otherwise it is "waiting". No subject-key match, no
from-address match, no noise filter. Because the relay leaves `opp` empty on any
reply it could not self-attribute (no plus-tag, no thread header, no sender match),
every such row - human or machine - falls into "waiting".

### 2b. The `console_board` view's linker (honest, but stage-only) - the strong one
`docs/supabase-board-view.sql`:
- `inbound_real` (`:128`-`:138`): the noise filter. `kind <> 'auto'`
  (`:135`), AND the from-address does not match
  `(dmarc|(^|[.+_-])(no-?reply|noreply|notifications?|notify|mailer-daemon|postmaster|bounces?)@)`
  (`:136`), AND the from host is not `google.com` / `github.com` (`:137`). It also
  computes `subj_key` = the subject with a leading `re|fwd|fw|رد|إعادة توجيه:`
  stripped, lower-trimmed (`:131`-`:132`).
- `mail_subj` (`:141`-`:151`): our outbound subjects, same normalization, distinct
  `(subj_key, opp)`.
- `inbound_linked` (`:156`-`:170`): a reply's opp is the UNIQUE `mail_subj.opp`
  whose `subj_key` equals the reply's (`:159`-`:160`); else the row's own `opp`
  (`:165`), with a stranded-child `slug--r-...` resolved to its parent
  (`:162`-`:164`); else NULL (unlinked, never guessed).
- `replied` (`:171`-`:187`): the per-card reply signal, three paths - a
  subject-linked inbound reply (`:174`), a hand-recorded `direction='in'` / status
  `replied` mail row (`:179`-`:182`), or `console_opps.stage='replied'` (`:184`).
  This feeds stage (`:231` `when coalesce(r.replied,false) then 'replied'`), NOT a
  counter.

So the server already knows how to tell a real reply from noise; it just never
emits a count the pill could read, and the client counter never asks.

### 2c. The old engine `app.js` - the honest client definition the shell dropped
`library/app.js` still carries the full client-side pair the board shell does not use:
- `inboundIsNoise(r)` `library/app.js:2758`-`:2785` (see section 4).
- `subjLinkKey(s)` `library/app.js:2794`-`:2799` and `subjectLinkOpp(r, sends)`
  `library/app.js:2804`-`:2816` - the subject-key linker (unique-send match, else
  ""), exported at `:2817`.

The board shell's `buildReplies` (`tools/bundle.js:1697`) predates or bypasses these;
porting them in is the smallest honest fix.

---

## 3. Signals already on a `console_inbound` row (no new data needed)

`fetchInbound` already selects `id, opp, kind, bounce, ts, data`
(`tools/bundle.js:1595`), and the relay stores a rich `data` per reply
(`attributeMessage_`, `relay/thrive-relay.gs`): `data.from`, `data.subject`,
`data.to` (the plus-tag recipient), `data.messageId`, `data.snippet`, `data.body`.
So every signal the fix needs is already on the row or one join away:

- Reply-prefix: `data.subject` starts with `re|fwd|fw|رد|إعادة توجيه:` -> normalize
  with the same `subjLinkKey` regex (`app.js:2796`, view `:132`).
- From-address: `data.from` (used today only for dedup at `bundle.js:1704`, never for
  linking or noise).
- From matches a recipient we actually sent to: `console_mail.to_addr` per opp - the
  board already reads `console_mail` for the G4 recipients tab, so the send ledger
  (opp, to_addr, subject) is available client-side for a from-address / subject link.
- Auto flag: `r.kind === 'auto'` and `r.bounce` (already the only exclusions,
  `bundle.js:1701`).
- Server attribution: `r.opp` (relay tag/thread/sender) - keep as one link path.
- Noise patterns: `data.from` and `data.subject` against the `inboundIsNoise`
  classes (section 4).

The one linking signal the honest definition should ADD, per the brief, is
from-address: an inbound whose `data.from` equals a `console_mail.to_addr` for some
opp links to that opp even when the subject drifted. The view deliberately excludes
sender-as-link today (`docs/supabase-board-view.sql:116`-`:117`,
`app.js:2788`-`:2789`); Lane A's Step 2 reverses that for the narrow, safe case of a
person we actually emailed answering us.

---

## 4. The senders that dominate the noise (the routing list)

The exact 159-row per-domain census lives in the live `console_inbound` (this
sandbox is egress-blocked, so it cannot be queried here); the earlier REPLIES_TRACE
sampled about 86 rows and found roughly 2 genuine human replies. The classes the
existing filters already enumerate, and that the fix should route to an inbox bucket,
are exhaustively listed in `inboundIsNoise` (`library/app.js:2758`-`:2785`):

- DMARC anywhere in the address (`:2767`): e.g. `noreply-dmarc-support@google.com`.
- Whole platform domains `google.com` / `github.com` (`:2769`): e.g.
  `notifications@github.com`.
- Automated local parts (`:2772`):
  `no-reply / noreply / do-not-reply / donotreply / no_reply / no-return / noreturn /
  no_return / mailer-daemon / postmaster / bounces / dmarc / abuse / notifications /
  notify / alerts / newsletter / digest / automated / mailer / system / updates` @.
- Machinery host prefixes (`:2774`):
  `bounce. / mailer. / reply. / em. / news. / notify. / notifications. / alerts. /
  updates. / mail. / email. / marketing.` (e.g. `notify.example.com`).
- ESP / bulk sending domains (`:2778`, `:2781`): `sender.net`, and
  `mailchimp / sendgrid / amazonses / mailgun / postmarkapp / sparkpostmail /
  sendinblue / mandrillapp / hubspot / intercom / zendesk / atlassian / slack /
  stripe / paypal / instagram / facebook(mail) / digitalocean / linkedin / twitter /
  github / notion / dmarcian`.
- Machinery subject patterns (`:2783`): `Report Domain: / DMARC aggregate report /
  delivery status notification / undeliverable / unsubscribe from this / out of
  office / automatic reply / auto-reply / read receipt / verify your / confirm your /
  password reset / new sign-in / new login / security alert / weekly digest / daily
  digest`.
- eVA specifically: the Virginia eVA leads mailer is caught by its `noreturn@` local
  part, called out in `library/app.js:2777` ("the eVA leads sender is caught above by
  its noreturn@ local part"). So eVA procurement/leads notifications route to inbox
  by the `no-return` rule at `:2772`, not by a bespoke domain entry.

The two genuine human replies from the trace sample: a government RFP update (a real
`.gov` person answering a send, which links by subject or by the from-address it was
sent to) and a gmail "Re:" (the fixture `alnajjarjawad97@gmail.com`, subject
`Re: من جد وجد`, in `tools/reply_link_test.py:74`). Both are non-noise and link to a
send, so both survive the honest filter as replies; everything else in the 159 is
inbox.

---

## Deliverable summary (for the Step 2 fix)

- "replies waiting" today = `buildReplies` (`tools/bundle.js:1697`) counting raw
  `console_inbound` rows with `kind<>'auto'`, no `bounce`, and empty `opp`
  (`:1701`, `:1703`); rendered at `:2345`-`:2346`. No noise filter, no subject-key,
  no from-address. That is the 159.
- The honest definition already exists: the `console_board` view
  (`inbound_real`/`inbound_linked`, `docs/supabase-board-view.sql:128`-`:170`) and
  `app.js` `inboundIsNoise` + `subjectLinkOpp`
  (`library/app.js:2758`, `:2804`). The board shell uses neither for the counter.
- Signals are all present on the row (`data.from`, `data.subject`, `kind`, `bounce`,
  `opp`) plus the `console_mail` send ledger (`to_addr`, `subject`, `opp`) the board
  already reads.
- Fix, per the brief: count a row as a REPLY only when it is not noise
  (`inboundIsNoise`) AND it links to a send (unique subject-key match, OR
  from-address equals a `console_mail.to_addr` we sent for some opp, OR the row's own
  plus-tag `opp`); route everything else to a quiet "inbox N"; ADD the from-address
  link so a real reply whose subject drifted still lands on its card. The view change
  is additive (`CREATE OR REPLACE VIEW`, read `pg_get_viewdef('public.console_board')`
  live first); any board.html counter change is one PR, rebuilt via `bundle.js`,
  fails-when-broken. No send / suppression / asset / editor change; no inbound row is
  deleted; a mislink is recoverable.
