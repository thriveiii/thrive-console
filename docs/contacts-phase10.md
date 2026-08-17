# The Thrive Contact Book (P10 / D8)

The Insights person list is really an address list: the same human appears under several addresses (one with
a typo domain, `gmial.com`), names drift, and there is no way to classify or search. The Contact Book is the
directory built as a **read-plus-curation lens** over the same ledger. Off latest main (P5–P9 merged); author
only; Thyab merges. One small additive table (`console_contacts`) holds curation facts only; the activity
history stays derived from the ledger and is never copied.

## The one store: `console_contacts` (curation facts only)

`docs/supabase-contacts.sql` – additive and idempotent. One row per person, holding only what a human decides
and a machine cannot derive:

- `addresses` – the bare addresses a human confirmed belong to one person (the merge grouping).
- `name` – the curated display name (nullable; the surface derives a fallback from the ledger).
- `tags` – free tags plus the standing set (client, prospect, partner, personal, test).
- `note` – a free note about the person.
- `author` / `author_name` – the curator's `auth.uid()` and a display-name snapshot (audit trail).

No activity number lives here. A contact row is a lens over the ledger, not a copy, so a merge is reversible by
deleting the row and the ledger is never disturbed. Shared directory RLS: read-all authenticated, writes
authenticated + author-stamped, no anon. GIN index on the grouped addresses.

## The one derivation: `derivePeople()`

The Insights person block was extracted into `derivePeople()` and `initHome` now calls it, so the Book and
Insights read **one** derivation. Every summary number therefore reconciles with Insights by construction: for
an un-merged person the Book's number equals the Insights number; for a merged person it is the sum of the
Insights per-address numbers (`contacts_test.py` proves the sum).

`buildContacts()` overlays the curation rows: default is one record per address; a `console_contacts` row
groups its addresses under one record and carries the curated name/tags/note. Each record's activity summary
(sends, personal opens, replies, campaigns touched, bounces, last activity) is derived and summed live from
`console_mail`, `console_hits` (token-bearing) and `console_inbound`. Sorted newest-activity first via the R6
clock (`parseTs`).

## Merge, by the owner's hand

The P4 near-duplicate flags land here as review items (`contactReviewItems()`), built from
`nearDupClusters()` – the **same** near-dup predicate the Insights flag uses (`nearDupPair`), now exposing
connected components. Confirming a review item calls `mergeContacts()`, which writes one `console_contacts`
row grouping the addresses; the surface asks the owner to confirm first (a dialog), so nothing merges
silently. A merge is reversible: `unmergeContacts()` deletes the row and the person returns to the derived
default. Every curation write goes through the one Stage-4 queue (`supaMirrorContact` →
`supaQueueUpsert("console_contacts")`).

## Classification, search, sort

Free tags plus the standing set, toggled per person (tag edits write to `console_contacts` only). Search
matches name (Arabic and English), address, tag, and campaign; the tag filter narrows the list. Default sort
is newest activity (R6); by name is offered.

## Hygiene

A typo-domain or malformed address carries a visible warning (`addrHygieneBad`, reusing the P4 `TYPO_DOMAINS`
table). A bounced address is marked on the person (`bouncedAddrSet` / `addressBounced`, the one bounce signal:
`console_inbound` autos naming the address). The P5 roster paste reads the **same** derived bounce truth and
warns before re-sending a previously-bounced address (`showReview` now flags `rst_flag_bounced`).

## One component

Tapping a person's thread opens the existing thread renderer via `thriveModal.open(slug, "history", name)` –
no second thread renderer, no second recency function.

## Evidence (`tools/contacts_test.py`, all green)

1. The three Abdullah Thyab variants (one with the `gmial.com` typo) surface as one review item; confirming
   the merge yields one person with three addresses, the typo flagged, and the ledger rows unchanged.
2. Search finds the person by Arabic name and by partial address; default sort is newest-activity first.
3. The person carries the bounced mark, and a P5 roster paste containing the bounced address warns.
4. Ten builds of the Book are byte-identical; every merged summary number equals the sum of the Insights
   per-address numbers.

Plus source law: one `derivePeople`, one `threadListHtml`, curation writes only to `console_contacts`, no
ledger history in the contact row. Gates: `verify.js` 35/35, `arabic.py`, `flows.py`, `perf_gate.py`
(ceilings raised; hydrate now 11 tables). No em-dash (U+2014); no horizontal scroll at 390 / 1024 / 1280 in
EN and AR.
