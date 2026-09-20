# HOSTING_MIGRATION_PLAN — leave Netlify

**Status: STEP 1 only — a read-only trace + a hosting plan. No code, no migration, no DNS change
has been made. Nothing here ships until Thyab approves.**

Why this exists: Netlify credit exhaustion has paused deploys twice and cost real time. Every future
feature — and, worse, every *page publish* — burns more Netlify credits. The console must be a
permanent home for HTML template operations that never depends on Netlify, keeps
`console.thriveiii.com`, and keeps the relay's page-publish working.

The good news, established below from the code: **the parts that matter are already host-independent.**
The relay commits pages to the *repo*, not to any host. The page assets already live in Supabase
Storage. The integrity probe, `version.json`, and the build marker are all relative-path and
host-agnostic. Netlify is doing exactly one thing for us that plain GitHub Pages could not: serving
HTML with a no-stale cache header. One host removes the credit cap **and** keeps that.

---

## STEP 1 — the current serving chain, with evidence

### 1a. How the SHELL is served today

1. A developer runs `node tools/bundle.js` (the one manual build step, `docs/DEPLOY.md`). It writes
   `library/board.html`, `index.html`, `library/console.html`, `version.json` in place
   (`tools/bundle.js:2845`, `:3136`, `:3155`), then assembles a **clean `publish/` tree**
   (`tools/bundle.js:3162`–`3191`): a byte-copy of `index.html`, `gate.html`, `404.html`,
   `authtest.html`, `beacon.js`, `version.json`, `CNAME`, and the `library/`, `assets/`, `opp/`,
   `templates/` directories (`tools/bundle.js:3179`–`3181`), plus a `_headers` file
   (`tools/bundle.js:3188`–`3190`).
2. **Netlify** builds on every push to `main`: `netlify.toml:6`–`8` sets
   `command = "node tools/bundle.js"` and `publish = "publish"`. So Netlify runs our build, then
   serves the `publish/` tree.
3. `publish/` is **git-ignored** (`.gitignore:6`), so it exists only as a Netlify build artifact —
   it is never committed. Netlify regenerates it each build.
4. The domain `console.thriveiii.com` (`publish/CNAME`, `SITE_L5` at `tools/board-send.src.js:18`)
   currently resolves to Netlify. The root `index.html` is a JS redirect into
   `./library/board.html?v=<BUILD>` (LANE F; `tools/bundle.js:3136` and the root-index template
   around `:2900`–`:3130`); every internal reference is relative
   (`tools/bundle.js:3177`–`3178`), so the same tree serves identically from any origin.
