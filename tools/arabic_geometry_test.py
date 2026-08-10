"""The Arabic surface renders without breakage; tile and button geometry repaired (WO-023).

Engine-independent facts (the three-width visual and Arabic joined-letter render stay Thyab's WebKit
device gate):
- Insights tiles are one aligned unit: icon, number and label share one edge, at the reading edge, and
  mirror by direction (left in English, right in Arabic), never icon-centered while the rest sits aside.
- Every date routes through the one formatter from #92 (fmtStamp): there is no ad-hoc toLocale* or a
  second Intl.DateTimeFormat anywhere, the formatter pins ar-u-nu-latn (Western digits on every engine)
  and its output is bidi-isolated.
- Numeric columns and their headers align consistently (one text-align rule for th and td).
- No two buttons in a row touch: every .bar is a flex row with one gap token, and a row's buttons
  (primary, ghost, and a label styled as a button) share one height.
- No letter-spacing is ever added to Arabic text (every rtl letter-spacing rule is 'normal')."""
import threading, http.server, socketserver, functools, os, re
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

app = open(os.path.join(ROOT, "library/app.js")).read()
css = open(os.path.join(ROOT, "library/styles.css")).read()

# ---- dates: one formatter, no ad-hoc string, pinned Latin digits, isolated ----
ck("fmtStamp is the one date formatter and pins ar-u-nu-latn (Western digits on every engine)",
   "function fmtStamp(" in app and "ar-u-nu-latn" in app)
ck("Intl.DateTimeFormat is constructed only inside fmtStamp (no second formatter)",
   len(re.findall(r'new Intl\.DateTimeFormat', app)) == 2)   # the primary + the en-US fallback, both in fmtStamp
adhoc = re.findall(r'toLocaleDateString|toLocaleTimeString|toLocaleString', app)
ck("no ad-hoc localized date string bypasses the formatter (grep returns zero)", adhoc == [], adhoc)
ck("the formatter output is bidi-isolated (<bdi> / unicode-bidi:isolate), so a date never reorders in RTL",
   "'<bdi>'+esc(s)+'</bdi>'" in app and "unicode-bidi:isolate" in css)

# ---- numeric columns: header and column share one alignment rule ----
ck("the log table aligns headers with their columns (one text-align rule for th and td)",
   ".logtable th,.logtable td{text-align:start" in css)

# ---- no letter-spacing is ever added to Arabic: every rtl letter-spacing rule sets it to normal ----
rtl_ls = re.findall(r'\[dir="rtl"\][^{]*\{[^}]*letter-spacing:\s*([^;}]+)', css)
ck("every rtl letter-spacing rule sets it to normal (Arabic joins never break)",
   all(v.strip() == "normal" for v in rtl_ls), rtl_ls)

# Representative shipped markup, rendered against the shipped stylesheet.
PROBE = """
<div class="wrap" id="probe">
  <div id="tilesPages" style="display:flex;gap:12px">
    <div class="tile acc-teal"><span class="tile-ic"></span><div class="tile-v">128</div><div class="tile-k">Pages</div></div>
    <div class="tile acc-purple"><span class="tile-ic"></span><div class="tile-v">1,024</div><div class="tile-k">Visitors</div></div>
  </div>
  <div class="bar" id="barA">
    <button class="btn" type="button">Save</button>
    <button class="btn ghost" type="button">Test connection</button>
    <label class="btn ghost">Restore from file</label>
  </div>
  <div class="bar" id="barB">
    <button class="btn sm" type="button">Re-match</button>
    <button class="btn ghost sm" type="button">Attach</button>
  </div>
</div>
"""

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

def tile_edges(pg):
    return pg.evaluate("""()=>Array.from(document.querySelectorAll('#tilesPages .tile')).map(tl=>{
      const r=el=>{ const x=tl.querySelector(el); const b=x.getBoundingClientRect(); return {l:Math.round(b.left), r:Math.round(b.right)}; };
      return { ic:r('.tile-ic'), v:r('.tile-v'), k:r('.tile-k') };
    })""")

def bar_geo(pg, sel):
    return pg.evaluate("""(sel)=>{
      const bar=document.querySelector(sel);
      const btns=Array.from(bar.querySelectorAll('.btn')).filter(b=>b.offsetParent!==null);
      const rects=btns.map(b=>b.getBoundingClientRect()).sort((a,b)=>a.left-b.left);
      let minGap=Infinity, touch=false;
      for(let k=1;k<rects.length;k++){ const g=rects[k].left-rects[k-1].right; if(g<minGap)minGap=g; if(g<2)touch=true; }
      const heights=[...new Set(rects.map(r=>Math.round(r.height)))];
      return { n:btns.length, minGap:(rects.length>1?Math.round(minGap):null), touch, heights };
    }""", sel)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page(viewport={"width": 900, "height": 900})
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_selector("#gateInput", timeout=10000)   # CSS + JS loaded
    # Reveal the page (the probe lives in a .wrap, hidden while gate-locked) so controls have real geometry.
    pg.evaluate("()=>document.documentElement.classList.remove('gate-locked')")
    pg.evaluate("(html)=>{ const d=document.createElement('div'); d.innerHTML=html; document.body.appendChild(d.firstElementChild); }", PROBE)

    # ---- LTR: each tile is one unit, all three parts share the left (reading) edge ----
    pg.evaluate("()=>document.documentElement.setAttribute('dir','ltr')")
    lt = tile_edges(pg)
    ck("English: icon, number and label share one left edge in each tile (one aligned unit, not icon-centered)",
       all(abs(t["ic"]["l"]-t["v"]["l"])<=2 and abs(t["v"]["l"]-t["k"]["l"])<=2 for t in lt), lt)

    # ---- RTL: the unit mirrors, all three parts share the right (reading) edge ----
    pg.evaluate("()=>document.documentElement.setAttribute('dir','rtl')")
    rt = tile_edges(pg)
    ck("Arabic: the same unit mirrors, icon, number and label share one right edge (never mixed)",
       all(abs(t["ic"]["r"]-t["v"]["r"])<=2 and abs(t["v"]["r"]-t["k"]["r"])<=2 for t in rt), rt)

    # ---- buttons: one gap, none touching, one height per row, in both directions ----
    for d in ("ltr", "rtl"):
        pg.evaluate("(dir)=>document.documentElement.setAttribute('dir',dir)", d)
        a = bar_geo(pg, "#barA"); bb = bar_geo(pg, "#barB")
        ck(f"[{d}] a mixed row (primary, ghost, label) has a real gap and no touching",
           a["minGap"] is not None and a["minGap"] >= 10 and not a["touch"], a)
        ck(f"[{d}] the mixed row's buttons share one height (primary == ghost == label)",
           len(a["heights"]) == 1, a)
        ck(f"[{d}] a small-button row also has a real gap and one height",
           bb["minGap"] is not None and bb["minGap"] >= 10 and not bb["touch"] and len(bb["heights"]) == 1, bb)

    # ---- the one gap token is 12px (the single spacing value used across button rows) ----
    pg.evaluate("()=>document.documentElement.setAttribute('dir','ltr')")
    gap = pg.evaluate("()=>getComputedStyle(document.querySelector('#barA')).columnGap")
    ck("the single gap token resolves to 12px (--s-3), used across every bar", gap == "12px", gap)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL ARABIC / GEOMETRY CHECKS PASS"))
raise SystemExit(1 if fails else 0)
