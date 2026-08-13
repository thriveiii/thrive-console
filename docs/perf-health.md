# Performance and operations health pass

Measured first, then fixed only what the numbers convict, then locked with a perf gate. No architecture
change. Numbers are from the sandbox harness at the tree this PR branches from.

## Measurements

### Bundle

| Asset | Size | Note |
|---|---|---|
| `library/app.js` | 569 KB | the logic; largest JS module |
| `library/fonts.css` | 327 KB | embedded Arabic + Latin font faces (needed, not dead) |
| `library/i18n.js` | 178 KB | EN + AR dictionaries |
| `library/styles.css` | 143 KB | |
| `dist/thrive-console.html` | 1.51 MB | the offline single file, everything inlined (fonts base64) |
| `library/console.html` | 58 KB | the served shell, assets linked and cached |

Dead code from retired surfaces: the retired manual-connection UI and the removed Lock control are
**already gone** (the settings block is the post-retirement read-only line; `relock` in `gate.js` is the
live graduated re-gate, not the removed manual Lock). An orphan-function scan (337 top-level functions in
`app.js`, cross-checked against all library files, the test bed, and every view HTML) found **five**
genuinely dead functions, removed below. No orphaned styles found.

### Cold open / paint

Static single-file document (no build step, no framework): the gate paints on first parse; the board
paints after the sign-in hydrate resolves. The dominant cold-open cost is the 327 KB of embedded fonts,
which is content, not code, and is left as-is (subsetting is not a health-pass mechanical fix).

### Hydrate

One sign-in hydrate reads **8 tables, each exactly once**, no duplicate reads and no N+1 per card:
`console_settings` (op prefs), `console_opps`, `console_pages`, `console_mail`, `console_inbound`,
`console_hits`, `console_comments`, `console_templates`. (`console_profiles` is read once separately by
the profile load.)

### Runtime

- The breathing glow (`reply-breathe`, styles.css) animates **opacity only** -> compositor, no layout.
- The arrival (`board-settle` / `rise-in`) animates **opacity / filter** -> compositor, no layout.
- **No animation touches a layout property** (width/height/top/left/margin/padding), so there is no
  layout thrash to convict. (The one-shot new-activity glows animate box-shadow/background = paint, not
  layout; they play once and are not the breathing glow.)
- **Board re-render on one sync round = one** (a single `render()` rebuilds all five lane bodies once).

### Operations

- **Reconstruction counter: 0** on fresh data (the child-card reconstruction net never fires).
- **Queue drains to empty** after hydrate.
- **Quota counts once per confirmed delivery** (existing `send_once_test`, unchanged).
- **Polling loops (grep `setInterval`):** two, both calling `syncNow` -> **one is redundant** (below).
- Silent catches on the one changed file (`app.js`) around the changed region are all intentional
  best-effort guards (localStorage/DOM/optional-API), consistent with the file's convention.

## Fixes the numbers convict

1. **One live-sync heartbeat, not two overlapping polls.** `startLiveSync` runs a 60s visibility-gated
   `syncNow` heartbeat, and `doSyncRound` fires the `sync` event that re-renders the board and repaints
   its badges. A **second** 90s `setInterval` inside `initBoard` polled the **same** transport and
   repainted the **same** badges that `render()` already repaints (`paintCardBadges`/`refreshInboxBadge`).
   Two overlapping loops of one transport, plus an extra board render every 90s for nothing. **Removed.**
   The 60s heartbeat is more frequent and covers it, so no freshness is lost and the board polls once.
   Before: 2 polls (`setInterval` count in `app.js` = 2). After: **1** (the justified heartbeat).

2. **Five dead functions removed** (each defined and never referenced anywhere: `app.js`, all library
   files, the test bed, and every view HTML):
   `clearActionStatus`, `removedAt`, `liveOfferUrl`, `supaClearDiverge`, `supaReadDegraded`.

No duplicate reads to collapse (hydrate already reads each table once) and no layout-thrashing animation
to convert (none animate layout properties), so neither is touched: nothing speculative.

### Before / after

| Metric | Before | After |
|---|---|---|
| `setInterval` polling loops in `app.js` | 2 (one redundant) | **1** (the 60s heartbeat) |
| Board renders from polling, per ~3 min on the board | ~5 (60s + 90s) | **~3** (60s only) |
| `library/app.js` | 569,294 B | 569,125 B (5 dead functions out; one explanatory comment in) |
| Hydrate reads per open | 8, no duplicates | 8, no duplicates (unchanged; already clean) |
| Reconstruction counter | 0 | 0 |

## Lock

`tools/perf_gate.py` (joins the test bed) holds four budgets, so a regression turns red instead of slow:

- **Bundle ceiling:** `library/app.js` under 600 KB and `dist/thrive-console.html` under 1.60 MB.
- **One heartbeat:** exactly one `setInterval` in `app.js`, and it is the visibility + auth gated 60s
  sync heartbeat (a second poll turns it red).
- **Hydrate budget:** one hydrate reads at most 10 tables, each at most once.
- **Operations sound:** the reconstruction net fires zero times and the write queue drains to empty.

Breaking a budget was shown red once (a second `setInterval` fails the poll check; +40 KB of bloat fails
the app.js ceiling), then reverted.
