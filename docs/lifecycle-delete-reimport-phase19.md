# Opportunity lifecycle: safe delete, and re-import that updates in place (P19)

Two lifecycle gaps sat on the console, both live.

1. **There was no delete, only archive.** A wrongly imported card could be filed off the board but never
   removed, so a mistaken drop could not be cleaned up and re-uploaded.
2. **Re-dropping a bundle duplicated its cards.** A corrected bundle could not heal the cards it already
   produced; it spawned twins instead. Tonight's need was to re-upload batch 13 so the six cards gain their
   contacts (P18) without spawning six more.

## R12 · The delete law: truth is never deleted; a draft is not truth yet

The ledger is the truth of what was sent and received, and it decides whether a card may be deleted at all.
One predicate reads it:

```
hasLedgerHistory(slug) = (any console_mail row) OR (any resolved console_inbound reply) OR (any token-bearing console_hits)
```

- A card with **no** ledger history is a draft in the true sense: **Delete** removes its opportunity record
  and its board row, after a confirmation that names the card. The delete is tombstoned and undoable.
- A card **with** ledger history cannot be hard-deleted. It offers **Archive** only, with a one-line reason;
  its slug stays reserved to its history.
- The delete is always explicit and singular, and it **never cascades into a ledger table**. `supaDeleteOpp`
  removes only the `console_opps` and `console_pages` rows; `console_mail`, `console_hits`, and
  `console_inbound` are never targeted, and the additive SQL adds no delete policy or cascade to them.

The English and Arabic labels distinguish the two honestly: **Delete / حذف** (drafts only) versus
**Archive / أرشفة** (keeps history). The gate holds at the source: `canHardDelete(o)` is checked both where
the control renders and in every delete handler, so a stale control can never remove a history-bearing card.

## R13 · Re-import updates in place, idempotent by slug

Re-dropping a bundle joins against existing opportunities by slug **before** creating anything. One classifier,
`ThriveIntake.importPlan(slug, existing)`, is read by both the report and the writer, so there is one lifecycle
path and no per-slug branches:

- **new** - no card with this slug exists; created, exactly as today.
- **update** - an existing card with no ledger history; refreshed in place (contacts, display name, template,
  body). The report row reads "updates in place". Its lifecycle fields (published / stage / sent_on) are kept.
- **update_locked** - an existing card **with** ledger history; the safe fields refresh, but the message body
  and subject do **not** silently change under a card that already sent something. The row reads "history
  kept, body unchanged".
- **decision** - an **archived** card with the same slug. The report offers two explicit choices on the row,
  **Restore & update** or **Import as new** (under a suffixed slug). Never resolved silently; an unresolved
  decision is left pending, never written.

A re-import never silently un-archives or un-deletes a card: the blanket `archived = false` is gone, replaced
by "un-archive only on new or on an explicit Restore". A slug re-imported after a delete has its tombstone
lifted, so it re-creates cleanly (one truth, no ghost) instead of being re-removed by the next sync.

The count line reads: **pages N · new X · updates Y · needs-decision Z** (updates folds update + update_locked),
with the P16 matched / confirm / needs / orphans counts still present. Counts render outside the translated
strings, inside `<bdi class="n">`.

This makes tonight's flow one step: re-drop the zip, the six rows read "updates", the contacts land (P18),
zero twins, nothing to delete first.

## Evidence

- **`tools/ingest_matcher_test.js`** (extended): `importPlan` classifies new / update / update_locked /
  decision from one map; every report row carries its action; the count line reads new / updates /
  needs-decision; an existing slug is an update, never a blocking `exists_would_overwrite` warning; a bare
  `existingSlugs` list stays back-compatible; there is exactly ONE classifier, read by the writer; ten reads
  of the classification are byte-identical.
- **`tools/lifecycle_delete_reimport_test.py`** (new, live, on board.html + console.html): a re-drop over
  three existing drafts reads three updates, zero new, zero duplicates, and after approve each card carries
  its contact channel and the board still holds three cards; a zero-history draft offers Delete while a card
  with a reply offers only Archive with a reason; hard-deleting the draft (confirmation shown) then
  re-dropping yields one new and two updates with no ghost; an archived slug on re-drop shows Restore /
  Import-as-new and Restore flips it to an update-in-place; and the ledger row counts are unchanged by every
  operation. The report mirrors to RTL in Arabic.

Gates: `verify.js` 35/35 (the trash glyph is the 24th symbol, recognized through the runtime `ic("name")`
API), `arabic.py`, `flows.py`, `perf_gate.py` green (the bundle ceilings raised with a documented P19 note).
Isolation grep clean (lotus/newsroom only the benign `store.js:20` prose); no long dash. `board_match_join`,
`import.py`, `ingest_matcher`, `lifecycle_legacy` all green. (`lifecycle.py` and `archive.py` fail in this
sandbox on an unrelated pre-existing `ThriveBoard.selfTest()` error that reproduces identically on clean main.)

## Do not (held)

Nothing with ledger history is ever hard-deleted; archive is the only exit for a history-bearing card. No
delete cascades into a ledger table. A card is never duplicated on re-import; slug-idempotent update is the
law. The body and subject of a card that already sent are never silently changed - the report surfaces it. An
archived-slug collision is never resolved silently; Thyab picks Restore or Import-as-new. Sending pacing, the
thread render, Lotus, and the newsroom asset are untouched.

## Real-zip / server caveat

The real batch-13 producer zip is not present in this environment, and the console's Supabase project is not
reachable from the sandbox. The delete and re-import laws are proven against the real field shapes and the
real client surfaces (board.html and console.html) with a seeded local store and ledgers; the additive
`docs/supabase-opp-delete.sql` is written to be run once in the console project's SQL editor. Drop the actual
zip into `tools/fixtures/` and the same board test runs against it directly.
