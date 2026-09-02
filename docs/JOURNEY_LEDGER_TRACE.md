# JOURNEY_LEDGER_TRACE.md

READ-ONLY trace. No build, no source edits, no SQL applied. Every claim carries a `file:line`
citation; where a capability is absent it says **ABSENT** plainly. No fixes are proposed here; this
trace precedes the L1 PR brief.

## Axioms this trace serves

- **#1 Operations is a transit, not a ledger.** The board (`console_board`) is a set of *aggregates*
  scoped to the current transit; the card *journey* must be a permanent, never-hidden **event
  history**, which is a different thing from the counts the board shows.
- **#4 A re-upload never inherits old transit counts.** A per-transit `cycle` scopes sends and opens
  so an old transit's ledger rows drop off a freshly uploaded card (`docs/supabase-live-verified.sql:72,115`).
- **#6 Compute at the authority.** Stage, lane, counts are DERIVED in the view, never stored
  (`docs/supabase-live-verified.sql:205-221`).
- **#8 Additive only (later).** This trace changes nothing; any L1 write is an additive follow-up.

## The one distinction this whole trace turns on: which shell is live

The root serves the **APP SHELL**: `index.html` redirects to `library/console.html?v=BUILD`, which loads
`library/app.js`. There is a **parallel board shell**, `library/board.html`, built from `tools/board-*.src.js`;
**the root does not serve it**. Several capabilities below exist ONLY in the parallel shell (`board-*.src.js`)
or ONLY in the relay, and are **absent from the served `app.js`**. Wherever that is true, this trace says
so, because a capability that lives only in an unserved file is, for the live console, ABSENT.

---

## A. JOURNEY LEDGER (L1) - what card history exists today

### A1. Lifecycle events we can reconstruct today

| Event | Timestamp? | Actor? | Storage site (cited) | Permanent (server) or local? |
|---|---|---|---|---|
| **Card inserted** | **ABSENT** (no `created_at`) | Yes: `created_by` | `app.js:3746` stamps `rec.created_by=currentActor()` on a new opp only (and `edited_by`/`edited_at` on every write); travels in `console_opps.data` jsonb (`supaRowFromOpp`, `app.js:3905-3911`). A local activity row `in_import` is also logged (`app.js:4708`). | `created_by` server (in data jsonb); the `in_import` row is LOCAL only |
| **Approved (to Ready)** | Column exists: `approved_at timestamptz` | Column exists: `approved_by text` | Columns added `docs/sql/stage_gate.sql:24-25`; view reads them `docs/supabase-live-verified.sql:222-223`. **But no code writes them** - see A2. | designated, **unwritten** |
| **Activated (page live)** | `console_pages.live_verified_at` | **ABSENT** (no actor) | Stamped ONLY by the parallel shell `pageStampLive` (`library/board.html:2356`: `{ live_verified_at: new Date().toISOString(), up }`). The served `app.js` page write is `{slug,html}` only (`app.js:3916`) and the relay commit does not stamp it (`relay/thrive-relay.gs:975-1008`). | server column, but **written only by the unserved shell** |
| **Sent** | Yes: `console_mail.ts` | Yes: `console_mail.actor` (uid) | `supaMailRow` (`app.js:3934-3940`): `{ id, opp, status, to_addr, subject, ts, actor, data, up }`. Real sends carry `actor` as a UUID (proven from DB). | **permanent** (server ledger) |
| **Opened** | Yes: `console_hits.ts` | **ABSENT** (the prospect, not an operator) | `supaHitRow` (`app.js:4214-4217`): `{ id, slug, type, ts, self, data }`; view counts non-self opens `docs/supabase-live-verified.sql:101-116`. | **permanent** (server ledger) |
| **Replied** | Yes: `console_inbound.ts` | Sender address (`data->>'from'`), not a roster uid | View `inbound_real`/`replied` `docs/supabase-live-verified.sql:118-172`. | **permanent** (server ledger) |
| **Bounced** | Yes: `console_inbound.ts` | n/a (auto) | View `bounce` CTE, `kind='auto'`, `bounce in ('hard','soft')` `docs/supabase-live-verified.sql:174-181`. | **permanent** (server ledger) |
| **Archived** | **ABSENT** (boolean flag, no `archived_at`) | **ABSENT server-side** (only a LOCAL `lc_archive` activity row carries actor) | `console_opps.archived=true` via `runMove("archive", …)` → `saveDraft` + `logActivity("lc_archive", …)` (`app.js:5111-5119`); flag toggled at `app.js:3633`. | flag server; the *event* (who/when/why) LOCAL only |

