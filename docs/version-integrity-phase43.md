# One build everywhere: version integrity and forced convergence (P43)

## The disease, named

Two devices, two different applications, same URL, same night: the iPad on build 73cd9340 (a week old,
predating P39 to P42), the iPhone on a6a10b4b. Every symptom of the week reduces to this: after the anon
door closed (correct security), a FLEET of cached clients kept limping on whichever stale build each
device happened to serve, and every fix was judged through that lens. The application had NO mechanism
that guarantees any device runs one consistent, current build. P43 makes freshness a property the
application enforces about itself: no cache clearing, no rituals, ever again.

## The in-repo evidence pass (quoted before any edit)

**1a, service worker census: NONE EXISTS.** Zero `serviceWorker.register` calls anywhere in the repo or
the generated pages; zero worker files (`sw.js` / `service-worker*.js`). The only references are the
shell's head bootstrap, which actively UNREGISTERS any stale worker on every boot (`tools/bundle.js:269`),
and two bed tests that enforce no-registration permanently (`bare_metal_auth_test.js` G6,
`fresh_code_test.py`). Finding recorded; the self-destructing-worker step is SKIPPED per the brief, and no
worker is introduced.

**1b, the versioning map.** Entry documents: `/index.html` (generated redirect), `/library/console.html`
(generated shell), `/authtest.html` (standalone, no scripts, no stamp), `dist/thrive-console.html`
(offline copy, everything inlined, gitignored). On console.html, all 16 scripts and 2 stylesheets carry
`?v=<per-file content hash>` from the bundler's fingerprint map: a changed file changes its URL, so **new
HTML with old JS is structurally impossible**; a cache can only serve bytes for a URL that never changed.
In-shell navigation is hash-only (`viewHref` returns `#view` inside the shell), so the ONE place an old
document could stamp the next was `index.html`: its meta refresh, visible anchor, and redirect script all
baked its OWN build into the console.html URL. A stale cached index.html therefore chain-pinned
console.html to an old `?v` forever: the exact iPad disease.

**1c, the stamp source of truth.** `BUILD` (a content hash over every shipped source) and `BUILT_AT` are
computed once in `tools/bundle.js` and embedded in: console.html (`meta[name=thrive-build]`, the visible
`.build-stamp`), index.html (three sites), and the dist copy. No other file embeds them.

## The build

1. **`version.json`, the version authority.** Written at the site root by the SAME bundling step that
   stamps the build: `{"build","builtAt"}`. Served beside index.html; fetched only with `cache:"no-store"`
   so no cache layer can lie about it.
2. **Front-door convergence (index.html, via its generator).** The redirect script now fetches
   `./version.json` no-store and navigates to `console.html?v=<SERVED build>`, falling back to the baked
   value only when the fetch fails (offline, first deploy). Incoming params (minus any stale `v`/`vr`) and
   the hash still carry across. The meta refresh remains as the JS-off fallback but is DELAYED (6s) so the
   convergence script wins the race; previously it fired at 0s with the baked build, which is precisely
   the chain-pin.
3. **Shell convergence (failsafe.js, the first script).** As the first act of boot the shell fetches
   `../version.json` no-store and compares the served build to its own `thrive-build` meta. On mismatch it
   replaces the location with the same URL carrying `?v=<served build>` (old `v` dropped, other params and
   the hash preserved), forcing revalidated HTML. The one-shot guard is the URL flag `vr=1`, NOT storage
   (storage may be blocked; the URL survives where storage cannot): if `vr=1` is present and the stamps
   STILL differ, it never loops; the failsafe panel reports **"Mixed build detected"** with BOTH stamps.
   If version.json is unreachable, boot proceeds untouched: convergence is best-effort, never a wall.
4. **Module consistency, resolved at the correct level.** Per-module build stamps are impossible by
   construction here: BUILD is a content hash OF the modules, so stamping it into them would change their
   content and change BUILD (circular). They are also unnecessary: every module URL carries its per-file
   content hash, so a current document can never load stale module bytes. The only mixed state that can
   exist is an OLD DOCUMENT, which is exactly what the document-level check catches, heals (one reload),
   and reports (the mixed-build panel) when healing fails. Self-healing and self-reporting, never silent.
5. **Cleanup, gated.** The P41 heartbeat strip and boot marks REMAIN until the device matrix below is
   green on one stamp. The closing commit of P43 (after matrix green) removes the visible strip; the
   silent failsafe (error panel, resource capture, reveal guarantee, watchdogs) stays permanently.

## Evidence

- **`tools/version_integrity_test.js`** (Node, DOM-shimmed), all pass, fails-when-broken proven (removing
  the `vr` guard reds V5):
  - V1 version.json exists and matches the shell meta and the index redirect;
  - V2 index fetches version.json no-store, prefers the served build, falls back baked, and its meta
    refresh is delayed so the script wins;
  - V3 the shell's check is no-store with the URL-flag one-shot guard;
  - V4 a stale document force-converges exactly once: `?v=<served>` present, the STALE v dropped, params
    and hash kept, `vr=1` appended;
  - V5 a persistent mismatch never loops and panels "Mixed build detected" naming both stamps;
  - V6 matching stamps do nothing; V7 an unreachable version.json blocks nothing.
- **Full bed green:** `verify.js` 35/35, `arabic.py` 0, `failsafe_surface` 17/17, `bare_metal_auth` 0
  (still proves no worker is registered), `session_integrity` / `signin_resilience` / `deploy_marker` /
  `fresh_code` / `supabase_auth` all pass. No em dash; Western numerals; isolation grep 0.

## Acceptance: the device matrix (Thyab, photographs in the PR thread, all on ONE stamp)

| Device  | Browser | Cold load | Sign-in to board | Stamp matches |
|---------|---------|-----------|------------------|---------------|
| iPhone  | Safari  |           |                  |               |
| iPhone  | Chrome  |           |                  |               |
| iPad    | Safari  |           |                  |               |
| iPad    | Chrome  |           |                  |               |
| Desktop | any     |           |                  |               |

Plus the recurrence-proof: one deliberately stale start (open the site, deploy a stamp bump, reopen)
converges to the new stamp within one load on Safari. Basel and Mohammed receive access only after the
matrix is green; their first sign-ins are the final acceptance rows. P43 does not close with any cell
unphotographed or on a differing stamp; the strip-removal commit lands only after that.

## Do not (held)

Auth, keys, session logic, RLS, and the DB untouched. No user-facing ritual anywhere. The silent failsafe
protections are untouched. No service worker introduced. Author only, not merged, not released.
