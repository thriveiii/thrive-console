# Console Sentinel · Ledger

Each entry is one sweep. The last column, "what later broke on the device that this sweep missed," is
filled in by the NEXT cycle and drives the protocol version bump.

---

## 2026-08-09 · Sweep 1 · protocol v1

- git HEAD read: `0ab34cd` (origin/main, includes PRs #76 to #81).
- Zero-Lotus grep: `grep -rniE 'lotus' library/ relay/ docs/` excluding the isolation test = 0. Isolation holds.
- Store reads: sandbox (Chromium) against the repo and the local store shapes. Live Supabase and WebKit are device-gated.
- Proofs re-run green: supabase_stage1_test (isolation), supabase_stage2_gate (dual-write), supabase_stage3_gate (read-switch), mail_migrate_gate (ledger/replies/opens), mail_footer_test, relay_courier_test, coherence_trace (#70).

### Findings (ranked)

**CRITICAL**: none confirmed in the repo. (Isolation clean; no secret in client/repo; no unsafe render sink found.) The one Critical-class risk, a live relay still writing "Egypt", is device-gated; see below.

**HIGH · L2/L3 · Board Replied does not derive from the reply records [BLOCKER]**
- Evidence: `library/app.js:615-627` effStage has no inbound branch (returns declared/live/draft/bounced/failed/opened/sent only). `library/stage-model.js:83` stageOf returns effStage; `:141` laneOf routes to "replied" only when stage==="replied". `library/app.js:641-661` causalStatus DOES derive "replied" from inboundFor, but the board uses effStage, not causalStatus. The only path to Replied is a stored declared stage: `library/app.js:1029-1041` applyInboundMoves runs `record_reply` at pull time, and `library/lifecycle.js:224` setStage("replied") stores it on the opportunity.
- Reproduction: seed a live opp (stage:"sent", no declared "replied") plus a real reply in thrive_inbound_v1 for its slug; `effStage(o)` returns "sent", `causalStatus(o)` returns "replied", `ThriveBoard.laneOf(o)` returns "sent". So the card sits in Sent and the Replied column reads zero, exactly the international-schools symptom. A migrated or backfilled reply, or reading from Supabase, never re-runs the stamp, so the reply is present but the state is not.
- Proposed fix (one concern): give effStage a "replied" derivation from inboundFor (mirroring causalStatus), so the board reads Replied from the reply records directly; stop depending on the stored stage stamp. This also removes the L3 stored-derived-state (stage="replied" duplicating what the reply records already prove).
- Blocker: YES. The living-card and any reply notification depend on the board deriving Replied from records.

**HIGH · L5 · Permissive RLS: anon can read and write every console_ row**
- Evidence: `docs/supabase-stage1.sql:95` and `docs/supabase-mail-migrate.sql:45` both create `... for all to anon using (true) with check (true)` on every console_ table. RLS is enabled but the policy is unconditional, so the anon key (public in the browser by design) grants read and write to every row of every console_ table.
- Reproduction: policy text in the SQL; no row predicate. (Live confirmation that anon reaches all rows is device-gated.)
- Proposed fix (one concern): scope the policies with a shared workspace claim (a signed JWT or a per-row secret) so the anon path can reach only this workspace's rows. This was raised and deferred in Stage 1.
- Blocker: no. It is a real exposure, not a card blocker.

**MEDIUM · L3 · Label divergence for the pre-send state (open since #70)**
- Evidence: `library/i18n.js:357` not_published "not activated yet", `:415` stage_live "Ready to send"; `library/lifecycle.js:48` STAGES include both "draft" and "ready". Two-to-three vocabularies name the same pre-send state across badge, lane, and lifecycle.
- Proposed fix (one concern): one label per state, produced in one place, reused by badge, lane and lifecycle. Blocker: no.

**MEDIUM · L8 · A down or stale relay hides the reply/open refresh**
- Evidence: `library/app.js:997` and `:1001` pullInbound returns 0 with the comment "not an error worth showing" when the relay is unreachable or on an old version. A slow or broken relay then looks identical to "no new replies/opens", with no surface.
- Proposed fix (one concern): a quiet honest state ("replies not refreshed, relay unreachable") so a down dependency is visible, not indistinguishable from empty. Blocker: no.

**LOW · L7 · Silent-catch inventory (informational)**
- Evidence: 128 empty catch blocks in library/app.js. Most are defensive storage/JSON guards that return a documented default (correct). The send, activate and action paths route through runAction with honest surfacing (prior work). No new silent action-path swallow confirmed this sweep.
- Proposed fix: none now; keep the standing re-sweep. Blocker: no.

### Passing (evidence, not a finding)
- L0 isolation: zero-Lotus = 0; the client guard allows only console_ tables (stage1 test passes).
- L1 dual-write and per-table verify: mail_migrate_gate proves all six stores dual-write, backfill is idempotent, and the verification reports per-table agreement and flags a seeded per-table divergence.
- L4 one composer and courier: mail_footer_test and relay_courier_test pass; the console attaches the footer in exactly one place (sendBody) and the repo relay writes no footer.
- L5 secrets: no service-role key, no private key, no hardcoded provider key in the client or the repo; RESEND_KEY is read from Apps Script properties; the relay requires authOk_ (not an open relay).
- L5 XSS: the untrusted render sinks spot-checked (reply from/subject/preview app.js:2564-2567, unmatched app.js:5914-5915, business/name across cards) are escaped via esc(); esc() is used 348 times.
- L8 origins: no external or CDN script; the Supabase client is a self-authored fetch wrapper; no unpinned origin.

### To confirm (suspicion, not yet evidence)
- Full sink-by-sink XSS pass over all 111 innerHTML sites (the untrusted ones checked are escaped; a complete enumeration is not done).
- Real per-table divergence beyond "Supabase holds more than the device after a Safari data clear" (needs live counts).
- Orphans: page with no opportunity, mail with no opportunity, reply with no thread, thread with no send (needs live data).

### Device-gated (only the iPad or live Supabase settle)
- L4 [High until confirmed]: the DEPLOYED Apps Script relay renders "Thrive Digital Solutions, VA, USA", never "Egypt". The repo relay is a courier (proven), but the live deployment must be redeployed (PR #80 deploy step). A wrong-address mail shipped once, so treat as High until a self-send Resend preview confirms it.
- L1: per-table Supabase-vs-device counts and orphan lists; run backfill then verify on device and cross-check the export.
- L4: the relay version handshake reports the deployed version (needs the live /exec).
- L6: whether Supabase Realtime holds on iPad Safari across background and focus. Repo evidence favors a poll on console_inbound (it carries id and ts, so "new since last seen" is queryable) as the reliable path; realtime over WebKit websockets is the doubtful one. Gather on device, do not pick here.
- L7: three-width render and Arabic joined-letters/guillemets on the international-schools card, in WebKit.

### What later broke on the device that this sweep missed
- Filled by Sweep 2: nothing broke on the device yet (the close is not run). But Sweep 1 carried no
  standing check that an access-REMOVAL SQL covers every table it must, and no check that a read-denial
  surfaces honestly rather than blanking the board. Sweep 2 added both (L5a, L5b) and found that #83's
  honest-denial keys on a 401/403, which a Postgres RLS read-denial does not raise (it returns an empty
  200). Caught in the repo before the device, which is the sweep working as intended.

---

## 2026-08-09 · Sweep 2 · protocol v1, bumped to v2 after

- git HEAD read: `5c9cefe` (branch `supabase-auth-path-a`, = origin/main `cba0c0e` which includes #82,
  plus the #83 auth code and the three SQL files under review). Ledger and protocol committed on the
  `console-sentinel` branch as in Sweep 1.
- Focus: pre-flight the anon-door close before Thyab runs the step-5 remove-anon SQL, and regress #82
  (reply derivation) and #83 (Supabase Auth). Read-only; no fix PR; the remove-anon SQL was NOT executed
  or simulated against any database, only read.
- Zero-Lotus grep: `grep -rniE 'lotus' library/ relay/ docs/` excluding the isolation test = 0. Isolation holds.
- Proofs re-run green in the repo sandbox: `reply_derivation_test` (#82, 9 checks) and `supabase_auth_test`
  (#83, 15 checks).

### Section 1 coverage matrix (the gate for the close), 7 of 7 tables one to one

| console_ table    | anon-created                | authenticated-added         | anon-dropped               | verdict |
|-------------------|-----------------------------|-----------------------------|----------------------------|---------|
| console_opps      | supabase-stage1.sql:88,95   | supabase-auth-policies.sql:32,40 | supabase-auth-remove-anon.sql:23,26 | pass |
| console_pages     | supabase-stage1.sql:88,95   | supabase-auth-policies.sql:32,40 | supabase-auth-remove-anon.sql:23,26 | pass |
| console_templates | supabase-stage1.sql:88,95   | supabase-auth-policies.sql:32,40 | supabase-auth-remove-anon.sql:23,26 | pass |
| console_mail      | supabase-stage1.sql:88,95   | supabase-auth-policies.sql:32,40 | supabase-auth-remove-anon.sql:23,26 | pass |
| console_settings  | supabase-stage1.sql:88,95   | supabase-auth-policies.sql:33,40 | supabase-auth-remove-anon.sql:24,26 | pass |
| console_inbound   | supabase-mail-migrate.sql:38,45 | supabase-auth-policies.sql:33,40 | supabase-auth-remove-anon.sql:24,26 | pass |
| console_hits      | supabase-mail-migrate.sql:38,45 | supabase-auth-policies.sql:33,40 | supabase-auth-remove-anon.sql:24,26 | pass |

No table with an anon policy is left undropped (no silent open door after step 5). No table is dropped
without an authenticated policy (no operator lockout after step 5). The client allow-list
(`library/supabase.js:43-44`) and the schema CREATE TABLEs are exactly these 7; no orphan table is missing
from any file. The close, at the SQL-coverage level, is clean.

### Findings (ranked)

**CRITICAL**: none. The close is a real close, not a false one: the coverage matrix is one to one, and
after step 5 the anon role genuinely loses access to every console_ row. No Lotus, no secret, no unsafe
new sink.

**HIGH · L5b · After the close, a signed-out read blanks the board instead of asking for sign-in**
- Evidence: #83 surfaces denial only on a thrown 401/403. `library/supabase.js:128` sets `err.authRequired`
  on 401/403; `library/app.js:1622` maps that to `__supa.authRequired`. But a Postgres RLS SELECT for a
  role with no permitting policy returns an empty `200`, not a 401 (the anon key is a VALID JWT with
  role anon, so it authenticates fine and is merely under-privileged). So post-step-5, with reads switched
  to Supabase (`console_sb_read="1"`) and no session, `supaHydrate` (`library/app.js:1598`) succeeds with
  empty arrays: `__supa.hydrated=true`, `degraded=false`, `authRequired=false`, `__supa.opps=[]`.
  `getDrafts` (`library/app.js:1376-1381`) then takes the Supabase branch and returns `[]`: a blank board,
  no sign-in prompt. That is the exact "blank board that looks like no data" the #83 brief section 6
  forbids. Writes still surface honestly (an INSERT as anon returns 403 → authRequired), so the gap is
  reads only.
- Reproduction: reasoned from PostgREST/Supabase RLS semantics (SELECT with no policy = empty 200). The
  repo test cannot show it because it mocks denial as 401 (see the Medium below). Live status-code
  confirmation is device-gated, but the semantics are standard and well documented.
- Proposed fix (one concern, future brief): when reads are switched to Supabase and the operator is not
  signed in, treat the state as authRequired proactively (gate on `signedIn()` before trusting a possibly
  RLS-filtered empty read), or probe a known-non-empty table and treat empty-while-signed-out as denial.
  Never render a Supabase empty as the board when signed out post-close.
- Blocker: no, but it must land before or with step 5, or the first Safari-data-clear reads as data loss.

**MEDIUM · L5 · The scoped policy trusts the whole `authenticated` role, not the one operator**
- Evidence: `docs/supabase-auth-policies.sql:40` grants `to authenticated using (true) with check (true)`.
  With a single account this equals Thyab, but if project sign-ups are enabled, ANY authenticated user gets
  full CRUD on all console data after step 5. The door closes on anon but opens to "any signed-in user."
- Reproduction: policy text; no `auth.uid()` predicate. The sign-up setting is a Supabase dashboard config,
  device/console-gated.
- Proposed fix (one concern): tighten to `using (auth.uid() = '<thyab-uid>')` (the brief already floated
  this), and confirm sign-ups are disabled in the project so `authenticated` cannot be self-minted.
- Blocker: no.

**MEDIUM · sweep-fidelity · The auth test mocks read-denial as a 401, a path the live read will not take**
- Evidence: `tools/supabase_auth_test.py` forces `denyRest` to return a 401 on `/rest/v1/`, and asserts
  `authRequired` is set. Real RLS read-denial is an empty 200 (see the High). So the "a persistent 401 sets
  authRequired ... the board falls back, never blank" check passes for a denial shape reads will not
  actually produce post-close. The test is not wrong about the 401 path (writes and expired-JWT do 401);
  it just does not cover the empty-200 read path that is the real signed-out-after-close case.
- Proposed fix (with the High): add a case where a Supabase read returns an empty 200 while signed out and
  assert the board does NOT render it as empty (once the fix defines that behavior).
- Blocker: no.

### Regression pass (evidence, not findings)

- #82 reply derivation, confirmed and reproduced. `hasReply(o)` (`library/app.js:621`) is the one shared
  helper; `effStage` derives "replied" from it (`library/app.js:632`) and `causalStatus` uses the same
  helper (`library/app.js:667`); the pull-time stamp (`applyInboundMoves`) is gone (grep = 0 in app.js).
  Sandbox: an opp with a reply yields `effStage="replied"` and `laneOf="replied"`; the Replied count equals
  the opportunities that actually have a reply; no double-derivation.
- #83 auth path, confirmed. `bearer()` (`library/supabase.js:65`) returns the session JWT when signed in,
  the anon key only with no session; `rest()` uses `bearer()` for every data call (`:112`), so no data call
  forces the anon key while a session exists. `apikey` stays the anon key by design (`:111`); it is the
  project publishable key used for gateway routing and does not itself grant rows, so it is not an access
  path once anon policies are dropped, access comes from the role in the Authorization JWT. The passcode
  Lock and its GitHub-token vault (`library/gate.js`) are untouched by #83 (diff does not include gate.js;
  `library/app.js:1486-1487` confirms the token, sync key and vault key are deliberately NOT mirrored to
  any anon-readable table).
- L7 auth/read path: no new silent action-path swallow. Every `catch` in `library/supabase.js` is a
  documented default or best-effort (the JSON-parse guards at `:72`/`:91` still throw via the
  `!data.access_token` check; `refresh` failing clears the session so the next `rest()` surfaces
  authRequired). The Settings sign-in routes through `runAction` (honest surfacing).
- L5 secrets: the auth change adds no hardcoded secret; the password is user-entered and cleared after
  sign-in; the stored session is the operator's own JWT, not an embedded key; no service-role key anywhere.

### Device-gated (only the iPad or live Supabase settle)
- The exact status code a live Supabase returns for a signed-out read after step 5 (the High predicts an
  empty 200, not a 401). Confirm on the device before running the removal, and confirm the denial surfaces.
- Session persistence across an iPad Safari reopen and a Safari-data-clear (which is the trigger for the
  blank-board High).
- Whether project sign-ups are disabled (the Medium): a dashboard setting, not visible in the repo.

### What later broke on the device that this sweep missed
- Filled by Sweep 3: the anon close ran on the device (remove-anon 06:03, auth-policies 07:37), and in the
  window between them a signed-in read was RLS-denied to empty for every table. That is the L5b class
  Sweep 2 named, so it was foreseen. What Sweep 2 did NOT foresee: the cutover would also expose that the
  card mail-state layer (console_mail / inbound / hits) can be present-in-schema but empty-in-rows in
  Supabase while opps are full, and the board reads Supabase-only, so every card fell to "no email yet".
  Sweep 2's matrix checked policy coverage table by table; it did not check DATA presence table by table
  for the layers the cards derive from. Sweep 3 adds that (L1a).

---

## 2026-08-09 · Sweep 3 · protocol v2, bumped to v3 after

- Code read: the card-state read path on `origin/main` (`cba0c0e`, the Stage 3 + mail-migrate code from
  #81), reasoned on the working tree, which matches for these functions. Ledger committed on the
  `console-sentinel` branch as before. Read-only: no fix PR, no data write, no live row count run.
- Zero-Lotus grep: `grep -rniE 'lotus' library/ relay/ docs/` excluding the isolation test = 0. Isolation holds.
- Symptom: every opportunity in Ready with "no email yet"; opps intact, each card's Sent/Opened/Replied
  not surfacing, reading from Supabase signed in.

### Headline: the exact break location

Not a code line that loses state. The card state on a signed-in Supabase read is exactly the contents of
`console_mail` / `console_inbound` / `console_hits`. `sendIndex` (`library/app.js:478`) finds zero sends
because `getMailLog` (`library/app.js:2998`) returns an empty `__supa.mail`, which `supaHydrate`
(`library/app.js:1623-1624`, `select=data` on `console_mail`) read back as zero rows. `effStage`
(`library/app.js:632-641`) then returns "live" for every card, which renders `tok_noemail`
(`library/app.js:5489`). This is a GENUINE EMPTY console_mail (a data gap), not a missing read and not a
linkage mismatch.

### Findings (ranked)

**HIGH (data, device-gated) · the mail-state tables are empty or short in Supabase while opps are full.**
- Ruled out, with evidence, the two code suspects the brief named:
  - Missing Supabase read: REFUTED. `supaHydrate` reads all three mail tables
    (`library/app.js:1623` mail, `:1625` inbound, `:1627` hits), not opps and pages only.
  - Linkage mismatch: REFUTED. The write puts the whole record in the `data` jsonb and a top-level `opp`
    (`supaMailRow` `library/app.js:1450-1452`, `data:rec`); the read takes `r.data`
    (`library/app.js:1624`); the derivation matches on `x.opp` (`sendIndex` `library/app.js:479-482`).
    Same key both sides, slug throughout. `console_mail` has a `data jsonb` column
    (`docs/supabase-stage1.sql:66`), so `select=data` does not error.
  - Corollary from the sequential awaits: opps rendering PROVES the mail read did not throw
    (a throw nulls opps too, `library/app.js:1619-1623`), so the mail read succeeded and returned few or
    zero rows. By elimination this is the brief's option 3: a genuine empty console_mail.
- Reproduced in the repo sandbox (mocked Supabase, signed in, `console_sb_read=1`):
  - Case A, `console_opps` present but `console_mail`/inbound/hits empty: `getMailLog().length===0`,
    `effStage==="live"`, `laneOf==="live"`, the card reads "no email yet". The exact symptom.
  - Case B, the same opp with one sent row, one inbound reply and one hit present in Supabase:
    `getMailLog().length===1`, `getInbound().length===1`, `effStage==="replied"`. State returns.
  - So the code reads and links the mail layer correctly when it is present; the live symptom is the
    absence of rows in `console_mail` (and inbound and hits), a data gap.
- Prescription: see below.

**MEDIUM (mechanism, by design) · an empty Supabase slice shadows the device for every card layer.**
- Evidence: `getMailLog` (`library/app.js:2998`), `getInbound` (`library/app.js:1005`) and the opens
  source (`library/app.js:351`) each return the Supabase slice whenever `supaReadable()` is true, and an
  empty array is truthy, so an empty (but successful) Supabase read is returned in place of the device
  store that still holds the records. This is what turned "mail not yet in Supabase" into a total,
  silent state blackout rather than a fallback. It is consistent with the Stage 3 design (Supabase is
  authoritative once reads switch, and merging the device back would reintroduce the dual-source
  divergence that design avoids), so it is a design tension to be aware of, not a clear bug to patch. The
  honest cure for the visible symptom is to make Supabase actually hold the rows (re-backfill), not to
  silently merge stores.

**LOW (process) · the anon close bypassed the in-app cutover guard.**
- Evidence: `supaVerify` (`library/app.js:1547-1558`) already checks `console_mail`, `console_inbound`
  and `console_hits` present-key by present-key, and `supaSetRead(true)` refuses the read switch on any
  divergence. But that guard runs only for the in-app "Read from Supabase" switch; the anon-door close
  was run as SQL in the editor, which does not consult it. Note also `supaVerify` compares only against
  the DEVICE's own rows, so it passes vacuously if the device's mail log was empty at switch time. So the
  guard exists but did not gate this cutover.

### The prescription (one concern)

- This is a DATA RECOVERY, not a code fix: re-run "Backfill existing into Supabase" (Settings, Storage)
  from the device that still holds the mail ledger, so `console_mail` / `console_inbound` / `console_hits`
  are populated; the cards then derive Sent/Opened/Replied from them on the next signed-in read. The
  backfill as written already covers all three with the correct keys and linkage (`library/app.js:1512`
  mail, `:1514` inbound, `:1518-1521` hits, each via the same `supa*Row` shape the reader expects), so it
  needs no code fix first.
- Device-gated and viable ONLY if that device still holds `thrive_mail_v1` / `thrive_inbound_v1` /
  `thrive_hits_v1`. Confirm first with Thyab's own row counts in the SQL editor
  (`select count(*) from console_mail;` and the same for inbound and hits) against the device's counts.
  If the device no longer holds the records (a Safari data clear, or the backfill never ran while mail
  existed), the mail history for these cards is not recoverable from Supabase and would have to be
  rebuilt from Gmail and the relay, a separate and larger effort. Raise, do not decide.
- One raise for a later brief, not this one: the Medium mechanism means any future incomplete cutover of
  a card layer blanks it silently. Worth deciding whether a signed-in board should surface "reading from
  Supabase, mail layer empty" when opps are present but mail is zero, rather than showing every card as
  "no email yet" with no hint. Named, not decided.

### Device-gated (only the iPad or live Supabase settle)
- The row counts of `console_mail` / `console_inbound` / `console_hits` in Supabase (the confirmation of
  the data gap) and whether the device still holds the source records (the confirmation the re-backfill
  is viable). Both are Thyab's to run; the sweep reasons from the shapes only.

### What later broke on the device that this sweep missed
- (to be filled by Sweep 4)
