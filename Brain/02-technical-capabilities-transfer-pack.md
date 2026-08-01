# Technical Capabilities Transfer Pack

A portable, source-neutral engineering reference. It captures reusable patterns for
bilingual (Latin + Arabic / RTL) web products built on a hosted Postgres backend, a
static front end, serverless functions, headless-browser rendering, and background
workers. Every entry is written as **Problem -> Solution -> Rule**. Code samples use
neutral names. Nothing here depends on any specific product, repository, brand, or
account.

Contents:

1. Architectural patterns
2. Git and deployment playbook
3. Postgres / backend-as-a-service playbook
4. Static host + serverless playbook
5. Build discipline (assemblers, smoke tests, assertion guards, versioning)
6. Debugging methodology and recurring error patterns
7. Data integrity and validation
8. Front-end: RTL, i18n, BiDi, typography
9. Document and PDF generation
10. Code discipline principles

---

## 1. Architectural patterns

### 1.1 Thin client, computing backend

**Problem.** Business logic drifts into the UI (name substitution, authorization,
formatting, sending). The same rule then exists in two places and they diverge.

**Solution.** Draw one hard boundary: the UI collects and passes parameters only; the
backend computes everything (validation, permissions, substitution, side effects,
logging). The client never re-implements a rule the server owns.

**Rule.** The UI passes parameters. The backend computes. When a fix is "just the
button," fix the button and nothing behind it.

### 1.2 Single-file front end

**Problem.** A small tool spread across many files becomes hard to deploy, diff, and
audit for a solo maintainer.

**Solution.** Ship the interface as one self-contained HTML file with inlined styles
and scripts. Keep a strict rule that no client-side business logic lives here (see 1.1).

**Rule.** For small tools, one auditable file beats a scattered bundle. Keep it a view
layer only.

### 1.3 Static + serverless

**Problem.** A full always-on server is overkill for a mostly static site that needs a
little dynamic behavior (a form, a lookup).

**Solution.** Host static assets on a static/CDN host; handle the few dynamic needs with
platform form handling or serverless functions. Put large or frequently changing assets
on a **separate** static site from the main app.

**Rule.** Static by default, serverless for the exceptions. Isolate the asset host so an
asset change never triggers (or collides with) an app deploy, and vice versa.

### 1.4 Background workers as a tiered data lifecycle

**Problem.** All data lives forever in the hot database. Costs climb and queries slow as
cold rows accumulate.

**Solution.** Move data down a temperature ladder on scheduled jobs:

```
Hot   (primary Postgres) : active rows, queried constantly
Warm  (object storage)   : recent assets, exported closed records (thin index kept in DB)
Cold  (archive/backup)   : rows older than N days, full encrypted backups
```

Daily job demotes closed rows past a threshold; weekly job pushes warm-to-cold and takes
a full backup; monthly and yearly jobs keep long-retention snapshots.

**Rule.** Storage has temperature. Keep hot storage small; demote on a schedule; keep a
thin index in the hot tier so demoted rows remain findable.

### 1.5 Facet-generic (future-proof) schema

**Problem.** A new record "kind" arrives later and forces a migration and a rewrite of
every query.

**Solution.** At design time, add a `purpose`/`kind` discriminator with a default and a
check constraint listing future values. Ship only the default value's UI now; the column
already tolerates the future kinds.

```sql
purpose text not null default 'primary'
  check (purpose in ('primary','future_a','future_b'))
-- one active record per owner and purpose keeps the upsert target stable:
unique (owner_id, purpose)
```

Design records to carry their own facets (kind, target, tags, source) so one composer can
absorb new cell types later without a rebuild.

**Rule.** Reserve the dimension before you need it. A defaulted, constrained discriminator
column costs nothing today and saves a migration tomorrow.

### 1.6 Parallel isolated tenancies on one backend (the firewall pattern)

**Problem.** Two audiences that must never mix (different languages, regions, or
compliance regimes) are tempting to serve from one shared pool "with a translation
bridge." That bridge becomes a permanent leak surface.

**Solution.** Run two "worlds" over one backend. They may share the engine, the billing
spine, and the owner's cross-view. They may **not** share a tenant, a data pool, or a
machine-translation path. A workspace belongs to exactly one world, set at creation and
never silently changed. The backend refuses any operation whose data-world and
workspace-world disagree.

