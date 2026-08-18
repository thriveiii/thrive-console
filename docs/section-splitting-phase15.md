# Section splitting: recognise the real heading shapes (P15)

P14 routed the live "Today's batch" drop through the one tolerant resolver, and left an honest caveat: on
the batch-13 *shape* reproducible in the sandbox, the old path already resolved all six, so that fixture did
not reproduce the live "Opportunities in the manifest: 0". The audit named the most likely residual - the
producer's section headings do not match the recogniser. P15 confirms it and fixes it.

## The defect

The producer ships numbered opportunities as `## 1) River-Sea Chocolates ...` - a digit, a close-paren, then
the title. The old recogniser was

```
HEAD_RE = ^\s*(\d+)\s*[middle-dot / en-dash / long-dash]\s*(.+)$
```

which requires a digit **directly** followed by a separator. The `)` after the digit is not a separator, so
the pattern rejected the heading. Every section fell through to notes, `entries` came back empty, and the
batch resolved zero opportunities. Proven fails-when-broken: against the real heading shapes, the old pattern
matches **0 of 9** headings in the batch-13 fixture.

## The fix: one tolerant recogniser, and the gate decides note-vs-opportunity

Two coupled changes in `library/intake.js`, both inside the one splitter (`parseManifest`); no second
recogniser, no per-batch branch (grep-proven).

1. **A tolerant heading grammar.** One pattern accepts every shape a person writes: an optional list marker
   (a number, optionally closed by `)`, `.` or `:`), then an optional separator (middle dot, hyphen, en dash,
   long dash, pipe or colon), then the title. `1) Name`, `1. Name`, `1 [dot] Name`, `N | Name` and a plain
   `Name` all parse to the same business + descriptor. The separator characters are written as escapes, not
   literals, because the long dash is banned in this source.

2. **The qualification gate, moved to section close.** Because a permissive heading now matches a plain name
   too, heading **shape** can no longer tell an opportunity from a "Market Assessment", a "Sources", or a
   README. So every `##` heading starts a *candidate* section, and the gate decides at section close: a
   section is an opportunity only if it yields a **send-to AND a body**. Everything else is a note, folded
   into `note_text`, and never becomes a phantom "needs message" card. This is the same predicate the
   resolver's `resolveOne` uses, so the two never disagree about what an opportunity is.

A non-opportunity section carries no Send-to and no message block, so it fails the gate on content, not on
the shape of its heading. The heading recogniser stays blind to what a section *is*; the gate answers that.

## Never dropped: where the guarantee actually lives

A pure-markdown section with a send-to but no body is not a shippable card (you cannot send an empty message),
so `parseManifest` keeps it as a note rather than storing an empty template. That is not a silent loss: its
heading survives in `note_text`, and - crucially - the moment such an opportunity has a **page**, the resolver
surfaces it as a "needs message" card with a one-tap Write action, exactly as before. The never-drop law lives
at the resolver, where it protects the user; `parseManifest`'s pure note-vs-opportunity split follows the gate.
`tools/batch_write_test.js` case 3 now proves both halves: the body-less section is a note in the pure parse,
and the same section resolves to a needs-message card once its page is present.

## Evidence

- `tools/ingest_ladder_test.js`: the batch-13 fixture (rewritten to the real `N)` producer headings) resolves
  all six via the research-md rung, send-to / subject / body filled, count six not zero; every heading shape
  (`N)`, `N.`, `N [dot]`, plain) parses to one opportunity; the three non-opportunity sections
  (Market Assessment, Sources, Money at a glance) are notes, not opportunities; a research md of only
  non-opportunity sections yields zero rows; one recogniser, one splitter (grep). The legacy middle-dot
  batch-06 shape still parses (no regression).
- `tools/board_ingest_resolver_test.py`: on the live board surface, the tolerant-heading batch resolves all
  six (count six), the unreachable folder is needs-message with a Write action, ten reads are byte-identical,
  the Arabic opportunity's slug reads left-to-right, no page errors.
- `tools/batch_write_test.js`, `tools/batch_write_gate.py`, `tools/import.py`, `tools/ingest_surface_test.py`,
  `tools/intake_integrity_test.py`: all green.
- Board surface shots at phone and desktop, EN and AR: the resolver report with provenance and the
  needs-message Write, no horizontal scroll, Arabic slugs isolated.

Gates: `verify.js` 35/35, `arabic.py`, `flows.py`, `perf_gate.py` all green. Isolation grep clean (only the
benign `library/store.js:20`). No long dash (U+2014) in source. The one known-benign `supabase_stage1`
failure (a retired-brand word in pre-existing docs) is unrelated and fails identically on main. The 10-gate
browser harness (`gates.py`) does not drive views in this sandbox and mass-fails on a clean `main` as well, so
it is not a signal here; the substantive gates and the targeted board tests carry the proof.

## Do not (held)

The recogniser does not require a digit-then-separator. It does not rely on heading shape to exclude
non-opportunities - the send-to + body gate does that. There is no second splitter or second recogniser, and
no per-format branch. No send-to, subject, or body is invented. The thread render (P12), sending (P8), the
retired-brand asset, and the isolated newsroom asset are untouched.
