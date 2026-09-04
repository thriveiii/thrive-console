# OPEN_TRACE.md

READ-ONLY trace of open/hit truth (`console_hits`). No build, no edits, no SQL, no send. Every claim is cited
to a `file:line` on origin/main (`62137df`), or marked **ABSENT** where the fact lives only in the deployed
relay/pixel endpoint (Code.gs). Nothing is applied.

---

## 1. RECORDING

An open is recorded through TWO different paths that both land in `console_hits`, plus a third event type
that is stored but not counted.

### The email tracking pixel (a delivery/open fetch by the mail client or its proxy)

- Built by `openPixelHtml(slug, token, ep)` (`tools/board-send.src.js:45-49`):
  `<img src="EP?op=hit&type=open&slug=<slug>&r=<token>" ...>`. The `token` is `recipientOpenToken` =
  `sendIdem(opp,to,subject,"")` (`tools/board-send.src.js:44`), which is the `console_mail.id` of that one
  recipient's send. The URL carries **`op=hit`, `type=open`, `slug`, `r` only** - no `self`, no `vid`, no
  `cycle`.
- The relay answers the GET and records the hit (`relay/thrive-relay.gs:1097-1104`):
  ```
  hitPut_({ type: e.parameter.type || 'open', slug: e.parameter.slug || '',
            ts: new Date().toISOString(), vid: e.parameter.vid || '', r: e.parameter.r || '',
            ms: ... });
  ```
  So a pixel hit is `{ type:'open', slug, ts:<relay clock at fetch>, vid:'', r:<token> }`. **No `self`, no
  `cycle`, no user-agent, no IP** are captured (the GET reads only `e.parameter`; an Apps Script `doGet` has
  no access to request headers). The response is an empty 1x1 text body (`:1106-1108`).

### The hosted-page beacon (a real browser opening `/opp/<slug>`)

- `beacon.js` fires on the published page (it bails if framed, `beacon.js:24`) and POSTs
  `op=hit` with:
  ```
  var openEv = { type:"open", slug, ts:<client clock>, vid:VID, self:SELF, r:R, cycle:CYCLE||null,
                 ref:document.referrer, lang:navigator.language, w:screen.width, h:screen.height,
                 ua:(navigator.userAgent).slice(0,180) };   // beacon.js:108-114
  ```
  and, only if `COLLECT_IP`, also `ip`/`city`/`country` from an ipapi call (`beacon.js:116-118`). The relay
  routes `op=hit` on POST to the same `hitPut_(ev)` (`relay/thrive-relay.gs:1146-1149`). So a page hit is a
  richer record: `vid`, a computed `self`, `cycle` from the page meta, and `ua` (and optional `ip`) inside
  its data.

### The `console_hits` row and its dedup key

`hitPut_` appends to the relay store (capped 4000, `relay/thrive-relay.gs:234-242`), and `supaMirrorLedger_`
upserts to `console_hits` via `supaHitRow_`:
```
return { id: hitKey_(e), slug, type, ts, self: !!(e && e.self), cycle: (e && e.cycle) || null, data: e };
```
`relay/thrive-relay.gs:552-555`. The table columns are **`id, slug, type, ts, self, cycle, data`** - there is
**no `ua` or `ip` column**; whatever a page beacon sent rides inside `data`, and a pixel sent none. The
primary key is `hitKey_(e) = type|slug|ts|vid` (`relay/thrive-relay.gs:546`, mirrored client-side at
`library/app.js:543`).

### What distinguishes the three

| | `type` | `r` (recipient token) | `vid` | `self` | `cycle` | `ua`/`ip` |
|---|---|---|---|---|---|---|
| **Email-pixel open** | `open` | yes | `''` (empty) | always false (never set) | always null | none |
| **Hosted-page open** | `open` | maybe (URL `?r=`, `beacon.js:35`) | set (persistent) | computed | from page meta | `ua` yes, `ip` optional |
| **Dwell** | `dwell` | no | set | computed | yes | in data |

