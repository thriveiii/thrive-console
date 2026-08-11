# Thrive Console · Launch device checklist

The one printable device pass. Run every line on the iPad, in WebKit (Safari), in this order, before
release. The order is deliberate: an earlier failure stops later waste, so do not skip ahead.

This file holds no credentials. The release itself (the URL, the passcode, and each operator's own
sign-in) goes through the private channel Thyab chooses, never this repo and never a chat log.

Read-only audit passed on the final code (Sentinel Sweep 5, the release audit delta on top of the
#103 sweep): every surface changed since #103 covered, zero silent controls, zero secrets, the
reconstruction counter at zero on fresh data. What a Chromium sandbox can prove is proven in the test
bed; what only a device can prove is the list below, which is why WebKit and the live relay are the
device's to sign off.

Sign-off: release only when every box is checked on the device.

## 1. Deploy truth

- [ ] **The footer build marker is current.** WHERE: the gate screen, the small build marker at the
      foot. HOW: it matches the latest commit on the default branch, so the live site is the final
      code and not a stale build.
- [ ] **The Pages action is green.** WHERE: GitHub, the repository's Actions tab. HOW: the most recent
      Pages deploy succeeded. If it is red or stale, stop here and redeploy before going on.

## 2. The gate (the graduated #105 model)

- [ ] **Cold open climbs passcode then lobby then board.** WHERE: a fresh or cleared browser. HOW:
      open the URL; it asks the passcode first, then the operator sign-in (the lobby), then lands on
      the board. Not one of the three steps is skipped.
- [ ] **A return inside 30 minutes goes straight to the board.** HOW: leave for under thirty minutes,
      return. The board is there, with no gate at all.
- [ ] **30 to 45 minutes re-gates to the lobby only.** HOW: leave idle between thirty and forty-five
      minutes, return. It asks the operator sign-in (the lobby), not the passcode. The passcode still
      holds.
- [ ] **Past 45 minutes re-gates to the passcode.** HOW: leave idle beyond forty-five minutes, return.
      It drops all the way to the passcode (a full exit).
- [ ] **Sign-out lands on the lobby.** WHERE: the Lock button. HOW: it returns to the operator sign-in
      (the lobby), never a blank board and never all the way to the passcode.
- [ ] **The calm return copy reads naturally in both languages.** HOW: on a re-gate, read the
      welcome-back line in English, then switch language and read it in Arabic. Both read as calm,
      natural sentences.

## 3. Truth: the states derive from evidence, and every surface agrees

- [ ] **madar holds Basel's reply and derives Replied.** WHERE: the board, the madar card. HOW: it
      carries Basel's reply and reads Replied, derived from that reply, not declared by hand.
- [ ] **thrive-july shows 0.** WHERE: the board / Insights, the thrive-july row. HOW: its opens and
      replies read zero, because there is no evidence for it, not a guessed number.
- [ ] **A re-match changes nothing.** WHERE: Settings, Replies, "Re-match held replies". HOW: tap it;
      no count moves and no card changes, because the attribution is already settled (idempotent).
- [ ] **Insights tiles, the campaign table, and the person table agree.** WHERE: Insights (home). HOW:
      the tiles, the campaign table, and the person table report the same sends, opens and replies for
      the same opportunity. No two disagree.

## 4. The write path: a group reply persists, and the net stays quiet

- [ ] **A fresh group-reply round trip leaves the child row in Supabase.** WHERE: a group opportunity;
      reply from one recipient's address. HOW: the child card appears as Replied; then, in the
      Supabase table editor (SQL read), the child row is present in `console_opps`. The reply survived
      the write path, not only the read-side net.
- [ ] **The reconstruction counter is zero.** WHERE: the browser console. HOW: read
      `window.__thriveReconCount`; it is zero on fresh data. A non-zero value is the signal that a
      child opp went missing (a flush-race regression), and would be logged with the slug.

## 5. The thread: the full editor, styled and threaded, in both directions

- [ ] **The thread carries the full send editor.** WHERE: a card's History tab. HOW: the reply
      composer is the same editor as a first send (formatting, templates, links), not a bare textarea.
- [ ] **A styled, templated self-test reply sends and threads in order.** HOW: compose a reply using a
      template and some styling, send it to an inbox you control. It leaves through the relay with a
      fresh Message-ID and appears in the thread in send order, oldest to newest.
- [ ] **Basel's actual quote-header line renders unscrambled.** HOW: in a thread that quotes Basel's
      reply, the "On <date> ... wrote:" header line reads in its correct order, not reversed or
      shuffled, with the address and date isolated left-to-right.
- [ ] **Arabic and English messages side by side do not interleave.** HOW: in a thread holding both an
      Arabic and an English message, each keeps its own reading direction; the lines do not bleed into
      one another.

## 6. The board speaks the ratified language

- [ ] **The glow breathes calmly on conversation cards.** WHERE: the board. HOW: a card that holds a
      reply carries a slow, calm green glow, not a hard or blinking one; a card with no conversation
      does not.
- [ ] **One dashed boundary before Replied, mirrored in Arabic.** HOW: a single fine dashed separator
      sits before the Replied lane; in Arabic it mirrors to the correct side.
- [ ] **The phone shows the same language.** HOW: open the console on the phone; it is in the same
      language as the iPad, and the board reads correctly at that width.
- [ ] **The longest titles do not collide or clip at three widths.** HOW: find the longest-named
      cards; at mobile, iPad-landscape and desktop widths, they neither touch a neighbour nor clip.
- [ ] **The ratified tagline and truthful hero subtitles render in both languages.** HOW: the tagline
      reads "Where your outreach thrives" in English and "حيث يزدهر تواصلك مع العالم الخارجي" in
      Arabic; the hero subtitle matches the board's real state (a reply state never shows a stalled
      line), in both languages.

