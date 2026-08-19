# Members, roles, and the owner's private oversight room (P27 · R17)

The console becomes multi-user: Thyab (owner), Agha, Basel, and future members. The ledger already carries the
actor on its writes; this brief builds identity, roles, and measurement on that foundation. It is authored
natively for Thrive; nothing is read from, referenced, or reused out of any other project (the firewall is
absolute). Additive SQL only; the SQL is applied by Thyab in the Supabase editor.

## What was already there (the foundation this reads, documented per the brief)

- **Sign-in is real Supabase Auth** (password grant; `library/supabase.js` `signIn` / `session` / `authUid`).
  A signed-in operator's identity is their Supabase `auth.uid()`.
- **`currentActor()`** (`app.js`) returns that uid, or the reserved constant `"thyab"` when signed out (the
  pre-stamp "console history" bucket). **Every actor-stamping write already calls it:** `logActivity` (the
  activity log), `logMail` (the one mail-ledger writer), and `postComment` (comments). So the actor is the
  member id at every ledger write, by construction.
- **`loadAdminTier()` / `isOwnerTier()`** establish the owner tier as a database fact. The authority is
  **`console_members.role`** read via the non-recursive `read_own` RLS (a legacy `console_admins` table is
  honored only if present); so a project without `console_admins` works, and the owner tier is never a client
  literal or a self-granted flag.
- **`operatorStats(uid)` / `operatorLedger(uid, opts)`** already derive a member's numbers and operations
  timeline from those stamped stores, filtered by actor; **`INSIGHTS_METRICS`** is the one P4 metric
  dictionary; **`resolveOperator(uid)`** turns a uid into a name via `console_profile_names`.

P27 builds on all of this rather than duplicating it.

## Members and roles (R17)

- **`console_members`** (additive table, `docs/supabase-members-oversight.sql`): `{ id (= auth uid), name,
  email, role: owner | member, active }`. RLS: a member reads **only their own row** via `read_own`
  (`id = auth.uid()`, non-recursive), so a client learns its own role and nothing about anyone else; the owner
  reads the whole roster via `read_owner`, scoped to `console_members.role = 'owner'`. There is **no client
  insert/update/delete policy**, so a role is never self-granted from a session; the roster is managed only by
  the SQL. The owner is seeded from `auth.users` by email (the address literal lives only in the SQL, never a
  client). Exactly two roles; finer roles are a future brief. **The owner tier the client trusts is read from
  the member's OWN row (`read_own`), which cannot recurse, so a slow or recursive `read_owner` roster read
  never locks the owner out of the room** (it would, at worst, leave the roster list empty).
- **Client role model** (`app.js`): `hydrateMembers()` reads `console_members` (falling back to the known
  operators from `console_profile_names` when the table is not present yet, so the room still lists real
  people); `memberRole(uid)` / `isOwnerMember()` resolve the role. Graceful when the SQL has not been applied:
  the single operator resolves as the owner.
- **Every write is actor-stamped, no bypass.** The ledger writers already stamp the actor; P27 additively
  stamps the **opportunity write** too (`saveDraft` / `commitDraftsBatch` set `edited_by` = `currentActor()`,
  and `created_by` on a first write), so no write path is left un-attributed.

### Role law

Members see and do the daily work (cards, sends, composer, library). The owner sees everything members see,
**plus** the oversight room and the member roster. The oversight view is owner-only, enforced in three places:
the router marks it `OWNER_ONLY` and `ownerOK()` **fails closed** (a member's direct `#oversight` URL is
corrected to the board); `initOversight` refuses a non-owner and returns to the board; and the roster read is
owner-scoped at the database (RLS). The owner-only nav link is installed at runtime for the owner only, so a
member never even sees the link.

## The oversight room (owner-only)

A private surface for Thyab. Per member: **precise numbers first**, in three windows (daily / weekly /
monthly): **sends, replies, reply rate, opens (token-based, truthful per P2), pages produced, edits.** Then a
calm **sparkline** trend (a static in-repo SVG; a still line is reduced-motion by nature and the CSS honors the
query) and the **operations trail** (`operatorLedger`). Every number carries its definition from the one metric
dictionary (`INSIGHTS_METRICS`, extended additively with `reply_rate` / `pages` / `edits`); no rate is
invented. The room also lists the **member roster** (names, roles, active) as a read-only view, with a note
that roles are set in the SQL. The pre-stamp `"thyab"` bucket is shown as one labeled "console history" line,
attributed to the owner by the stated, reversible mapping in the SQL.

`memberMetrics(uid, sinceDays)` is the one derivation: it filters the stamped mail ledger by `actor === uid`
(and by timestamp for the window), counts replies with `hasReply` and reply rate over the member's own opps,
attributes token opens (P2) to the member's send ids whose hit landed in the window, and reads pages/edits from
the member's stamped activity. So a member's numbers can never disagree with the board, and never include
another member's rows.

## The member's own panel

A member sees **exactly one thing** of this surface: their **own** performance panel, rendered in Profile by
the same `memberPanelHtml` with the same metric-dictionary definitions, scoped to their own uid only. No member
ever sees another member's numbers, or the oversight room's existence, in the UI.

## Evidence

- **`tools/members_oversight_test.js` (Node, no browser)** – 34 checks, all pass:
  - *Part A* lifts the real `memberMetrics` / `memberSendTrend` / `sparklineSvg` and proves: each member's
    numbers come only from rows stamped to that member (**A leaks into B never**); the windows filter by
    timestamp (a 60-day-old send and a 40-day-old open drop from the monthly window); reply rate is replies
    over the member's own opps; token opens attribute to the member's send ids; the per-member sends
    **reconcile** with the flat count; and the sparkline is a clean SVG with explicit width/height and no
    number inside.
  - *Part B* audits the SQL (additive, idempotent, `console_` only, newsroom untouched, member-reads-own /
    owner-reads-roster RLS, no self-grant), the router/room gating (owner-only, fails closed, refuses a
    member, no static nav link), the dictionary (new definitions in EN + AR), the actor stamping (no bypass),
    and the firewall (no other project referenced in the shipped client).
- **`tools/members_oversight_shots.py`:** the oversight room EN + AR at three widths (380 / 720 / 1120), each
  `h-overflow=False`. Screenshots in `shots/members-oversight/`.
- **Gates:** `verify.js` 35/35, `arabic.py` green. Isolation grep clean on the shipped client. No em dash;
  Western numerals; counts render outside the translated strings inside `<span class="n">`.

## Device-gated live test (Thyab runs it, fresh stamp first)

1. Two member identities operate: each write lands with the correct actor; the activity trail and ledger agree.
2. Signed in as a member: no oversight room anywhere (direct `#oversight` URL refused); the member sees their
   own panel only.
3. Signed in as owner: the room shows both members with daily/weekly/monthly rates that reconcile against SQL
   counts (screenshot the equality); trends render, reduced motion respected.
4. Additive SQL applied in the Supabase editor; zero destructive change; the existing single-user history is
   attributed to Thyab's member id by the stated, reversible mapping in the SQL.

## Do not (held)

Nothing is imported, referenced, or adapted from any other project (the firewall is absolute). No member's
numbers are exposed to another member (the room is owner-only at the router and the database; the member panel
is own-data-only). No write path bypasses actor attribution (the ledger writers stamp the actor, and the
opportunity write now does too). No metric is invented outside the dictionary. Additive only: one new table,
one read-time role model, no existing write path replaced.
