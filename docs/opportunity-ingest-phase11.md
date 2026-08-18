# The tolerant opportunity ingest (P11 / R8)

Batch 13 dropped six `opp/<slug>/index.html` folders and the console reported **"no instruction entry"** for
all six. The producer had shipped one aggregated research md (`BATCH13_research_and_messages.md`) beside the
folders plus a README asking a human to hand-write `manifest.json` steps; the consumer expected a manifest
entry keyed to each page. Neither end met the other. This brief fixes both: a self-describing envelope every
folder can carry (`opp.md`), and a **tolerant reader** that resolves an opportunity from whatever the bundle
actually contains, never dropping one. Off latest main (P5–P10 merged); author only; Thyab merges; additive
only.

## The root cause

`keyOf(name)` strips the path (`replace(/^.*\//, "")`), so every `opp/<slug>/index.html` reduced to the key
`index`. Six folders collided on one key; the research-md entries, keyed by business, matched none of them; the
pages fell through as orphans and were reported `no_manifest_entry`. The identity was being taken from the
file, when it lives in the **folder**.

`pageSlug(name)` fixes the identity: for `.../<slug>/index.html` (or any generic basename –
index/page/opp/opportunity/default/home) it returns `slugify(folder)`; otherwise `slugify(filename)`. `match()`
was reordered so the slug / business-slug pass runs **first** (before the generic page-file pass that had
collided on `index`), then the page-file pass, then the business-substring pass.

## The contract: `opp/<slug>/opp.md` (R8 envelope)

Every folder can describe itself. `parseEnvelope(md)` reads a flat `key: value` head –
`slug / business / kind / template / location / send_to / subject / sent_on` – then a `---` line, then the full
tailored email body verbatim (the `{{NAME}}` token kept). It is the authoritative rung: an `opp.md` beside the
page wins over any research md or manifest. (The companion edit that makes Jood emit `opp.md` per folder is a
follow-up after merge, not part of this PR.)

## The one reader: `resolveBatch` → `resolveOne` (the fallback ladder)

One resolver, one ladder, no per-batch or per-slug branch (a grep in `ingest_ladder_test.js` proves it, and
proves there is exactly one `resolveBatch` and one `resolveOne`). `resolveBatch` classifies the dropped files
into `opp.md` envelopes, research/flat docs, and `.json` manifests; runs the existing, tested rung-3 engine
(`buildBatch` – section parse + slug-aware match) unchanged; indexes each source by slug; and for every slug
runs `resolveOne`, which walks the rungs **highest confidence first and stops at the first that yields a
send-to and a body**:

1. **`opp_md`** – an `opp.md` beside the page. Authoritative.
2. **`manifest_json`** – any `manifest.json` entry for the slug. Legacy, still honoured.
3. **`research_md`** – any `.md` section naming the slug or business; `Send to:` / `Subject:` / body extracted.
   This is the batch-13 path.
4. **`page_partial`** – the `index.html` itself: a visible email and the hosted quote become a minimum record,
   marked *partial, body needs writing*.
5. **`needs_message`** – nothing reachable: the card is still created, marked *needs message*, with a one-tap
   action that opens the composer.

The rung that resolved each opportunity is recorded as **provenance** and travels onto the report row and onto
`toRecord` (`provenance`, `needs_message`). The resolver reads; it never sends, and it never invents a
send-to, subject, or body that is not in the bundle or on the page.

## The drop surface

The editor's upload path (`#fileInput` → `runBatch` → `renderBatch`) runs every dropped opportunity through
the resolver. The batch report gains a **"Read from"** column showing each row's provenance rung quietly, and a
`needs_message` row renders a one-tap **Write** action that stores the drafts (no GitHub gate) and opens the
composer at that slug – the road is never a dead end. `.json` files now join `.html/.htm/.zip/.md/.txt` on the
file input. Arabic and English bundles both parse; RTL business names stay intact and no letter-spacing is
applied to Arabic. Additive only: no new store, and resolved instructions attach to the opp record.

## Evidence

`tools/ingest_ladder_test.js` (pure Node, 15/15) and `tools/ingest_surface_test.py` (the live drop surface,
device-gated) together prove:

1. The batch-13 shape (six `opp/<slug>/index.html` + one research md) resolves all six via **rung 3** with the
   exact `send_to` / `subject` / body the research md named (never invented), provenance *research md*, and
   **zero** "no instruction entry".
2. An `opp.md` beside `index.html` resolves via **rung 1** and wins over the research md.
3. A folder with only `index.html` → *needs message* (rung 5) or *partial* (rung 4 when a visible email is
   present); the card is created either way and the Write action opens the composer.
4. A legacy `manifest.json` bundle resolves via **rung 2** – no regression – and the flat batch-06 shape still
   matches by name.
5. Ten reads of the batch are byte-identical; the resolver carries no per-batch or per-slug branch (grep);
   there is exactly one resolver and one ladder.
6. An Arabic opportunity (جمعية الشرق للحلويات) resolves and keeps its right-to-left business name intact.

Gates: `verify.js` 35/35, `arabic.py`, `flows.py`, `perf_gate.py` (dist ceiling raised the minimum for the
provenance column + Write action the offline file inlines; app.js unchanged ceiling; hydrate still 11 tables).
No em-dash (U+2014). Isolation grep clean (the retired-brand and newsroom terms remain 0 in the shipped
client beyond the benign `store.js:20` prose). No horizontal scroll at 390 / 1024 / 1280 in EN and AR; the seven-column report scrolls
inside its own container.

## Do-not (held)

No manual `manifest.json` is required for the standard path – `opp.md` is the contract. No failing opportunity
is dropped or hidden – it is created *needs message*. No send-to, subject, or body is invented. No per-batch or
per-slug logic. The isolated newsroom asset and its store are untouched.
