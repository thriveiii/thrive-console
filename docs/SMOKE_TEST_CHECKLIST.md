# Thrive Console, full pipeline smoke test

Run this once, end to end, before returning to design. Owner is Thyab. Member is Basel (a second login, not Thyab's). Every step says what to expect and where to verify it. If any step fails, stop and report which number.

Rule for this run: send to a real prospect or a neutral address you control, never to a personal Gmail, to protect sender reputation.

Supabase check query, reused below (run in the SQL editor):

```
select id, opp, to_addr, subject, status, actor, ts from console_mail order by ts desc limit 5;
```

---

## Part A, the member creates and activates (Basel)

1. Basel signs in (his own account, not Thyab's) and uploads a real opportunity zip.
   Expect: the card lands in Under Review. It does NOT vanish.
   Verify: the card is visible on Basel's board under Under Review.

2. Basel activates the page (Activate).
   Expect: the page goes live through the relay, no repo token needed. The card shows Live, the hosted URL resolves in a browser.
   Verify: open the opp URL; it loads.

3. Basel writes the message: a real subject and body, one real recipient. Not a test phrase.
   Expect: subject, body, and recipient all attach to the card.

## Part B, the approval gate

4. Basel requests approval (he does NOT send directly).
   Expect: the card is marked awaiting the owner's approval. No email has gone out yet.
   Verify: nothing new in Resend, nothing new in the Supabase check query.

5. Thyab reviews and approves.
   Expect: the card moves to Ready (approved).

## Part C, the send, the single source of truth

6. The send goes out (after approval).
   Expect: Resend shows one Delivered row for the real recipient.
   Verify (the important one): the Supabase check query shows exactly ONE row for this send:
   - id begins with `snd_` (the Resend id), not a UUID.
   - actor is set (the sender's uid).
   - status is sent.
   NOT two rows. One send, one row.

7. The card advances to Sent.
   Expect: the card is in Sent, one send, zero idle.

## Part D, opens and replies

8. A third party (not Thyab, not Basel) opens the email or the link.
   Expect: the card moves to Opened. The open count reflects the real open.
   Verify: the card shows in Opened; the activity log shows the open.
   Note: a self open (Thyab or Basel opening their own send) is filtered by design and does NOT count. Use a different person.

9. The recipient replies.
   Expect: within the relay scan window (up to 15 minutes), the reply attaches to the card and the card moves to Replied.
   Verify: the card shows the reply threaded, in the reply conversation.

## Part E, close

10. Archive the opportunity.
    Expect: the card leaves the active board and appears in the archive. The count updates.

---

## What each step proves

- Steps 1 to 3: a member creates and activates without a token (the vanishing-card and member-activation fixes).
- Steps 4 to 5: the approval gate (a member cannot send unreviewed).
- Step 6: the single source of truth. One row, keyed by the Resend id, written by the relay. No duplicate, no phantom, no delivered-but-missing send.
- Steps 8 to 9: opens and replies attribute correctly, self opens excluded.
- Step 10: archive works.

## If a step fails

Report the step number and what you saw. Useful extras when a send looks wrong:

```
select id, opp, to_addr, subject, status, actor, ts from console_mail where opp = '<slug>' order by ts desc;
```

and the drift badge on the device (it names any refused or diverged write).
