# Collaboration layer - design spec + additive-SQL plan + staged PR plan (PHASE 0)

Status: **design only, no feature code.** For Thyab to review and approve before any build PR.
Scope: card members/assignment, per-user durable notifications (bell + drawer), a card activity log,
per-member identity colors, and Trello-like operations UX (drag/motion) - all on the standalone
`library/board.html`, preserving every send invariant and canon rule.

Members are three people: Thyab (abdu.thyab@gmail.com), Agha (muhelagha@gmail.com), Basel
(alnajjarjawad97@gmail.com). "Mohammed" and "Agha" are the SAME person (Mohammed Agha) - never a fourth
member. `console_profile_names` / `resolveActor` is the name source.

---

## 0. Trace findings (read-only, on current main incl. #338)

**Storage today.** `console_opps (slug, business, stage, published, archived, outreach_subject,
outreach_text, data jsonb, up)` plus the additive `owner text` from #338. Stage/lane is DERIVED by the
`console_board` view (canon 3.4), never stored. `console_mail` carries `actor` (the sender uid).
`console_profiles` is owner-only by RLS; `console_profile_names` is a definer-rights view exposing
`(uid, display_name, email)`; `resolveActor(uid|email)` turns a stored actor into `{uid, name, email}` via
the boot-time `__profileIndex`. `currentUid()` = `session().uid`. Read/write helpers: `restGet(path)`
(returns `[]` on any non-2xx), `authFetchOnce` (bounded, one refresh-retry), `oppUpsert(slug, fields)`
(POST, `Prefer: resolution=merge-duplicates`), `oppPatch(slug, patch)` (PATCH). The team-discussion table
`console_comments` already exists (open read, owned writes) and is the pattern to mirror.

**The Activity gate.** The opportunity window's Details view renders an Activity timeline
(`d_activity` / `d_no_activity`) built read-only from `console_mail` (sends) + `console_hits` (opens) +
the reply resolver (`console_inbound`), newest first. There is **no** who-did-what card action log today
(no assign/comment/edit events) - that is exactly what the new activity table adds, and it becomes the
SOURCE that feeds both the Activity gate and the notification writer.

**Owner vs member.** #338's `owner` is the CREATOR (stamped `currentUid()` at create/upload/send via
`ownerStamp()`, coalescing so a re-save never clobbers). It is a single value. Membership/assignment is a
NEW, separate concept: a SET of members per card, independent of send and independent of owner (creator is
a member by default). The owner column stays; members are additive.

### Why Basel's latest uploads show "unassigned" - exact cause + fix

Decision tree, resolved against the code:

1. **Is the `owner` column applied?** It must be. Every create/upload/send oppUpsert sends `owner:` in the
   payload *unconditionally* (`board-upload.src.js:379,1632`, `board-newmsg.src.js:177,254`). If the column
   were missing, PostgREST returns 400 (`PGRST204, could not find the 'owner' column`), `oppUpsert`
   rejects, and `upCommit` counts the row **Failed** - no card is created. Basel sees COMMITTED cards, so
   the column is applied and the owner was stamped = Basel's uid.
2. **So why "unassigned"?** The chip label comes from `ownerLabel(uid)` → `resolveActor(uid)` →
   `{name, email}` then the canonical email map. Two facts break it for Basel:
   - `OWNER_CANON` is keyed by **email**, but the client NEVER writes `console_profiles.email`
     (`profileSaveName` writes `{uid, display_name}` only). `console_profiles.email` is seeded only for the
     owner tier in `supabase-operator-profile.sql`; for a member it is null, so `console_profile_names.email`
     is null, so `resolveActor(basel_uid).email` is "" and the canonical map can never match.
   - The fallback is `console_profiles.display_name`. If Basel never saved a display name (no profile row),
     `resolveActor` returns an empty name too. `ownerLabel` then returns "" → the chip renders **Unassigned**
     even though the owner uid is correctly stored.

   (A secondary latent contributor: `renderBoard` paints cards from `__cardMeta` while `loadIdentity`
   populates `__profileIndex` in parallel and the board does not re-render when identity settles, so a
   freshly-uploaded card can paint before the index is ready and stay unassigned until the next reload.)