5. `_headers` gives the no-stale-HTML guarantee: `/library/board.html` →
   `Cache-Control: public, no-cache, must-revalidate`; `/*` → `public, max-age=0, must-revalidate`
   (`publish/_headers`, generated at `tools/bundle.js:3188`). This is a **Netlify/Cloudflare-Pages
   feature; GitHub Pages ignores `_headers`** — and per `netlify.toml:1` and `tools/bundle.js:3166`
   this header is the stated reason the site moved onto Netlify ("kills the stale-HTML class GitHub
   Pages could not control").

> Note the repo still carries the **prior** GitHub-Pages setup: `docs/DEPLOY.md` documents
> "GitHub Pages, deploying from a branch" (no workflow file, `pages build and deployment`, 53 runs),
> and `.nojekyll` + `CNAME` are still in the repo root. So the site ran on GitHub Pages before
> Netlify; the Pages path is dormant, not deleted. `docs/DEPLOY.md` is now stale on the "how it is
> served" question and should be updated by whichever option we pick.

### 1b. How OPP PAGES are served today

1. A page is published through the relay: the board calls `pagePublishRelay(slug, html)`
   (`tools/board-upload.src.js:461`), which POSTs `{op:"page_publish", slug, html}` to the relay
   endpoint baked from `library/sync.json` (`published.ep` at `tools/bundle.js:138`, `:915`,
   `:1444`). The relay endpoint today is a **Google Apps Script**
   (`library/sync.json` → `script.google.com/macros/.../exec`).
2. The relay's `pagePublish_` (`relay/thrive-relay.gs:1060`) commits the file to the **repo** via the
   GitHub Contents API: path fixed to `opp/<slug>/index.html` (`relay/thrive-relay.gs:1071`), api
   `https://api.github.com/repos/<owner>/<repo>/contents/<path>` (`:1072`), owner/repo/branch default
   to `thriveiii` / `thrive-console` / `main` and are overridable via `GH_OWNER`/`GH_REPO`/`GH_BRANCH`
   Script Properties (`:1068`–`:1070`). It does a GET-sha-then-PUT, idempotent by path+sha
   (`:1075`–`:1091`). The owner-token path in the legacy shell does the same commit directly
   (`library/app.js:3452`–`3477`, `:3549`).
3. **The commit lands in the repo. Netlify sees the new commit and rebuilds**, `bundle.js` copies
   `opp/` into `publish/opp/` (`tools/bundle.js:3181`), and Netlify serves
   `console.thriveiii.com/opp/<slug>` from `opp/<slug>/index.html` (directory-index serving; the
   email link form is `https://console.thriveiii.com/opp/<slug>` with **no** trailing slash,
   `liveUrl()` at `tools/board-send.src.js:33`). `opp/` is committed on `main` (109 files tracked).
4. After committing, the board polls the live URL until it resolves: `verifyLivePoll` →
   `verifyLive` GET of `liveUrl(slug)` (`tools/board-upload.src.js:480`, `:498`). The comments there
   were written for the GitHub-Pages rebuild delay ("A FRESH Pages path (opp/<slug>/index.html) 404s
   while Pages rebuilds", `:471`–`:473`); the same delay exists on Netlify because a page publish is
   a **repo commit that triggers a full site build**.

**This is the credit sink.** Every page publish is a commit, every commit is a Netlify build, every
build spends Netlify credits and adds the rebuild-latency the verify poll is waiting out.

### 1c. What is already host-independent (this is why the move is low-risk)

| Concern | Where it lives | Host dependence |
|---|---|---|
| Relay `page_publish` | Google Apps Script → commits to the **repo** (`relay/thrive-relay.gs:1060`) | **None.** Commits to the repo, not to a host. |
| Opp-page images/fonts | Supabase Storage public `assets` bucket; `{{ASSET_BASE}}` = `URL_BASE + /storage/v1/object/public/assets` (`tools/board-send.src.js:76`–`84`); "if the host moves, ASSET_BASE follows automatically" (`:79`) | **None.** Already off-Netlify. |
| Open pixel / beacon | `publish/beacon.js` reads `/library/sync.json` and `sendBeacon`s to the relay (`publish/beacon.js:81`, `:96`) | **None.** Relative + relay. |
| Integrity probe | Root `index.html` "Test board file": fetches `./version.json` and `./library/board.html`, SHA-256 compares to `boardSha256` (`tools/bundle.js:2907`–`2969`) | **None.** Relative paths; works on any origin. |
| `version.json` | Written at `tools/bundle.js:3155`; read by the probe and by `failsafe.js` inside `console.html` (`tools/bundle.js:2874`) | **None.** Relative fetch. |
| Build marker | `<meta name="thrive-build">` in every shell (`tools/bundle.js:498`, `:838`, `:922`); read at `library/app.js:3296` | **None.** In the HTML. |
| Supabase reads/writes (board, mail, inbound, contacts) | `config.js` baked project URL + anon key | **None.** Direct to Supabase. |
| Domain in relay response | `pagePublish_` returns `url: https://console.thriveiii.com/opp/<slug>` (`relay/thrive-relay.gs:1091`) | Hardcoded to the domain — host-independent as long as we keep the domain. |

The **only** host-dependent behavior is the `_headers` no-stale-HTML guarantee (`publish/_headers`),
plus the plumbing itself (who runs `node tools/bundle.js` and who serves the tree).

---

## STEP 2 — three off-Netlify hosts, evaluated for this commercial use

The evaluation targets the four things that can differ by host: **(i)** does `pagePublish_` still
work unchanged, **(ii)** where the content lives, **(iii)** the exact DNS change for
`console.thriveiii.com`, **(iv)** what breaks (integrity probe / `version.json` / build marker /
`_headers`).

### (a) GitHub Pages — deploy from `main`

- **`pagePublish_`:** **unchanged.** It already commits `opp/<slug>/index.html` to the repo
  (`relay/thrive-relay.gs:1071`); "deploy from a branch" is exactly what the site ran on before
  (`docs/DEPLOY.md`). The commit *is* the deploy.
- **Content:** the **repo root** is served as-is (index.html, `library/`, `opp/`, `assets/`,
  `version.json`). Pages does **not** run our `publish/` assembly — it serves committed files, so
  `publish/` and its `_headers` are irrelevant to Pages. `.nojekyll` (already present) keeps
  `library/` and future `_`-dirs intact.
- **DNS:** `console.thriveiii.com` is a subdomain, so a **CNAME → `thriveiii.github.io`** (Pages
  reads the custom domain from the committed `CNAME`). Repo Settings → Pages → Source =
  "Deploy from a branch", branch `main`, folder `/`.
- **What breaks:**
  - **`_headers` (the no-stale-HTML guarantee) is LOST** — GitHub Pages ignores it. This is the
    exact regression that drove the move to Netlify (`netlify.toml:1`, `tools/bundle.js:3166`).
    Pages sets its own ~10-minute cache; the shell can serve stale until the CDN revalidates. The
    `version.json` probe + `?v=BUILD` asset pins + `failsafe.js` still catch a stale shell, but the
    header-level guarantee is gone.
  - **Commercial-use terms:** GitHub Pages is "not intended for … commercial" heavy use and forbids
    running a business primarily *as* a Pages site; an operational commercial console is a grey area
    and a soft **build ceiling of ~10 builds/hour** applies. Every page publish is a build, so a busy
    publishing hour could hit that cap.
  - **Build-per-commit stays** (Pages rebuilds on every commit) — but Pages builds are free and
    unmetered by dollars, so there is **no credit exhaustion and no dollar cap pause**.
  - Integrity probe, `version.json`, build marker: **all fine** (host-independent, above).

### (b) Cloudflare Pages — connect the same GitHub repo *(recommended, see STEP 3)*

- **`pagePublish_`:** **unchanged.** Cloudflare Pages watches the repo; a relay commit of
  `opp/<slug>/index.html` triggers a CF build → serve. No change to `relay/thrive-relay.gs`.
- **Content:** CF Pages runs our **existing build**: build command `node tools/bundle.js`, output
  directory `publish/` — the **same two lines** we give Netlify (`netlify.toml:6`–`8`). It serves
  the assembled `publish/` tree, directory-index and all, exactly as Netlify does now.
- **DNS:** subdomain **CNAME → `<project>.pages.dev`** (set the custom domain in the CF Pages
  project; Cloudflare provisions the TLS cert). If the domain's DNS is not already on Cloudflare, the
  cleanest path is to move `thriveiii.com`'s nameservers to Cloudflare (free) or add a CNAME at the
  current DNS provider to `<project>.pages.dev`.
- **What breaks:** **nothing.**
  - **`_headers` is SUPPORTED** by Cloudflare Pages with the same syntax — the no-stale-HTML
    guarantee is **preserved** (`publish/_headers` works as-is).
  - Global CDN, free tier fits (unlimited requests/bandwidth, unlimited sites). **No dollar credit
    model, so it never "pauses on a cap"** the way Netlify did.
  - Integrity probe, `version.json`, build marker: all fine.
  - **One honest caveat:** CF Pages free tier meters **builds at 500/month** (build-per-commit, same
    as today). For this console's page-publish volume 500/month is very likely ample, and it is a
    *free-tier build count*, not a paid credit that pauses deploys — but if publishing ever became
    high-frequency, option (c) is the escalation that removes builds-for-pages entirely.

### (c) Pages to object storage (Supabase Storage or Cloudflare R2) + shell on Cloudflare Pages

- **`pagePublish_`:** **needs a clean small change.** Instead of (or in addition to) the GitHub
  Contents PUT (`relay/thrive-relay.gs:1071`–`1091`), `pagePublish_` PUTs
  `opp/<slug>/index.html` straight to the storage bucket (Supabase Storage upload, or R2 S3-style
  PUT). This is a localized change to one function in `relay/thrive-relay.gs`; the browser side
  (`pagePublishRelay`, `verifyLivePoll`) is unchanged because it only knows the relay op and the live
  URL.
- **Content:** the **shell** (board.html + library/ + assets/ + version.json) on Cloudflare Pages
  (repo-connected, as in (b)); the **opp pages** as objects in the bucket. **No build runs when a
  page is published** — the PUT is instant. Builds happen only when the *shell* changes (rare,
  developer-driven).
- **DNS:** shell CNAME → `<project>.pages.dev` (as in (b)). The opp pages need to be reachable at
  `console.thriveiii.com/opp/<slug>`; the clean way is a **Cloudflare Worker / Pages Function** that
  maps `/opp/<slug>` → the bucket object, so the domain and the `liveUrl()` form
  (`tools/board-send.src.js:33`) stay identical.
- **What breaks / costs:**
  - **Directory-index serving is lost at the storage layer.** `/opp/<slug>` (no trailing slash,
    `liveUrl()`) does **not** auto-resolve to `.../index.html` in Supabase Storage, and only with an
    index rule in R2 — so a small routing shim (the Worker above, or storing at a flat key like
    `opp/<slug>.html` and mapping) is required. This is the main added moving part, and it touches the
    exact no-trailing-slash form the code already had trouble with on Pages
    (`tools/board-send.src.js:304`–`308`).
  - `_headers`: still applies to the **shell** on CF Pages; the **pages'** cache headers now come from
    the storage/Worker layer and must be set there to match the no-stale intent.
  - Integrity probe / `version.json` / build marker: all still fine (they concern the shell).
  - Content is now **split across two origins** (shell on Pages, pages in storage behind a Worker) —
    more surface, more to reason about, more to verify.
  - **Upside:** page publishes cost **zero builds** and are instant — the most build-frugal option,
    and the natural escalation if build counts ever matter.

### Side-by-side

| | (a) GitHub Pages | (b) Cloudflare Pages | (c) Storage + CF Pages shell |
|---|---|---|---|
| `pagePublish_` change | none | none | small change (one relay fn) |
| Build per page publish | yes (free, ~10/hr cap) | yes (free, 500/mo) | **no** (instant PUT) |
| Dollar credit cap / pause | **never** | **never** | **never** |
| `_headers` no-stale guarantee | **lost** | **kept** | kept for shell; set at storage for pages |
| Directory-index `/opp/<slug>` | works | works | needs a routing shim |
| Content origins | 1 (repo) | 1 (`publish/`) | 2 (Pages + storage) |
| Commercial-use fit | grey area | clean | clean |
| Keeps `console.thriveiii.com` | yes (CNAME) | yes (CNAME) | yes (CNAME + Worker) |
| Net new moving parts | fewest | few | most |
| Closest to today's setup | no (`_headers` lost) | **yes (same build+publish+`_headers`)** | no |

---

## STEP 3 — recommendation

**Recommend (b) Cloudflare Pages, repo-connected, as the lowest-risk path.** It is a near drop-in for
the current Netlify setup — the *same* `node tools/bundle.js` build, the *same* `publish/` output, the
*same* `_headers` — so it keeps every guarantee we have today, keeps `pagePublish_` **completely
unchanged**, keeps `console.thriveiii.com`, and removes the dollar credit cap that pauses deploys.
It is the only option that both **keeps the no-stale-HTML `_headers` guarantee** and **never pauses on
a paid cap**. The one caveat — a 500 builds/month free ceiling — is a soft, free-tier build count far
from Netlify's failure mode, and option (c) is the clean escalation if page-publish volume ever
approaches it.

(Option (a) is the zero-cost fallback if Cloudflare is ever unavailable, accepting the `_headers`
loss. Option (c) is the future-proof end-state if builds ever become the bottleneck; it is a bigger
change and splits the content, so it is not the first move.)

### Migration steps (to run only after approval)

1. **Prep, no cutover:** create a Cloudflare account; create a Pages project connected to
   `thriveiii/thrive-console`, branch `main`, build command `node tools/bundle.js`, output dir
   `publish/`. Let it build and serve on the temporary `<project>.pages.dev` URL.
2. **Verify on `pages.dev`** (before any DNS change): shell loads, board works, an existing
   `/opp/<slug>` resolves, the integrity probe passes, `_headers` is applied (check response headers).
3. **Cutover DNS:** point `console.thriveiii.com` (CNAME) at `<project>.pages.dev` and add the custom
   domain in the CF Pages project; wait for the CF-managed TLS cert to issue.
4. **Confirm live**, then **disable the Netlify site** (stop its builds) so no further credits are
   spent and there is no double-build on commits.
5. **Update `docs/DEPLOY.md`** to describe the Cloudflare Pages mechanism (it currently documents the
   dormant GitHub-Pages setup). `netlify.toml` can stay in the repo harmlessly (CF ignores it) or be
   removed in the same doc PR; keeping it one build cycle eases rollback.

### Rollback

- **Instant:** revert the `console.thriveiii.com` CNAME to Netlify and re-enable the Netlify site —
  the `publish/` build is identical, so Netlify serves the same bytes. Nothing in the repo or the
  relay changed, so there is nothing to un-migrate. (Option (b) is chosen precisely because rollback
  is a DNS record, not a code revert.)

### What must be verified live (browser, from a real device — the sandbox proxy 403s `console.thriveiii.com`, `docs/DEPLOY.md`)

1. `https://console.thriveiii.com/` redirects into the board; the board signs in and renders.
2. `https://console.thriveiii.com/opp/<an existing slug>` resolves (directory-index works).
3. **Publish a test page through the relay** and confirm the commit → CF build → the new
   `/opp/<slug>` resolves, and `verifyLivePoll` settles to live (no change expected, but this is the
   credit-sink path and must be proven on the new host).
4. Response headers on `/library/board.html` show `no-cache, must-revalidate` and on `/*` show
   `max-age=0, must-revalidate` (`_headers` honored).
5. The root "Test board file" integrity probe passes (bytes + SHA-256 match `version.json`).
6. Send-path smoke: an opp page's live URL passes `upSendLiveGate`, an email send records a
   `console_mail` row, the open pixel/beacon reaches the relay.
7. Confirm the Netlify site is disabled and no longer building on commits.

### Open questions for Thyab (before STEP 2)

- Is `thriveiii.com`'s DNS somewhere we can add/repoint a CNAME (or move nameservers to Cloudflare)?
- Rough page-publish volume per month — to confirm the CF 500-builds/month free ceiling is comfortable
  (and whether we should plan option (c) as a follow-on regardless).
- Confirm keeping the Google Apps Script relay as-is (option (b) needs no relay change at all).