**Rule.** A firewall between audiences is a product decision before a technical one.
Share the engine, never the pool. Enforce the boundary in the backend, not in convention.

---

## 2. Git and deployment playbook

### 2.1 Merge is not deploy

**Problem.** A change is merged and assumed live. It is not: the running server still
holds the old code. Hours are lost debugging a fix that was never deployed.

**Solution.** After every merge, run an explicit deploy: pull on the server, restart the
service, then run a zero-cost probe that proves the live code actually changed (print a
version marker, hit a harmless endpoint).

```
git pull origin <branch>
systemctl restart <service>
# then confirm: a one-line import/version print or a cheap endpoint check
```

**Rule.** Deploy is a separate, verified act. "Merged" and "running" are different facts;
prove the second one.

### 2.2 Confirm the active branch, do not assume

**Problem.** Deploy instructions say `main`; the repo's primary branch is `master` (or the
reverse). The pull silently no-ops.

**Solution.** Confirm the active branch per repository once, and encode it in the deploy
steps.

**Rule.** Branch name is a fact to verify, not a default to assume.

### 2.3 Single merge authority; agents author, humans merge

**Problem.** An autonomous coding agent opens and merges its own work; an unreviewed diff
reaches production.

**Solution.** Agents (and contributors) author on branches and open PRs. One human is the
sole merge authority and reviews diffs line by line. One PR, one concern.

**Rule.** Authoring and merging are different privileges. Keep merge in one pair of hands
and review every line.

### 2.4 Verify agent success claims

**Problem.** A coding agent reports success without having verified execution.

**Solution.** After any agent session, confirm the real state independently.

```
git log --oneline -3      # did the commits actually land?
```

**Rule.** Trust the artifact, not the report. Confirm with the source of truth.

### 2.5 No numbered file names in the active workspace

**Problem.** `module_v7.py` and `module.py` coexist; deploys and imports pick the wrong one.

**Solution.** The active file has one canonical name. Versioned copies are backups and live
in an archive, never beside production code.

**Rule.** One canonical name per production file. Version history belongs to Git, not to
file names.

---

## 3. Postgres / backend-as-a-service playbook

### 3.1 The SQL editor is the only migration path (no CLI on the box)

**Problem.** There is no migration runner or CLI on the server; ad-hoc schema edits drift
from the code's expectations.

**Solution.** Author every schema change as a SQL file inside a PR. Apply it by hand in the
managed dashboard's SQL editor after review. Never edit schema live from application code.

**Rule.** Schema changes are reviewed artifacts, applied deliberately in one place.

### 3.2 Additive, non-destructive migrations only

**Problem.** A destructive migration (drop/rename) run against live data cannot be undone.

**Solution.** Only additive SQL reaches production.

```sql
alter table records add column if not exists component_a numeric;
alter table records add column if not exists component_b numeric;
```

For nested JSON, edit the target key, never rewrite the whole array:

```sql
-- targeted edit, keeps siblings intact
update config set data = jsonb_set(data, '{section,key}', '"value"'::jsonb)
where id = :id;
```

**Rule.** Add, do not destroy. Guard with `IF NOT EXISTS`. Patch JSON keys with
`jsonb_set`, never a full-array overwrite.

### 3.3 Row-level security with a reusable membership helper

**Problem.** Per-table access rules are copied and drift; recursive policies deadlock.

**Solution.** Define one membership helper and reuse it in every policy. Do not weaken RLS
to make a query work; fix the query.

```sql
alter table items enable row level security;

create policy items_access on items
  for all
  using (is_member(owner_id));   -- one helper, reused everywhere; no recursion
```

Run writes as the signed-in user so RLS actually applies. Verify by having a second user
attempt to read the first user's rows and fail.

**Rule.** One membership predicate, reused. Never weaken RLS to pass a test. Prove
isolation with an adversarial read.

### 3.4 Read the real columns before you query them

**Problem.** Code assumes a column name (`usage`, `score`) that differs from the actual
schema (`query_count`, plus separate components). Queries silently return nothing or wrong
values.

**Solution.** `select *` a few rows first and read the true column names and shapes. Names
rarely match intuition.

