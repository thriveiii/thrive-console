# The five-stage audit (full card-logic review)

Every board card carries exactly one of five stages. This is the audit the brief asks for: for each
stage, its **source of truth**, the **table and column** that holds the signal, the **linking key** that
ties the signal to an opportunity, and one **production row** that confirms it, with a **read-only** SQL
query to run in the Supabase editor (Thyab runs the counts; nothing here writes).

## The one law the audit rests on

The board reads **one server-computed stage** from the `console_board` view and buckets by it. It
computes no stage of its own.

- `library/stage-model.js:81`, `if (typeof global.boardViewStage === "function") return global.boardViewStage(o);`
  the board's lane authority is `boardViewStage`, nothing else; the local evidence path below it is never
  reached on the console.
- `library/app.js:883`, `boardViewStage(o)` returns `boardViewRow(o.slug).stage` (the view's word) or, only
  when the view does not hold the card, the record's own inert `baseStage(o)` (a declared terminus, else
  `live` if a page/email is prepared, else `draft`). `baseStage` **never** re-derives sent / opened /
  replied from the local mail, hits, or inbound stores (`app.js:877`).
- `docs/supabase-board-view.sql:186-199`, the view's `stage` CASE is the single derivation. It runs once,
  server-side, from the confirmed rows.

So every stage below traces to a `console_board` column, and every `console_board` column traces to a
confirmed `console_*` row. No stage is derived client-side (acceptance 2).

## The table

| Stage | Source of truth (view column) | Signal table · column | Linking key | Confirming row |
|---|---|---|---|---|
| **Draft** | `stage='draft'`, no send **and** no page/email prepared | `console_opps` (no `console_pages` row, `published=false`, empty `outreach_text`/`outreach_subject`) | `console_opps.slug` | a batch card never activated |
| **Ready** (`'live'`) | `stage='live'`, no confirmed send, but a page or email is prepared | `console_opps.published` / `console_pages.slug` / `console_opps.outreach_text` | `console_opps.slug` = `console_pages.slug` | a published page nobody has been written to |
| **Sent** | `stage='sent'`, `sent_count>0`, no open, no reply, no bounce | `console_mail` · `opp`, `status`, `data->>'direction'` | `console_mail.opp = console_opps.slug` | `cozy-calico-books` |
| **Opened** | `stage='opened'`, `open_count>0`, counted at/after the first send | `console_hits` · `slug`, `ts`, `self` | `console_hits.slug = console_opps.slug` | `thrive-july` |
| **Replied** | `stage='replied'`, `replied=true` | `console_inbound` · `opp` (or a ledger `direction='in'`/`status='replied'`, or `console_opps.stage='replied'`) | `console_inbound.opp` → parent slug (child slug `<parent>--r-<hash>` resolved by `split_part`) | Basel Issa → `مدارس المدار الدولية` (`madar`) |

## Stage by stage

### Draft, no page
- **Truth:** `console_board.stage='draft'`, the CASE fall-through (`supabase-board-view.sql:190-194`) when
  `sent_count=0` **and** neither `has_page` nor `has_email` is true.
- **Key:** the opportunity's own `console_opps.slug`. Nothing else is consulted.
- **Client naming:** lane key `draft` (`stage-model.js:19`), label `lane_draft` = "Draft" / «مسودة» (`i18n.js:2425,2578`).

### Ready, page or email prepared, no confirmed send (view stage `'live'`)
- **Truth:** `console_board.stage='live'` (`supabase-board-view.sql:190-194`): `sent_count=0` and
  (`published` **or** a `console_pages` row **or** `outreach_text`/`outreach_subject` present).
- **Key:** `console_opps.slug`, joined to `console_pages.slug` for the page signal (`has_page`,
  `supabase-board-view.sql:166`) and reading the promoted `outreach_*` columns for the email signal
  (`has_email`, `:168`).
- **The one `'live'` → Ready naming map (confirmed the only board site):** the value `'live'` is a **lane
  key**, carried verbatim from the view through `stage-model.js` `LANES` (`:19`) and `laneOf`
  (`:150-155`); the board buckets by the key. Its **display label on the board** is set in exactly one
  place, `lane_live` = "Ready" / «جاهزة للإرسال» (`i18n.js:2428,2579`). (The pipeline pill elsewhere uses
  the long form `stage_live` = "Ready to send"; that is a different surface, not the board lane. Short
  form on the 132px lane, long form on the pill, one name, by design.) Renaming the view stage would
  require a new client map; keeping `'live'` keeps a single mapping.

### Sent, a confirmed `console_mail` row
- **Truth:** `console_board.stage='sent'`, the CASE `else` (`supabase-board-view.sql:198`), reached when
  `sent_count>0` and there is no reply, no bounce, and `open_count=0`.
- **Signal:** `mail_sends` (`supabase-board-view.sql:48-57`) counts a `console_mail` row that is **not** a
  reply (`data->>'direction' <> 'in'`) and whose `status` is a dispatched one (`NULL`, `''`, `sent`,
  `copied`, `pending`); `queued`/`failed`/`unsent` do not count. This mirrors the client `sendIndex()`.
  `sent_on` on the record proves nothing and is deliberately never consulted (`:47`).