The board view exposes **derived counts and a derived stage**, not an event stream:
`sent_count`, `open_count`, `replied`, `last_activity_ts`, `idle_days`, `stage`
(`docs/supabase-live-verified.sql:192-221`). Stage is a `CASE`, never stored.

### A2. Events with NO durable (server, permanent) capture today

- **Who inserted the card, and WHEN.** Who: `created_by` is stamped (`app.js:3746`) - present. **When:
  ABSENT** - there is no `created_at` on `console_opps`; `toRecord` mints no creation timestamp
  (`library/intake.js:602-640`). `up` (epoch ms, `app.js:3911`) is a last-write marker that bumps on
  every edit, so it is not a durable insert time.
- **Who transitioned it, and WHEN (each move).** **ABSENT** as discrete events. Stage is derived in
  the view (`docs/supabase-live-verified.sql:205-221`); the individual transitions (draft→ready→sent→
  opened→replied) are not recorded as signed, timestamped rows anywhere server-side. The two
  transitions that *have* designated columns are approval (`approved_at`/`approved_by`) and activation
  (`live_verified_at`) - and both are unwritten by the served shell (A1).
- **When it was archived, by whom, and WHY.** **ABSENT.** `archived` is a boolean (`app.js:3633`);
  there is no `archived_at`, no `archived_by`, and no reason/justification column. The only "why" is the
  narrow `outcome_was:"lost"` + `prev_stage` written on the lost→archive migration (`app.js:4765`), not a
  general archive reason. The actor and time survive only in the LOCAL, capped activity log (A3).

### A3. The modal History tab - what it renders, and from where

The History tab (`console.html:1283`, panel `#modalHistory`) is a **live, merged event trail**, not a stub
and not empty. Render path: `renderHistory` (`app.js:13387-13408`) → `activityTrailHtml`
(`app.js:7313-7357`) → `cardActivity` (`app.js:7303-7309`) → `buildThread` (`app.js:6797-6865`).

`buildThread` merges, newest-first, from FOUR sources:

1. **Sends & manual replies** from the mail ledger `getMailLog()` (`app.js:6804-6819`) - kind `sent`/`reply`,
   carrying `actor`, `ts`, `subject`, body preview. **Server-permanent** (`console_mail`).
2. **Replies & bounces** from `inboundFor(slug)` (`app.js:6823-6838`) - kind `reply`/`auto`. **Server-permanent**
   (`console_inbound`).
3. **Opens** from `allHits()` (`app.js:6842-6846`) - kind `open`, no actor. **Server-permanent** (`console_hits`).
4. **"Activity" rows** from `getActivity()` (`app.js:6849-6852`) - kind `act`: `edit`, `draft_save`, `upload`,
   `activate`, `contact`, `merge`, `archive`, `restore` (`app.js:7301-7302`). Each carries `action`, `detail`,
   `actor`, `ts`.

**The shape it expects:** an array of entries `{ kind, ts, actor?, subject?, detail?, … }` sorted newest-first;
ledger kinds (`sent`/`reply`/`open`/`auto`) are DERIVED and a legacy `email` act row is dropped so a send is
represented once (`app.js:7298-7307`). Each entry renders with its actor (`opName(e.actor)`) and time
(`app.js:7319-7323`).

