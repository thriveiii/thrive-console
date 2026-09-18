# ZIP_MESSAGE_TRACE

Read-only trace. No code changed, no PR. Every claim is cited `file:line` against
`origin/main`. The bug: a full campaign zip imports the PAGES and creates cards, but
the per-folder MESSAGES do not attach, so cards land with no message body (and no
recipient). The zip is correct: each page and its message sit together in a per-slug
subfolder, e.g. `bards-alley/index.html` + `bards-alley/bards-alley.md`, and each
`.md` is a valid message (a Subject line, a json `{"to":"..."}` block, then the body).

## Short answer
The reader DOES read subfolders. The failure is the pairing: a page and its message
are matched only by TOKEN SIMILARITY between two independently-derived slugs - the
page's slug (taken from its FOLDER) and the message's slug (taken from its `#`
HEADING, else its FILENAME with the folder stripped). The one fact that unambiguously
pairs the two files - they live in the SAME folder - is never used. When the message's
heading or filename is not token-similar to the folder name, the page commits with no
message (`no_message`), which is exactly what happened to the 4 folders.

---

## 1. Does the reader recurse into subfolders, or only read top-level entries?

It reads subfolders. A zip's central directory is a flat list of entries whose names
carry the full path, so there is no recursion to do - every file, at any depth, is one
entry.

- `upReadZip` (`tools/board-upload.src.js:49`) walks the central directory
  `count` entries (`:53`, `:55`-`:72`), decoding each entry's full `name` (`:61`),
  e.g. `bards-alley/bards-alley.md`. The only skips (`:63`-`:64`) are: a directory
  entry (`/\/$/`), a dotfile (basename starts with `.`), a non-target extension
  (not `.html?|.md|.txt|.json`), or a bad local header. A nested `.md`/`.html` passes
  all of these, so it IS read, with its folder kept in `name`.
- `upReadFiles` (`:75`) classifies each entry by extension, keeping the FULL path as
  `name`: `.html` -> `pages` (`:84`), `.md/.txt/.json` -> `texts` (`:85`). So
  `bards-alley/index.html` lands in `pages` and `bards-alley/bards-alley.md` lands in
  `texts`, both with their folder intact.

So both files of every folder are present with their paths. Subfolders are not the bug.

---

## 2. How is a `.md` message paired to its `.html` page?

By TOKEN SIMILARITY of two slugs that are derived SEPARATELY, and never by the shared
folder or the filename-to-folder relationship.

- The page's slug comes from its FOLDER. `upPageSlug` (`:104`) splits the path
  (`:105`); for `bards-alley/index.html` the file base is `index`, which matches the
  index/page/home set (`:108`), so it returns `upSlugify(parts[len-2])` =
  `upSlugify("bards-alley")` = `bards-alley`. (This is why the PAGE resolves
  correctly.) Used at `upBuildPlan` `:222`.
- The message unit's slug comes from its HEADING, else its FILENAME with the folder
  STRIPPED. In `upBuildPlan`, the per-file (whole-file) branch builds the unit at
  `:238`: `var nm = upFirstHeading(tx.text) || upBaseName(tx.name).replace(/\.(md|txt|json)$/i, "");`
  then `slug: upSlugify(nm)` (`:239`).
  - `upFirstHeading` (`:111`) returns the first `#`..`######` heading in the text and
    takes PRIORITY over the filename. So any `# ...` line anywhere in the message
    (a title, a greeting header) becomes the unit's name.
  - `upBaseName` (`:103`) is `replace(/^.*\//, "")` - it DELETES the folder, so even
    the filename fallback carries no folder context. For `bards-alley/bards-alley.md`
    with no heading it yields `bards-alley`; for `bards-alley/outreach.md` it yields
    `outreach`.