**Rule.** Inspect the table before filtering it. The schema, not memory, is the source of
truth.

### 3.5 Persist derived components, not just the composite

**Problem.** Only a composite value (for example a final score) is stored; later features
need its inputs, which are gone.

**Solution.** At write time, persist the components alongside the composite so they can be
re-read, re-ranked, and audited without recomputation.

```sql
alter table records add column if not exists component_a numeric;  -- input
alter table records add column if not exists component_b numeric;  -- input
-- 'total' already exists; keep the parts too
```

**Rule.** If a later view might need the inputs, store the inputs. A composite you cannot
decompose is a dead end.

### 3.6 Audit log as a first-class table

**Problem.** Sensitive actions (permission grants, sends, deletes) leave no trail.

**Solution.** A dedicated append-only audit table with actor, action, entity, before/after
state, and timestamp, indexed on actor, action, entity, and time.

```sql
create table audit_log (
  id bigserial primary key,
  actor_id uuid,
  action text not null,
  entity_type text,
  entity_id uuid,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);
```

**Rule.** Auditable actions write an audit row. A file (or a row) is auditable; a
conversation is not.

### 3.7 Structured, prefixed IDs

**Problem.** Bare integer or opaque UUID references are unreadable in logs and handoffs.

**Solution.** Give user-facing entities readable prefixed IDs (`PRJ-014`, `CTT-0231`) while
keeping UUID/serial primary keys internally. Accept both the readable ref and the numeric
id at API boundaries.

**Rule.** Human-readable IDs for humans, machine IDs for machines; accept either at the
edge.

### 3.8 One source of truth; caches are provisional

**Problem.** A local cache and the database disagree; the cache is trusted and ships stale
data.

**Solution.** Name the database the single source of truth. Treat every local cache as
provisional and reconcile to the database on conflict.

**Rule.** One store is canonical. Everything else is a hint.

---

## 4. Static host + serverless playbook

### 4.1 Separate asset site to avoid deploy collisions

**Problem.** Large or fast-changing assets on the main site cause deploy churn and
occasional collisions with app deploys.

**Solution.** Host assets (fonts, media, downloadables) on a **separate** static site from
the application. Each deploys independently.

**Rule.** Isolate asset deploys from app deploys. Different change rates deserve different
pipelines.

### 4.2 Intelligent forms with hidden context fields

**Problem.** A single contact form cannot tell which service or path a submission came
from; the recipient loses context.

**Solution.** Drive question labels from the selected type in the UI, and write the routing
context into hidden fields submitted alongside the visible answers.

```html
<select id="type"> ... </select>
<input type="hidden" id="type-code" name="type-code" value="">
<input type="hidden" id="q1-key"   name="q1-key"   value="">
<!-- script sets labels + hidden values when the type changes -->
```

**Rule.** Put the branching logic in visible labels and the routing context in hidden
fields. The submission should explain itself.

---

## 5. Build discipline

### 5.1 The asset-inlining assembler

**Problem.** A rendered artifact must be fully self-contained (for headless rendering,
email, or offline use), but references external fonts and images by relative URL that will
not resolve.

**Solution.** An assembler step inlines every external asset as a data URI and folds
external stylesheets into a `<style>` block, producing one standalone file.

```python
import base64
from pathlib import Path

def inline_assets(html: str, work: Path) -> str:
    # binary asset -> data URI
    raw = (work / "asset.png").read_bytes()
    uri = "data:image/png;base64," + base64.b64encode(raw).decode()
    html = html.replace("url('asset.png')", f"url('{uri}')")
    # external stylesheet -> inline <style>
    css = (work / "fonts.css").read_text()
    html = html.replace(
        '<link rel="stylesheet" href="fonts.css">',
        f"<style>{css}</style>",
    )
    return html
```

**Rule.** If it must render anywhere, inline everything. The build produces one file with
no external dependencies.

### 5.2 Smoke tests before every deploy

**Problem.** A syntax error or an import-time failure ships and takes the whole page or
service down.

**Solution.** Cheap, mandatory pre-deploy checks:

```
node --check script.js          # JS syntax; catches duplicate-const style SyntaxErrors
python -c "import app_module"    # import-time failures in the module graph
<build command>                  # must pass before merge
```

