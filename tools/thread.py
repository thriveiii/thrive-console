"""WO-015 Phase A: the thread is derived and read-only, proven on the page.

  python3 tools/thread.py

The thread stores nothing (I7). This seeds all four sources for one opportunity,
snapshots every thrive_ storage key, assembles the thread, and asserts not one
byte of storage moved. It then drives the opportunity window to the thread tab
and confirms the thread renders, that a reply shows its snippet and a Gmail link,
that no full body leaks, and that it renders in Arabic too.
"""
import threading, http.server, socketserver, functools, os, sys, json

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

# One opportunity with a full thread: two sends, two opens, one real reply with a
# snippet and a Gmail-linkable message id, one bounce, and two activity entries.
SEED = """()=>{ const now=Date.now(), iso=d=>new Date(now-d*86400000).toISOString();
 localStorage.setItem('thrive_opps_v1', JSON.stringify([
  {slug:'replied-co',business:'Replied Co',published:true,up:now,stage:'replied',
   channel:{kind:'email',to:'c@r.example'}}]));
 localStorage.setItem('thrive_mail_v1', JSON.stringify([
  {ts:iso(5),mid:'s1',opp:'replied-co',direction:'out',to:'c@r.example',toName:'Carla',subject:'Replied Co x Thrive',status:'sent',provider:'endpoint'},
  {ts:iso(3),mid:'s2',opp:'replied-co',direction:'out',to:'c@r.example',subject:'Re: Replied Co x Thrive',status:'sent',provider:'endpoint'}]));
 localStorage.setItem('thrive_hits_v1', JSON.stringify([
  {type:'open',slug:'replied-co',ts:iso(4)},{type:'open',slug:'replied-co',ts:iso(2)}]));
 localStorage.setItem('thrive_inbound_v1', JSON.stringify([
  {ts:iso(1),opp:'replied-co',kind:'reply',from:'carla@r.example',name:'Carla',
   subject:'Re: Replied Co x Thrive',snippet:'Yes, this looks great, let us talk next week.',
   rule:'replyto',threadId:'t-carla-1',messageId:'<abc123@mail.gmail.com>'},
  {ts:iso(1),opp:'replied-co',kind:'auto',bounce:'soft',from:'mailer-daemon@x'}]));
 localStorage.setItem('thrive_activity_v1', JSON.stringify([
  {ts:iso(5),action:'lc_send_email',slug:'replied-co',detail:'c@r.example',actor:'thyab'},
  {ts:iso(1),action:'lc_record_reply',slug:'replied-co',detail:'2026-08-03',actor:'thyab'}]));
}"""

