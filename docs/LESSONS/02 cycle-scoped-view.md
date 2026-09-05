# Cycle scoped view drops a real send

**Symptom.** A send confirms and writes a console_mail status='sent' row, yet the card
reverts to draft. The board diverges from reality.

**Root.** The console_board view counted a send only when the mail row cycle matched the
opp cycle, or both were null: (m.cycle = mo.cycle OR (m.cycle IS NULL AND mo.cycle IS NULL)).
The client stamped the send cycle=null (a stale in-memory row.cycle) while the opp carried a
non-null cycle minted at upload. null vs non-null satisfies neither branch, the send is
dropped, sent_count=0, and the stage CASE falls to draft.

**How we proved it.** A SQL join of console_mail.cycle against console_board.cycle for the
affected opps returned MISMATCH (mail null, opp non-null).

**Fix.** Relax the view scope to (m.cycle = mo.cycle OR m.cycle IS NULL): an unstamped send
counts as current, matching the send code's own documented intent. Reconcile existing rows
with a scoped UPDATE stamping the current opp cycle.

**Guard.** When a view is cycle or tenant scoped, an unstamped (null) record must count as
current, not require both-null. Keep the client stamp and the view scope in agreement and
assert it in a test.