**Rule.** Never deploy code that has not at least parsed and imported. These checks are
non-negotiable and take seconds.

### 5.3 Assertion guards around output

**Problem.** Malformed output (unbalanced tags, content overflowing the page, an unqualified
record slipping to final production) reaches the user.

**Solution.** Guard the output with assertions that refuse to emit on failure.

```python
# structural balance
assert html.count("<div") == html.count("</div>")

# layout: last element must clear the reserved footer zone
assert last_element_bottom < PAGE_HEIGHT - FOOTER_RESERVE

# qualification gate: emit only on a full pass
def gate_check(item) -> bool:
    checks = [has_required_a, has_required_b, has_valid_source]
    return sum(1 for c in checks if c(item)) == len(checks)
```

The correct fix for a bad item reaching the end is a **structural gate that refuses it**,
not "be more careful next time."

**Rule.** Put a guard where the failure occurred. A missing validation layer is fixed with
a validation layer, not with vigilance.

### 5.4 Idempotency guard on triggered pipelines

**Problem.** A duplicate trigger re-runs an expensive pipeline (wasting spend or corrupting
state).

**Solution.** Make re-runs structurally impossible: a run-level idempotency key so a
duplicate trigger is a no-op, not a second execution.

**Rule.** Make the bug impossible, not merely discouraged. Structural guarantees beat
procedural reminders.

### 5.5 Deterministic replay for non-deterministic components

**Problem.** A component with a stochastic dependency (a model call, a sampler) gives
different results across runs, so you cannot tell a regression from noise.

**Solution.** Pin determinism where you need to test it (temperature 0, fixed seed), then
assert a fixed replay set passes every time (for example, 5 of 5 PASS).

**Rule.** You cannot regression-test what you cannot reproduce. Pin the randomness, then
assert the replay.

### 5.6 Staging first

**Problem.** Changes land straight on production.

**Solution.** Target a staging surface by default; promote to production deliberately.

**Rule.** Production is a promotion, not a default.

---

## 6. Debugging methodology and recurring error patterns

### 6.1 Trace values to their grave

**Problem.** A green test suite is taken as proof the system works; the value is never
confirmed where it lands.

**Solution.** Follow the value to its final resting place: the actual database row or a
printed log line, not merely the end of a function.

**Rule.** A passing test proves the code ran, not that the value arrived. Observe the
value at its grave.

### 6.2 Do not poll a processing endpoint in a loop

**Problem.** Polling a "process" endpoint in a loop re-triggers work each call and burns
metered budget.

**Solution.** Trigger is fire-and-forget and returns an id; read progress from the store,
never by re-hitting the trigger.

```python
run_id = start_run(payload)        # POST returns an id, does not block
state  = db.read("runs", run_id)   # read the row; never re-POST to advance it
```

**Rule.** Launch once, then read state. A processing endpoint is a trigger, not a status
poll.

### 6.3 Heredocs break on nested quotes and interpolation

**Problem.** `cat > f << 'EOF'` corrupts content containing nested quotes or template
syntax; pasted multi-line blocks hang on the shell continuation prompt.

**Solution.** Write files programmatically, and keep diagnostic scripts as real files run
with the project interpreter.

```python
# write a file without heredoc quoting hazards
open("out.py", "w").write(script_text)
```

Run `python diag.py` (a real `.py` file, project virtualenv), not an inline heredoc.

**Rule.** Generate files in code, not with heredocs. Diagnostics are committed scripts, not
pasted blocks.

### 6.4 Literal braces inside interpolated strings

**Problem.** CSS or other brace-heavy text placed inside a language's format string is
parsed as interpolation and breaks every rule.

**Solution.** Double the literal braces inside the format string, and un-double them only
after interpolation if you extract the text later.

```python
w = 200
css = f".box {{ width: {w}px; }}"   # {{ }} render as literal { }
```

**Rule.** Inside an interpolated string, literal braces must be escaped. Watch the un-escape
step if you later re-inject the text.

### 6.5 Version-specific language traps

**Problem.** A construct valid in one runtime version is a syntax error in another (for
example, a slice applied to a conversion flag inside a modern format string).

**Solution.** Prefer the explicit, version-stable form.

```python
# fragile in newer runtimes:
# f"{value!r[:40]}"
# stable:
f"{repr(value)[:40]}"
```