**Exact cause:** the owner uid is stamped correctly; the chip is "unassigned" because Basel's identity does
not resolve to a name - `console_profiles.email` is unpopulated (so the email-keyed canonical map cannot
fire) and Basel has no saved `display_name`.

**Fix (in this plan):**
- **Data:** additively populate identity so `resolveActor` always resolves. `supabase-collab-layer.sql`
  below backfills `console_profiles(uid, display_name, email)` for the three members from `auth.users` (by
  email, exactly like the existing owner seed), and `console_profile_names` (a projection) then carries a
  real email + name for every member - so `OWNER_CANON` fires and the fallback name exists.
- **Client (PR-2):** key the canonical member map by **uid as well as email** (uids captured once from
  `console_profile_names`), and re-render owner/member chips when `loadIdentity` settles (fix the paint
  race). Also make the `owner`/members write **resilient**: never let an identity write 400 a create/send
  (see the write-resilience note in PR-1).
- **Ops:** Thyab runs the identity backfill once; each member can also open Profile and save their display
  name (both paths converge on `console_profiles`).

**Write-resilience risk (flag).** Because #338 sends `owner:` unconditionally, any environment where the
column is not yet applied will 400 every create/upload/send. PR-1 must either (a) guarantee the column
exists before the write path ships to that environment, or (b) make the identity write tolerant (retry
without the field on a `PGRST204`), so a missing additive column can never break a send. This same
discipline applies to the new `members` write.

---

## 1. Data model - additive SQL + backfill

Design principle: **membership and collaboration state live in their own `console_`-prefixed tables**, not
by widening `console_opps` or the `console_board` view. Cards read them with bounded best-effort selects
joined by slug/uid at render (the same shape `fetchCardMeta` already uses). Nothing here changes
send/compile/commit or the derived lane view.

Tables:

- **`console_card_members`** - the assignee SET per card (one row per card+member). Open read (shared
  board); any authenticated member may add or remove any member (Trello: anyone manages membership),
  enforced by an authenticated-only policy, with the ACTOR recorded for the activity log.
- **`console_watchers`** - who watches a card for notifications. In the Trello model a member IS a watcher
  of any card they belong to; we keep watchers as a first-class row (seeded = members) so future
  "watch without being a member" is possible without a migration. PR-4 can derive watchers = members and
  treat this table as the durable superset.
- **`console_activity`** - the who-did-what-when trail per card (assign, unassign, comment, edit,
  state-change). This is the SOURCE the notification writer reads and the Activity gate renders.
- **`console_notifications`** - the per-user DURABLE inbox (one row per recipient per event), keyed by
  `recipient` uid, carrying `read_at`. Private: a member reads/updates ONLY their own rows (RLS
  `recipient = auth.uid()`). This is the durable store the bell reads; never localStorage.
- **`console_read_state`** - a tiny per-user cursor (`recipient`, `seen_at`) for "badge cleared at" so the
  unread count and the drawer's read-marking are O(1) and survive across devices. (Alternative: rely only
  on `console_notifications.read_at`; the cursor is an optimization for the badge.)
- **`console_card_order`** - optional per-lane manual order (a storable priority WITHIN a lane), for the
  Trello reorder affordance. Storing ORDER is canon-legal (it is not lane membership); it is a separate
  additive column/table so it never touches the derived stage.

The SQL is authored in `docs/supabase-collab-layer.sql` (additive, idempotent, `/* */` comments only, no
Arabic, no destructive change), summarized here:

```
console_card_members(opp text, member text, added_by text, created_at timestamptz)  PK(opp, member)
console_watchers    (opp text, watcher text, created_at timestamptz)                PK(opp, watcher)
console_activity    (id text PK, opp text, actor text, verb text, meta jsonb, created_at timestamptz)
console_notifications(id text PK, recipient text, actor text, opp text, verb text, meta jsonb,
                      created_at timestamptz, read_at timestamptz)
console_read_state  (recipient text PK, seen_at timestamptz)
console_card_order  (opp text PK, lane text, ord double precision, updated_at timestamptz)
```

RLS (mirroring `console_comments`): reads OPEN to `authenticated` for the shared-board tables
(`console_card_members`, `console_watchers`, `console_activity`, `console_card_order`); `console_activity`
insert requires `actor = auth.uid()`; `console_card_members` / `console_watchers` insert+delete allowed to
`authenticated` (anyone manages membership) with `added_by = auth.uid()` on insert; `console_notifications`
and `console_read_state` are PRIVATE - select/insert/update/delete only where `recipient = auth.uid()`
(insert `with check` allows writing a notification whose recipient is not self, so the event writer can
notify others; a stricter alternative is a `security definer` RPC - noted as the hardening option).

**Backfill (owner -> initial member).** Additively seed `console_card_members` and `console_watchers` with
each card's existing `owner` (from #338), so every already-owned card starts with its creator as its first
member/watcher. Cards with no owner stay memberless (unassigned), never fabricated. Plus the identity
backfill for the three members (fixes the "unassigned" name-resolution cause above).

---

## 2. Notification event catalog

The activity log is the single source; the notification writer runs on each activity event and fans out
one `console_notifications` row per RECIPIENT. Recipients = the card's watchers (= members) MINUS the
actor. Copy = actor + verb + card + context, localized EN / AR (Gulf MSA, Alyamama, guillemets, Western
numerals, no em dash).

| Event | Recipients | Actor excluded | Notes |
|---|---|---|---|
| Added to a card | the added member (if added by someone else) | yes (self-add = no notify) | "Agha added you to <card> (started by Thyab)" |
| Comment / note added | all watchers except the actor | yes | "Basel commented on <card>" |
| Card edited / changed (subject, body, page, recipient) | all watchers except the actor | yes | "Thyab edited <card>" (coalesce rapid edits) |
| Card state changed lane (auto-derived move) | all watchers except the actor | yes | "<card> moved to Replied" - written when a re-read detects a lane change |
| **Removed from a card** | **nobody** | n/a | **explicitly no notification** |

Rules:
- **Never notify a member of their OWN action** - the writer always excludes `actor` from the recipient
  set (`recipient <> actor`). This is enforced both at write time and re-checked in the query.
- **Removal produces no notification** - the remove path writes an activity row (for the log) but emits no
  `console_notifications` row.
- **Durability:** unread notifications live in Supabase keyed by uid; they accumulate across sessions and
  devices until the member opens the drawer. WebKit localStorage eviction is irrelevant - nothing about the
  inbox is local.
- **Read / unread + badge clear:** the bell badge count = `console_notifications where recipient = me and
  read_at is null`. Opening the drawer marks the currently-shown notifications read (`read_at = now()` for
  the loaded set) and advances `console_read_state.seen_at`; the badge clears. Newest-first ordering by
  `created_at`. A notification stays unread until the member opens the drawer (not merely on receipt).
- **Actor identity in copy:** resolved via `resolveActor` (name), with the member canonical map; the
  "started by <owner>" context uses the card's `owner`.

---

## 3. Per-member identity color - proposal + IDENTITY.md amendment

This introduces a NEW semantic role: **member identity color** (canon IDENTITY gate G3 requires every color
to carry a meaning). It must be AA, DISTINCT from the six lane hues and from the reserved brand gradient,
and used as a graphical accent (dot / left-border / soft-tint chip) with the NAME text kept in `--ink-2`
(so it never becomes off-canon colored body text).

