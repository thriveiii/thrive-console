# A slow relay is not a failed send

**Symptom.** A send that Resend shows Delivered prints "Sent 0 of 1. 1 failed" and reverts
the card. The console lies about a delivered email.

**Root.** The send POSTs to a Google Apps Script relay and reads the reply within a 6s client
bound (FETCH_TIMEOUT_MS). Apps Script legitimately takes longer (cold start, then Resend,
then a 302 body hop). The cut-off rejects the promise, and the rejection handler returned
{ok:false} for every reason, so a slow-but-delivered send became a hard failure and the card
reverted (sent.length===0).

**How we proved it.** Resend showed every send Delivered. The client relayPost inherited the
6s bound (called with no timeoutMs). An in-file precedent (page-publish) already treated
kind==="timeout" as likely-landed.

**Fix.** Give the relay send a real bound (RELAY_SEND_TIMEOUT_MS=20000) so the success path
runs and writes the row. For the rare >20s tail, on kind==="timeout" write a status='pending'
row (the view counts pending) and return a non-failing 'confirming' result. Non-timeout
rejections (network, aborted) stay real failures.

**Guard.** A timeout on an idempotent write is "unknown, likely landed", never "failed".
Ground truth is the provider, not the client's read of a slow relay. A card must never
contradict a Delivered.
