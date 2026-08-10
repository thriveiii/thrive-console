# Thrive Console · Launch device checklist

Read-only audit passed on the final code (Sentinel Sweep 4, WO-024). Check every line below on the
iPad, in WebKit (Safari), before release. This file holds no credentials: the release itself (the URL,
the passcode, and each operator's own sign-in) goes through the private channel Thyab chooses, never
this repo and never a chat log.

Sign-off: release only when every box is checked on the device.

## 1. Relay and deploy

- [ ] **Relay reads v5.** WHERE: Settings tab, Connections section, "Run the checks". HOW: the
      connection-health checklist reports the relay at v5. This is a confirmation, not a redeploy,
      unless it regressed.
- [ ] **Self-send footer reads "Thrive Digital Solutions, VA, USA".** WHERE: send the self-test from
      section 3 to an address you control, then open the received email. HOW: read the signature line
      at the foot of the message.
- [ ] **Latest GitHub Pages action is green.** WHERE: GitHub, the repository's Actions tab. HOW: the
      most recent Pages deploy succeeded, and the build marker printed on the gate matches the latest
      commit (so the live site is the final code, not a stale build).

## 2. Three operators, one identical console

- [ ] **Each operator signs in and sees the same console.** WHERE: the gate (passcode first, then the
      operator sign-in). HOW: sign in as Thyab, then Mohammed, then Basel, each with their own
      credentials. Every operator sees the identical console, the same tabs and the same board, with no
      per-operator difference.

## 3. Send, open, reply, thread on a real self-test opportunity

- [ ] **Send.** WHERE: the board, a self-test card addressed to an inbox you control. HOW: send it;
      the card shows Sent and the ledger records the send with its Message-ID.
- [ ] **Open.** HOW: open the page from the sent link; the card moves to Opened.
- [ ] **Reply and match.** HOW: reply from the recipient address. If it does not attach on its own, tap
      "Re-match held replies" in Settings, Replies. The reply matches its opportunity and the card moves
      to Replied.
- [ ] **Thread in order.** HOW: open the card thread; the send, the open, and the reply read oldest to
      newest, each message in its own reading direction.
- [ ] **Compose a reply in the thread.** HOW: write a reply in the thread composer and send. It leaves
      through the relay with a fresh Message-ID and appears in the thread in order. An Arabic reply
      reads right-to-left with joined letters.

## 4. Session lifecycle

- [ ] **Short background returns with no gate.** HOW: switch away from the console for under thirty
      minutes, then return. The board is there, with no re-gate.
- [ ] **Thirty-minute idle re-gates to the passcode.** HOW: leave the console idle for thirty minutes
      or more. It re-gates to the passcode only (not the full operator sign-in).
- [ ] **The calm re-gate copy reads correctly in both languages.** HOW: on that passcode re-gate,
      confirm the welcome-back line reads naturally in English and in Arabic.

## 5. Arabic and English at three widths

For each surface (the board, a card view, Insights, Library, Settings), view it in English then in
Arabic, at mobile, iPad-landscape, and desktop widths.

- [ ] **Board** reads correctly in both languages at all three widths.
- [ ] **A card view** reads correctly in both languages at all three widths.
- [ ] **Insights** reads correctly; each tile is one aligned unit (icon, number, label on one edge),
      mirrored by direction, never mixed.
- [ ] **Library** reads correctly in both languages at all three widths.
- [ ] **Settings** reads correctly; the five sections hold, no two buttons touch or clip.
- [ ] **Across all of them:** Arabic joined letters are intact with no letter-spacing; every date reads
      correctly in Arabic with Western digits and no shuffled or reversed order; no control pair is
      cramped, touching, or clipped.

## 6. Sign out

- [ ] **Sign out returns to the gate.** WHERE: the Lock button. HOW: it returns to the gate, never a
      blank board.

## Release (Thyab's action, after every box above is checked)

1. Share the console URL, the passcode, and each operator's own credentials with Mohammed and Basel
   through the private channel Thyab chooses. Never through this repo and never a chat log.
2. Add a release entry to the ledger.
3. Bump the Sentinel protocol if the audit taught a new standing check. This launch adds one:
   `tools/launch_audit_test.py`, the standing gate for isolation, secret hygiene, RLS scope, thread
   escaping, matcher idempotency, and visible control state.