**The L1 gap is precisely in source 4.** `getActivity`/`setActivity` (`app.js:284-285`) read and write
**localStorage only**, capped to the **last 500 entries** (`a.slice(-500)`), on **one device**. `logActivity`
(`app.js:347-352`) writes only there - it stamps `ts` + `action` + `slug` + `detail` + `actor:currentActor()`
but persists to no server table. So the lifecycle events that ONLY exist as activity rows (inserted, activated,
archived, edited) are **device-local, capped, and not cross-device** - the History tab on a second device, or
after 500 newer rows, cannot show them. `console_activity` is named only in a stats *definition* comment
(`app.js:1232-1233`); **there is no client write path to any `console_activity` table** (grep: zero writes in
`app.js`).

### A4. Actor resolution (UUID → display name)

**EXISTS.** The roster is `console_members` - read as `id,name,email,role,active`
(`app.js:1950`). Resolvers:
- `membersRoster()` (`app.js:1967`), `memberName(uid)` (`app.js:1970`), `memberRole(uid)` (`app.js:1968`),
  `isOwnerMember()` (`app.js:1969`).
- `currentActor()` (`app.js:295-298`) returns the Supabase `authUid()` or the single-operator default `"thyab"`.
- Fallback when `console_members` is not present: `membersDerived()` (`app.js:1959`) / `resolveOperator(uid)`,
  used by the trail via `opName` (`app.js:7317`).

So a journey line CAN read "activated by Basel" today, given the member row exists. (Opens carry no operator;
replies carry a sender address, not a roster uid.)

### A5. The `up` bigint (on `console_opps` / `console_mail` / `console_pages`)

`up` is an **epoch-milliseconds "last written" marker** used for **last-writer-wins reconciliation**, not a
version counter and not the send idempotency key.
- Written: `supaRowFromOpp` `up:d.up||Date.now()` (`app.js:3911`); `supaMailRow` `up:rec.up||Date.now()`
  (`app.js:3939`); custom templates `rec.up=Date.now()` (`app.js:527`).
- Read: newest-`up`-wins in `unionUp` (`app.js:4458-4460`) and the keyed merge (`app.js:503`, `509` for
  tombstone-vs-write ordering); newest-first sorts (`app.js:2597`).
- Idempotency for sends is separate: the `console_mail` row id / Resend id (`relay/thrive-relay.gs:751-756,
  793`), not `up`.

---

## B. CYCLE LIFECYCLE - settled

### B1. Does `upCommit` set/refresh `console_opps.cycle` on every upload, and is a re-upload a NEW cycle?

**In the parallel board shell: yes. In the served app shell: ABSENT.**
- Parallel shell: `board-upload.src.js` mints `var cycle = upNewCycle()` on every (re-)upload
  (`tools/board-upload.src.js:343`) - a fresh short id (`upNewCycle` defined `:326-327`) - and writes it via
  `oppUpsert(r.slug, { …, cycle:cycle })` (`:344`), stamping the SAME cycle into the published page's
  `<meta name="thrive-cycle">` (`withCycleMeta`/`withBeaconClient`, `:393-404`). A re-upload of an existing
  slug therefore mints a NEW cycle.
- **Served app shell (`app.js`): ABSENT.** A whole-file scan of `library/app.js` finds **no cycle field, no
  `upNewCycle`, no `thrive-cycle` stamp** anywhere. The served upload path (`writeImport`→`publishOpp`→
  `supaMirrorOpp`) writes the opp via `supaRowFromOpp`, whose emitted top-level columns are
  `{slug,business,stage,published,archived,outreach_subject,outreach_text,channel,data,up}` - **no `cycle`
  column** (`app.js:3905-3911`). (A `cycle` value present on a record would ride inside `data` jsonb, but the
  top-level `cycle` column the view joins on is not written by the served shell.)

So the `cycle` values observed on live opps came from the parallel `board.html` shell and/or a manual SQL
step, **not from the served app shell**.

