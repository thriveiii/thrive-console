# Scale-proof sending: the durable server-driven queue (P8 / D6 + R3)

Today every send is a client call, so a large campaign dies when the device sleeps. R3 ratifies the fix:
the queue lives in the ledger, the Apps Script relay paces and sends on a time trigger, and the device is
free. Off latest main; author only; Thyab merges; additive SQL only. The relay change ships as its own
reviewed file (Thyab deploys the relay manually).

## The queue (no new store)

Starting a campaign writes **one `console_mail` row per recipient**, status `queued`, with a per-row `due`
timestamp in `data` computed with randomized jitter (base 45s plus a random up to 120s between rows,
bounded, never a fixed beat) and the compiled per-recipient body. No new table and no new column: a queued
send is an ordinary mail row (the `status` column already holds text; `due` and the payload live in the
`data` jsonb), so it reads straight back through the same `select=data` path. The daily budget gates **at
queue time**: rows beyond the day's capacity (the smaller of the remaining budget and a soft warm-ramp cap)
defer to the next window, visibly (`day > 0`); the warm-ramp cap is stated on the card, never silent. A
queued row is never counted as "sent" (`campaignStats.sent` excludes `queued`/`held`).

## The worker (relay, time trigger)

`store.outbox` is a **relay-owned** key, exactly like `store.inbound`: the console pushes the compiled
batch (`outbox_push`) and reads status (`outbox_status`); it never writes the queue back, so the console's
full-state sync can never clobber it, and the relay still never writes to Supabase. On each `sendQueue_`
trigger tick the worker:

- **claims** a small batch of due queued rows, oldest-due first, flipping each `queued -> sending`
  **inside the store lock** (`LockService`), which serializes every tick, so two overlapping ticks can
  never claim the same row (the idempotent claim);
- **sends** each as its own single-To message (no BCC, no multi-recipient To) with the row id as the
  Resend idempotency key, so a re-claimed row (a worker that died mid-send) or an overlapping tick
  delivers **at most once**;
- flips `sending -> sent` **only after the provider accepts**, or `-> failed` with the reason, never
  silently. A `sending` row stuck past a timeout is re-claimed; the idempotency key keeps that safe.

A bounce arrives through the existing inbox scan and marks that recipient bounced; the queue never
auto-retries it. A complaint pauses the whole campaign loudly (`paused-complaint` on the card); the worker
simply stops claiming a held row.

## The client (starts and watches, never paces)

The card carries the campaign's in-flight state as a **first-class visual state** (`cardState` in-flight,
the one `data-state` law): sent k of N, how many are queued and when the next is due, held and failed
counts, the deferred tail and the warm-ramp cap, and one control (pause or resume). **Pause** flips the
remaining queued rows to `held` (and tells the relay); **resume** re-queues them with **fresh jitter**.
Closing the tab changes nothing: the relay sends on its trigger, and any device that syncs reconciles the
ledger from `outbox_status` on the same 60s heartbeat (no new timer). Reopening shows live progress.

## Evidence

`tools/queue_relay_test.py` (18 checks) extracts the outbox worker and runs it in Node against a mock store
+ mock Resend: **Evidence 5**, an overlapping tick fired mid-send never double-sends a row (the row count
still equals the recipient count); one single-To message per row; the row id as the at-most-once key; sent
only after acceptance, failed (with reason) on a throw; a retried push never duplicates; pause holds,
resume re-queues. **Fails-when-broken**: neutering the `queued -> sending` claim flip makes the overlapping
tick re-claim every row and double-send it (Evidence 5 reds); restored, it passes.

`tools/queue_client_test.py` (16 checks) drives the client engine: a 5-recipient campaign writes exactly 5
queued rows, one per recipient, zero duplicates, with dues that differ by randomized gaps (no fixed beat)
and the deterministic per-recipient token as the row id (**Evidence 1**); the card reads in-flight while
draining and a queued row is not counted as sent; **pause** holds the tail and **resume** re-queues it with
fresh jitter (**Evidence 3**); a daily budget of 2 defers 3 of 5 to the next window (**Evidence 4**);
reconcile from the relay's status flips queued to sent; and the client itself never marks a row sent.

`tools/compile_parity_test.py` is the **hard gate on the two-path window** (see the scope note below): it
proves that for the same recipient and the same authored content, the single-send composer (`compileArtifact`)
and the campaign composer (`compileCampaignRow`) produce **byte-identical** output (subject, html, text, and
the open token), because both compose through the one shared `composeArtifactCore`. Named and nameless
recipients both match; a different recipient yields different bytes (the comparison is real, not constants).

Full bed green. Gates green (verify 35/35, arabic, flows, perf 0 failed; APP_JS_MAX and DIST_MAX raised for
the queue engine, noted; still exactly one interval, the 60s heartbeat). Isolation grep 0. Em-dash clean.

## Device gate (Thyab, WebKit + the deployed relay)

The relay change (`relay/thrive-relay.gs`, now v6) is deployed manually: **Deploy > Manage deployments >
Edit > New version** (never a new deployment; the URL must not change), then run `installSendTrigger` once
from the editor. Then, on device:

1. A 5-recipient test campaign: the `console_mail` dues differ by randomized gaps (no fixed beat); Resend
   shows five individual deliveries; exactly five rows; zero duplicates.
2. Close the tab after the first send; the remaining sends complete with the device untouched; on return
   the card shows the finished truth.
3. Pause mid-run holds the tail (held rows visible); resume completes it.
4. A campaign larger than today's remaining budget queues the tail for the next window, visibly, and sends
   it then.
5. Double-tick safety: two overlapping trigger runs still leave the row count equal to the recipient count.

## Notes on scope and overlap

`REQUIRED_RELAY` stays `5`, so single sends keep working on a v5 relay; the campaign queue is offered only
where the console sees a v6 relay, and every outbox call degrades silently on an older one (like
`pullInbound`).

**Two compile entry points, one shared source (deliberate, gated, closing in P9).** After the rebase onto the
merged P7, the console has two compile *entry points* -- `compileArtifact` (single send + preview) and
`compileCampaignRow` (the campaign queue). They do **not** duplicate the compose logic: both build their body
through the one shared `composeArtifactCore`, which is the single place the POSTAL footer, the tokenized page
link, the open pixel, and the deterministic open token are attached. `compile_parity_test.py` proves the two
paths are byte-identical for the same recipient and content; `relay_courier_test.py` asserts the footer is
attached in exactly one place. Both `compileArtifact` and `compileCampaignRow` carry an explicit comment that
the two entry points coexist **by design** until P9. **P9 carries a hard acceptance item**: collapse to one
compile path, delete the second entry point, and re-prove preview==send with a single composer
(`ThriveStore.footerHtml` count returns to 1 place *and* one composer). This window is tracked, not accidental.

Complaint handling depends on the inbox scan surfacing the complaint (this relay cannot receive Resend
webhooks); the pause path and the `paused-complaint` state are built, and the trigger to set it is the operator
or a future webhook relay.
