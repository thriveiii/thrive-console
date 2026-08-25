"""CONSOLE_ENTRY_DIAG contract (browser, fails-when-broken).

For a week the console entry has failed on the operators' iPad and iPhone with a symptom that carries no
information: a black screen. A black screen is produced identically by a request that never returns, a body
that arrives cut in half, a stale cached copy, and a document that arrives whole but cannot be painted. This
brief does not fix any of those. It makes them TELL THEM APART on the device, in one session.

So the test does not ask "is the console working". It asks the only question that matters for a diagnostic:
CAN THIS INSTRUMENT DISTINGUISH THE CASES? A probe that prints "intact" no matter what is worse than no
probe, because it launders a guess into evidence. Therefore every check here is run twice: once against a
healthy file, once against a deliberately damaged one, and the probe must disagree with itself.

  P1  healthy file      -> headers/first byte/termination all yes, byte count and SHA-256 match version.json
  P2  truncated body    -> the same probe must REFUSE to say intact and must name the size disagreement
  P3  paint-safe mode   -> the two first-viewport paint-heavy constructs are actually neutralized
  P4  read-only         -> the probe never navigates and never reloads (Stage 6/7 law is permanent)
"""
import json, os, threading, http.server, socketserver, functools, hashlib, re
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

idx = open(os.path.join(ROOT, "index.html")).read()
shell = open(os.path.join(ROOT, "library/console.html")).read()
ver = json.load(open(os.path.join(ROOT, "version.json")))
raw = open(os.path.join(ROOT, "library/console.html"), "rb").read()

# ---- source guards ---------------------------------------------------------------------------------
ck("Part 2: version.json publishes the exact byte count and SHA-256 of the shipped shell",
   ver.get("consoleBytes") == len(raw) and ver.get("consoleSha256") == hashlib.sha256(raw).hexdigest(),
   {"json": ver.get("consoleBytes"), "disk": len(raw)})

ck("Part 4: the two static entry links and the probe control are painted in the markup (no JS to reach them)",
   'id="idxNormal"' in idx and 'id="idxSafe"' in idx and 'paint=safe' in idx and 'id="idxProbe"' in idx)

probe_block = ""
for b in re.findall(r"<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)</script>", idx):
    if 'getElementById("idxProbe")' in b: probe_block = b
ck("the probe is one self-contained block wired to a click", bool(probe_block) and 'addEventListener("click", run)' in probe_block)
# The law is about CODE, not prose: the block's own comment names the forbidden constructs in order to
# forswear them, so strip comments before judging (a comment may name it; nothing may call it).
probe_code = re.sub(r"/\*[\s\S]*?\*/", "", probe_block)
ck("Part 1 law: the probe NEVER navigates, reloads, or aborts (it reads and prints, nothing else)",
   bool(probe_code)
   and "location.replace" not in probe_code and "location.href" not in probe_code
   and "location.reload" not in probe_code and "AbortController" not in probe_code,
   probe_code[:200])
ck("the 30s mark prints a line instead of acting",
   "no response after 30s" in idx and "لا استجابة بعد 30 ثانية" in idx)

ck("Part 3: the paint-safe class is set by the FIRST script in the head, before any stylesheet decides anything",
   shell.index('paint-safe")') < shell.index('id="gate-critical"') < shell.index('href="./styles.css'))
ck("Part 3: the svg suppression is a SEPARATE rule that stays inactive unless svg=off is also passed",
   "html.paint-safe.no-svg svg{display:none!important}" in shell
   and 'q.get("svg")==="off"' in shell)

# ---- browser ---------------------------------------------------------------------------------------
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

