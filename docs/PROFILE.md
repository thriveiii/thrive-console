# The operator profile: identity, performance, operations, memory (Phase B)

One concern: an operator's identity and record are complete and real across the console. This is the
shape and the conventions Phase B settles, so future needs add to it rather than migrate it.

## 1. One name resolver

Every surface that shows an actor (a comment author, a discussion reply, the operations ledger, the
performance region) turns a uid into a real name through one function, `resolveOperator(uid)` in
`library/app.js`. No surface carries its own fallback label. The generic label «زميل» / "A teammate"
(`dc_someone`) lives inside the resolver and is returned for exactly one case: a uid that resolves to
nobody, a genuinely deleted or unknown operator. A live operator never reads as «زميل».

The name comes from `console_profile_names`, a minimal cross-readable projection of `console_profiles`
exposing only `(uid, display_name, email)` to any authenticated operator (see
`docs/supabase-profile-phase-b.sql`). The base table keeps its owner-only RLS, so preferences and memory
are never readable across operators. Names are shareable; the rest is not. The map hydrates once on
sign-in (`hydrateOperatorNames`, the `unlock` hook) and caches on the device.

Two floors keep a real name on screen even before, or without, that read:

- the signed-in operator resolves their own name from their loaded profile;
- a comment seeds a floor from the display-name snapshot it already carries (`operatorNameSeed`).

So the authoritative read refreshes a name that is already correct, and «زميل» appears only when no
source anywhere knows the uid.

## 2. Performance derives, never counts in parallel

The Performance region reads `operatorStats(actor)`, which derives every number from the actor-stamped
rows through the one attribution law the board and Insights already use (`outreachOpens`, `hasReply`):
sends, opens, replies, reply rate, cards moved, cards closed, and a seven-day cadence against the daily
rhythm of 3. There is no parallel counter, so a person's numbers can never disagree with the board.

History stamped before per-operator stamping began carries the reserved default actor (`thyab`). It is
reported as one honest bucket, "console history" (`consoleHistoryStats`), never split into or fabricated
as any real operator's numbers.

## 3. The operations ledger is derivation, not a second copy

`operatorLedger(actor, opts)` builds a per-operator timeline from the two stores the system already
keeps: a send from the stamped mail ledger, every other action from the stamped activity log. Nothing is
double-written. Kinds are `send`, `move`, `comment`, `page`, and an honest `other`; the view is newest
first, filterable by kind, and paged. Every date rides the one composer (`fmtWhenHtml`), so an Arabic
locale reads a right-to-left row with Latin digits.

Where a durable row lacked a first-class actor column, it is added additively at the write site, never
backfilled: `console_mail` gains an `actor` column (`supaMailRow` now sets it, and the additive SQL adds
the column), so a row with no actor stays honestly empty rather than being guessed into a number.

## 4. Namespaced, versioned keys: the convention for what comes next

Preferences and memory live inside the two `jsonb` columns on `console_profiles` (`prefs`, `memory`).
From Phase B on, a key is **namespaced and versioned**:

```
memory.pins.v1        memory.hints.v1        memory.notes.v1
prefs.signature.v1    prefs.view.v1          prefs.density.v1
```

The rule: **a future need ADDS a key, it never migrates a table.** A new kind of memory is a new
namespace; a breaking change to an existing one is a new `.v2` written alongside the `.v1`, so an older
client keeps reading what it understands. Because both columns are `jsonb`, none of this touches the
schema.

Accessors live in `library/app.js` (`ThriveProfileKeys`): `profileMemNS(ns, dflt)` /
`setProfileMemNS(ns, v)` and `profilePrefNS(ns, dflt)` / `setProfilePrefNS(ns, v)`. A read prefers the
versioned key and falls back to the legacy flat key (`memory.pins`), so nothing an operator already saved
is ever lost; a write always lands on the versioned key. Memory persists to `console_profiles` and
reconstructs on any fresh device at sign-in (the Stage-4 pattern): clear the browser, sign in, and pinned
cards, dismissed hints, and notes return.

## 5. What Thyab runs

`docs/supabase-profile-phase-b.sql`, once, in the thrive-console Supabase project. It is additive and
idempotent: it creates the `console_profile_names` view, grants it to `authenticated`, and adds the
`console_mail.actor` column if it is not already there. There is no drop and no data is rewritten. Device
gate: sign in as two operators and confirm each sees the other's real name on a shared card's discussion.
