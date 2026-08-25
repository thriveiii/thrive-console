# Console entry outage: a week of investigation, every stage, every finding

**Status: OPEN. The operators still cannot reach the board.**
**Scope: reaching the console interface at `console.thriveiii.com`. No data was lost at any point.**
**Audience: external review. This is written to be read by someone who has not seen the code.**

---

## 1. What the operators experience

They open `console.thriveiii.com` and cannot get to the working interface. Over the week the symptom
changed shape several times, which is the central difficulty: each shape looked like a different bug, and
several were.

| Shape of the failure | When | Reached |
|---|---|---|
| Black screen after the gate | early | gate passed, board black |
| "Signing in" hangs forever | mid | operator sign-in POST never returns |
| Stuck forever on the root splash, tab reads "Loading" | mid | the console document never opens |
| Console renders as raw unstyled HTML (purple underlined link) | late | CSS never applied |
| Board area black below a working header | late | gate passed, board never paints |
| Stuck on the root splash with escape buttons that do nothing | **now** | **the console document never opens** |

Affected: the owner's iPad and iPhone, and the whole team. Both WiFi and cellular (LTE, full signal).
Reproduced in private tabs with cleared website data, so it is not one stale cache.

**Not affected:** `gate.html` (the standalone sign-in page) and `index.html` (the root splash) load reliably.
Only `library/console.html` fails to open.

---

## 2. The system, in one paragraph

A static site on GitHub Pages. `index.html` at the root is a small router: it reads the stored session and
forwards to `library/console.html`, or to `gate.html` to sign in. `console.html` is the console shell: it
loads fifteen scripts, of which `app.js` paints the board. There is no server of our own; data comes from
Supabase (auth and rows) and a Google Apps Script relay (mail).

---

## 3. Payload census (measured, gzip is what the device downloads)

This was measured late and it corrected a wrong assumption held for days.

| asset | raw bytes | gzip bytes | role |
|---|---|---|---|
| app.js | 890,601 | 286,038 | paints the board |
| fonts.css | 327,517 | **247,678** | decorative webfonts (base64, barely compresses) |
| i18n.js | 216,497 | 63,186 | translations |
| styles.css | 201,415 | 51,698 | all interface styling |
| console.html | 94,733 | 27,290 | the shell |

**Total first load: ~676 KB gzipped, not the 1.7 MB raw figure quoted earlier in the week.** On the LTE in
the device captures (full signal) that is seconds. **This retires the "weak connection" explanation, which
had been offered to the operators and was wrong.**

---

## 4. Investigation stages, in order

Each stage states the evidence, the hypothesis, what was changed, and the outcome. Stages that were wrong
are marked, because the wrong turns are part of the record.

### Stage 1 (P55) - Black screen after the gate
- **Evidence:** device diag strip read `boot board painted`, screen black.
- **Hypothesis:** the boot awaited network before painting anything.
- **Change:** paint the board synchronously from local cache first; time-box every boot network call (6s).
- **Outcome:** cured that specific black screen. Confirmed on device.

### Stage 2 (P56) - The operator sign-in hangs at `token:sent`
- **Evidence:** diag strip `sign token:sent`, spinner forever, dozens of attempts.
- **Finding:** the identical auth request completes in ~250 ms on the standalone `gate.html` and hangs
  inside the loaded console. The difference is the page context, not the request.
- **Change:** route the operator sign-in to the standalone `gate.html`.
- **Outcome:** sign-in worked. The operator could authenticate.

### Stage 3 (PR #221) - Stranded on the root splash. **Diagnosis partly wrong.**
- **Evidence:** signed in, stuck forever on the root splash.
- **Hypothesis:** two render-blocking stylesheets (~300 KB gzipped) delayed the console's first paint, so
  the browser kept showing the previous page.
- **Change:** load both stylesheets asynchronously (`media="print"` swapped to `all` on load).
- **Outcome:** did not fix it. **And it introduced a serious new defect (Stage 7).**

