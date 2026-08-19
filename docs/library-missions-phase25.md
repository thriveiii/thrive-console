# The Library, mission-aware: two missions, their templates, their pages (P25)

The Library was a flat wall of pages classified by name, date, location and template. That is the right index
once you already know what you are looking at, but it hides the thing that actually organizes the work: the
**mission**. Thrive sends two kinds of designed page, and they are not variants of one form. One is the
**Prospect Offer** (the Signal Brief the page editor already embodies, sent to a single prospect). The other is
the **Thrive Monthly Report** (a ratified design sent to the whole Thrive community). P25 restructures the
Library around those missions, so each one leads with its base template as the source of truth, publishes the
requirements an outside design must satisfy, and holds the pages filed under it, newest first.

## The mission model (R16)

A mission is `{ id, name (EN + AR), tagline, base template family, requirements manifest, pages }`. Two ship
seeded and cannot be removed:

- **prospect-offer** – templates `en-opp1` / `ar-opp1` (the Signal Brief, EN and AR). A *fill* mission: the
  editor offers its base templates and you fill them in.
- **monthly-report** – no fill-template in this repo, so it is an *upload* mission: a ratified design is
  produced against the manifest and uploaded. Its shelf seeds with the manifest and starts empty.

Missions live in one additive synced key, `thrive_missions_v1`. Only custom missions are persisted; the two
seeds are implicit, so a seed can never be corrupted and the store stays small. A custom mission (a third
shelf) appends to the store and can be removed once you no longer need it; removing it simply returns its pages
to the default shelf (nothing is deleted).

### Nothing is ever unfiled: `missionOf` is read-time, not a migration

The heart of the model is one resolver, `missionOf(page)`:

1. an explicit `page.mission` wins (set when a page is filed through the mission question), else
2. the template origin (`en-opp1` / `ar-opp1` → prospect-offer), else
3. the default shelf (prospect-offer).

Because this runs at read time and mutates no record, the migration of the existing pages is not a write at
all: every page resolves to exactly one shelf on read. **Count before == count after is structural, not
hoped-for** – the pages are partitioned, none created, none dropped. `library_missions_test.js` proves the
partition on a representative fixture (every original slug appears exactly once across the shelves; the total
equals the flat count). The 17-of-21 custom uploads with no distinguishing template land on the default
Prospect Offer shelf; a page can be re-filed onto the Monthly Report shelf explicitly (through the editor's
mission question) and it then carries `mission: "monthly-report"`.

## One editor, mission-parameterized (the one-component law)

There is exactly **one** page editor, `initEditor`. There is no `initReportEditor`, no second editor fork. The
editor gains a **Mission** select (`#f_mission`) at the top of Identity and a collapsible requirements manifest
(`#missionManifest`):

- choosing a *fill* mission (Prospect Offer) binds the template picker to that mission's base-template family
  and shows the fill fields, exactly as the editor worked before;
- choosing an *upload* mission (Monthly Report) hides the template picker and switches to upload mode, because
  a ratified design is uploaded against its manifest, not filled;
- **＋ New mission…** opens a prompt (name it), creates a third shelf with a starting manifest copied from the
  Prospect Offer as a checklist you refine, and files the page there.

`record()` stamps a `mission` on every page the editor builds, defaulting to `prospect-offer` when unset, so
**nothing lands unfiled**. Editing an existing page opens the editor on that page's own mission (via
`missionOf`), so an edit stays filed where it was. The one editor serves both missions; it is parameterized by
the mission, never forked.

## Evidence

- **`tools/library_missions_test.js` (Node, no browser):** 30 checks. The two seeds ship in order with their
  templates and non-empty manifests; `missionOf` resolves every page to exactly one mission (template origin,
  explicit override, unknown-mission fallback, no-template default); a flat page list partitions across the
  shelves with **count before == count after** and every slug present exactly once; a custom mission appends a
  third shelf and can be removed while a seed cannot; and the one-editor law holds (exactly one `initEditor`,
  no per-mission fork, the editor asks the mission and `record()` stamps it). All 30 pass.
- **`tools/library_missions_shots.py`:** a faithful static-mock gallery on the real `styles.css` and the exact
  shelf classes (`shelves` / `shelf` / `shelf-base` / `shelf-manifest` / `mf-list` / `grid` / `card`), EN + AR
  at **three widths** (380 / 720 / 1120). Each width reports `h-overflow=False`: the two shelves stack cleanly
  on a phone and hold on a desktop, RTL mirrored, Western numerals isolated in the counts.
- **Gates:** `verify.js` 35/35, `arabic.py`, `flows.py` green. Isolation grep clean (only the benign
  `store.js:20` prose). No em dash; Western numerals; counts render outside the translated strings inside
  `<span class="n">`.

## The live end-to-end test (device-gated, Thyab runs it)

The console boot and the operator's real page store are not reachable from the sandbox, so the shelves are
confirmed against live data on Thyab's device:

1. The Library opens on the two mission shelves with page counts, each showing its base template first, its
   manifest, and the filed pages with working search (business name, slug, date, language), newest first.
2. Uploading a page asks the mission: filing lands it on the right shelf. **＋ New mission** creates a third
   shelf; delete it in the test.
3. The existing pages sit under the Prospect Offer shelf by template origin, none lost (the flat count equals
   the sum of the shelf counts).
4. One editor component serves both missions (the grep proof above holds on the shipped bytes).

## Do not (held)

No page is left unfiled and no upload skips the mission question; the editor is not forked per mission (the one
component is parameterized); the ratified templates themselves are not altered. Additive only: one synced key,
one read-time resolver, no record mutated.