Lane hues in use (dark): draft `#71BFCC` (~189°), live `#7F9FD4` (~219°), sent `#9685CA` (~260°), opened
`#EE8C9D` (~350°), replied `#7EE0B8` (~157°), closed `#6b7280` (gray). The warm band (~15–45°) and the
fuchsia band (~310°) are unused by lanes. Proposal - one hue per free band, each with a light-theme darkened
variant (same treatment lanes get):

| Member | Meaning | Dark hue | Light hue (darkened) | Approx contrast vs surface* |
|---|---|---|---|---|
| Thyab | member identity | `#E6B450` (gold ~44°) | `#8A5D0A` | dark ~9:1 on `#111116`; light ~5:1 on `#fff` |
| Basel | member identity | `#C96F4A` (terracotta ~18°) | `#A8482A` | dark ~4.6:1; light ~5.5:1 |
| Agha  | member identity | `#CE7BD1` (fuchsia ~312°) | `#9C3FA0` | dark ~6:1; light ~5:1 |

*Contrast is for the color as a graphical UI object (WCAG non-text ≥ 3:1); all three clear it in both
themes. Gold and terracotta sit in the warm band ~26° apart AND differ in lightness (bright vs deep) so
they are unmistakable; fuchsia is far from every lane and from the other two. None is a lane hue, none is
the gradient. The name text stays `--ink-2` (already AA); the member hue is the dot/border/tint only.

**IDENTITY.md amendment (for Thyab to approve):** add a G3 entry "member identity color" defining these
three tokens (`--mem-thyab`, `--mem-basel`, `--mem-agha`, each with a dark and a light value), their AA
proof, and the rule that they are used only as identity accents (dot/border/soft tint), never as lane
color, never the gradient, never colored body text. Exact final hexes to be locked on approval.

---

## 4. Trello-like UX - adopt vs the derived-state boundary

Canon 3.4: lane membership is DERIVED by the `console_board` view, never stored. So the one Trello gesture
we must NOT adopt is **drag a card between lane columns to change its pipeline state** - that would imply a
stored stage and contradict the derived-state law. We adopt Trello's ease and motion everywhere it does not
imply a stored stage:

**Adopt:**
- **Drag a card onto a member** (a member rail / the card's member area) to ASSIGN, and drag off to remove
  - membership IS storable (`console_card_members`), so this is canon-legal and is the headline gesture.
- **Drag to reorder / prioritize WITHIN a lane** - order is storable (`console_card_order`) and is not
  lane membership, so a manual priority order within a column is legal.
- **Smooth FLIP animation when a card auto-moves** because a re-read changed its DERIVED lane (send, open,
  reply): the card animates from its old column to its new one. The MOVE is still server-derived; only the
  visual transition is Trello-smooth (canon `--e-standard`, reduced-motion honored).
- **Calm hover/lift, drag affordance (grab cursor, lift shadow), and drop targets** - presentation only.

**Must NOT:**
- **Drag-to-change-pipeline-state** (moving a card between lane columns to force draft→sent, etc.). Lane is
  derived; there is no writable stage. The compliant equivalent is: the card moves itself when the
  underlying signal changes (send/open/reply), animated via FLIP.
- Any drag that would write a `stage`/lane value. There is none to write.

Boundary summary: **motion + drag are adopted; the only forbidden target is the derived lane.** Assignment
and intra-lane order are the storable things we let drag write.

---

## 5. Staged PR plan (in order; each preserves send invariants + canon)

Every PR: presentation + additive data only; no change to send/compile/commit
(B2 fail-closed, F1 publish-truth, F2/F3 srcdoc, per-recipient one-to-one, guaranteed signature, greeting
opt-in, `{{ASSET_BASE}}`, `unifiedSend -> runSend`); canon holds (Alyamama joined, `letter-spacing:normal`,
no uppercase AR, Western numerals with `unicode-bidi:isolate`, guillemets AR / straight quotes EN, no em
dash incl. CSS comments, `itfGhroob` 0 refs, no dusty rose, gradient reserved for the one primary action,
lane color stays the semantic carrier). Each ships fails-when-broken tests and screenshots at
390/1024/1440, dark+light, EN+AR.

- **PR-1 - schema + backfill + identity fix.** Apply `docs/supabase-collab-layer.sql` (members, watchers,
  activity, notifications, read-state, card-order) + the owner→member/watcher backfill + the three-member
  identity backfill (fixes the "unassigned" name resolution). Make the identity write resilient
  (`PGRST204` tolerance). No UI yet. Tests: schema round-trips via mocked REST; a member resolves to a name.
- **PR-2 - members + assign/unassign UI + member colors.** Card shows its member chips (using the approved
  member colors) beside the owner chip; an add/remove members control (any member manages any member,
  incl. self); creator seeded as first member. IDENTITY.md amendment landed. Tests: multi-member add/remove,
  colors AA + distinct from lanes + not gradient, creator-is-member, EN/AR mirrored.
- **PR-3 - activity log.** Write `console_activity` on assign/unassign/comment/edit/state-change; render it
  in the Activity gate (merged with the existing send/open/reply timeline), newest first. Tests: each verb
  logs one row with the actor; the gate renders it.
- **PR-4 - notification write (events → per-user inbox, actor-excluded).** On each activity event, fan out
  `console_notifications` to watchers minus the actor; removal writes activity but no notification; self-
  action never notifies. Tests: the catalog in §2, each row asserted (recipients, actor-exclusion,
  removed-no-notify), durable (survives a reload).
- **PR-5 - bell + drawer + unread/read + badge.** A bell in `#headNav` (new `bell` icon) with a rising
  unread count; a newest-first dropdown drawer; unread accumulate across sessions; opening marks read +
  clears the badge (`read_at` + `console_read_state`). Neutral chrome (not the gradient). Tests: badge
  counts unread, accumulates across a reload, clears on open; localized copy EN/AR.
- **PR-6 - drag-to-assign + intra-lane reorder + motion.** Drag a card onto a member to assign; drag to
  reorder within a lane (`console_card_order`); FLIP animation on an auto-derived lane move; calm
  hover/lift. NO drag-to-change-lane. Tests: drop-on-member writes a member; reorder persists order; a
  derived move animates; no code path writes a stage.
- **PR-7 - durability / refresh.** Confirm notifications survive across sessions/devices (Supabase-only, no
  localStorage for the inbox); a lightweight refresh (poll or on-focus re-read) keeps the badge current;
  the paint-race fix from PR-1/2 re-renders identity chips on `loadIdentity` settle. Tests: eviction-proof
  (inbox read from Supabase after a storage clear), badge current after a background event.

Stacking: PR-1 must land (and the SQL be applied) before PR-2+. PR-3 before PR-4 (activity is the event
source). PR-4 before PR-5 (inbox before bell). PR-6 and PR-7 are independent polish once members + inbox
exist.

---

## 6. Open decisions for Thyab

1. **Member colors** - approve the three hues (gold / terracotta / fuchsia) and the IDENTITY.md G3
   amendment, or adjust.
2. **Notification-write authority** - allow an authenticated client to insert a `console_notifications`
   row whose `recipient` is another member (simple, RLS `with check` permits it), or require a
   `security definer` RPC that computes recipients server-side (stricter, prevents a client forging a
   notification to someone). Recommendation: start with the client-writer + open-insert (matches the trust
   model of the shared board and `console_comments`), harden to an RPC later if needed.
3. **Watchers** - keep `console_watchers` as a first-class table seeded = members (future-proof), or derive
   watchers = members and defer the table. Recommendation: keep the table, seed it = members.
4. **Apply order** - run the identity backfill portion of PR-1's SQL now (it fixes the current "unassigned"
   display independently of the rest).
