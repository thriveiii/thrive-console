# Console Sentinel · Protocol v2

A standing, read-only, self-improving audit of the Thrive Console. It reads the live code and the two
stores, reproduces every finding in the repo with `file:line`, ranks by severity, and returns one report.
It writes no mail, spends nothing, changes no data, opens no fix PR. Fixes are separate briefs, one
concern each.

## Invariants (checked every run)

0. Isolation, first and absolute. Only the thrive-console Supabase project, only `console_` tables. Never
   Lotus-V1, its keys, or its tables. `grep -rniE 'lotus' library/ relay/ docs/` (excluding the isolation
   test that names it to forbid it) must be 0. Any Lotus reference in console code or config is Critical
   and the sweep stops there.
1. Read-only. No writing SQL, no send, no activation commit.
2. Evidence or it is a suspicion. Every ranked finding carries a `file:line` or an exact query and result,
   plus a repo reproduction. No evidence, it goes to the "to confirm" list.
3. One writer, one source, per record. Each store is checked for a second writer that can drift.
4. The device is the gate. WebKit-only or live-Supabase-only checks are marked device-gated, never
   asserted from the sandbox.

## Layers and checks

- L1 Data integrity and store agreement: write paths per record type; per-table agreement (Supabase count
  vs device count vs named divergence); orphans (page/mail/reply/thread with no parent); the console_
  write guard active.
- L2 Reply and threading pipeline: trace a real reply from inbound to a derived Replied state; name the
  broken link; confirm the ledger has one writer.
- L3 State derivation and the card model: state derived from records, never a stored duplicate that can
  drift; per-recipient identity per send; the #70 label divergence.
- L4 Relay and delivery truth: one composer, correct footer on a real send; relay version handshake;
  bounced/delivered reconcile; opens durable and deduped.
- L5a Access-removal parity (new in v2, standing). Whenever an access-removal SQL exists (a policy drop,
  a role revoke, an RLS toggle), build a table-by-table matrix across the create SQL, the add-scoped SQL,
  and the remove SQL, for every `console_` table, BEFORE the removal is run. Pass condition, one to one:
  every table with an anon policy is dropped in the removal (an undropped table stays wide open after the
  run, Critical); every table dropped in the removal has an authenticated policy (a dropped table with no
  scoped policy locks the operator out, High); every schema table appears in each relevant file (a missing
  table is a gap, flag it). Output the matrix as its own block, one row per table, never summarized away.
- L5b Denial surfaces honestly, at the layer it actually fails. A close is not honest until the denied
  path is device-proven to surface, not to look empty. Note the Postgres RLS asymmetry: a role with no
  SELECT policy gets an empty 200, NOT a 401/403, so a read-denial can masquerade as "no data" (a blank
  board) while a write-denial throws. Any honest-denial claim that keys on a 401/403 must be checked
  against this, and any test that mocks read-denial as a 401 is testing a path the live read will not take.
- L5 Security: RLS on every console_ table and not permissive past intent; no service-role key or secret
  in the client or repo; prospect text escaped at every sink; the relay is not an open relay.
- L6 Notification readiness (design input): realtime vs poll on GitHub Pages + anon key + iPad Safari;
  console_inbound queryable for "new since last seen".
- L7 Frontend integrity: no silent action, no silent catch, three-width render, Arabic rendering.
- L8 Dependency posture: per-dependency failure mode (honest vs silent); no unpinned external origin.

## Report format

Header (date, git HEAD, zero-Lotus result, which store reads came from), then a severity-ranked findings
table (Critical, High, Medium, Low), each with Layer, one-line title, Evidence (`file:line`/query),
Reproduction, Proposed fix (the single future-PR concern, no code), Blocker flag (living-card and
notification). Then a "to confirm" list and a "device-gated" list.

## Self-improving loop

After each sweep, append a dated entry to `CONSOLE_SENTINEL_LEDGER.md`: what was found, what was fixed,
and what later broke on the device that this sweep did not catch. Before the next sweep, revise this
protocol to a higher version so it would have caught the miss, bump the version, and note what changed and
why. A green run that missed a device break is itself a finding against the sweep.

### Version history
- v1 (2026-08-09): initial protocol, layers L1 to L8, first sweep recorded in the ledger.
- v2 (2026-08-09): added L5a access-removal parity (the table-by-table matrix that gates every policy
  drop) and L5b honest-denial-at-the-right-layer (the RLS empty-200-on-read asymmetry). Earned by Sweep 2,
  pre-flighting the anon-door close (#83): Sweep 1 named the permissive-anon exposure but did not carry a
  standing check that the removal SQL covers every table it must, nor that the read-denial actually
  surfaces rather than blanking the board. Both are now checked every run whenever a removal SQL exists.