### B2. Does the live send path stamp `console_mail.cycle` from the opp's CURRENT cycle?

**No.** The served app shell does NOT stamp `console_mail.cycle`.
- The client's send-row builder `supaMailRow` (`app.js:3934-3940`) emits **no top-level `cycle`** column.
- The relay's send op `sendMail_` (`relay/thrive-relay.gs:712-768`) is a pure Resend courier: it writes **no**
  `console_mail` row and carries **no** cycle; it returns `{ok,id,messageId,replyTo,delivered}`.
- Cycle stamping on a send exists ONLY in the parallel shell: `board-send.src.js:335-339` puts
  `cycle:(row && row.cycle) || null` on the outbox row. The served shell has no such line.

**The one honest line on B2:** *On the live (served) console, no send stamps `console_mail.cycle`, so every
send it writes is null-cycle; the view's "drop old transit" rule `(m.cycle = mo.cycle) OR (both null)`
(`docs/supabase-live-verified.sql:72`) is load-bearing on legacy/null cycles only - and because a cycled opp
(`mo.cycle` set) no longer matches its null-cycle sends, those sends drop out of the card's count entirely.*
This is exactly the proven symptom: `underdog-coffee-bread` and `uncle-cs-chicken-and-waffles` have
`mail.cycle=null` while their opp has a cycle, so their sends fall off the card.

### B3. Is `cycle` stamped on a `console_hits` write?

**Split.**
- The **relay hit path** (the tracking-beacon open) DOES stamp it: `supaHitRow_`/hit builder writes
  `cycle: (e && e.cycle) || null` (`relay/thrive-relay.gs:469`), reading the cycle the beacon sent
  (`beacon.js:45,110,129`, which reads `<meta name="thrive-cycle">` from the page, `beacon.js:37-42`).
- The **served app shell's own hit mirror** does NOT: `supaHitRow` (`app.js:4214-4217`) emits
  `{id,slug,type,ts,self,data}` - **no top-level `cycle`**.

Honest limitation: cycle on an open is only as good as the page's `thrive-cycle` meta, which is stamped only
by the parallel shell's publish (`board-upload.src.js:393-404`); a page published by the served shell or the
relay (`withBeacon_`, `relay/thrive-relay.gs:980`) carries no cycle meta, so its opens are null-cycle.

---

## C. DELETE AND ARCHIVE PATHS

### C1. Delete

- The **client** performs it: `removeDraft(slug)` (`app.js:3753`) → `supaDeleteOpp(slug)` (`app.js:3918-3922`),
  which queues deletes for **`console_opps` and `console_pages` only** (`app.js:3921-3922`).
- **`console_mail` is left intact** - and so are `console_hits` and `console_inbound`.
  `docs/supabase-opp-delete.sql` is explicit: "THE LEDGER IS NEVER DELETED … no cascade from console_opps or
  console_pages into console_mail, console_hits, or console_inbound, and this file adds none. A deleted
  opportunity's send and reply history remains, keyed by its slug string."
- Gated: only a zero-history card may hard-delete - `canHardDelete` (`app.js:4642`) via `hasLedgerHistory`
  (`app.js:4627`); a history-bearing card archives instead.

### C2. Archive

- Set via the one shared lifecycle move: `runMove("archive"|"unarchive", slug, {})` (`app.js:5119`), which
  writes `console_opps.archived=true` through `saveDraft` and logs an `lc_archive` / `lc_unarchive` activity
  row (`app.js:5111-5119`); the raw flag toggle is `app.js:3633`; the archived flag is also carried onto the
  manifest on a published page's archive (`app.js:3635`).
- **Reason/justification: ABSENT** for a general archive. Only the lost-outcome migration stores
  `outcome_was:"lost"` + `prev_stage` (`app.js:4765`). There is no `archived_at`, no `archived_by`, and no
  reason column (see A2).
