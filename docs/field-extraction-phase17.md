# Field extraction, completed (P17)

P16 made the join correct - six rows, six matched, zero ghosts. The last defect was extraction: on the live
report the Subject column (العنوان) was empty for all six while destination and body were filled, and the
saved card carried only a slug - no display name, no person, no template - which starved the {{NAME}} merge
(P6), the roster, and the Contact Book (P10).

## The break

Fields share one line, wrapped in markdown bold:

```
- **Send to:** info@dripdocx.com · **Subject:** From press to booked chairs
```

The old key-line reader was a single, start-of-line regex: it captured the first field (Send to) and swallowed
the rest as its value, losing the Subject after the middle dot. Person names were nowhere - not from the
`Owner:` line, not from the body's `Hi Adam,` greeting.

## The grammar - labels anywhere on a line, bold-tolerant, value-bounded

One extractor, extended (no second reader). A labeled field is a known label anywhere on the line, optionally
bold-wrapped, its value bounded by the next labeled field or end of line:

- **Label set (EN + AR):** Send to / Send-to / To / Email / Recipient / المرسل إليه (send_to); Subject / Subj /
  الموضوع (subject); Owner / المالك; Template / القالب; Page; Kind / النوع; Location / الموقع. A qualifier the
  batches sometimes append ("Subject / opener:") is tolerated; ordinary prose ("talk to me:") is not.
- **Several fields on one line are all captured** - the shared Send-to + Subject line yields both.
- **Only a middle dot that precedes a KNOWN label splits a value**, so a middle dot inside a quoted subject
  ("The shop · found") stays in the value.
- **Bold markers never survive** into a captured value (stripped by `plain()`).
- **owner_name:** the `Owner:` line up to the first period or the next label, a title within the name segment
  kept (Narges Najmyar, PA-C).
- **greeting_name:** the body's first line if it is a greeting (Hi / Hello / Dear / مرحبا / أهلا) up to the
  comma - "Hi Krissee and Mariano," yields both. A bare `{{NAME}}` token is never captured as a name.
- **person name** for the card: greeting_name if present, else the owner's leading first name, else blank -
  never invented.
- **business display name:** the section title the matcher already computed, stored on the card; the slug
  stays the identity, and the report row now shows the business name above the slug.
- **template:** a per-section Template label, else a bundle-wide value the README/intro names for all pages
  (batch 13 says en-opp1), else blank - scanned, never guessed.

## What the record carries now

`toRecord` writes the full envelope: `business` (display name), `template` (en-opp1 where named), `subject`,
`body`, the channel, and - the downstream wire - a `recipients: [{addr, name, lang}]` entry plus `contact_name`,
so the composer and the pre-send roster read the person name for the {{NAME}} merge instead of a bare
placeholder. The language is detected from the body so an Arabic opportunity greets in Arabic.

## Evidence

- **`tools/ingest_matcher_test.js`** (permanent fixture, extended): a shared send-to + subject line yields both;
  bold-wrapped labels leave no `*` in any value; the Owner name ends at the first period with the note kept
  apart (and PA-C survives); a greeting with two names is captured and wins precedence over the owner; Arabic
  labels (المرسل إليه / الموضوع) and an Arabic greeting parse; a middle dot inside quotes does not split; a
  bundle-wide template applies where a page named none; the saved record carries the full envelope; one
  extractor; ten reads byte-identical.
- **`tools/board_match_join_test.py`** (extended): on the live board surface, the real batch-13 shape (subject
  sharing the send-to line) resolves all six MATCHED with the Subject column filled for every row, the business
  display name rendered beside each slug, and zero markdown stars in the report.
- `ingest_ladder_test.js`, `board_ingest_resolver_test.py`, `board_intake_gate.py`, `import.py`,
  `batch_write_test.js`, `batch_report_test.js`, `ingest_surface_test.py` all green (BATCH06's
  "Subject / opener:" still reads; the slug-cell reads updated to the isolated `.bt-slug` span).
- Board shot: six rows, each with its business display name and a checked Subject column, count line 6/6.

Gates: `verify.js` 35/35, `arabic.py`, `flows.py`, `perf_gate.py` green (the bundle ceiling raised a few KB for
the grammar and the row's business-name column, documented). Isolation grep clean; no long dash. The one
known-benign `supabase_stage1` docs failure is unrelated.

## Do not (held)

Labels are captured anywhere on the line, not only at the start. No markdown marker leaks into a captured
value. No name, subject, or template is invented that the bundle did not name. A middle dot inside quotes does
not split a value. There is one extractor, extended in place - no second one. The thread render, sending, and
the isolated assets are untouched.

## Real-zip caveat

The real batch-13 producer zip is not present in this environment. The failure and the fix are reproduced
against the real field shapes - the shared bold `Send to ... Subject` line, the `Owner:` line, greeting first
lines, Arabic labels, and the `en-opp1` bundle template - on the live board surface. Drop the actual zip into
`tools/fixtures/` and the same board test runs against it directly.
