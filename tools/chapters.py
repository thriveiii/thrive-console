"""WO-015 Phase C: chapters, proven on the page and in the data.

  python3 tools/chapters.py

An opportunity can have more than one act. A mail record carries its chapter,
the card's lane follows the active chapter's furthest state, a quiet marker names
the live chapter, and the thread shows a divider where the offer began.
"""
import threading, http.server, socketserver, functools, os, sys

os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = "http://127.0.0.1:%d" % PORT
from playwright.sync_api import sync_playwright

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:240])

# first-co: a plain first contact, one send in chapter 1.
# offer-co: answered in chapter 1, then an offer sent in chapter 2 that has not
#   been opened or answered. Its active chapter is 2, so its lane must read from
#   the offer, "sent", not from the earlier reply.
SEED = """()=>{ const now=Date.now(), iso=d=>new Date(now-d*86400000).toISOString();
 localStorage.setItem('thrive_opps_v1', JSON.stringify([
  {slug:'first-co',business:'First Co',published:true,up:now,stage:'sent'},
  {slug:'offer-co',business:'Offer Co',published:true,up:now,stage:'replied'}]));
 localStorage.setItem('thrive_mail_v1', JSON.stringify([
  {ts:iso(8),mid:'f1',opp:'first-co',direction:'out',to:'f@x',status:'sent',chapter:1},
  {ts:iso(9),mid:'o1',opp:'offer-co',direction:'out',to:'o@x',status:'sent',chapter:1},
  {ts:iso(2),mid:'o2',opp:'offer-co',direction:'out',to:'o@x',subject:'Your offer',status:'sent',chapter:2}]));
 localStorage.setItem('thrive_inbound_v1', JSON.stringify([
  {ts:iso(7),opp:'offer-co',kind:'reply',from:'o@x',snippet:'interested',chapter:1}]));
}"""

def unlock(pg):
    if pg.query_selector("#thriveGate"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1200)

def lane_of(pg, slug):
    return pg.evaluate("(s)=>{ const e=document.querySelector('.tok[data-slug=\"'+s+'\"]'); return e? e.getAttribute('data-lane'):null; }", slug)

def marker_of(pg, slug):
    return pg.evaluate("""(s)=>{ const e=document.querySelector('.tok[data-slug="'+s+'"]');
      if(!e) return {n:-1,text:'',ls:''};
      const m=e.querySelectorAll('.tok-chapter');
      const one=m[0]; return {n:m.length, text:one?one.textContent.trim():'',
        ls:one?getComputedStyle(one).letterSpacing:''}; }""", slug)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width": 1200, "height": 900}, reduced_motion="reduce")
    ctx.route("https://api.github.com/**", lambda x: x.abort())
    pg = ctx.new_page()
    pg.goto(base + "/library/console.html"); pg.wait_for_timeout(400)
    unlock(pg)
    pg.evaluate(SEED); pg.reload(); pg.wait_for_timeout(1800); unlock(pg)
    pg.evaluate("x=>location.hash='#board'"); pg.wait_for_timeout(900)

    # ---- chapter field, default 1 ----
    ch = pg.evaluate("()=>{ const r=logMail({opp:'tmp-co',to:'t@x',status:'sent'}); return r.chapter; }")
    ck("logMail defaults chapter to 1", ch == 1, ch)
    thread_ch = pg.evaluate("()=>buildThread('first-co').filter(e=>e.kind==='sent').map(e=>e.chapter)")
    ck("an existing send reads as chapter 1", thread_ch and all(c == 1 for c in thread_ch), thread_ch)

    # ---- lane follows the active chapter (proven with synthetic records) ----
    ac = pg.evaluate("()=>activeChapter('offer-co')")
    ck("offer-co's active chapter is 2", ac == 2, ac)
    acs = pg.evaluate("()=>{ const o=getDrafts?getDrafts().find(x=>x.slug==='offer-co'):null; return activeChapterStage(o||{slug:'offer-co',stage:'replied'}); }")
    ck("activeChapterStage reads offer-co from the offer, as sent, not the old reply", acs == "sent", acs)
    ck("first-co stays sent in chapter 1", pg.evaluate("()=>activeChapterStage({slug:'first-co',stage:'sent'})") == "sent")
    ck("the board puts offer-co in the sent lane", lane_of(pg, "offer-co") == "sent", lane_of(pg, "offer-co"))
    ck("the board keeps first-co in the sent lane", lane_of(pg, "first-co") == "sent", lane_of(pg, "first-co"))

    # ---- the marker, once per card, both languages ----
    for lang, first_word, offer_word in [("en", "First contact", "Offer"), ("ar", "أول تواصل", "عرض")]:
        pg.evaluate("l=>localStorage.setItem('thrive_lang',l)", lang); pg.reload(); pg.wait_for_timeout(1500); unlock(pg)
        pg.evaluate("x=>location.hash='#board'"); pg.wait_for_timeout(900)
        mo = marker_of(pg, "offer-co"); mf = marker_of(pg, "first-co")
        ck("offer-co shows exactly one chapter marker, the offer (%s)" % lang,
           mo["n"] == 1 and mo["text"] == offer_word, mo)
        ck("first-co shows exactly one chapter marker, first contact (%s)" % lang,
           mf["n"] == 1 and mf["text"] == first_word, mf)
        ls = mo["ls"]
        ck("the marker has no letter-spacing on Arabic (%s)" % lang,
           ls in ("normal", "0px", "0"), ls)

    # ---- the thread shows a chapter divider where chapter 2 begins ----
    card = pg.query_selector('.tok[data-slug="offer-co"] .tok-open')
    hist = ""
    if card:
        card.click(); pg.wait_for_timeout(700)
        tab = pg.query_selector('.modal-tab[data-tab="history"]')
        if tab:
            tab.click(); pg.wait_for_timeout(400)
            hist = pg.evaluate("()=>{ const b=document.getElementById('modalHistory'); return b? b.innerHTML : ''; }")
    ck("the thread shows a chapter divider where chapter 2 begins", 'class="th-chapter"' in hist, hist[:80])

    ctx.close(); b.close()

httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
