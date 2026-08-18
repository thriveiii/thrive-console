# The match join, completed (P16)

P14 unified the drop surface, P15 parsed the sections. The real batch-13 drop then read all six sections
and resolved four. Two split into ghost cards, visible on the live report (Aug 18):

- `hypergoat-coffee` showed "needs message" (empty), AND `hypergoat-coffee-roasters` appeared as a new,
  pageless "saved as draft" card.
- `drip-docx` and `drip-docx-wellness-and-aesthetics`: the same split.

Two compound defects, both fixed here.

## Defect 1 - the join matched exact slugs only, not tokens

For a folder-shipped page (`opp/hypergoat-coffee/index.html`), `keyOf()` reduces the name to the shared
basename `index`, so every folder page collides on one key and the `byKey` prefix path is dead. The only
working path left was `bySlug[slugify(business)]` - **exact** slug equality. `slugify("Hypergoat Coffee
Roasters")` is `hypergoat-coffee-roasters`, not the folder `hypergoat-coffee`, so the section never joined its
page. The four that worked had a business that slugified exactly to their folder.

**The one ranker (P13), now live.** `match()` scores every page x section pair on normSlug **tokens** and
assigns greedily, 1:1:

| rule | score | example |
|---|---|---|
| exact | 3 | `river-sea-chocolates` = `River-Sea Chocolates` |
| token-prefix | 2 | `hypergoat-coffee` is a prefix of `Hypergoat Coffee Roasters` |
| token-subset | 2 | every token of one appears in the other |
| overlap (Jaccard >= 0.6) | 1 | a CONFIRM, never an auto-join |
| below | - | no match |

`matched` (shared token count) is the specificity that breaks a tie: for one "River-Sea Chocolates" section,
`river-sea-chocolates` (exact, 3) wins over `river-sea` (prefix, 2), and `river-sea` stays a needs-message
page rather than being mis-assigned. A score of 1, or a genuine tie at the top, is a CONFIRM - one page and
one candidate section shown together, one tap to Join or mark Not a match, never auto-imported.

## Defect 2 - an unmatched section auto-spawned a card

A section that failed to join keyed its own slug into the resolver's union and `resolveOne` minted it a
pageless "matched" card, splitting one opportunity into two rows. The join now draws its slug union from
**pages, envelopes and json only** - a section keys a slug only when there are no pages at all (a
manifest-only import, where sections legitimately become drafts). When pages are present, a section that
matched none is an **orphan section**: surfaced in its own small list under the report, with the nearest page
below threshold as a suggestion, and a **Create card** action that is the only, explicit path to a card. It
does not create an opportunity, save a draft, or appear as a row among the pages.

## The complete join, and a truthful count

Every page and every section ends in exactly one state: MATCHED, CONFIRM, NEEDS-MESSAGE (a page with no
candidate), or ORPHAN (a section with no page). The count line reads pages / matched / to-confirm /
need-a-message / orphan-sections, each count isolated in a `<bdi class="n">` so a Western numeral never
reverses inside an Arabic phrase. Six pages plus six sections render as six matched rows, never eight.

## Repair on re-drop

Re-dropping runs the join against the store. A card already saved whose send-to AND subject equal a page now
joined, under a different slug, is a previously spawned ghost: it surfaces as "duplicate of <page>, merge?"
with one tap that archives the ghost while the page card keeps everything. The two ghosts from that night
(`hypergoat-coffee-roasters`, `drip-docx-wellness-and-aesthetics`) heal this way, on device, by a tap, never
silently.

## Evidence

- **`tools/ingest_matcher_test.js`** (new permanent fixture): token-prefix join; a tie forcing CONFIRM (never
  auto-joined); a below-threshold orphan that renders in the orphan list and spawns nothing; the specificity
  case (river-sea vs river-sea-chocolates); the truthful count line; and the source-law greps - one ranker,
  one scorer, the union never drawn from a section alone, the old exact-only branch gone.
- **`tools/board_match_join_test.py`** (new): on the live board surface, the real batch-13 shape resolves all
  six MATCHED, `hypergoat-coffee` and `drip-docx` via `token_prefix` (the rule shown on the row), zero orphan
  sections, zero spawned cards, count line pages 6 / matched 6; and the pre-existing ghost surfaces as
  "duplicate, merge?" and one tap archives it. Ten reads byte-identical; no page errors.
- `tools/ingest_ladder_test.js`, `board_ingest_resolver_test.py`, `board_intake_gate.py`, `import.py`,
  `batch_write_test.js`, `batch_report_test.js` all green (the batch-06 manifest-only import - sections with
  no pages - still resolves as drafts, unchanged).
- Board shots EN + AR: the six matched rows, the count line, the duplicate-merge block; no horizontal scroll,
  Arabic slugs isolated left-to-right.

Gates: `verify.js` 35/35, `arabic.py`, `flows.py`, `perf_gate.py` green (the bundle ceiling raised a few KB
for the confirm/orphan/duplicate surface, documented; the token ranker itself lives in `intake.js`, off that
budget). Isolation grep clean; no long dash. The one known-benign `supabase_stage1` docs failure is unrelated.

## Do not (held)

No card is created, drafted, or saved from an unmatched section - orphans are surfaced, never spawned. No
exact-only comparison is left in the join; the P13 ranking governs. A CONFIRM is never auto-imported and a
tie is never resolved by guessing. Pages and sections are not rendered as separate row populations - one row
per page, orphans in their own list. No field is invented; the join joins only what parsed. The thread render,
sending, and the isolated assets are untouched.

## Real-zip caveat

The real batch-13 producer zip is not present in this environment. The failure and the fix are reproduced
against the real heading and slug **shapes** (folder `hypergoat-coffee` + section "Hypergoat Coffee Roasters",
folder `drip-docx` + section "Drip Docx Wellness and Aesthetics", plus the four exact-slug cases), on the live
board surface. If the actual zip is dropped into `tools/fixtures/`, the same board test runs against it
directly.
