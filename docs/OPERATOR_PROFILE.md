# Operator profile and memory - design study (for ratification)

One concern: every operator has a whole, unbroken personal profile - identity, preferences, memory,
and their own performance - under a two-tier permission model, enforced at the database, not the UI.
This note is the §1 design study. It is delivered for ratification BEFORE the layout is built.

## 0. Isolation and firewall

Only thrive-console, only `console_` tables. Never Lotus-V1 (zero-Lotus grep is 0 in the shipped
client). The newsroom stays firewalled: no newsroom identity, contact, or artifact enters this
system. There is no `abdu.thyab@gmail.com` literal anywhere in the client today, and this design keeps
it that way: the admin identity lives only in the database, seeded by SQL Thyab runs.

## 1. The surface: one coherent page, an identity header and three quiet regions

A single `profile` view (a new hash route `#profile`, one line in the bundler's `VIEWS`, `initProfile`
beside `initSettings`). It reads as a whole, not a settings dump: a clear identity header, then three
self-contained regions, then - for Thyab only - a reserved sensitive zone. No region is empty for any
tier; no control dead-ends.

### Identity header (read from the auth session)
- Name (display name, editable), the operator's own email (`authEmail()`, read-only, LTR-isolated),
  an avatar/initial, a role label (Operator / Owner), and member-since.
- Source: the Supabase session (`authEmail()`, `authUid()`), plus the profile row's display fields.
  Editable only where personal (display name, avatar).

### Region 1 - Preferences (personalization, every operator)
Shapes only THAT operator's experience; never another operator's board or the shared data.
- Language default (EN / AR), theme/density within brand, notification and digest choices, default
  board view and filters, a signature block for their own sends, timezone.
- Today only `lang` and `board` exist as per-operator prefs (on the `op_prefs:<uid>` row); the rest is
  greenfield and lands here for the first time. Signature is currently SHARED
  (`thrive_signature_v1`, a synced Library key) - see decision D2.
- Persisted to `console_profiles.prefs` (JSON), read on sign-in, cached on device.

### Region 2 - Memory (personalization, every operator)
A durable per-operator memory across sessions and devices.
- Dismissed hints, pinned cards, draft notes - held in `console_profiles.memory` (JSON).
- Reconstructs on a fresh device on sign-in exactly like the board (the Stage-4 read-on-sign-in
  pattern: Supabase is the source, the device is a cache), so a cleared Safari loses nothing.
- Phase A renders the region reading real preference/memory data; the full cross-device
  reconstruction test is Phase B.

### Region 3 - Performance (personalization, derived, tied to cards and platform)
The operator's own numbers, from the SAME derivation the board and Insights already use - never a
parallel store: `sendsFor`, `outreachOpens`, `hasReply`, `repliesReceived`, `quotaUsage`, `effStage`.
- Sends they made, opens and replies attributed to their sends, cards they moved and closed, the
  follow-through cadence, outcomes over time.
- Decisive constraint (found in the code): per-operator attribution is NOT possible today. Every
  `console_mail` and activity row is stamped `actor:"thyab"` from a hardcoded constant
  (`ACTOR="thyab"`, app.js:208), even though the signed-in identity is available. The `actor` field
  was reserved for exactly this (WO-013 §10.7). See decision D3: begin stamping `actor` from
  `authUid()` on new sends so per-operator numbers become real going forward (historical rows stay
  "thyab", no migration). The full per-operator derivation and the cadence panel are Phase B.

## 2. Two tiers, enforced at the database (not the UI alone)

- **Owner tier (Thyab, abdu.thyab@gmail.com / hi@thriveiii.com):** everything above PLUS the sensitive
  infrastructure controls (the Advanced disclosure from Settings v2 / WO-028: connection health,
  GitHub activation, the relay/email endpoint, the analytics endpoint, live sync, the Supabase
  switches). Present and functional.
- **Operator tier (Mohammed, Basel, future):** identity, preferences, memory, performance, fully
  theirs, with zero access to the infrastructure zone.

The gate is a database fact, not a client flag:
- A `console_admins(uid, email, added_at)` table, seeded by Thyab via SQL (his uid). RLS grants
  `select` to `authenticated` only `using (uid = auth.uid())`, and grants NO insert/update/delete to
  clients - so an operator can read only whether THEY are an admin, and can never self-promote. The
  admin identity literal lives only in the SQL Thyab runs, never in any client (grep stays clean).
