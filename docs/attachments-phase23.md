# Attachments and rich links: the composer becomes a full channel (P23)

The concern: the composer could write words and links, but not carry an image or name a rich destination
cleanly. P23 adds both, through the one compile path, so a campaign of many recipients gets exactly what the
preview showed, and a deliverability limit is stated in a number, never a silent drop. Additive only; the one
compile, the one send path (relaySend via the relay to Resend), and the lane laws are unchanged. They are fed.

## What P23 builds

### Images, stored not inlined

- An image attaches from the device, uploads once to a public-read Supabase Storage bucket
  (`console-attachments`, `docs/supabase-attachments.sql`), and is referenced by URL. It is **never**
  base64-inlined into the body: the relay request stays small and the 400 KB relay JSON is never the ceiling.
- **compile() decides, in ONE place, how each image lands**, from the provider's own limits (Resend: 40 MB
  total per message), so the strip in the composer and the bytes on the wire agree by construction:
  - at or under 5 MB (`ATTACH_INLINE_MAX`): a real email attachment. Resend fetches it from the Storage URL
    via `path`, so the relay request carries a URL, not megabytes;
  - over 5 MB and at or under 25 MB (`ATTACH_MAX`): a clean, labelled hosted link in the body ("View image:
    filename" / «عرض الصورة»), baked per RECIPIENT language exactly as the footer is;
  - over 25 MB, or past the count ceiling (`ATTACH_COUNT_MAX = 10`), or bursting the 40 MB running total
    (`ATTACH_TOTAL_MAX`): **refused with the number**, never dropped. The composer refuses at add time; the
    send path (`eSend`, the campaign start) keeps the same floor so a stale or synced draft cannot smuggle one
    through.
- Every limit is a stated constant. `planAttachments(list)` is the one pure partition; it returns `{ attach,
  hosted, refused, totalBytes, count }` and compile calls it once. Preview equals sent by construction, not by
  assertion (the same builder, `editorContent`, feeds the composer; `campaignContent` feeds the queue; both
  reach the one compile).

### Rich links, recognized and labelled

- A pasted or inserted link is recognized by its host (`linkKind`): Instagram, X, TikTok, Facebook, LinkedIn,
  YouTube, Google Drive, or a generic URL. A bare recognized link reads as its clean type word; the links
  manager (unchanged, DOM-derived from the `<a>` anchors) names the recognized kind beside the origin tag.
- A **Google Drive** link raises a sender-only reminder chip in the composer to check its sharing before the
  message goes, so the recipient never hits a request-access wall. The chip never leaves the composer.

### Every attachment is in the card's memory

- Attaching an image writes one `attach_add` activity row (P21), stamped with its author, so the card's
  activity trail records who added what.

## The version contract, and the gate that was hiding features

Attachments change the send request shape and require a relay that forwards them. That relay is **v8**
(`RELAY_VERSION`). But the console's runtime gate (`relayReady`) was strict equality (`===`): it treated any
relay whose version was not *exactly* `REQUIRED_RELAY` as a mismatch. The deployed relay is v5, so every
feature added since (P8's paced queue at v6, P22's inbound signals at v7) was **dormant behind that gate**,
lit in source but never reached. P23 fixes the gate to **not-older-than** (`seen >= REQUIRED_RELAY`):

- `REQUIRED_RELAY` stays **5** (the oldest request shape the console needs), `RELAY_VERSION` is **8**;
- a relay equal to or newer than 5 is READY; an OLDER (or version-absent) relay is still refused, by name;
- the relay's own request-side guard still refuses a newer console against an older relay (`request v9,
  relay v8`), so the two-way protection is intact;
- attachments gate on their own capability, `relaySupportsAttachments()` = `seen >= 8`. Below v8 the composer
  refuses to add one and the send refuses to dispatch it, naming the version to deploy, never a silent drop.
- `classifyRelayBody` (the Connection-health line) was moved to the same `>=`, so a v8 relay reads as
  "current", not "old".

### The relay version is now always visible (so a dormant feature is never invisible again)

Settings → Connection health carries a **relay capability matrix**, read from the one authority
(`relaySeenVersion`, set by every sync/send/check response). It names the live version and, for each
capability, whether it is live or waiting for a deploy:

| capability | needs relay | at deployed v5 today | after the v8 deploy |
|---|---|---|---|
| Send email | v5 | **live** | live |
| Paced campaign queue (P8) | v6 | waiting | **lights up** |
| Inbound signals: heartbeat, reconcile (P22) | v7 | waiting | **lights up** |
| Image attachments (P23) | v8 | waiting | **lights up** |

So deploying the v8 relay (the five-tap ritual in `docs/RELAY.md`) turns on the paced campaign queue, the
inbound heartbeat and reconciliation, and image attachments, all at once, and the panel says so before and
after.

## Evidence

- **`tools/attach_logic_test.js` (Node, no browser):** the real `planAttachments` and hosted-block functions,
  lifted verbatim from `library/app.js`, prove the partition (attach / hosted / refuse-with-number), the count
  and total ceilings, and the per-recipient Arabic label; the real version-gate functions prove `>=` (a v8 and
  a v9 relay are READY against REQUIRED 5, a v5 relay is ready but attachment-incapable, an OLDER relay is
  refused by name, a version-absent response is a mismatch) and include a discrimination check that a `===`
  variant WOULD wrongly reject v8, so a regression to strict equality reds this file.
- **`tools/relay_attach_test.js` (Node, the real relay in a stubbed Apps Script sandbox):** `sendMail_`
  forwards the `{ filename, path }` items to the Resend payload verbatim, invents no base64, and a text-only
  send carries no attachments key (unchanged); `RELAY_VERSION` is 8; the queue path (`outboxPush_`,
  `sendQueue_`) carries attachments per row.
- **`tools/attachments_test.py` (browser, device-gated):** drives the live composer for the partition,
  compile-carries-attachments, preview==sent parity across two campaign recipients, the version gate, the
  rich-link recognition and the Drive chip. The sandbox's live-console boot is network-flaky (the same reason
  `compile_parity_test.py` and the P22 suites are Thyab's device gate), so it runs its source invariants and
  then skips the live-DOM assertions here; it passes on device.
- **`tools/attachments_shots.py`:** a faithful static-mock gallery on the real `styles.css` and exact classes
  (`eattach`, `edrivechip`, `elink-item` + `tag-kind`, `relay-caps`), EN + AR, RTL clean, Western numerals.
- **Gates:** `verify.js` 35/35, `arabic.py`, `flows.py` green; `version.js` and `relay_handshake_test.py`
  green (the invariant `REQUIRED_RELAY <= RELAY_VERSION`, now 5 <= 8). Isolation grep clean (only the benign
  `store.js:20` prose).

## The live full-channel test (device-gated, Thyab runs it, after the v8 deploy)

Storage, the live relay, and a real mailbox are not reachable from the sandbox, so the full channel is proven
on Thyab's device once the v8 relay is deployed:

1. Send a test with **1 image + 1 Drive link**. The delivered mail shows both, with clean EN+AR labels; the
   Drive chip appeared in the composer before send.
2. A **3-recipient campaign** compiles the same attachment through the one path: the preview equals the sent
   message per recipient.
3. An **oversize image** is refused with its stated limit, at add time and at send.

## Do not (held)

Attachments are never base64-inlined (stored and referenced). There is one compile and one attachments
partition; there is no second compile and no second links store. An attachment never bypasses the
preview-equals-sent property. A provider limit is never exceeded silently: it is refused with the number.
