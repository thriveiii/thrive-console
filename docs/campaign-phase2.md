# Campaigns P2 · Truthful opens, per recipient

Makes per-recipient opens real for single sends and campaigns alike, with zero schema change. The token
is a `console_mail` row id; it rides an email open pixel and a tokenized page link; the relay writes it
into `console_hits.data.r`; attribution is the join `console_hits.data.r -> console_mail.id -> to_addr`.
A hit with no token stays an anonymous, campaign-level view and is never guessed onto a person.

## What the live source actually was (read before writing, per the brief)

The brief's mechanism (R4) rested on four assumptions the live source did not support. Each is corrected
here; none is worked around silently.

1. **The relay cannot serve a pixel or a 302.** `relay/thrive-relay.gs` answers through
   `ContentService`, whose only MIME types are TEXT/JSON/JAVASCRIPT/CSV/ICAL/XML. It cannot return image
   bytes, and Apps Script cannot set a `Location` header for a real 302. So neither "serve the pixel" nor
   the brief's "302 to a static 1x1" fallback is possible on this relay. **What ships:** the pixel `<img>`
   GETs the relay hit URL; the relay records the open and returns an empty `text/plain` body. Loaded by an
   `<img width="1" height="1" alt="">`, that renders as an invisible 1x1 (no broken-image glyph worth
   speaking of, no alt), so the visible body is unchanged and deliverability is unaffected (one request,
   the same relay domain already used for page hits). This is the only pixel behavior this relay can offer;
   if a rendered image is ever required, that needs a logging host that can serve bytes (new infra), a
   separate decision.

2. **The page beacon did not forward `r`.** `beacon.js` built its open event from the path only and never
   read `location.search`, so a tokenized link (`?r=`) was dropped. The brief's "the existing page relay
   hit carries data.r through unchanged" was not accurate. **Fixed:** `beacon.js` now reads `r` from the
   URL and includes it in the open event (channel 2).

3. **The relay dropped POST hits entirely (pre-existing bug).** `beacon.js` sends page opens by
   `navigator.sendBeacon` (a POST of `{op:"hit", ev}`), but `doPost` had **no `hit` branch** - the request
   fell through to `authOk_` and was refused, so remote page opens never reached the store (only the
   visitor's own localStorage, which never syncs to the console). **Fixed:** `doPost` now answers
   `op:"hit"` before `authOk_` (a visitor has no credential), calling the same `hitPut_` the GET pixel
   uses, and carrying `ev.r` through. This both enables channel 2 and repairs a standing gap in page-open
   collection.

4. **The row id is minted at send, not known at compile.** `supaMailRow`'s `id` is `rec.mid`, minted by
   `newMid()` (random) inside `logMail` at send time - not available when the body is compiled, and if the
   pixel token were a hash of the body it would be circular and, worse, would change the send idempotency
   key on every re-tap, breaking exactly-once. **What ships:** the token is
   `recipientOpenToken(opp,to,subject) = sendIdem(opp,to,subject,"")` - deterministic, per-recipient,
   **body-independent**, so it is known before the body is compiled and is identical across re-taps. The
   send passes it to `relaySend` as the row `mid`, so `console_mail.id === token` and the join holds. Since
   the token does not depend on the body, the body-with-pixel is stable across re-taps, so the dedup
   `idem` is stable and exactly-once is preserved (proven: `send_once_test` stays green).

## The build

- **Compile (one code path).** `sendBody()` is the single place the finished body is assembled. When a
  real outreach send is in flight (never a self-test, never the preview), it tokenizes the page link
  (`liveUrl?r=<token>`, in both html and text) and appends **exactly one** open pixel
  (`openPixelHtml`). The token is set for that one send and cleared in `finally`. A thread reply carries
  no pixel (it is a conversation, not a page send). A single send is a campaign of one, same path.
- **Relay** (`relay/thrive-relay.gs`, ship as its own reviewed file, deploy manually): `doGet op=hit`
  stores `r`; `doPost op=hit` added before `authOk_`. Both leave every other behavior untouched.
- **`campaignRecipientLedger`** gains `open_count` and `last_open_at`, computed **only** from
  token-bearing hits whose `r` is one of that recipient's send ids. Untokened hits never enter a person's
  row.
- **`campaignStats`** gains `openersTokened` (distinct recipients with a token open) and `viewsAnon`
  (opens with no token). The two are separate fields and are **never summed** into one number.

## Preview note (deferred to P4/D5)

The preview does not carry the pixel/token (it is not a send), so preview is not byte-identical to the
sent artifact in this phase. Preview-equals-sent is D5 (P4); this phase changes nothing about it.

## Evidence

- `tools/campaign_opens_test.py` (8 checks, engine-independent): the token is deterministic and
  per-recipient; the compile emits exactly one 1x1 pixel carrying `op=hit`, `type=open`, and the token; a
  token-bearing open attributes to the right recipient with `open_count`/`last_open_at`; the other
  recipient stays at 0; an **untokened** hit is never attributed to a person; `campaignStats` keeps token
  openers and anonymous views separate and never sums them; ten reads are byte-identical.
- `tools/campaign_ledger_test.py` (P1) updated: with untokened hits, every `open_count` is 0.
- Device gate (Thyab): send a two-recipient test campaign to two real inboxes; open one email only; that
  recipient shows `open_count 1` with a timestamp, the other stays sent; a tokenized page visit attributes,
  an untokened visit in a clean browser only raises `viewsAnon`; a single send shows the same per-person
  truth. Requires the relay redeploy first.