- **Archived cards retain their sends/history in the view.** The view selects every `console_opps` row and
  exposes `archived` as a flag (`docs/supabase-live-verified.sql:198`) while still computing `sent_count`,
  `open_count`, `replied`, `stage` for it; the board filters archived cards into a client-side tray, but the
  counts and the ledger persist. Combined with C1 (ledger never deleted), history survives archive.

---

## D. TEMPLATE / LIBRARY REALITY (L2 prep)

### D1. `console_pages` and re-upload overwrite; template entity / version / content_hash

- **Re-upload overwrites `html` in place by slug.** The served write is
  `supaQueueUpsert("console_pages", { slug:d.slug, html:d.html })` (`app.js:3916`) - an upsert keyed by slug
  (PostgREST merge-duplicates, `app.js:3871` / relay `pagePublish_` PUTs `opp/<slug>/index.html` in place with
  the current sha, `relay/thrive-relay.gs:986-999`). No new row per upload; the page row is replaced.
- **`console_pages` columns (live DB, per the brief, Session 13): `slug, html, live_verified_at, title, task,
  tags, up, updated_at`.** In-repo I can confirm the `live_verified_at` add (`docs/supabase-live-verified.sql:43-44`).
  **Divergence to flag:** `library/board.html:2317-2318` comments that the schema is
  `(slug, html, up, updated_at, live_verified_at)` with "no title … column"; the live DB (authoritative per the
  brief) has `title/task/tags`, so that in-code comment is stale. Not re-derived here.
- **No version, no content_hash on `console_pages`.** ABSENT - neither column appears in any migration
  (grep across `docs/*.sql`), and the upsert carries neither.
- **A `console_templates` table DOES exist** (`docs/supabase-stage1.sql:47`), but it is a **separate entity**:
  the operator's reusable custom page-templates/snippets in the editor (`app.js:3879, 3924`), keyed by its own
  `id`. It is NOT a per-opportunity page-version entity and does not link a `console_pages` row to a template
  or carry a content hash. So for the per-opportunity page (L2's subject), there is **no template entity, no
  version, no content_hash**.

### D2. Where the four pieces live

- **Page HTML** → `console_pages.html`, its own row keyed by slug (`app.js:3907` splits html out of the opp;
  `supaMirrorOpp` writes it at `app.js:3916`).
- **Message body** → `console_opps.outreach_text` (top-level column AND inside `data`, `supaRowFromOpp:3910`;
  minted from `e.body` in `toRecord`, `library/intake.js:634`).
- **Subject** → `console_opps.outreach_subject` (same, `app.js:3910`; `intake.js:635`).
- **Recipient email** → **inside `console_opps.data`**, not a dedicated column: `recipients:[{addr,name,lang}]`
  and `channel:{kind,to}` minted in `toRecord` (`library/intake.js:610-626`), plus `manual_contacts[]` used by
  the view's `manual_sends` CTE (`docs/supabase-live-verified.sql:75-86`).

So today the four pieces are split across **two rows**: `html` on `console_pages`; body + subject + recipient
on `console_opps` (subject/body as columns, recipient inside its `data` jsonb). They are joined only by the
shared `slug` - there is no single record that binds them as one recordable unit.

### D3. Usage-counting feasibility (message body carries the page link?)

- **The sent body IS stored:** `supaMailRow` writes `data:rec` (`app.js:3939`), and `rec` carries the
  body/preview; `buildThread` reads it back as `m.preview||m.body` (`app.js:6816`). So each send retains its
  body in `console_mail.data` jsonb.
- **The page link CAN be in the body, but is not guaranteed.** The composer computes `oppUrl = liveUrl(slug)`
  (`app.js:7627`) and the insert-link bar (`#eoppbar`, `app.js:7848`) both inserts it and *detects* it:
  `text.indexOf(oppUrl) >= 0 || text.indexOf("/opp/"+slug) >= 0` (`app.js:7854-7856`). So a later
  "link present in a sent message" count is **feasible** from `console_mail.data` body text.
- **What is missing to count usage:** the link's presence is operator-dependent (only if inserted), there is
  no `content_hash` tying a send to a specific page version (D1), and `console_templates` usage is not linked
  to sends. A robust usage count would need an explicit, stamped link (or a page/template id) on the send row,
  which is ABSENT today.

---

## E. RECALL SURFACE (L3 prep)

### E1. The Library surface - listing and "use this" flow

- The Library view EXISTS as a surface: `console.html:538` `#view-library`, nav `#library`
  (`console.html:326`), title "Opportunity Library" (`console.html:539`).
- It lists **pages grouped by mission/manifest** as shelves: `shelf-manifest` / `shelf-base` / page cards
  with a page count (`app.js:4980-5018`), each card offering archive/unarchive (`app.js:4954`) and a "start a
  new one from this base" link into the editor (`lib_base_new` → `viewHref("editor", "mission=…")`,
  `app.js:5008`).
