# Roster ingest (P5 / D3): paste-first recipients

One roster editor on the campaign card, three inputs into one editor: a paste box, a CSV upload, and
add-one-by-hand. Additive only. Nothing sends from this screen; it only builds the roster, stored on the
opp record (`recipients[]`), the single name source for merge (D4).

## The parser (`parseRoster`, one for all three inputs)

Splits on lines; per line, extracts zero or more `{ name, addr }`:

- **`Name <email>`** pairs -> the name and the address.
- **A bare email** -> the address, no name.
- **A CSV row** (`name,email` or `email,name`) -> the field containing `@` is the email, the other is the
  name, so column order does not matter. A header row (`email,name` with neither field an address) yields
  no recipient and falls out naturally.
- **A comma/semicolon list of emails** on one line -> one recipient each.

Then it trims, dedupes (by lowercased address), validates, and flags. Names are preserved **exactly** - no
case change, no letter mangling - and an Arabic name is tagged `lang: "ar"` for D4. Flags, never silent
drops (the operator decides):

- `invalid` - the value has an `@` but is not a well-formed address. (A line with no `@` at all is treated
  as noise, not an address attempt, and is not turned into a recipient.)
- `dup` - a second occurrence of an address already seen.
- `typo` - a known typo domain (`gmial.com`, `hotmial.com`, and similar) - a warning, not a block.

## The editor

Rendered in the campaign card's Overview as a `<details>` (open for a campaign, collapsed for a
single-send opp so it never clutters). It holds:

- the current roster as **inline-editable** rows (name + email, plus a per-row flag and a remove button);
  an edit re-validates and persists to the opp record on change;
- a **paste box** + "Preview and add": the parse result is shown for review (each row with its flag,
  malformed struck through, duplicates dimmed), then "Add N valid" commits the valid, non-duplicate rows;
- a **CSV upload** that reads the file text into the same preview;
- **add one** (a blank editable row).

Persistence is `saveDraft({ slug, recipients })` - additive, mirrored to `console_opps.data`, no second
store. `campaignRecipients` already reads `recipients[]`, so the roster is immediately the campaign's
recipient list. Nothing here sends or queues; sending is P6.

Reused from `intake.js`: its `slugify`/dedupe conventions informed the parser; the roster surface itself is
net-new (`intake.js` parses template zips, not recipient lists).

## Evidence

`tools/roster_ingest_test.py` (12 checks): a mixed messy list (Arabic and English names, a duplicate, a
malformed address, a typo domain, CSV rows in both column orders, a header line) parses to clean rows with
the right flags, deduped, Arabic preserved byte-for-byte; the editor commits valid rows to the opp record
additively; no mail row is written; an inline name edit persists and survives a re-read. Fails-when-broken
proven by disabling email validation (the malformed-flag check reds).

Device gate (Thyab): paste the messy list on device; the roster shows clean rows, flags the bad and
suspect ones, dedupes, keeps Arabic exact; a CSV with reversed columns detects name and email; inline edits
persist across refresh and RTL names render correctly at phone, iPad, and desktop widths.
