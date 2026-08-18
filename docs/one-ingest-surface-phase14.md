# One ingest surface (P14)

The audit that followed three failed fixes found the real defect, and it was structural, not a matching bug.
There were **two ingest paths** in the tree:

- The board's "Today's batch" drop surface (`initIntake`, wired to `#intakeZone` / `#intakeFile`) rendered
  `review()`, fed by `ThriveIntake.readDrop`. `readDrop` called the old `parseManifest` + `match()` directly.
  It **never** called `resolveBatch`.
- The P11 tolerant ladder (opp.md / manifest.json / research-md rungs, provenance, needs-message) lived
  entirely inside `ThriveIntake.resolveBatch`, reachable only from the editor's separate "Upload HTML"
  surface (`runBatch` → `readBatch` → `resolveBatch`).

So every fix to `resolveBatch` changed nothing on the surface Thyab actually uses: those fixes were applied to
a function that surface did not run. This brief retires the old path and routes the live drop surface through
the one tolerant resolver.

## The fix: one reader, reached from every surface

- **The board "Today's batch" drop now calls `ThriveIntake.readBatch` (→ `resolveBatch`)**, not `readDrop`
  (`initIntake` in `library/app.js`). It renders the resolver's report - provenance rung per row, resolved /
  needs-message, the same as the editor - replacing `review()`'s old orphan / `in_parsed` output.
- **One shared report renderer.** `mountIngestReport(container, batch, opts)` (module scope in `app.js`) paints
  the resolver report and wires its Approve / Discard / needs-message-Write gate. Both the editor upload
  (`renderBatch`) and the board drop (`initIntake`) mount it. One writer (`writeImport`, via `ingWriteRows`)
  lands every storable row idempotently by slug; the board never hosts a page (`host:false`).
- **The old path is gone.** `readDrop` is deleted from `intake.js` (zero references). `parseManifest` and
  `match` remain, reached **only** through `buildBatch` inside the resolver - the one path - never as a second
  entry point (grep-proven). The unified board surface drops the per-item Skip/Replace UI; the resolver's
  idempotent update-in-place (existing slug updates, in-batch duplicate suffixed) is the dup handling now, the
  same as the editor.
- **File-type reach.** `#intakeFile` accepts `.json` alongside `.md/.txt/.html/.zip`; `readZip` keeps the same
  set. A dropped `.docx`/`.pdf` the reader cannot open is reported on the report as "unreadable format" rather
  than dropped in silence (`readBatch` surfaces `out.unreadable`), and every folder page keeps its
  needs-message Write action, so the road is never a dead end.

## Verification datum (what the old path saw, at cutover)

Before deleting `readDrop`, its output was logged against the batch-13 shape (six `opp/<slug>/index.html`
folders + one aggregated research md) on the live surface:

```
readFiles(files).manifests      = [["BATCH13_research_and_messages.md", 1325]]   (the md IS present, as .md)
readDrop(files).entries.length  = 6
readDrop(files).orphanPages     = []
readDrop(files).orphanEntries   = []
```

This closes the empirical gap the audit left open, and it carries a caveat worth stating plainly: **on the
batch-13 *shape* reproducible in this environment, the old `readDrop` path already resolved all six with zero
orphans.** So this fixture does not reproduce the live "Opportunities in the manifest: 0". The real producer
zip - which this environment does not contain - must differ (per the audit, most likely its section headings
do not match `HEAD_RE`, or the instruction file is a `.docx` filtered before the reader). The surface
unification is still correct and strictly safe: `resolveBatch`'s rung-3 engine **is** `readDrop`'s
`buildBatch`(`parseManifest` + `match`), plus the opp.md/json/**needs-message** ladder on top, so routing the
board to `resolveBatch` can only equal-or-beat `readDrop` on any input - and it converts the old "0 +
orphan pages" dead-end into actionable needs-message rows. If the real zip still under-resolves after this, the
residual is the parser/format matter the audit named (headings / file type), a separate change from unifying
the surface.

## Evidence

- `tools/import.py` (**rewritten to the board surface**): drops the REAL producer format
  (`READY_TO_SEND_BATCH06.md`, deflated) on `board.html`, proves the resolver report is shown before any write,
  three opportunities resolve matched, and Approve lands all three in Draft with channel / owner / prohibition
  / subject / tier / page / batch note intact. A page on its own is created "needs message", never dropped.
- `tools/board_intake_gate.py` (**rewritten**): the idempotent write lands two new in Draft and updates the
  existing archived slug in place, un-archiving it; the confirmed outcome counts "2 imported, 1 updated".
- `tools/board_ingest_resolver_test.py` (**new**): on the live board surface, the batch-13 shape resolves all
  six via the research-md rung (count 6, not 0), the unreachable folder is needs-message with a Write action, a
  legacy manifest.json resolves via the manifest rung, ten reads are byte-identical, and the Arabic
  opportunity resolves with its slug isolated. Source law: one `resolveBatch`, one `mountIngestReport` mounted
  by both surfaces, `readDrop` deleted.
- `tools/ingest_ladder_test.js` (P11) still passes, now exercising the resolver the live surface runs.

Gates: `verify.js` 35/35, `arabic.py`, `flows.py`, `perf_gate.py` all green (app.js **shrank** to ~750 KB - the
duplicate path removed). Full bed green but the one known-benign `supabase_stage1` failure (a retired-brand
word in pre-existing docs, unrelated, failing identically on main). No em-dash (U+2014); isolation grep clean.
Board surface shots at phone / desktop, EN and AR, show the resolver report with provenance + needs-message
Write, no horizontal scroll, Arabic slugs isolated.

## Do not (held)

Two ingest paths are not left in the tree - the surface Thyab uses and the resolver are the same path.
`readDrop` is deleted, not kept as a fallback. No send-to, subject, or body is invented. A folder or an
unreadable doc is reported truthfully, never dropped silently. The thread render (P12), sending (P8) and the
isolated newsroom asset are untouched.
