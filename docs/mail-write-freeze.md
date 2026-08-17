# Thrive Console · the send ledger stopped writing (whole-path fix)

`console_mail` held 28 rows days ago and still holds 28. No send has written a row in days: every campaign
(Fleurs and the rest) is Delivered by Resend, but not one is recorded. The prior brief's timeout and honest
failed state are working correctly and exposing the real disease: the ledger write path is broken for **all**
sends. This fixes the write path itself. Author only; Thyab merges, runs the SQL, confirms the count moved.

---

## Step 1 · The trace, and the exact break

Every send path funnels into one row builder and one write:

```
Outreach Send / Send to myself / board send / thread reply
  -> relaySend(intent)                       (app.js) dispatch to the relay (Resend) - Delivered
  -> supaConfirmMail(row)                     (app.js:2811) awaited confirmed write
       -> supaMailRow(rec)                    (app.js:2789) builds the row object
       -> window.ThriveSupa.upsert(           (supabase.js:179) POST /rest/v1/console_mail
            "console_mail", [row])              Prefer: resolution=merge-duplicates
```

**The exact break - a schema/column mismatch on `console_mail.actor`:**

- `supaMailRow` (**library/app.js:2793-2794**) emits a **top-level `actor` column** on every row:
  `{ id, opp, status, to_addr, subject, ts, actor, data, up }`.
- `actor` exists in the table **only after** the manual migration
  **`docs/supabase-profile-phase-b.sql:35`** (`alter table console_mail add column if not exists actor`). The
  Stage-1 base table (`docs/supabase-stage1.sql:59-68`) has **no `actor`**.
- Introduced together in commit **`583207b` (profile Phase B, 2026-08-14)** - the freeze window. The client
  ships automatically; the SQL is run **by hand**. If that run was missed, the deployed DB is one column behind
  the client as of Aug 14.
- On a DB without the column, PostgREST rejects **every** insert with **PGRST204** ("Could not find the 'actor'
  column of 'console_mail' in the schema cache"). Because the upsert is a single merge-duplicates batch, the
  unknown column rejects the whole row.
- The 400 is **swallowed**: `supaConfirmMail`'s catch (**app.js:2822-2826**) records it to the diverge ledger
  and returns `confirmed:false`; `supaFlush`'s catch (**app.js:2703**) keeps the row queued and records it.
  Neither surfaces. Resend keeps Delivering, so the freeze is silent.

Cause classification (acceptance 3): **schema mismatch (a column the insert names that the deployed DB lacks),
then swallowed.** Not "not called", not RLS, not an empty-opp early return.

---

## Step 2 · The write, fixed for every path

The write must not hard-depend on a column a later migration adds.

- **`mailUpsert(rows)`** (app.js) is the one console_mail writer. It tries the full row; if the server is a
  migration behind (a missing-column / **PGRST204 / 42703** / "schema cache" error, detected by
  `mailColMissing`), it **drops the optional top-level columns (`actor`) and retries**. `actor` still travels
  inside the `data` jsonb, so **nothing is lost** and the send records whether or not the migration ran.
- Both write sites route through it: the confirmed write (`supaConfirmMail`) and the durable queue flush
  (`supaFlush`, the `console_mail` case).
- **Not swallowed:** a *non-schema* error (a real 500, RLS) still throws, so `supaConfirmMail` records the
  diverge and the card shows its failed state; only the known, safe schema-drift is auto-recovered, and even
  that is recorded to the diverge ledger (visible, never silent).
- After the fix, a new send writes its row and moves the count from 28 upward, and the card moves to Sent on
  confirm.

**The schema, restored additively:** `docs/supabase-mail-actor-column.sql` adds the `actor` column back
(`add column if not exists`, idempotent) so it is first-class again for server-side per-operator aggregation.
The client fix means sends record even *before* this is run; the SQL restores the column and verifies the count.

---

## Step 3 · The historical backlog, reconciled (additive, from the operator's own ledger)

The server is missing **every** send since Aug 14 - but the operator's device still holds them in the local
ledger with their **true recipient, subject, and timestamp**. `reconcileMailToServer` (app.js) walks that
ledger and upserts every delivered send (and every one the freeze stranded as `unrecorded`/`sending`) through
`mailUpsert`. It runs once per session after sign-in (the unlock hook), and is idempotent (upsert by id), so
re-running writes nothing new. A stranded send that lands flips locally to Sent, so its card leaves "sent, not
recorded". This reconciles from the real send data, not a guess.

For any residual send that exists in neither the local ledger nor the server, `docs/supabase-mail-actor-column.sql`
carries the read-only count and latest-rows queries to spot it against Resend, and a manual insert can be added
in the same additive pattern. Deletes nothing.

---

## Step 4 · Proof and guard

- **Visible proof** (Thyab, on device): `docs/supabase-mail-actor-column.sql` query 2 shows the count past 28;
  query 3 shows the latest send at the top with today's timestamp; query 4 shows per-opp recorded sends.
- **Engine-independent proof** (`mail_write_path_test.py`): against a mock server that rejects the `actor`
  column exactly like the frozen DB, a send now writes its row (freeze lifted), `actor` preserved in `data`; on
  a migrated DB `actor` stays first-class; a non-schema error still throws (never hidden); the reconcile pushes
  the whole local backlog and flips stranded sends to Sent. Fails-when-broken proven (route back through the raw
  upsert and the write throws, no row lands).
- **The guard stays:** the unsynced/drift indicator counts any write that fails and drains to zero when it
  succeeds, so a silent freeze can never sit undetected again.

---

## Acceptance

1. A new send writes a `console_mail` row: the count moves past 28, the row appears with today's timestamp.
   **Met** (test: write lands against a DB missing the column; SQL queries 2-3 prove it on device).
2. Fleurs and every delivered-but-unrecorded send are reconciled; no card sits on "sent, not recorded" for a
   send Resend delivered. **Met** (`reconcileMailToServer` from the local ledger).
3. The exact break is named (file, line, cause). **Met** (Step 1: app.js:2793-2794 + profile-phase-b.sql:35,
   commit 583207b; schema mismatch, then swallowed).
4. Ten refreshes identical; lane matches detail; chips == headers == counts, EN and AR. **Met** (bed unchanged:
   `one_stage_source_test`, `board_calm_test`).
5. The unsynced indicator reflects any future write failure and drains to zero. **Met** (the prior brief's drift
   guard, unchanged).

Full bed 73/73 green; verify 35/35; arabic / flows green; perf green (ceiling 665K->668K for the new writer;
app.js is now large and should be split soon - flagged in `tools/perf_gate.py`); isolation grep 0; build stamp
moved. No Lotus, no newsroom.
