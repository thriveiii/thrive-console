"""Arabic dates and counted phrases render correctly everywhere: every numeral and date is isolated.

The per-line reply fix (#86) covered quoted content, but numerals composed into Arabic phrases elsewhere
were not all isolated: the board card meta and hero used .n, but the stalled chip dropped the STALL_DAYS
number raw into «متوقفة أكثر من 10 أيام», and the sync pill set "last sync <date>" via textContent (no
isolation). A raw numeral or date in an RTL phrase reorders on WebKit.

The fix: one numeral helper (nIso -> .n, direction:ltr; unicode-bidi:isolate) beside the one date
formatter (fmtStamp / fmtStampHtml -> <bdi>). Every number composed into a phrase routes through nIso;
every displayed date through fmtStamp, isolated for injection. This suite renders the Arabic board (card
meta, chips, hero) and the sync pill and asserts every digit sits inside an isolation wrapper, so no
numeral or date can reorder. English is unaffected.

WebKit is Thyab's device gate; the isolation structure is proven here.
"""
import threading, http.server, socketserver, functools, os, sys, json, re
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

# ---- Source guards ----------------------------------------------------------
app = open(f"{ROOT}/library/app.js").read()
ck("one numeral helper (nIso) sits beside the date formatter",
   "function nIso(n){" in app and 'class=\"n\"' in app)
ck("the board numeral helper routes through nIso", "const num=v=>nIso(v);" in app)
ck("the stalled chip isolates its in-phrase day count", "{d:nIso(ThriveBoard.STALL_DAYS)}" in app)
ck("the sync pill date is isolated (fmtStampHtml), not a raw textContent date",
   'p.innerHTML=esc(t("sy_last"))+" "+fmtStampHtml(last' in app
   and 'p.textContent=t("sy_last")+" "+fmtWhen(last)' not in app)
ck("no displayed date bypasses the one formatter (no ad-hoc locale date formatting)",
   not re.search(r"toLocale(Date|Time)?String|toDateString", app))

# The walker: any digit whose OWN wrapper is not direction-isolated is a reorder risk in RTL.
WALK = r"""
(sel) => {
  const root = document.querySelector(sel);
  if (!root) return { missing:true };
  const bad = [];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = w.nextNode())) {
    if (!/[0-9]/.test(node.nodeValue || "")) continue;
    const p = node.parentElement; if (!p) continue;
    const ub = getComputedStyle(p).unicodeBidi || "";
    const wrapped = p.tagName === "BDI" || p.classList.contains("n") || p.classList.contains("mono-iso")
                    || ub.indexOf("isolate") >= 0 || ub.indexOf("plaintext") >= 0;
    if (!wrapped) bad.push({ digits:(node.nodeValue||"").trim().slice(0,24), parent:(p.className||p.tagName) });
  }
  return { bad, text:(root.textContent||"").trim().slice(0,80) };
}
"""

OPPS = [{"slug":"idle-co","business":"Idle Co","published":True,"up":1}]
MAIL = [{"opp":"idle-co","status":"sent","ts":"2026-07-20T10:00:00Z","to":"a@x.com","mid":"m1"}]

def boot(pg, lang):
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_function("()=>typeof window.thriveBoardRefresh==='function'", timeout=15000)
    pg.evaluate("()=>{document.documentElement.classList.remove('gate-locked');const g=document.getElementById('thriveGate');if(g)g.remove();}")
    pg.evaluate("""(a)=>{ localStorage.setItem('thrive_lang',a.lang);
        localStorage.setItem('thrive_opps_v1',JSON.stringify(a.opps));
        localStorage.setItem('thrive_mail_v1',JSON.stringify(a.mail));
        localStorage.setItem('thrive_sync_ep','https://relay.example/exec');
        localStorage.setItem('thrive_sync_last','2026-08-11T09:05:00Z'); }""",
        {"lang":lang,"opps":OPPS,"mail":MAIL})
    pg.reload()
    pg.wait_for_function("()=>typeof window.thriveBoardRefresh==='function'", timeout=15000)
    pg.evaluate("()=>{document.documentElement.classList.remove('gate-locked');const g=document.getElementById('thriveGate');if(g)g.remove();}")
    pg.evaluate("()=>location.hash='board'"); pg.wait_for_timeout(600)
    # the board reads the server-computed view now: seed idle-co as a stalled sent card (idle_days >= 10)
    # so its meta renders the isolated idle-days number and the stalled chip still shows
    pg.evaluate("""()=>window.__boardViewSet([
      {slug:'idle-co', stage:'sent', open_count:0, replied:false, idle_days:12, has_page:true, has_email:false, archived:false}
    ])""")
    pg.evaluate("()=>window.thriveBoardRefresh()"); pg.wait_for_timeout(400)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width":1280,"height":900})
    ctx.route("https://api.github.com/**", lambda r: r.abort())
    ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))
    pg = ctx.new_page()

    # ---- Arabic: every numeral/date on the board is isolated ----
    boot(pg, "ar")
    for sel, label in [('.tok[data-slug="idle-co"] .tok-meta', "card meta («N أيام بلا حركة»)"),
                       ('#boardChips', "the chips (stalled day count + counts)"),
                       ('#boardVerdictSub', "the hero subtitle (relative days)"),
                       ('#boardSync', "the sync pill (last sync date)")]:
        r = pg.evaluate(WALK, sel)
        if r.get("missing"):
            ck("AR: "+label+" is present", False, sel); continue
        ck("AR: every numeral/date is isolated in "+label, r["bad"] == [], r)
    # The sync pill carries a real, isolated date (a <bdi>).
    hasbdi = pg.evaluate("()=>{ const el=document.getElementById('boardSync'); return !!(el && el.querySelector('bdi')); }")
    ck("AR: the sync pill date is a direction-isolated element", hasbdi, pg.evaluate("()=>document.getElementById('boardSync').innerHTML"))
    # The stalled chip's day count is inside .n (the exact device symptom).
    chip_ok = pg.evaluate("""()=>{ const c=document.querySelector('#boardChips [data-chip=\"stalled\"]');
        return !!(c && c.querySelector('.n')); }""")
    ck("AR: the stalled chip day count is isolated in .n", chip_ok,
       pg.evaluate("()=>{const c=document.querySelector('#boardChips [data-chip=\"stalled\"]'); return c?c.innerHTML:null;}"))

    # ---- English: unaffected, still renders the numbers and an isolated date ----
    boot(pg, "en")
    en_meta = pg.evaluate(WALK, '.tok[data-slug="idle-co"] .tok-meta')
    ck("EN: the card meta still renders its number, isolated", en_meta.get("bad") == [] and any(ch.isdigit() for ch in en_meta.get("text","")), en_meta)
    en_pill = pg.evaluate("()=>{ const el=document.getElementById('boardSync'); return { html:el.innerHTML, bdi:!!el.querySelector('bdi') }; }")
    ck("EN: the sync pill shows an isolated date", en_pill["bdi"], en_pill)

    ctx.close(); b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
