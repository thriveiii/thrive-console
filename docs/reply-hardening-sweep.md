# Reply surfaces: hardening sweep

This brief hardens the reply surfaces after the subject-link root closed (#153). Three findings, then a
read-only stability sweep. No new feature; additive only.

## Finding 1 · One resolved link on every surface

The reply-to-opportunity link now reads the SAME on every surface, through one resolver,
`resolvedReplyOpp(r)` (`library/app.js`): a stored `opp` resolves through `replyParentOf` (child slug to
parent); an empty `opp` resolves by normalized subject the way the server view does (`subjectLinkOpp`);
noise never resolves, even when a subject coincides. No surface reads the raw `inbound.opp` any more, so a
reply is linked everywhere or unlinked everywhere.

| Surface | What it shows | Reads | Before |
|---|---|---|---|
| Board lane / Replied | the card's stage | `console_board` (server view, subject-linked) + `hasReply` → `resolvedReplyOpp` | server view resolved; client `hasReply` read raw `opp` |
| Card Replied badge | "N replies" | `replyCountFor` → `repliesForOpp` → `resolvedReplyOpp` | `replyParentOf(r.opp)` only (no subject fallback) |
| History row | the reply + its match label | `inboundFor` → `resolvedReplyOpp`; label from the resolved match tier | `inboundFor` read `r.opp===slug`; label read the empty relay `r.rule` → "not matched" |
| Replies inbox (by opportunity) | numbered replies | `repliesForOpp` → `resolvedReplyOpp` | `replyParentOf(r.opp)` only |
| Replies inbox (unmatched/held) | replies to confirm | `inboundUnmatched` → `!resolvedReplyOpp` | `!r.opp` (a subject-linked reply wrongly held) |
| Overview replies count | the header total | `repliesReceived` → `resolvedReplyOpp` | keyed by raw `r.opp` |

The History label is now the resolved match tier (`rp_rule_subject` "matched by the subject", plus
`rp_rule_header` / `rp_rule_manual` added), so "not matched to an opportunity" (`rp_rule_none`) can only
surface for a genuinely unattached reply, never for one shown inside an opportunity's thread.

**Basel:** his reply carries an empty `opp` and comes from a personal address the send never went to; only
the subject links it. He now reads attached to `مدارس المدار الدولية` on the board, the card badge, and the
History row alike (proven in `tools/reply_hardening_test.py` and `tools/reply_link_test.py`). A github row
that shares his subject never resolves (noise excluded).

## Finding 2 · The reply message reads clean

The reply card renders: sender name and address, date, subject, then the answer in its own block
(`.rp-msg`), then the quoted original as a separate collapsible quote (`.rp-quoted`), and a muted
signature if present. A Latin URL inside an Arabic answer is direction-isolated (`<bdi class="rp-ltr">`),
so RTL and LTR do not collide, and no letter-spacing reaches Arabic (the standing rules).

The tangle was the parser aborting to a flat render whenever a Gmail quote header was header-shaped but did
not cleanly split. That abort is removed: an unparsable header folds into the collapsible quote, so the
answer still reads first and the original stays separated, never one flat run of answer + header + quote.
Shots: `shots/reply-render/reply-{phone,ipad,desktop}-{en,ar}.png`.

## Finding 3 · Card polish and stability sweep (read-only)

Each invariant, checked on the fresh build, with the committed test that holds it. All HOLD.

| Invariant | Result | Held by |
|---|---|---|
| Chips = lane headers = card counts, EN and AR, no lane read as empty while online | HOLDS | `board_calm_test`, `view_invariant_test` |
| No "Sent 0" while signed in and online; one read per settle, never a blank paint | HOLDS | `board_one_read_test` |
| Every card's stage traces to `console_board`; no client re-derivation | HOLDS | `board_server_stage_test`, the five-stage audit (`docs/board-stage-audit.md`) |
| Card geometry: equal margins, centering, no overflow/clipping, multi-line Arabic titles (مدارس المدار الدولية, Rise Dance Center of Virginia) at three widths | HOLDS | `card_geometry_test`, `arabic_geometry_test` |
| The "unsynced" indicator shows a real count when writes are pending and drains to zero when they confirm, never hiding a dropped write | HOLDS | `ledger_drift_test` |
| The Replied lane's distinct styling and per-opportunity reply numbering render with real linked data | HOLDS | `replied_boundary_test`, `replied_glow_test`, `reply_latest_test` |
| Chip component parity (one status-chip, lane palette) | HOLDS | `status_chips_test` |
| Sign-in rehydrates the board (no stale empty) | HOLDS | `signin_board_test` |

Ten-refresh identity, the WebKit joined-letter rendering, and the three-width device feel remain Thyab's
device gate; this sweep proves the wiring on the fresh build.