- The pairing itself (`:245`-`:262`): for each page row, scan all units and keep the
  best by `upRankTokens(upNormTokens(r.slug), upNormTokens(u.slug || u.name))` (`:249`).
  A unit is accepted only when `bestScore >= 2` (`:252`); `upRankTokens` (`:113`)
  gives 3 for an exact token match, 2 for a prefix/subset match, 1 for a Jaccard
  >= 0.6, else 0 (`:114`-`:125`). Below 2, the page is left with `no_message`
  (`:259`-`:261`).

There is NO folder-based pairing anywhere in `upBuildPlan`. `upPageSlug` (folder-aware)
is used only for the page (`:222`); the unit never records its folder (`:231`, `:238`
both go through `upBaseName`, which strips it). So two files in the same folder are
paired only if their independently-derived slugs happen to be token-similar.

(For completeness: the OTHER text mode is the consolidated one-file-many-messages
format - `upParseSections` `:175` splits on `#`-headed sections and reads a "Send to:"
line plus a fenced body per section, `:193`-`:199`. The per-folder `.md` here has a
json `{"to":...}` block, NOT a "Send to:" line, and typically no fenced body, so its
section is `isMessage=false` (`:198`) and is filtered out (`:228`); it therefore falls
through to the whole-file branch above at `:236`-`:239`, and its recipient is found by
`upEmailFrom` scanning the whole text, including the json (`:147`, `:131`-`:135`). So
the unit and its email ARE created - only the pairing slug is wrong.)

---

## 3. Why did 4 pages match but their per-folder messages not attach?

- The 4 PAGES matched because `upPageSlug` reads the FOLDER for an `index.html`
  (`:108`), so each `<slug>/index.html` becomes a row keyed by its folder slug
  (`:222`-`:224`). That half is correct.
- The 4 MESSAGES did not attach because each unit's slug came from its heading or its
  bare filename (`:238`), not its folder, and that slug was not token-similar (score
  `>= 2`) to the folder slug the page carries. So `upRankTokens` returned `< 2` for
  every (page, unit) pair, `best` stayed null, and each row took the `no_message`
  branch (`:259`-`:261`) - the page commits, the message and recipient are dropped.
  Two ways this happens for the exact zip described:
  1. The `.md` contains a `#` heading (a subject-as-heading or a greeting line). Then
     `upFirstHeading` wins at `:238` and the unit slug is the heading slug (e.g.
     `the-del-ray-opening-louder`), which shares no tokens with `bards-alley` -> score
     0 -> `no_message`. This is the dominant case for AI-authored messages that open
     with a heading.
  2. The `.md` filename is not the folder name (e.g. `bards-alley/message.md` or
     `bards-alley/outreach.md`, or a different separator like `bards_alley` vs
     `bards-alley`). With no heading, `upBaseName` yields `message`/`outreach` (folder
     stripped at `:103`), again token-different from `bards-alley` -> `no_message`.

The unambiguous signal - `bards-alley/index.html` and `bards-alley/bards-alley.md`
share the folder `bards-alley` - is available on both `pg.name` and `tx.name` at pair
time and is simply never consulted.

---

## Root cause (one line)

The page-to-message pairing matches token-similar slugs derived independently (page
from its folder, message from its heading/filename), and never pairs the page and the
`.md` that live in the SAME folder - so a per-folder message whose heading or filename
drifts from the folder name silently drops to `no_message`.

## For the fix (evidence only, not done here)

Pair a page and a `.md` by their SHARED FOLDER first: the directory prefix of `pg.name`
(everything before the last `/`) equals the directory prefix of `tx.name`. When a page
and exactly one message-bearing text share a folder, attach that message directly,
before the token ranker runs; keep `upRankTokens` as the fallback for the consolidated
one-file-many-messages zip (which has no per-folder structure). This makes
`bards-alley/index.html` + `bards-alley/*.md` pair regardless of the message's heading
or filename. A fails-when-broken test: a 4-folder zip (each `<slug>/index.html` +
`<slug>/<something>.md`, each `.md` a Subject + json `{"to":...}` + body, with a
heading that does NOT match the folder) must commit 4 cards, each carrying its message
subject/body AND its recipient - proven by reverting the folder-pairing so the rows
fall back to `no_message`.
