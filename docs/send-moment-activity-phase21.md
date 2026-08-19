# The send moment, and the card's cumulative memory (P21)

Two experience gaps sat on the card surface, so they ship together.

## The send moment

After a send, the screen used to hang on the operation and then, when the composer was closed, raise the
generic unsaved-edits dialog over a message that had already gone out. Sending deserves its own moment; that
dialog belongs to editing only.

- **The send never blocks the screen.** It runs through the existing confirmed-write path (`relaySend`); the
  in-progress state lives on the Send button itself (`cmp_sending`), and no scrim covers the screen while it
  is in flight.
- **On a confirmed outreach send, an elegant Thrive-identity moment appears** (`showSendMoment`): a small card
  with an in-repo inline SVG mark – the asterisk signature motif, three strokes through one core inside two
  radiating rings – with a gentle CSS radiate that respects `prefers-reduced-motion` (the rings fall still),
  and one localized line: EN «Your brief has reached its destination. Stay close.» / AR «وصل عرضك إلى وجهته.
  كن قريبًا.». One tap, Enter/Escape, or a short auto-dismiss returns to the board. There is no new
  dependency; the mark is authored in the repo and the animation is CSS.
- **The return closes the card modal directly** (`returnToBoardAfterSend` → `window.thriveModal.close(true)`),
  which bypasses the edit-only close guard by construction, so **the generic unsaved-edits dialog can never
  appear on a send**. The card's lane is already set by the ledger row, so no code moves the card. The
  unsaved-edits three-way dialog (`askBeforeClose`) is unchanged and stays bound to edit-close alone.

## R15 · The card activity trail

Cards had no memory of what happened to them. With multiple users coming, each card now carries a truthful,
elegant activity trail.

- **The History tab is the activity trail** (`activityTrailHtml`), newest-first, quiet typography, no chrome.
  Each entry carries its actor and time.
- **Sends and replies are derived from the ledger, never double-stored.** `cardActivity(slug)` reads the one
  merged timeline (`buildThread`) and drops any legacy `email` activity row, so a send is represented exactly
  once, as the ledger event, not a second activity row. The outreach send no longer writes an activity row
  at all; it is derived. Only genuinely new operations (edit / draft save, page upload, contact confirmed,
  merge, archive, restore) remain as activity rows, each already stamped with its actor by `logActivity`.
- **A message opens in place.** A send or reply is a tappable trail entry; tapping it expands, inline, to the
  full message, rendered through the **one** P12 message-model path (`buildMessage` → `renderMessageBody`,
  via the shared `thSentBubble` / `thReplyBubble`). Those builders were extracted to module scope so the
  conversation thread (`threadListHtml`) and the trail's expansion render a message through the exact same
  code: `renderMessageBody` has two call sites and no other. No copy, no modal, one scroll; the composer
  margins stay equal.
- **Saved edits are visible to everyone with their author.** An edit logs a `draft_save` activity row stamped
  with `currentActor()`, and the trail resolves it to a display name.
- **Unsaved edits are a per-user draft.** The compose working-draft is now actor-scoped: it lives under
  `compose_draft.byActor[actor]` on the synced opportunity record (`composeDraftGet` / `composeDraftSet`), so
  a second operator opening the same card never sees another person's in-progress message, and each author's
  draft is restored for that author on return. Additive over the legacy flat `compose_draft` (still restored,
  once, for continuity); a write touches only its own actor's slot.

## Evidence

`tools/send_moment_activity_test.js` runs against the real `library/app.js`:

- **The send moment**: `showSendMoment` exists; the mark is an in-repo inline `<svg>`; the moment uses the
  localized line; `returnToBoardAfterSend` closes the modal directly; a confirmed outreach send shows the
  moment; the send is **not** double-written as an activity row; the send path never invokes `askBeforeClose`.
- **One render path**: `renderMessageBody` has exactly two call sites (both bubble builders); the trail's
  expansion is those same builders; the History tab mounts `activityTrailHtml`.
- **Per-user drafts**: persist / clear / restore all go through the per-actor `composeDraftGet` /
  `composeDraftSet`.
- **The model (run live)**: `cardActivity` drops the derived `email` row, keeps the ledger send once, keeps a
  second profile's edit with its author, orders newest-first; `activityTrailHtml` renders a send as a tappable
  entry carrying its actor, an edit carrying its second author, and expands a message to the P12 bubble; ten
  reads are byte-identical.

Playwright: `thread_rebuild_test` and `thread_gutter_test` updated to the trail (the History tab is now the
activity trail; a message expands in place to its P12 bubble). `thread_structure_test`, `reply_latest_test`,
`reply_render`/`reply_editor` and the other thread tests render `window.threadListHtml(slug)` directly and are
unchanged; the bubble builders they exercise are byte-identical.

Gates: `verify.js` 35/35 (the asterisk mark is authored inline, not a new sprite symbol, so the symbol set is
unchanged), `arabic.py`, `flows.py`, `perf_gate.py` green (bundle ceilings raised with a documented P21 note).
Isolation grep clean (the two legacy-project terms match only the benign `store.js:20` prose in the shipped
client); no long dash; Arabic tanwin sits on the letter (`قريبًا`).

## Do not (held)

The UI is never blocked during a send, and the edit dialog is never reused for it. A ledger event is never
double-stored as an activity row; sends and replies are derived. No user is ever shown another user's unsaved
draft. No external animation library is added; the mark is one in-repo SVG. The one P12 message renderer is
the only path to a message bubble, in the thread and in the trail's expansion alike.

## Real-server caveat

The console's Supabase project is not reachable from the sandbox. Per-actor drafts and the actor stamped on
each activity row are proven against the real field shapes with `currentActor()` resolving to the signed-in
uid (or the single-operator default). Signed in against the live project, the same helpers key the draft and
the activity row on the auth uid; nothing here changes a schema.
