# The reply card, the thread, and the service sweep

Builds on the merged reply work (#151 attach, #153 subject-link, #154 one-link + clean render). This brief
surfaces the reply as its own card, opens the thread straight at it, renders the conversation two-sided, and
runs a full service sweep. One concern, additive only.

## Parts 1-3 · what was built

- **Reply card (Part 1):** in the Replied lane, each reply now shows as its own distinct card under its
  parent opportunity (`replyLaneCardHtml`, a `.reply-card` element that is deliberately NOT a `.tok`, so it
  never enters the opportunity count, the drag order, or any `.tok` selector). It carries the sender and a
  snippet, in the lane's own replied-green. The reply cards are a presentation of the confirmed replies
  (`repliesForOpp` -> `resolvedReplyOpp`) attached to a parent the **server view** already placed in
  Replied; they derive no stage, and the lane count stays the parent cards, so chips = lane header = count.
- **Tap to thread + pulse (Part 2):** tapping a reply card opens the conversation on the History tab
  scrolled straight to that reply, keyed by the reply's gid (`data-rid`), reusing `highlightTarget` ->
  `.th-flash` (a brief pulse, reduced-motion respected). Never the cold overview. The respond editor is one
  tap away, pre-filled.
- **Ordered two-sided thread (Part 3):** `threadListHtml` renders our send as an outgoing bubble
  (`.msg-out`, far edge) and their reply as an incoming card (`.rp-card`, reading-start edge), one
  chronological timeline. Each message's own text reads first, the quoted original stays collapsed
  (`renderReplyBodyStructured`, #154). Direction correct per message; a Latin URL inside an Arabic answer is
  isolated (`.rp-ltr`); no letter-spacing or uppercase on Arabic.

## Part 4 · One link on every surface

Every surface reads the one resolved subject-normalized link (`resolvedReplyOpp`, #154), and the new reply
card and reply detail join them: the reply card is built from `repliesForOpp` (which routes through
`resolvedReplyOpp`), and its tap opens the same thread whose History label reads "matched by the subject",
never "not matched". Basel reads attached on the board lane, the parent badge, the reply card, the History
row, the inbox, and the count. Held by `reply_hardening_test` + `reply_card_test`.

## Part 5 · All-card service sweep (read-only)

Each invariant checked on the fresh build; all HOLD, each held by a committed test.

| Invariant | Result | Held by |
|---|---|---|
| Every stage traces to `console_board`; no client re-derivation (the reply cards derive no stage) | HOLDS | `board_server_stage_test`, `board_one_read_test` |
| No card in two lanes; chips = lane headers = counts, EN and AR; no Sent 0 while signed in and online | HOLDS | `board_calm_test`, `view_invariant_test`, `reply_card_test` (count stays parents-only) |
| Every lane transition monotonic; no phantom lane (Rise Dance never recurs) | HOLDS | `board_server_stage_test`, `view_invariant_test` |
| Geometry at mobile / iPad / desktop, EN and AR: margins, centering, no overflow; multi-line Arabic titles | HOLDS | `card_geometry_test`, `arabic_geometry_test`, `phone_parity_test`, shots `shots/reply-card/` |
| The Replied lane's distinct styling + per-opportunity numbering render with real linked data | HOLDS | `replied_boundary_test`, `reply_latest_test`, `reply_card_test` |
| "unsynced" accurate and drains to zero; no silent dropped write | HOLDS | `ledger_drift_test` |
| Chip component parity (one status-chip, lane palette) | HOLDS | `status_chips_test` |

Ten-refresh identity, WebKit joined-letter rendering, and the three-width device feel remain Thyab's device
gate (confirm the build stamp changed first). This sweep proves the wiring on the fresh build.

## Not touched

No stage derivation reintroduced (the reply cards present confirmed replies for parents the server already
placed in Replied). No new colour or chrome (the lane's own replied-green tokens; the pulse reuses
`.th-flash`, reduced-motion guarded). No SQL or view change. Additive only.
