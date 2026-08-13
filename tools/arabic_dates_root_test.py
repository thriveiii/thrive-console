"""Arabic dates read correctly on the surfaces that were broken: one composer, isolation by CONTENT (WO-032).

The earlier dates fix (#123) isolated numerals and dates, but through the WRONG kind of wrapper on several
surfaces: an LTR-forcing isolate (.mono, or ltr() -> .mono-iso) that is right for a Latin identifier but
forces an Arabic date to render left-to-right, so «2026/08/11، 3:46 م» scrambled on the device. #123's
walker only checked THAT a digit was isolated, not that its direction fit the content, so it passed while
the History rows, thread timestamps and card meta stayed broken.

The root: one date composer (fmtStampHtml / fmtWhenHtml -> <bdi>) whose direction follows its CONTENT, and
one counted-phrase composer (fmtRelative -> nIso). Every displayed date and counted phrase routes through
them; nothing is assembled ad-hoc at a call site. This suite renders the three broken surfaces in a real
RTL page and asserts, by PIXEL ORDER, that the Arabic date reads right-to-left even inside an LTR-forced
cell (the meridiem «م» sits LEFT of the year), and that the counted number is the isolated right-most atom.

WebKit at three widths is Thyab's device gate; the composition and order are proven here.
"""
import threading, http.server, socketserver, functools, os, sys, re
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True; threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:300])

# ---- Source guards: one composer per axis, and no ad-hoc composition anywhere -------------------
app = open(f"{ROOT}/library/app.js").read()
# Strip comments before the "no ad-hoc" greps, so the composer's own doc-comments (which quote the retired
# patterns to warn against them) do not read as live call sites.
code = re.sub(r"//[^\n]*", "", re.sub(r"/\*.*?\*/", "", app, flags=re.S))
ck("one date composer bakes CONTENT-direction isolation (a <bdi>, not an LTR-forced wrapper)",
   "function fmtStampHtml(ts, opts){ var s=fmtStamp(ts, opts); return s ? '<bdi>'+esc(s)+'</bdi>' : ''; }" in app
   and "function fmtWhenHtml(ts){ return fmtStampHtml(ts" in app)
ck("a plain-text date sink is isolated with Unicode controls (FSI .. PDI)",
   'function fmtStampTxt(ts, opts){' in app and "⁨" in app and "⁩" in app)
ck("one counted-phrase composer isolates the numeral in one place",
   "function fmtRelative(key, n, extra){" in app and "split(String(n)).join(nIso(n))" in app)
# The ad-hoc patterns the root removes: a date in an LTR-forced wrapper, and a hand-rolled numeral splice.
ck("no displayed date is wrapped in ltr() (the LTR-forcing isolate) any more",
   re.search(r"ltr\(\s*(when|fmt|fmtWhen|fmtWhenShort)\(", code) is None)
ck("no call site hand-rolls a counted phrase (txt(...).replace(String(n),num(n)) / split-join .n)",
   re.search(r"replace\(String\([^)]*\),\s*num\(", code) is None
   and re.search(r"\.split\(String\([^)]*\)\)\.join\('<span class=\"n\">", code) is None)

BASEL = ("نعم شكرًا.\n\n"
         "في اثنين، ٣ آب ٢٠٢٦ في ٩:٣٧ م، كتب Thrive <hi@thriveiii.com>:\n"
         "> سطر مقتبس.")

def boot(pg, lang):
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_function("()=>typeof window.fmtWhenHtml==='function' && typeof window.fmtRelative==='function' && typeof window.threadListHtml==='function'", timeout=15000)
    pg.evaluate("()=>{document.documentElement.classList.remove('gate-locked');const g=document.getElementById('thriveGate');if(g)g.remove();}")
    pg.evaluate("(l)=>localStorage.setItem('thrive_lang',l)", lang)
    pg.reload()
    pg.wait_for_function("()=>typeof window.fmtWhenHtml==='function' && typeof window.fmtRelative==='function'", timeout=15000)
    pg.evaluate("()=>{document.documentElement.classList.remove('gate-locked');const g=document.getElementById('thriveGate');if(g)g.remove();}")