There is **no distinct "click" record** (section 4). A pixel open and a page open share `type='open'`; they
are told apart only by `r` + empty `vid` (pixel) versus a real `vid` and `ua` (page).

## 2. SELF

`h.self` is the sole thing the view uses to drop the operator's own views (`coalesce(h.self,false)=false`,
`docs/supabase-live-verified.sql:110`). It is set on ONE path and never the other:

- **Hosted-page beacon: computed, and fairly reliable when it applies.** `SELF = isSelf()`
  (`beacon.js:59`), where `isSelf()` returns true if `localStorage.getItem("console_sb_session")` exists on
  the opp origin (`beacon.js:56`) - the durable signed-in session, shared across tabs, so it catches an owner
  who opens `/opp/<slug>` directly in another tab while signed in (the comment at `beacon.js:49-54` notes the
  old sessionStorage-only check missed exactly that). **But** an owner who opens the page from a browser or
  device that is NOT signed in on that origin (a phone, a private window, a different browser) has no
  `console_sb_session` there, so `self=false` and the view counts it as a real open.
- **Email-pixel open: `self` is never set, so it is always false.** The pixel URL carries no `self`
  (`tools/board-send.src.js:47`), the relay GET does not add one (`relay/thrive-relay.gs:1102`), and
  `supaHitRow_` defaults `self:!!(e&&e.self)` to false (`relay/thrive-relay.gs:554`). So any fetch of the
  pixel - the recipient's client, a proxy, OR the operator viewing the sent copy in his own mail - is counted
  as a non-self open. **An operator open of a sent email can and does slip through untagged and inflates the
  count**; there is no mechanism on the pixel path to tag it self.

So: self-filtering works for a signed-in, same-origin page preview, and does not exist at all for the email
pixel.

## 3. PROXY PREFETCH

**There is no reliable signal today to separate a delivery-time proxy fetch from a human open, on the path
where it matters (the pixel).**