**Rule.** When a shorthand is version-sensitive, write the explicit long form.

### 6.6 Silent JS failures kill the whole page

**Problem.** A duplicate `const` (or similar) throws a SyntaxError that aborts all script
execution on the page, with no visible error to the user.

**Solution.** Catch it in the smoke test (`node --check`) before deploy.

**Rule.** One silent parse error can disable an entire page. Parse-check every script.

### 6.7 Overlay and preview quirks

**Problem.** Fixed/overlay panels placed inside the main content container break layout;
sandboxed preview frames silently render nothing.

**Solution.** Place fixed and overlay panels after the main container closes. Grant preview
iframes the script permission they need.

```html
<main> ... </main>
<div class="overlay"> ... </div>   <!-- after </main>, never inside -->
<iframe sandbox="allow-scripts" src="..."></iframe>
```

**Rule.** Overlays live outside the content flow; sandboxed previews need explicit
permissions or they fail quietly.

### 6.8 Schema drift is a top failure cause

**Problem.** Code expects columns the database does not have; inserts and reads fail at
runtime.

**Solution.** Keep code expectations and schema in lockstep; when a failure appears, check
for missing columns first.

**Rule.** When writes fail mysteriously, suspect drift between code and schema before logic.

### 6.9 Terminal output round-trips are lossy

**Problem.** Copying terminal output back as text arrives empty or mangled.

**Solution.** Capture such output as a screenshot (or redirect to a file and read the file).

**Rule.** Do not rely on copy-pasting live terminal output; capture it as an artifact.

### 6.10 Any secret seen in output is compromised

**Problem.** A key printed to a terminal, a log, or a response is now exposed.

**Solution.** Treat it as compromised the moment it appears and rotate it immediately; track
the rotation until closed.

**Rule.** Exposure equals compromise. Rotate on sight; never store secrets in the repo,
logs, or responses.

---

## 7. Data integrity and validation

### 7.1 Make the critical evidence fields non-nullable

**Problem.** Records reach output missing the facts that justify them (a source, a reason, a
date), and the gap is filled with invention.

**Solution.** Enforce presence at the schema level so an unqualified record cannot be stored
at all.

```sql
source_url text not null,
reason_text text not null,
event_date date not null
```

**Rule.** If a field is what makes a record valid, make it not-null. The database is the
last honest gate.

### 7.2 Date integrity rules

**Problem.** Bad dates (future timestamps, ambiguous day/month, bare years) silently corrupt
recency logic.

**Solution.** Apply strict rules and keep the raw string on reject for diagnosis:

- A parsed date after "now" is a hard reject (logged as a parse defect, raw string kept).
- Day/month ambiguity resolves by source locale; if still unresolvable, reject rather than
  guess.
- Bare years are rejected.
- Recency is a **gate**, not a decoration: outside the freshness window fails before any
  scoring.

**Rule.** When a date cannot be trusted, drop the record; never guess a date into validity.

### 7.3 Honest states, never pretend success

**Problem.** A failed write is reported to the user as success.

**Solution.** Surface the true state. If the write failed, say so; do not fake a success
path.

**Rule.** Report reality. A false success is worse than an honest failure.

### 7.4 Drop, never invent

**Problem.** Gaps in coverage tempt fabrication to "fill the slate."

**Solution.** Report the gap honestly (what was not covered) and drop the unqualified item.
Coverage metrics that admit blind spots build more trust than invented abundance.

**Rule.** Never fabricate to fill a gap. An honest empty slot beats a fake full one.

### 7.5 Entity resolution and dedup before scoring

**Problem.** The same entity surfaces from multiple sources and is counted several times.

**Solution.** Resolve and dedup to one entity carrying multiple hits before scoring; treat
the stacking as added confidence, shown as multiple badges on one record.

**Rule.** Deduplicate first; let repetition raise confidence, not count.

### 7.6 Type consistency at boundaries

**Problem.** A field is sometimes an array and sometimes a JSON string; consumers break on
the shape they did not expect.

**Solution.** Fix one canonical wire shape per field and honor it everywhere (for example,
a list field is always a JSON string on the wire, parsed once on receipt).

**Rule.** One field, one shape, everywhere. Normalize at the boundary.

---