- **Key:** `console_mail.opp = console_opps.slug`. A manual off-channel contact
  (`console_opps.data.manual_contacts[].sent_on`, `:61-72`) counts identically, keyed by the parent slug.
- **Confirming row:** `cozy-calico-books`, the send whose local ledger row was the drift case; the send
  key is `opp = slug`, so its `console_mail` row is what a "Sent" reading requires.

### Opened, a page open, send-gated
- **Truth:** `console_board.stage='opened'` (`supabase-board-view.sql:197`) when `open_count>0`.
- **Signal:** `opens` CTE (`:94-105`): a `console_hits` row of type `open` (or untyped), **not** a
  self-visit (`self=false`), counted **only at or after the first send** (`h.ts >= s.first_ts`, joined on
  `sends`). A page read before any message went out is a view, not an open, so a zero-send card can never
  read Opened.
- **Key:** `console_hits.slug = console_opps.slug`.
- **Confirming row:** `thrive-july`, has a recorded open after its send; stays in Opened (a group
  campaign never itself enters Replied; a recipient's reply spawns a child that carries Replied).

### Replied, a confirmed inbound reply, resolved to its parent
- **Truth:** `console_board.stage='replied'` (`supabase-board-view.sql:189`) when `replied=true`.
- **Signal (three real paths, `supabase-board-view.sql:107-144`):**
  (a) a `console_inbound` row keyed by `opp`;
  (b) a hand-recorded ledger reply (`console_mail.data->>'direction'='in'` or `status='replied'`);
  (c) a hand-recorded reply move that stamps the opportunity itself (`console_opps.stage='replied'`,
  writing no inbound or mail row).
- **Key:** `console_inbound.opp` → the **parent** opportunity. A reply keyed to a **stranded** child slug
  `<parent>--r-<hash>` (no such `console_opps` card) resolves back with `split_part(opp,'--r-',1)`
  (`:126`); a child that has its own card keeps its reply. The client applies the identical rule in the
  one resolver `replyParentOf` (`app.js:803`), so the client count and the server view never disagree.
- **Confirming row:** **Basel Issa**, his reply belongs to `مدارس المدار الدولية` (`madar`). It is keyed
  to a child slug that is stranded, so `split_part` (view) and `replyParentOf` (client) both attach it to
  `madar`, moving that card into Replied.

## Read-only confirmation (run one per named row)

```sql
-- The whole board, one row per card, exactly what the client reads and buckets:
select slug, business, stage, sent_count, open_count, replied, has_page, has_email, archived
  from public.console_board order by stage, slug;

-- DRAFT: a card with no page, no email, no send. It must read stage='draft'.
select b.slug, b.stage, b.has_page, b.has_email, b.sent_count
  from public.console_board b where b.has_page = false and b.has_email = false and b.sent_count = 0;

-- READY ('live'): a prepared page or email, no confirmed send. It must read stage='live'.
select b.slug, b.stage, b.has_page, b.has_email, b.sent_count
  from public.console_board b where b.sent_count = 0 and (b.has_page or b.has_email);

-- SENT key: does cozy-calico carry a dispatched console_mail row on its slug (not a reply)?
select id, opp, status, coalesce(data->>'direction','') as direction, ts
  from public.console_mail
 where opp = 'cozy-calico-books' and coalesce(data->>'direction','') <> 'in';

-- OPENED key: thrive-july's opens, and its stage. open_count>0 must give stage='opened'.
select b.slug, b.stage, b.open_count, b.sent_count from public.console_board b where b.slug = 'thrive-july';
select h.slug, count(*) from public.console_hits h where h.slug = 'thrive-july' group by 1;

-- REPLIED key: how is Basel's reply keyed, and does madar read replied=true?
select id, opp, kind, ts from public.console_inbound
 where opp = 'madar' or opp like 'madar--r-%' order by ts desc;
select b.slug, b.stage, b.replied from public.console_board b where b.slug = 'madar';
```

## Findings

One finding surfaced by the audit, and it is a UI completeness gap, not a stage-derivation error:

- **Acceptance 5, the newest reply was not distinguished.** The per-opportunity numbering (`repliesForOpp`,
  `app.js:811`) already numbered a card's replies 1..N, but the card's reply list rendered every number
  identically, so a multi-reply card did not show *which* reply is the latest. Fixed additively: the
  highest per-opportunity number is marked (`rp_latest` label + `.rp-latest` / `.rp-card.is-latest`
  using the existing `--lane-replied` token, no new chrome), and only when a card has more than one reply.
  Proven in `tools/reply_latest_test.py`.

No stage's UI value failed to trace to a confirmed row: the board buckets by the view stage, and each
view stage traces to a `console_*` signal above. There is no client-side stage derivation to remove (it
was already retired in the one-read work; `baseStage` is inert and used only when the view does not hold
a card).