### Stage 4 (PR #222) - Why fixes were not reaching the device
- **Evidence:** #221 deployed, device unchanged.
- **Finding:** the cache-busting build id was computed from the app modules only, **not** from the page
  shell. A shell-only fix left the id unchanged, so the versioned URL never changed and devices kept
  serving the cached old shell. Confirmed at git level: identical build id across two deploys.
- **Change:** fold the shell generator into the build id.
- **Outcome:** real fix. Shell fixes now reach devices. **This means several earlier "fixes" had never
  actually been tested on a device.**

### Stage 5 (PR #223) - The racing double navigation
- **Evidence:** stuck on the splash even in a private tab with cleared data; tab reads "Loading".
- **Finding:** the root page fired **two** simultaneous navigations to the console (a `0s` meta refresh and
  a JavaScript redirect). Two concurrent top-level navigations is a state WebKit can hang on.
- **Change:** remove the meta refresh (one navigation), add static tappable escape links, add a `?stay=1`
  manual launcher.
- **Outcome:** **the operator got in.** The first confirmed entry of the week.

### Stage 6 (PR #225) - A watchdog that became the worst regression. **Self-inflicted.**
- **Evidence:** after entry, the board area was black below a working header.
- **Finding:** the boot watchdog keyed on a flag the gate sets on resolve, so it never fired after the gate
  and the black board was silent.
