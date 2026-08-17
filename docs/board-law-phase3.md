# Board behavior law (P3)

Two generic board defects, fixed by law rather than by case. Additive only.

## R6 · One recency clock, every lane

`lastActivityAt(opp)` is the single recency function, imported by every lane sort. It returns, in ms, the
latest of: our sends (`console_mail.ts`), a token-bearing open (a real person, P2), an inbound reply or
bounce, and a stage change (the activity log). Timestamps are TEXT; `parseTs` parses them explicitly, and a
malformed value returns `0` so it sorts **last** and never throws.

Every lane sorts by it, descending - newest activity on top. The device-stored manual order (`cardOrder`)
is **retired**: it was applied on top of the lane's order and could hold a card with new activity down. There
is now no lane-specific sort, no manual pinning, no exception. A new event lifts its card to the top of its
lane on the next refresh.

## R5 · The badge means one thing

The badge lights when there is activity newer than the owner's last view of that card, and nothing else.

- **Server-held acknowledgment.** `last_viewed_at` rides the opp record (`data`, additive; it round-trips
  through `console_opps.data`), written by `markCardSeen` when the owner opens the card. So a card seen on
  one device is seen on all. The local `thrive_card_seen_v1` map is only a fast offline mirror; whichever
  acknowledgment is newer wins (`lastViewedAt`), so the record is authoritative once it syncs. This is the
  fix for the VSD-Photography bug: a badge that stayed lit for 8 days because acknowledgment lived only in
  one device's localStorage and nothing durable ever cleared it.
- **Opening clears it by definition.** The view timestamp advances; there is no separate clear action and
  **no stored badge flag** anywhere. The count is always computed from timestamps.
- **The count is distinct new events since the last view**: replies, bounces, and opens **by a person** (a
  token-bearing hit whose `r` is one of this card's send ids, P2). An anonymous page view never lights the
  badge. Compared on the parsed-ms clock, so a malformed timestamp is never counted as newer.
- The visual-state law holds: the badge maps to the named state `new-activity` only.

## Case-free logic sweep

Grep of `library/*.js` for slug/address literals inside behavior logic. **Zero per-card behavioral
branches found.** Every specific-slug/address literal is one of:

- the canonical bounce-sender rule `mailer-daemon@` / `postmaster@` (a sender *class*, not a card) -
  `library/inbound.js:93,117`;
- self-test fixture data inside `selfTest`/harness blocks - e.g. `library/inbound.js:355,391`,
  `library/intake.js:327-377`, `library/numbers.js:267`;
- seed/config, which the brief allows.

The two `slug=(typeof slug==="string")? slug : slug.slug` lines (`app.js:859,3031`) are argument-shape
guards, not per-card branches. No removals were needed.

## Evidence

`tools/board_law_test.py` (10 checks, engine-independent):

- R6: `lastActivityAt` returns a real ms per card and a malformed hit ts does not throw; recency orders
  bbb > vsd > aaa; the lane paints newest on top; a new event lifts a card to the top on refresh.
- R5: a token open the owner hasn't seen shows the badge (count 1); opening writes `last_viewed_at` on the
  opp record and clears the badge (count 0) with no stored flag; the acknowledgment holds with the local
  seen map cleared (cross-device); a new tokenized open relights it (count 1); an anonymous view never
  lights it.

Device gate (Thyab): open VSD once, the badge clears and stays clear across refresh and on a second device;
a new tokenized visit relights it with count 1; trigger one new event and watch that card rise to the top of
its lane.
