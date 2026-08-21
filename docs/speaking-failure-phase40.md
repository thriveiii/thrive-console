# The speaking failure: make a silent client death say which mechanism (P40)

## Ground: the wire is proven healthy; the client dies after data arrives

The edge log for the failing attempt (04:49:57Z, the failing device, Chrome on iOS) shows the COMPLETE
boot sequence succeeding on the wire, in order, within one second:

1. `OPTIONS` then `POST /auth/v1/token?grant_type=password` 200. Sign-in succeeded.
2. `GET /rest/v1/console_settings` (op_prefs) 200, auth_user = 38864a57-4d66-4525-a4a4-d83880c2ce63.
3. `POST /rest/v1/console_templates` 200, same auth_user.
4. `GET /rest/v1/console_board?select=slug,business,stage,...` 200, SAME auth_user attached.

This kills the anon hypothesis for this attempt: the board read carried the real session token (the edge
resolved the JWT to the operator's user id) and the server answered 200. Auth, CORS, headers, RLS
attachment, and transport are proven end to end. After 04:49:57 the device issues no further requests and
the screen never paints. The death is strictly CLIENT-SIDE, after successful authenticated reads. Exactly
two mechanisms remain:

- **A:** the 200 carried ZERO ROWS (a 200 says nothing about row count). An authenticated operator can
  legitimately see an empty `console_board` if the P27 membership row or its migrations are missing in this
  database. P39's `boardEmpty` should then paint; if the empty path itself throws, black follows.
- **B:** rows arrived and a rendering or parsing exception killed the boot after data receipt, unpainted
  and unreported, because P36 stripped every shipped error surface.

This phase does not guess between A and B. It makes the device say which, in one photograph. Reveal, not
fix: zero behavior change to auth, session, reads, rendering, or the DB.

## What was added

1. **`library/failsafe.js`, the first script on every page (both builds), before any module.** Inlined in
   the head (no asset fetch), it registers `window` `error` and `unhandledrejection` listeners and builds
   its own panel imperatively on `documentElement`, depending on no app CSS, module, or render path. On the
   first trigger it prints, one line each EN then AR: the error name/message/first stack line, the build
   stamp, the boot checkpoint, BOARD ROWS (the console_board row COUNT), SESSION IN STORAGE (present /
   null), and EPHEMERAL. It NEVER prints a token value or any row content, counts and presence only. In a
   healthy boot it renders no pixel.
2. **A boot watchdog (12s default).** Armed by the app only once the gate has RESOLVED (so a signed-out gate
   never trips it). If the board never painted (`window.__bootPainted`) and nothing errored, the same panel
   appears with "boot stalled" plus the checkpoint, row count, and storage datum.
3. **Boot checkpoints, string assignments only.** `window.__bootMark` is set at each existing step: gate
   resolved (`gate.js` finish), hydrate begun (`supaHydrate`), board request sent / response received
   (`readBoardViewRows`), payload parsed (`adoptBoardView`, which also records `window.__boardRows`), board
   painted (`render`, which also sets `window.__bootPainted`). No logic, no timing, no new branches.
4. **Nothing else changes.** No retries, no fallbacks, no auth or render changes.

## Evidence

- **`tools/failsafe_surface_test.js`** (Node, DOM-shimmed), all pass:
  - an uncaught error and an unhandled rejection each render the panel with the checkpoint, row count, and
    session presence, in EN and AR;
  - **the privacy law**: the panel never contains the token value (a fake JWT placed in storage never
    appears), only the row COUNT and presence;
  - the watchdog fires the stall panel only when the board never painted, and stays silent once it did;
  - a healthy boot renders no panel; the panel renders at most once.
- The rendered panel (captured from the test harness, error case, rows 0) is reproduced in the PR body.
- **Gates:** `verify.js` 35/35 (incl. zero em dashes), `arabic.py` 0 failed, `bare_metal_auth` 0 failed
  (the failsafe strings do not match its diagnostic regex, and it never reassigns `fetch`),
  `session_integrity` / `signin_resilience` / `supabase_auth` / `deploy_marker` / `fresh_code` /
  `board_one_read` all pass. Western numerals; shipped-shell isolation grep 0. The build stamp advances
  (a new BUILD hash includes `failsafe.js`). Pre-existing benign exception: `supabase_stage1` "no Lotus
  reference" (older docs prose; reproduces on `main`).

### Device-gated (Thyab, fresh stamp first)

1. Confirm the new build stamp on the failing device BEFORE testing (clear site data for
   console.thriveiii.com if the stamp does not advance).
2. Sign in on the failing device. The black screen is replaced by a readable panel. Photograph it. BOARD
   ROWS: 0 selects mechanism A (data/membership, server-side SQL next). An error line with rows present
   selects mechanism B (the named exception is the next fix's exact target).
3. A healthy desktop boot shows no panel and no new pixels.

### In parallel, no code: the mechanism A check (Thyab, Supabase SQL editor, read-only)

    select table_name from information_schema.tables
    where table_schema = 'public' and table_name in ('members','contacts','channels','batches');

    select column_name from information_schema.columns
    where table_name = 'members' and table_schema = 'public';

Then, if `members` exists with a user id column, check the operator's row (use the actual column names the
first query returned):

    select * from public.members where <user_id_column> = '38864a57-4d66-4525-a4a4-d83880c2ce63';

A missing `members` table or a missing operator row (or is_console_owner false) confirms the P27 migration
debt as the source of an empty authenticated board, and the next step is applying the pending SQL, not
another client PR.

## Do not (held)

Nothing is fixed here; this reveals only. No token value or row content is printed, logged, or embedded
(counts and presence only). The panel never renders in a healthy boot. The auth request, the keys, the DB,
Lotus, and the newsroom are untouched. Author only, not merged, not released.