- **A "use this / insert into a new message" recall flow is ABSENT.** There is no template-insert-into-composer
  path in the served shell; the nearest affordance is "new from base" (opens the editor on a mission), and a
  source comment records that exactly these flows fell through a gap: "'use this template', 'compose with
  this' … fell down the gap" (`app.js:436`). This is consistent with `docs/FOUNDATION_BRIEF.md` scoping the
  real 03 Library (templates with Preview/Open full/Use, and the operations archive) to the unbuilt PR-5.

---

## ABSENT list - every L1 capability that does not exist yet

1. **A permanent, server-side event ledger.** Lifecycle "act" events (inserted, activated, archived, edited)
   live ONLY in localStorage, capped at 500, one device (`app.js:284-285, 347-352`). No `console_activity`
   write path exists (`app.js:1232-1233` is a definition comment only).
2. **Card insert timestamp.** No `created_at` on `console_opps` (`created_by` exists, `app.js:3746`;
   `toRecord` mints no timestamp, `intake.js:602-640`).
3. **The approval event, actually written.** `approved_at`/`approved_by` columns exist
   (`docs/sql/stage_gate.sql:24-25`) and the view reads them (`…live-verified.sql:222-223`), but **no code in
   the repo writes them** (grep: zero writes across `app.js`, `board-*.src.js`, relay).
4. **Activation stamped by the served shell.** `live_verified_at` is written ONLY by the unserved
   `board.html` (`board.html:2356`); the served `app.js` and the relay never stamp it
   (`app.js:3916`, `relay/thrive-relay.gs:975-1008`).
5. **Signed, timestamped transition events.** draft→ready→sent→opened→replied are derived aggregates in the
   view (`…live-verified.sql:205-221`), not recorded moves with actor + time.
6. **Archive metadata.** No `archived_at`, no `archived_by`, no reason/justification column; only a boolean
   `archived` (`app.js:3633`) plus a local `lc_archive` row (`app.js:5111-5119`).
7. **Cycle on the served shell.** The served app shell mints no opp `cycle` (B1) and stamps no
   `console_mail.cycle` (B2) or `console_hits.cycle` (B3); all cycle code is in the unserved `board-*.src.js`,
   the beacon, and the relay-hit path.
8. **A single record binding page + body + subject + recipient.** Split across `console_pages` and
   `console_opps` (recipient inside `data`), joined only by slug (D2); no page version / `content_hash` (D1).
9. **A recall "use this / insert into a new message" flow** in the served Library (E1).

## The one honest line on B2 (repeated, because the brief asks for it)

**The live (served) console does not stamp `console_mail.cycle` at send time (`app.js:3934-3940`; the relay
courier writes no mail row, `relay/thrive-relay.gs:712-768`); every send it writes is null-cycle, so the
view's transit-drop rule is load-bearing on legacy/null cycles only, and a cycled opp silently drops its own
null-cycle sends from the card.**