## 8. Front-end: RTL, i18n, BiDi, typography

### 8.1 RTL layout mechanics

**Problem.** An interface built for LTR breaks when flipped to RTL.

**Solution.** Set direction at the root and let logical layout do the flipping; handle the
exceptions explicitly.

```html
<html dir="rtl"> ... </html>
```

- Flexbox order and text alignment flip automatically under `dir="rtl"`.
- **Directional** icons (arrows, chevrons) must be mirrored; **non-directional** icons
  (search, gear) must not.
- Logos and wordmarks do not mirror.
- Prefer CSS logical properties (`margin-inline-start`, not `margin-left`) so one stylesheet
  serves both directions.

**Rule.** Flip by direction and logical properties; mirror only what encodes direction;
never mirror brand marks.

### 8.2 Keep digits and identifiers LTR inside RTL text

**Problem.** Numbers and Latin identifiers reorder or split inside RTL runs.

**Solution.** Isolate them.

```css
.number, .identifier { unicode-bidi: isolate; }  /* stays LTR within RTL flow */
```

Keep Latin identifiers and codes in their original form even inside otherwise-Arabic text.

**Rule.** Digits and codes are LTR islands in an RTL sea. Isolate them.

### 8.3 Do not letter-space Arabic

**Problem.** Letter-spacing applied globally breaks Arabic, whose letters join; each glyph
detaches.

**Solution.** Zero out letter-spacing for RTL text and scope any tracking to Latin only.

```css
[dir="rtl"] * { letter-spacing: 0 !important; }
.latin { letter-spacing: 0.02em; }   /* tracking scoped to Latin */
```

Also: never uppercase Arabic text (it has no case).

**Rule.** Letter-spacing is a Latin-only tool. Arabic joins; never track it, never uppercase
it.

### 8.4 Optical vertical centering for Arabic

**Problem.** Arabic glyphs sit slightly above the box's visual center and look misaligned
next to Latin.

**Solution.** Nudge Arabic elements down a hair; leave Latin at zero.

```css
.rtl-glyph { position: relative; top: 0.05em; }
```

Set Arabic body line-height higher (around 1.7) for readability.

**Rule.** Center optically, not just geometrically. Arabic needs a small downward nudge and
more line-height.

### 8.5 Mixed-language spans

**Problem.** An Arabic phrase inside an English document (or vice versa) renders with wrong
direction.

**Solution.** Wrap the foreign phrase and declare its direction.

```html
English text with an <span dir="rtl">عبارة عربية</span> inside.
Arabic text with a <span dir="ltr">Latin phrase</span> inside.
```

**Rule.** Every embedded foreign-direction phrase gets its own `dir`.

### 8.6 Numerals policy

**Problem.** Mixing Western and localized digits inconsistently looks careless.

**Solution.** Pick one system per deliverable and apply it consistently. Keep Western digits
inside Latin identifiers and codes even in a localized document.

**Rule.** One numeral system per document, chosen deliberately; codes keep their native
digits.

### 8.7 i18n string discipline

**Problem.** Hard-coded strings and machine translation leave an interface half-localized and
unnatural.

**Solution.** Every visible string (labels, helper text, validation messages, buttons) exists
in both message files. Keep a small glossary of locked terms. Have native strings reviewed;
do not ship machine translation as final.

**Rule.** No string ships in one language only. Localize natively, not by machine.

### 8.8 Fonts: embed, cap weights, wait for load

**Problem.** Fonts fall back before load, or a weight is requested that the font does not
have.

**Solution.** Embed fonts as base64 in the CSS for self-contained rendering. Know each font's
real maximum weight and downgrade any reference beyond it. Before screenshotting or printing,
wait for fonts to be ready and force-load the specific weights used.

```python
await page.evaluate("""async () => {
  await document.fonts.ready;
  await document.fonts.load('700 24px "BodyFont"');
}""")
```

**Rule.** Embed the fonts, respect their real weight range, and wait for load before you
capture.

### 8.9 Precision layout and multi-width verification

**Problem.** "Looks fine on my screen" ships broken margins, clipping, and overflow on other
widths.

**Solution.** Hold a precision standard and verify it by screenshot at three widths before
delivering.