- The client's tier = "does `console_admins` return a row for me". The sensitive zone renders only
  when it does.
- Any infrastructure config that is stored in Supabase is placed behind an admin-only RLS policy
  (`using (exists (select 1 from console_admins where uid = auth.uid()))`), so a non-admin session
  physically cannot read or write it - not merely hidden. Config that is device-local (endpoint URLs
  in localStorage, the public anon key, the public relay URL) is public by the static-site design
  already and holds no secret; the UI for it is tier-gated and the tier is DB-enforced.

## 3. The data spine

- **`console_profiles`** (additive SQL, Thyab applies): one row per operator, keyed to `auth.uid()`,
  holding `prefs` and `memory` as JSONB, plus display name / avatar / email / member-since.
  - RLS: `for all to authenticated using (uid = auth.uid()) with check (uid = auth.uid())`, and NO
    anon policy. This is the FIRST properly per-owner-scoped table: an operator reads and writes only
    their own row; a signed-out client cannot touch it. On first load it defaults from the existing
    `op_prefs:<uid>` row so no operator loses their current language/board.
- **Performance is DERIVED, never stored** - computed from `console_mail`, `console_inbound`, and the
  opportunity/stage records already present, filtered to the operator through the one attribution law,
  so a person's numbers always agree with the board and Insights. No parallel counters that can drift.
- No secret in any client; no personal-address literal (the only `hi@thriveiii.com` uses are the
  shared sender constant `FROM_EMAIL` and its UI/i18n copy, which are the outreach identity, not a
  per-operator special-case); the newsroom firewall holds.

## 4. Phase A (this PR) vs Phase B (named follow-up)

- **Phase A (this PR):** the profile surface shell with the identity header and the three regions;
  Preferences wired and persisted to `console_profiles` (Stage-4 reconcile); the two-tier gate proven
  (Thyab sees the sensitive zone; a second operator does not, at RLS, with the API refusing). Memory
  and Performance render as their regions with real preference data. The `console_admins` +
  `console_profiles` additive SQL for Thyab.
- **Phase B (named, not folded in):** the full per-operator performance derivation and the durable
  cross-device memory reconstruction test. Split out if Phase A already fills one clean PR.

## 5. "Complete without breaks" - the map

Every control has a home; no region is empty for any tier; the sensitive zone is present-and-gated for
Thyab, absent-and-refused for others.

| Region / control | Tier | Data source | Persist |
|---|---|---|---|
| Identity: name, email, avatar, role, since | both | auth session + profile row | `console_profiles` (name/avatar) |
| Pref: language | both | `op_prefs.lang` -> profile | `console_profiles.prefs` |
| Pref: theme/density, digest, default view, timezone | both | new (greenfield) | `console_profiles.prefs` |
| Pref: signature | both | `thrive_signature_v1` (shared today, D2) | D2 |
| Memory: hints, pins, notes | both | new | `console_profiles.memory` |
| Performance: sends/opens/replies/cards/cadence | both | one derivation (`sendsFor` etc.), filtered by `actor` (D3) | derived, none |
| Infrastructure: relay, sync, Supabase, activation, health | owner only | Settings Advanced (WO-028) | localStorage + admin-gated DB |

## Decisions (ratified by Thyab)

- **D1 - the map above: RATIFIED as-is.** Three regions, two tiers, the `console_admins` +
  `console_profiles` RLS spine. Phase A builds on this map.
- **D2 - signature scope: PER-OPERATOR.** The signature moves into `console_profiles.prefs`; the
  existing shared `thrive_signature_v1` is read as the default on first load, so nothing is lost.
- **D3 - attribution start: START IN PHASE A.** New sends are stamped `actor = authUid()` (the email
  is kept for display); the hardcoded `ACTOR="thyab"` becomes a signed-in-operator lookup with the
  same fallback when there is no session. Historical rows keep "thyab"; no migration.
- **D4 - infrastructure boundary: TIER-GATED UI + DB-ENFORCED TIER.** The admin tier is a DB fact
  (`console_admins`, un-self-promotable); the infrastructure zone renders only for admins. Infra
  config stays device-local (the endpoints and the anon key are already public by the static-site
  design, no secret to leak). No Supabase-stored infra config is introduced in Phase A.

Ratified. Phase A build follows.