def read_probe(pg):
    pg.click("#idxProbe")
    for _ in range(60):
        t = pg.evaluate("()=>{var o=document.getElementById('idxProbeOut'); return o?o.textContent:'';}")
        if "VERDICT" in t: return t
        pg.wait_for_timeout(250)
    return t

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # ---- P1: healthy file. The probe must resolve every stage and agree with version.json. ----
    ctx = b.new_context()
    pg = ctx.new_page()
    pg.goto(f"{base}/index.html?stay=1", wait_until="domcontentloaded")
    pg.evaluate("()=>{ window.__probeAlive='yes'; }")   # dies if the probe ever navigates or reloads
    t1 = read_probe(pg)
    ck("P1 the probe resolves all three transfer stages on a healthy file",
       "headers arrived" in t1 and re.search(r"headers arrived\s+yes", t1)
       and re.search(r"first body byte\s+yes", t1) and re.search(r"full body terminated\s+yes", t1), t1)
    ck("P1 it reports the exact received byte count, and it equals the published one",
       re.search(r"bytes received\s+" + str(len(raw)) + r"\b", t1) is not None, t1)
    ck("P1 it reports the SHA-256 of what it received, and it equals the published one",
       hashlib.sha256(raw).hexdigest() in t1, t1)
    ck("P1 it reports content-type and the VERDICT is INTACT",
       "content-type" in t1 and "text/html" in t1 and "INTACT" in t1, t1)
    ck("P4 the probe did not navigate or reload the front door",
       pg.evaluate("()=>window.__probeAlive||null") == "yes"
       and pg.evaluate("()=>location.pathname").endswith("/index.html"))
    ctx.close()

    # ---- P2: the SAME probe against a damaged file. It must refuse to call this intact. ----
    ctx2 = b.new_context()
    half = raw[: len(raw) // 2]
    ctx2.route("**/library/console.html*", lambda r: r.fulfill(status=200, content_type="text/html; charset=utf-8", body=half))
    pg2 = ctx2.new_page()
    pg2.goto(f"{base}/index.html?stay=1", wait_until="domcontentloaded")
    t2 = read_probe(pg2)
    ck("P2 with the body cut in half, the probe REFUSES to report intact",
       "INTACT" not in t2, t2)
    ck("P2 and it names the disagreement in numbers (received vs published)",
       re.search(r"bytes received\s+" + str(len(half)) + r"\b", t2) is not None
       and str(len(raw)) in t2 and "DIFFERENT SIZE" in t2, t2)
    ctx2.close()

    # ---- P3: paint-safe actually neutralizes the two first-viewport paint-heavy constructs. ----
    def paint_state(url):
        c = b.new_context()
        c.route("**/app.js*", lambda r: r.abort())      # the shell alone; the heavy app is not the subject
        c.route("**/fonts.css*", lambda r: r.abort())
        pp = c.new_page()
        pp.goto(url, wait_until="domcontentloaded")
        pp.wait_for_timeout(900)
        s = pp.evaluate("""()=>{
          var top=document.querySelector('.top');
          var bd=document.querySelector('.board');
          if(bd) bd.classList.add('board-settle');
          var ts=top?getComputedStyle(top):null, bs=bd?getComputedStyle(bd):null;
          return {
            topBlur: ts?((ts.backdropFilter||ts.webkitBackdropFilter||'none')+''):null,
            boardAnim: bs?(bs.animationName+''):null,
            boardFilter: bs?(bs.filter+''):null
          };
        }""")
        c.close(); return s

    normal = paint_state(f"{base}/library/console.html")
    safe = paint_state(f"{base}/library/console.html?paint=safe")
    ck("P3 the normal console really does carry the two paint-heavy constructs (the thing being tested exists)",
       "blur" in (normal.get("topBlur") or "") and (normal.get("boardAnim") or "none") != "none", normal)
    ck("P3 paint-safe neutralizes the sticky-header backdrop blur",
       (safe.get("topBlur") or "") in ("none", ""), safe)
    ck("P3 paint-safe neutralizes the whole-board blur animation",
       (safe.get("boardAnim") or "") == "none" and (safe.get("boardFilter") or "none") == "none", safe)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL CONSOLE-ENTRY-DIAG CHECKS PASS"))
raise SystemExit(1 if fails else 0)