- **Change:** re-key the watchdog to the board's own paint; two phases (5s overlay, 18s Retry panel).
- **Outcome:** **catastrophic.** At 5s a full-screen overlay covered the working interface (the "fake
  interface" the operators reported). At 18s a full-screen panel replaced the screen whose only exit was a
  page reload, which **cancelled the in-flight app.js download and restarted the whole load from zero**.
  Any connection needing more than 18 seconds could never finish: an infinite reload loop that locked
  everyone out.

### Stage 7 (PR #226) - Reverting the lockout
- **Change:** deleted both overlays, the 18s deadline, and the forced reload. Replaced with one small
  non-blocking bottom banner that offers a Retry the operator may choose, covers nothing, and clears itself
  when the board paints.
- **Law established:** *the first load is never covered, never interrupted, and never reloaded by the page's
  own hand.* Guarded by a test that fails if any full-screen overlay or fail deadline is reintroduced.

### Stage 8 (PR #227) - The unstyled console, and a measurement that inverted an earlier decision
- **Evidence:** a device capture showed the brand as a **purple underlined link** and the language control
  as a bare pill: raw unstyled HTML.
- **Finding:** the Stage 3 async swap only applies the stylesheet if its `onload` fires. When it does not
  fire on WebKit, the sheet stays a *print* stylesheet **permanently**. No timeout, no recovery.
- **Measurement:** `styles.css` is only ~52 KB gzipped (making it async bought almost nothing);
  `fonts.css` is ~248 KB gzipped and purely decorative (the only heavy sheet).
- **Change:** `styles.css` blocking again; `fonts.css` moved out of the boot entirely (loaded after window
  load). Critical CSS path: 300 KB to 52 KB gzipped, an 83% cut.
- **Outcome:** the unstyled failure mode is eliminated. The console still did not open.

### Stage 9 (current, PR pending) - The fact that now isolates the problem
- **Evidence:** the latest capture shows the operator on **`index.html`**, not the console: the root splash
  plus the three escape buttons. The buttons do nothing useful. Tapping "Open the console" does not open it.
- **What this proves:** the root router runs correctly and its navigation to the console is issued. The
  console document **never commits**, by redirect or by direct tap.

  > **`gate.html` loads. `index.html` loads. `library/console.html` does not load, by any route, on the
  > affected devices.** That is the entire remaining problem, stated exactly.

- **Changes made:** the app CSS is now **inlined** into the shell, so there is **zero** render-blocking CSS
  fetch (one request instead of two, identical bytes, and nothing about CSS can hang or fail to apply);
  and a **"Test console file"** probe was added to the root page, which fetches the exact console URL and
  reports HTTP status, bytes, elapsed time, or the thrown error **on screen**, so "nothing happens" becomes
  a readable fact.

---

## 5. What is proven, and what is not

**Proven:**
- Payload is ~676 KB gzipped; bandwidth is not the wall on the observed LTE.
- The build id previously excluded the shell, so shell fixes silently never reached devices (Stage 4).
- The root page previously fired two racing navigations (Stage 5).
- PR #225's watchdog reloaded the page every 18 seconds, making a slow first load impossible (Stage 6).
- The async stylesheet swap can leave the console permanently unstyled (Stage 8).
- `boardLanes` **does** exist in the shipped shell, so the board container is not missing.
- The board render paints one of three states (auth prompt / empty / lanes) synchronously and then marks
  the boot painted; it returns early and silently only if its container is absent, which is not the case.

**Not proven:**
- **Why `console.html` does not commit on the affected devices.** This is the open question. It has not been
  reproduced in the test environment: the harness cannot run the 890 KB `app.js` (a limitation of the
  sandbox, not evidence about the device).
- Whether the cause is WebKit memory pressure (many tabs open in every capture), a device-level network
  policy, or something in the response itself.

---

## 6. Honest account of process failures

Recorded deliberately, because they cost days:

1. **A wrong cause was asserted with confidence** ("weak connection") and the operators were sent to test
   against it repeatedly. The size census that disproved it should have been step one, not step twenty.
2. **Fixes were shipped that could not reach the device** (Stage 4). For several rounds, "deployed" was not
   the same as "running", and that was not checked.
3. **A fix (PR #225) made the outage strictly worse** and locked out the whole team. It was reasoned about
   but its interaction with a slow load was never tested, and it shipped with a forced reload in it.
4. **A commit was pushed to a branch after its PR had already merged**, stranding it. It had to be re-landed.
5. Each round changed one hypothesis at a time against a device the engineer could not observe, with a
   turnaround of one screenshot per attempt. That loop is too slow for a problem with this many layers.

---

## 7. The single question that would end this

**Does `https://console.thriveiii.com/library/console.html` return a complete response on an affected
device?**

The probe shipped in Stage 9 answers it on the device with no inspector. On the root page, tap
**"Test console file"**. It reports one of:

- `status: 200 ... bytes: ~296000 ... VERDICT: the console file DOES download here.`
  Then the file arrives and the failure is in parsing or executing it: the next suspects are memory
  pressure and the fifteen script requests, and the response is to cut the shell down.
- `RESULT: no response after 30s` or `FAILED: <error>`
  Then the file never arrives, and the cause is at the network or device layer, not in the page code.

Everything after this point should be decided by that readout, not by another hypothesis.

---

## 8. Change log

| PR | Title | Verdict |
|---|---|---|
| #217 | BARE_GATE: standalone proven auth page | held |
| #218 | BOOT_PAINT_FIRST: never hold a black screen | held |
| #220 | GATE_BREACH: route sign-in to the standalone gate | held |
| #221 | Async stylesheets for first paint | **wrong; caused the unstyled console** |
| #222 | Fingerprint the shell so shell fixes bust the cache | **key fix** |
| #223 | Single navigation + static escapes + `?stay=1` | **key fix; first entry of the week** |
| #224 | Restore gate.html to the approved design | held (cosmetic) |
| #225 | Board watchdog, two-phase overlays | **regression; locked everyone out** |
| #226 | Revert the lockout; non-blocking banner only | **key fix** |
| #227 | styles.css blocking, fonts.css out of the boot | held; 83% critical CSS cut |
| pending | Inline the CSS; on-device console-file probe | awaiting device readout |

---

*Prepared for external review during an active outage. Every claim above is either supported by a device
capture, a git-level check, or an automated test in `tools/`; claims that are not are listed as unproven in
section 5.*