# Render an HTML fragment inside a real RTL container that carries the SAME class as the broken surface,
# then report the computed direction of the date node and the x of two substrings (for the pixel order).
MEASURE = r"""
(a) => {
  const host = document.createElement(a.tag==='tr' ? 'table' : 'div');
  host.dir = a.dir; host.style.cssText = 'position:absolute;top:0;left:0;width:420px;font-size:16px';
  host.innerHTML = a.tag==='tr'
    ? '<tbody><tr><td class="'+a.cls+'">'+a.html+'</td></tr></tbody>'
    : '<span class="'+a.cls+'">'+a.html+'</span>';
  document.body.appendChild(host);
  const cell = host.querySelector('.'+a.cls.split(' ').join('.'));
  const bdi = cell.querySelector('bdi') || cell.querySelector('.n') || cell;
  function xOf(sub){
    const w = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT); let node;
    while ((node = w.nextNode())){ const i=(node.nodeValue||'').indexOf(sub); if(i>=0){
      const r=document.createRange(); r.setStart(node,i); r.setEnd(node,i+sub.length);
      return r.getBoundingClientRect().left; } }
    return null;
  }
  const out = { dir: getComputedStyle(bdi).direction,
                isBdi: bdi.tagName==='BDI' || bdi.classList.contains('n'),
                x: {} };
  (a.marks||[]).forEach(m => out.x[m] = xOf(m));
  host.remove();
  return out;
}
"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width":1280,"height":900})
    ctx.route("https://api.github.com/**", lambda r: r.abort())
    ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))
    pg = ctx.new_page()

    # ============================ ARABIC ============================
    boot(pg, "ar")
    ts = "2026-08-11T15:46:00Z"

    # Surface #1 - the History row: fmtWhenHtml inside the exact <td class="mono"> that forced LTR.
    hist = pg.evaluate(MEASURE, {"tag":"tr","dir":"rtl","cls":"mono",
        "html": pg.evaluate("(t)=>window.fmtWhenHtml(t)", ts), "marks":["م","2026"]})
    ck("History date is composed in a <bdi> and computes right-to-left even inside the LTR-forced .mono cell",
       hist["dir"]=="rtl" and hist["isBdi"], hist)
    ck("History date reads right-to-left by PIXEL ORDER: the meridiem «م» sits left of the year",
       hist["x"].get("م") is not None and hist["x"].get("2026") is not None and hist["x"]["م"] < hist["x"]["2026"], hist)

    # Surface #2 - the card idle meta: fmtRelative inside <span class="tok-meta">. The isolated count is the
    # right-most atom of the RTL phrase (it sits to the RIGHT of the trailing word «حركة»).
    idle_html = pg.evaluate("()=>window.fmtRelative('tok_idle', 8)")
    idle = pg.evaluate(MEASURE, {"tag":"span","dir":"rtl","cls":"tok-meta","html":idle_html,"marks":["8","حركة"]})
    ck("card idle meta isolates the count in .n (an atomic numeral)", '<span class="n">8</span>' in idle_html, idle_html)
    ck("card idle meta reads right-to-left by PIXEL ORDER: «8» sits right of the trailing word «حركة»",
       idle["x"].get("8") is not None and idle["x"].get("حركة") is not None and idle["x"]["8"] > idle["x"]["حركة"], idle)

    # Surface #3 - the thread timestamp: the real threadListHtml, its .th-when / .rp-when date node.
    thread = pg.evaluate("""(a)=>{
      localStorage.setItem('thrive_opps_v1', JSON.stringify([{slug:'s1',business:'S',published:true}]));
      localStorage.setItem('thrive_mail_v1', JSON.stringify([{mid:'m1',opp:'s1',to:'x@x.com',subject:'Re',status:'sent',direction:'out',ts:a.ts}]));
      localStorage.setItem('thrive_inbound_v1', JSON.stringify([{gid:'g1',opp:'s1',kind:'reply',from:'x@x.com',name:'X',subject:'Re',snippet:a.basel,ts:a.ts}]));
      const w=document.createElement('div'); w.id='thp'; w.dir='rtl'; w.style.cssText='width:420px';
      w.innerHTML=window.threadListHtml('s1'); document.body.appendChild(w);
      const when=w.querySelector('.rp-when bdi') || w.querySelector('.th-when bdi');
      const r={ hasBdi: !!when, dir: when?getComputedStyle(when).direction:'' };
      // pixel order inside the timestamp node
      const xOf=(el,sub)=>{ const wk=document.createTreeWalker(el,NodeFilter.SHOW_TEXT); let n;
        while(n=wk.nextNode()){ const i=(n.nodeValue||'').indexOf(sub); if(i>=0){ const rg=document.createRange(); rg.setStart(n,i); rg.setEnd(n,i+sub.length); return rg.getBoundingClientRect().left; } } return null; };
      if(when){ r.xMer=xOf(when,'م'); r.xYear=xOf(when,'2026'); }
      w.remove(); return r; }""", {"ts": ts, "basel": BASEL})
    ck("thread timestamp is a content-direction <bdi> (never ltr()-forced), computing right-to-left",
       thread["hasBdi"] and thread["dir"]=="rtl", thread)
    ck("thread timestamp reads right-to-left by PIXEL ORDER: «م» sits left of the year",
       thread.get("xMer") is not None and thread.get("xYear") is not None and thread["xMer"] < thread["xYear"], thread)

    # ============================ ENGLISH: unaffected ============================
    boot(pg, "en")
    en = pg.evaluate(MEASURE, {"tag":"tr","dir":"ltr","cls":"mono",
        "html": pg.evaluate("(t)=>window.fmtWhenHtml(t)", ts), "marks":["2026"]})
    ck("English date still renders, composed in a <bdi> and computing left-to-right",
       en["dir"]=="ltr" and en["isBdi"] and en["x"].get("2026") is not None, en)
    en_idle = pg.evaluate("()=>window.fmtRelative('tok_idle', 8)")
    ck("English counted phrase still renders its number, isolated", '<span class="n">8</span>' in en_idle and "idle" in en_idle.lower(), en_idle)

    ctx.close(); b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
