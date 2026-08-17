# Campaigns Phase 1 · Recipient-level ground truth (D1)

Implements CAMPAIGN_ARCHITECTURE D1: a campaign is one opportunity that contains N recipients, each
recipient its own lifecycle, read from the same ledger the aggregate reads. This phase verifies the
one-row-per-recipient invariant and adds the additive per-recipient companion read. No new store, no
UI change, no change to the campaign aggregate.

## What was already built (verified against live app.js)

- `isGroupOpp(o)` marks a campaign (group) opportunity. Internal identifier kept per R1; user-facing
  word is "campaign" / «حملة».
- `campaignRecipients(o)` derives the roster from the union of the opp's stored `recipients[]` and the
  `console_mail` rows where `opp === slug` and direction is out. One entry per address.
- `recipientState(slug, addr)` derives a single recipient's state: sent, replied (on the parent or the
  extracted child), bounced, the linked child slug, and the latest timestamp.
- `campaignStats(slug)` is the one campaign aggregate (recipients, sent, opens, unique, replies,
  replyRate), read by both the card header and Insights.
- `childSlugFor` / `spawnChildrenFromReplies` extract a replying recipient into its own child
  opportunity (`<parent>--r-<hash>`), so a reply is a fact about one recipient and never lifts the
  campaign (D2).

## The one-row-per-recipient invariant (verified)

Every send is one `relaySend(intent)` call, which writes exactly one durable `console_mail` row keyed
by a unique per-intent idempotency key, before the POST, and confirms it on the server (the
confirmed-write law). A completed send is refused by name, so re-tapping never writes a second row.
There is **no multi-recipient batch send loop today** (`renderGroupReviewInto` is a review that writes
nothing; campaigns accrue rows one send at a time through the shared composer, `opp` = campaign slug).
So the invariant holds by construction: one recipient send = one row. The batch that could under-write
it is Phase 5 (paced sending); its evidence requirement (one row per recipient) is stated there.

## The companion read (new, additive)

`campaignRecipientLedger(slug)` returns one row per recipient, reading `console_mail` and
`console_inbound` only:

```
{ addr, name, sent, sent_at, replied, reply_at, reply_link, bounced, child }
```

- `sent_at` is the first send to that address.
- `reply_link` is `{ child }` once the replier is extracted (D2), else `{ inbound: <key> }` for a
  reply still on the parent, else `null`.
- `bounced` is true when a bounce names that address.

The campaign aggregate (`campaignStats`) is untouched; the ledger is a second zoom level over the same
rows, so lane equals detail by construction.

## Finding: opens are page-level, not per-recipient (deviation from the brief's literal field list)

The brief's Phase 1 companion read lists per-recipient `open_count` and `last_open_at`. **These cannot
be produced truthfully with the current tracking model, so they are deliberately omitted**, per the
standing no-invented-state law:

- A campaign is one page (one `slug`). `liveUrl(slug)` returns the identical URL to every recipient.
- Opens come from `console_hits`, whose columns are `id, slug, type, ts, self, data` and whose id is
  `type|slug|ts|vid` where `vid` is an anonymous per-browser visitor id. There is no recipient or
  address column, and no per-recipient token in the link.
- Therefore an open cannot be attributed to an individual recipient. Opens remain a campaign-level
  signal (`campaignStats.opens`), which the recipients panel already surfaces via `campaignAggHtml`.

To attribute opens per recipient would require minting a per-recipient link token (a unique tracked
URL or query parameter per address, carried into `console_hits`). That is net-new tracking, additive,
and belongs in its own phase, not in a "verify + additive read." Flagged here for Thyab's decision.

## Evidence

`tools/campaign_ledger_test.py` (engine-independent; WebKit is the device gate):

1. A `thrive-july` campaign of several recipients (AR and EN names, one nameless, one bounced, one
   replied) returns exactly one ledger row per recipient with true per-address states.
2. The replier's row carries `replied:true` and a `reply_link` to the extracted child; the campaign
   card does **not** move to Replied (D2 holds).
3. Ten consecutive reads are byte-identical (stable, no flicker).
4. The ledger's per-recipient truth matches the recipients panel (lane equals detail).
