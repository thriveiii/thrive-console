# The daily drop, whole: the batch's documents ride with its opportunities (P26)

The daily production ships more than opportunities. Each batch (per PLAYBOOK.md) carries its
research-and-messages md, a market assessment, a playbook or notes, and a README. The ingest ladder (P11..P17)
resolves the opportunities and correctly refuses to make cards from those documents, which is right. But until
now the documents were then **lost**, and they are the batch's audit trail: the sources, the freshness stamps,
the owner's-eye review, the rejection log. P26 keeps them. Each drop now creates one batch record that holds
its documents, every opportunity it produced links back to it, and a Batches view lists the drops whole.

## What P26 adds

### One batch record per drop, keeping its documents

The one resolver already reads every dropped file. It splits the flat documents (research md, market
assessment, playbook, notes, README) from the `opp.md` envelopes, parses them for opportunity sections, and
then discarded the files. P26 keeps them: `resolveBatch` now returns `documents` (each `{ name, type, text }`),
classified by a simple, recognizable type from the filename first, then the first heading (`classifyDoc`):
`research`, `market`, `playbook`, `notes`, `readme`, else `document`. This rides the existing report; there is
**no second ingest path**, and both drop surfaces (the board's "Today's batch" and the editor upload) already
funnel through the one `readBatch`.

On write, `ingWriteRows` mints one batch id and date, threads them through the existing
`writeImport -> toRecord` context so **every opportunity the drop creates or updates carries `batch_id` /
`batch_date`**, then persists the batch record (its documents plus the slugs it produced) to a new synced key
`thrive_batches_v1`. A numbered batch (a document says "Batch 13") is **idempotent by its number**, so a
re-drop updates the same record rather than piling up. A document never becomes a card: the write stores the
files beside the cards, it does not import them.

### The card's quiet "from batch" chip

The card Overview gains one quiet row: **from batch \<date\>**, a chip that opens the Batches view for that
drop, where its documents render read-only on demand. The card never carries the document content; it links
the batch and the documents render when asked. The date is isolated LTR so an Arabic phrase never reverses the
Western numerals.

### The Batches view

A new **Batches** view (`initBatches`) lists the drops newest-first (R6): each batch's number and date, a
count of its documents and of the opportunities it produced, the documents (each a disclosure that renders the
md read-only on demand), and the opportunities as chips that open the card. It is **searchable by date and
business**. It is read-only: it renders the batch records and the opp store and turns no document into a card.

### A safe, dependency-free markdown renderer

There is no markdown library on this console by design (nothing runs here that we did not write). `renderDocMd`
is a small renderer that **escapes everything** (no HTML from a document ever runs), isolates each line with
`dir="auto"` so an Arabic line reads RTL and a Latin line LTR inside the same document, and gives headings,
list items, and fenced code a light treatment. It is byte-identical across repeated renders.

## Evidence

- **`tools/batch_documents_test.js` (Node, no browser)** - 33 checks, all pass:
  - *Part A (the real resolver):* the research md rides with the batch as a `research` document; its six makers
    become opportunities and **none of its note sections** (Market Assessment / Sources / Money) become cards;
    a **documents-only drop spawns ZERO opportunities** (the qualification gate holds) while still capturing
    both documents; `classifyDoc` names each type; and `toRecord` stamps `batch_id` / `batch_date` so every
    opportunity links (and mints empty batch fields when there is no batch, additive).
  - *Part B (the pure helpers):* `batchNumberFrom` reads the number from a name or heading; the id is
    idempotent by number; `renderDocMd` escapes HTML (no `<script>` survives), isolates each line `dir="auto"`,
    renders headings/lists/bold, and is **byte-identical across ten renders** (the brief's "ten reads
    byte-identical").
  - *Part C (the wiring):* the synced key, the write path persisting the batch and stamping opps through
    `ctx.batch`, the Overview chip, the Batches view, and **exactly one resolveBatch** (no second ingest path).
- **`tools/batch_documents_shots.py`:** a static-mock gallery on the real `styles.css` and exact classes
  (`batch` / `bdoc` / `batch-count` / `bopp-chip` / `mw-batch-chip`), EN + AR at three widths
  (380 / 720 / 1120), each reporting `h-overflow=False`. Screenshots in `shots/batch-documents/`.
- **Gates:** `verify.js` 35/35, `arabic.py`, `flows.py` green. No em dash; Western numerals; counts render
  outside the translated strings inside `<span class="n">`.

## Device-gated live test (Thyab runs it, fresh stamp first)

1. Drop the real batch 13 zip: one batch record holds the research md, the market assessment, and the README;
   the six cards each carry the batch chip; opening it renders the research md cleanly.
2. The Batches view lists the drop with its files and six linked opportunities; a search by a business name
   finds the batch.
3. Zero phantom cards from documents (the gate holds); ten reads byte-identical.

## Do not (held)

No document becomes an opportunity; the qualification gate is untouched. No document content is copied onto a
card - the batch is linked and the documents render on demand. No second ingest path - this rides the one
resolver's report. Additive only: one synced key, one read-time join, no existing write path replaced.