- **User agent: ABSENT on the pixel.** The proxy signature people key on (UA contains `GoogleImageProxy`,
  Apple MPP's fetcher) is a request HEADER. The pixel is served by an Apps Script `doGet`, which exposes no
  request headers - the handler reads only `e.parameter` (`relay/thrive-relay.gs:1102`), and stores no `ua`
  (section 1). So a `GoogleImageProxy` / MPP fetch of the pixel is indistinguishable from a human open by UA.
  (The hosted-page beacon DOES capture `ua`, `beacon.js:114`, but a page open is a real browser, not the
  proxy case.)
- **Timing (open ts within seconds of send): the raw material half-exists, but nothing uses it.** The pixel
  hit's `ts` is the relay's clock at fetch (`relay/thrive-relay.gs:1103`), and the send's time is
  `console_mail.ts`; the pixel carries `r` = `console_mail.id`, so a join `console_hits.data.r ->
  console_mail.id -> console_mail.ts` COULD compute a send-to-open delta. **No code does this**, and the view
  never looks at it (`docs/supabase-live-verified.sql:101-116` reads only `type/self/cycle/ts>=first_ts`). A
  proxy or Apple MPP that opens every pixel shortly after delivery therefore counts as a real open, with no
  delta check and no UA to catch it.
- **IP: ABSENT on the pixel** (only the page beacon optionally sends `ip`, `beacon.js:116-118`), so an
  IP-range heuristic is not available for pixel opens either.

## 4. DISTINCTNESS

- **The board's server count is RAW, not distinct.** The view's `opens` CTE is
  `count(*) as open_count` (`docs/supabase-live-verified.sql:104`), filtered to
  `type in ('','open')` (`:109`), `self=false` (`:110`), the current cycle (`:115`), and
  `ts >= first_send` (`:112`). It does NOT de-duplicate by `vid`, `ua`, or `ip`. So every proxy re-fetch of
  the pixel, and every page reload by the same visitor, adds one to `open_count`. (The PK `type|slug|ts|vid`,
  `relay/thrive-relay.gs:546`, only collapses two events that share the exact same second and vid; pixel
  opens all have `vid=''`, so two proxy fetches a second apart are two rows.)
- **The client Insights number is distinct-by-vid, but excludes the pixel.** `campaignStats` computes
  `uniq[e.vid]` over hits and only counts a hit that HAS a `vid`:
  `allHits().forEach(... if(... (!e.type||e.type==="open") && e.vid) uniq[e.vid]=1)`
  (`library/app.js:1153`; documented as "distinct visitor ids that opened the page",
  `library/app.js:1224`). Email-pixel opens have `vid=''`, so they are dropped from this "unique" figure
  entirely. The board `open_count` (raw, pixel + page) and the Insights `unique` (distinct vid, page only)
  are therefore two different numbers derived two different ways.
- **Clicks are not recorded separately from opens - clicks are not recorded at all.** There is no `type:'click'`
  event anywhere (`beacon.js` sends only `open` and `dwell`; the relay records whatever `type` arrives; a
  repo grep finds only DOM `addEventListener("click", ...)` handlers, no click beacon). `dwell` rows exist
  but the view excludes them (`type in ('','open')`, `:109`). So there is no click metric to compare against
  opens.

---

## ABSENT list

1. **`self` on email-pixel opens** - never set; every pixel fetch (recipient, proxy, or the operator's own
   view of a sent email) is counted as a non-self open (`tools/board-send.src.js:47`,
   `relay/thrive-relay.gs:1102,554`).
2. **User agent / IP on email-pixel opens** - the Apps Script `doGet` pixel captures no request headers, so
   no `GoogleImageProxy` / Apple MPP detection is possible on the pixel (`relay/thrive-relay.gs:1102`).
3. **A send-to-open time delta** - nothing compares `console_hits.ts` to `console_mail.ts`, though the join
   key (`r`) exists (`relay/thrive-relay.gs:1101`).
4. **Distinct-open counting on the server** - the view uses raw `count(*)`, so re-fetches and reloads inflate
   `open_count` (`docs/supabase-live-verified.sql:104`).
5. **A click event** - clicks are recorded nowhere; only `open` and `dwell` exist, and `dwell` is not counted
   (`beacon.js:108-130`, `docs/supabase-live-verified.sql:109`).
6. **`cycle` on email-pixel opens** - the pixel URL carries none, so every pixel open is null-cycle
   (`tools/board-send.src.js:47`); on a cycled opp those opens still count only via the null-null relax, and
   are indistinguishable per transit.

## The smallest set of facts still needed before a trustworthy open metric

1. **Live capture of the deployed pixel endpoint (Code.gs).** Confirm the deployed `doGet` for `op=hit`
   really has no request headers to read (the repo relay does not; a deployment cannot add them). This
   decides whether UA-based proxy filtering is even possible without moving the pixel OFF Apps Script to a
   host that exposes headers. One capture: fetch the pixel URL and inspect what the endpoint can see.
2. **A production sample of `console_hits`** (one read, no write): the split of rows by pixel (`vid=''`,
   `r` set) versus page (`vid` set), by `self` true/false, and the distribution of pixel `ts` minus the
   matching `console_mail.ts`. That single query shows how much of today's `open_count` is pixel-vs-page,
   how much is plausibly proxy/MPP (opens clustered within seconds of send), and how much the raw-vs-distinct
   gap matters in practice.
3. **A decision input, not in the code:** whether an "open" should mean "a distinct human viewed the message"
   (needs de-dup + proxy exclusion, i.e. items 1-2 resolved) or "the message was fetched at all" (today's raw
   count). The metric cannot be made trustworthy until that target is stated, because the two answers want
   opposite treatments of the pixel.
