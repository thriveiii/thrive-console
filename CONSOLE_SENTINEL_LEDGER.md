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

**CRITICAL** — none confirmed in the repo. (Isolation clean; no secret in client/repo; no unsafe render sink found.) The one Critical-class risk, a live relay still writing "Egypt", is device-gated; see below.

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
- (to be filled by Sweep 2)