- Equal margins on all four sides; vertical centering in every container.
- Consistent line-heights within a block; every element strictly inside its box.
- Spacing from a fixed scale (multiples of a base unit such as 8); no arbitrary values.
- Render at 2x device scale for crisp output.
- Screenshot at mobile, tablet-landscape, and desktop; no horizontal scroll at a narrow
  width (for example 390px).

```python
ctx = await browser.new_context(
    viewport={"width": 1080, "height": 1350},
    device_scale_factor=2,
)
```

**Rule.** Precision is verified, not assumed. Three widths, screenshots, before delivery.

---

## 9. Document and PDF generation

### 9.1 Render searchable PDFs with a headless browser

**Problem.** Some HTML-to-PDF engines embed fonts as glyph outlines without a Unicode map;
the output is not selectable or searchable, which fails accessibility and search
requirements.

**Solution.** Render via a headless browser's print path (Chromium `page.pdf()` /
`print_background`, explicit page size, zero margins). This preserves selectable, searchable
text.

```python
await page.pdf(path="out.pdf", width="8.5in", height="11in",
               print_background=True, margin={"top": "0", "right": "0",
               "bottom": "0", "left": "0"})
```

**Rule.** For searchable PDFs, render text through a real browser engine. Avoid any engine
that outputs unmapped glyph outlines.

### 9.2 Page-break and font-ready discipline

**Problem.** Pages merge or fonts fall back in the PDF.

**Solution.** Control page breaks in CSS and wait for fonts before printing.

```css
.page { width: 8.5in; height: 11in; break-after: page; }
.page:last-child { break-after: auto; }
```

```python
await page.evaluate("async () => { await document.fonts.ready; }")
```

**Rule.** Break pages explicitly; wait for fonts; then print.

### 9.3 Verify the PDF programmatically

**Problem.** Visual review misses crowding, tag imbalance, and forbidden characters.

**Solution.** After generation, extract text and assert:

- Forbidden characters count is zero (whatever your house style bans).
- Structural tag balance holds (open count equals close count per page).
- The last element on each content page clears the footer zone (measure it; exclude cover and
  divider pages that are designed to fill).
- Key facts (numbers, a contents list against real section locations) match.

**Rule.** A generated document is not done until it passes automated checks, not just a
glance.

### 9.4 Compress as a separate, deliberate step

**Problem.** High-resolution PDFs are too large to send.

**Solution.** Compress with a dedicated tool preset tuned for on-screen reading as a final
step.

```
gs -sDEVICE=pdfwrite -dPDFSETTINGS=/ebook -o out_small.pdf out.pdf
```

**Rule.** Generate at quality, compress deliberately at the end.

---

## 10. Code discipline principles

**Evidence before code.** Read the actually deployed source before changing it. Never
reconstruct a file from memory. Read the stored data before choosing how to act on it.

**The first solution is the permanent solution.** No placeholders, no TODOs, no "temporary"
fixes in production. Every line is a contract with the future reader.

**One responsibility, one concern.** Each function has one job; each endpoint one purpose;
each PR one concern, reviewed line by line.

**Every exception path is handled.** Silent failures are bugs. If a step can fail, its
failure has a defined, visible outcome.

**Verify three times, three ways.** Do not call something fixed until it is confirmed by
independent means (a syntax check, an import, a traced value in the store).

**Spend behind an explicit gate.** Any metered or paid operation runs only after an explicit
approval, and only after a zero-cost probe confirms the paid path is correct. Enforce a hard
monthly cap; raise it only as a logged, conscious decision, never silent drift. Rate-limit on
purpose (for example one request per second) so bugs stay visible instead of racing.

**Make bad states impossible, not merely discouraged.** Prefer a structural guard
(constraint, idempotency key, gate) over a reminder to be careful.

**Material decisions belong to the owner.** Present analysis and a recommendation honestly;
leave pricing, exceptions, and scope calls to the decision-maker. Offer disagreement once,
clearly, before execution; once decided, execute.

**Separate the languages of the work.** Code, comments, commit messages, configuration, and
technical documentation are in one working language (English here) regardless of the
conversation language; user-facing deliverables follow their audience, not the conversation.

---

*End of transfer pack. Extend it whenever a new reusable lesson is proven. Following it means
the next project starts where the last one's hardest-won lessons ended, not from zero.*