## 7. Noise and Settings

- [ ] **noreturn and the ESP domain are out of the human list.** WHERE: Replies / the inbound list.
      HOW: a no-reply sender and the ESP's own domain do not appear as human replies to attach.
- [ ] **The Alleghany reply is human, with one-tap attach.** HOW: the Alleghany reply reads as a human
      reply and offers a single tap to attach it to its opportunity.
- [ ] **Settings shows the daily set with one closed Advanced disclosure.** WHERE: Settings. HOW: the
      everyday controls are visible; the rarely-needed ones sit inside one closed Advanced disclosure.
      Read it once in English and once in Arabic; both are calm and complete.

## 8. Three operators, one identical console

- [ ] **Each of the three signs in and sees the identical console.** WHERE: the gate. HOW: sign in as
      Thyab, then Mohammed, then Basel, each with their own credentials. Every operator sees the same
      tabs and the same board, with no per-operator difference.
- [ ] **Sign-out returns to the lobby, never a blank board.** HOW: each operator signs out and lands on
      the operator sign-in (the lobby), never a blank or half-drawn board.

## Release (Thyab's action, only after every box above is checked)

1. Share the console URL, the passcode, and each operator's own credentials with Mohammed and Basel
   through the private channel Thyab chooses. Never through this repo and never a chat log.
2. Add a release entry to the ledger.
3. Bump the Sentinel protocol with what this cycle taught. At minimum, three standing checks:
   the attribution law (a state is derived from evidence, never declared), the drain contract (every
   queued write drains, in order, until the queue is empty), and the reconstruction counter as a
   standing signal (zero on fresh data; non-zero is a flush-race regression). The standing gates that
   hold these are `tools/attribution_law_test.py`, `tools/flush_race_test.py`, and
   `tools/launch_audit_test.py`.
4. Write any debt that survives launch into the ledger, not memory. The PVR4 and the other business
   items live outside this repo.