THRIVE_KEYS = """()=>{ const o={}; for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i);
  if(k && k.indexOf('thrive_')===0) o[k]=localStorage.getItem(k); } return JSON.stringify(o); }"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, reduced_motion="reduce")
    ctx.route("https://api.github.com/**", lambda x: x.abort())
    pg = ctx.new_page()
    pg.goto(base + "/library/console.html"); pg.wait_for_timeout(400)
    if pg.query_selector("#thriveGate"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1200)
    pg.evaluate(SEED); pg.reload(); pg.wait_for_timeout(1800)
    if pg.query_selector("#thriveGate"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1000)

    # ---- I7: it stores nothing ----
    # The snapshot must bracket the FIRST buildThread call, or an idempotent write
    # would already be present in "before" and slip past. So measure here, before
    # anything has assembled the thread even once.
    before = pg.evaluate(THRIVE_KEYS)
    entries = pg.evaluate("()=>{ const r=buildThread('replied-co'); activeChapter('replied-co'); buildThread('replied-co'); return r; }")
    after = pg.evaluate(THRIVE_KEYS)
    ck("buildThread writes nothing to storage (I7)", before == after,
       "before/after differ" if before != after else "")

    # ---- the thread exists as data ----
    kinds = [e["kind"] for e in entries]
    ck("the thread assembles from all four sources", set(kinds) >= {"sent", "open", "reply", "act"}, kinds)
    ck("the thread is time ordered, oldest first",
       all(entries[i]["ts"] <= entries[i+1]["ts"] for i in range(len(entries)-1)), kinds)
    ck("the bounce is present as machinery, not a reply", "auto" in kinds, kinds)
    reply = next((e for e in entries if e["kind"] == "reply"), None)
    ck("the reply carries a snippet and a Gmail link, not a body",
       bool(reply) and reply.get("snippet") and reply.get("gmail") and "body" not in reply, reply)
    ck("the snippet is only what the relay stored (<=600 chars)",
       bool(reply) and len(reply.get("snippet", "")) <= 600, len(reply.get("snippet", "")) if reply else 0)

    # ---- it renders, with the reply visible, in the window ----
    pg.evaluate("x=>location.hash='#'+x", "board"); pg.wait_for_timeout(700)
    card = pg.query_selector('.tok[data-slug="replied-co"] .tok-open')
    rendered = False
    if card:
        card.click(); pg.wait_for_timeout(700)
        tab = pg.query_selector('.modal-tab[data-tab="history"]')
        if tab:
            tab.click(); pg.wait_for_timeout(500)
            rendered = True
    html = pg.evaluate("()=>{ const b=document.getElementById('modalHistory'); return b? b.innerHTML : ''; }")
    ck("the thread tab renders a thread list", 'class="th-list"' in html and rendered, rendered)
    ck("a reply shows its snippet on screen", "Yes, this looks great" in html, html[:120])
    ck("a reply shows a working Gmail link", "mail.google.com" in html or "#search" in html, "")

    # ---- Arabic ----
    pg.evaluate("()=>localStorage.setItem('thrive_lang','ar')"); pg.reload(); pg.wait_for_timeout(1600)
    if pg.query_selector("#thriveGate"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1000)
    pg.evaluate("x=>location.hash='#'+x", "board"); pg.wait_for_timeout(700)
    card = pg.query_selector('.tok[data-slug="replied-co"] .tok-open')
    ar_html = ""
    if card:
        card.click(); pg.wait_for_timeout(700)
        tab = pg.query_selector('.modal-tab[data-tab="history"]')
        if tab:
            tab.click(); pg.wait_for_timeout(500)
            ar_html = pg.evaluate("()=>{ const b=document.getElementById('modalHistory'); return b? b.innerHTML : ''; }")
    ck("the thread renders in Arabic with fluent labels",
       "رسالة صادرة" in ar_html or "فتحوا الصفحة" in ar_html, ar_html[:120])
    ctx.close()

    # ---- renders at three widths (acceptance #2) ----
    for (w, h) in [(768, 1024), (1440, 900)]:
        c2 = b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce")
        c2.route("https://api.github.com/**", lambda x: x.abort())
        p2 = c2.new_page(); p2.goto(base + "/library/console.html"); p2.wait_for_timeout(400)
        if p2.query_selector("#thriveGate"):
            p2.fill("#gateInput", "ConThrive2030"); p2.click(".gate-btn"); p2.wait_for_timeout(1200)
        p2.evaluate(SEED); p2.reload(); p2.wait_for_timeout(1600)
        if p2.query_selector("#thriveGate"):
            p2.fill("#gateInput", "ConThrive2030"); p2.click(".gate-btn"); p2.wait_for_timeout(1000)
        p2.evaluate("x=>location.hash='#'+x", "board"); p2.wait_for_timeout(700)
        cd = p2.query_selector('.tok[data-slug="replied-co"] .tok-open')
        h2 = ""
        if cd:
            cd.click(); p2.wait_for_timeout(700)
            tb = p2.query_selector('.modal-tab[data-tab="history"]')
            if tb:
                tb.click(); p2.wait_for_timeout(400)
                h2 = p2.evaluate("()=>{ const b=document.getElementById('modalHistory'); return b? b.innerHTML : ''; }")
        no_hscroll = p2.evaluate("()=>document.documentElement.scrollWidth <= window.innerWidth + 2")
        ck("the thread renders at width %d with no horizontal scroll" % w,
           'class="th-list"' in h2 and no_hscroll, {"w": w, "list": 'class="th-list"' in h2, "no_hscroll": no_hscroll})
        c2.close()

    b.close()

httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
