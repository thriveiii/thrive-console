"""Messaging audit: the one small gap closed - a one-tap Follow up.

The follow-up capability already existed in pieces: the library flags a live opportunity that was sent
three or more days ago with no open and no reply (needsFollowup), and a stock follow-up template ships in
both languages (opp-nudge / opp-nudge-ar). The only missing wire was a button to act on it: following up
meant re-opening the composer and hunting for the nudge template by hand. This closes that with a "Follow
up" control on the flagged card that opens the composer bound to the opportunity with the nudge template
already chosen in the opportunity's own language. It is pure wiring of the existing ?etpl= preselect and
the stock template; the send path (relaySend) is untouched.

Proven: the button appears ONLY on a live, follow-up-flagged opportunity; its link carries the opportunity
slug and the language-correct nudge template id; an opportunity that is not due a follow-up shows no such
button; both languages. Fails-when-broken covered by the render assertions.
"""
import threading, http.server, socketserver, functools, os, sys, re
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT="/home/user/thrive-console"; CH="/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails=[]
def ck(n,c,d=None):
    print(("PASS " if c else "FAIL ")+n)
    if not c:
        fails.append(n)
        if d is not None: print("      "+str(d)[:300])

# ---- source: the wire reuses the etpl preselect + stock nudge, never the send path ----
app=open(f"{ROOT}/library/app.js").read()
ck("the Follow up control reuses the ?etpl= preselect and the stock nudge, by the opportunity's language",
   'data-fu="' in app and 'etpl="+(docLang(o)==="AR"?"opp-nudge-ar":"opp-nudge")' in app
   and 't("flw_send")' in app)
ck("the follow-up wire does not touch the send path (no new relaySend call site)",
   app.count("relaySend(")==3)   # definition + thread reply + composer, unchanged
ck("no em dash / zero-Lotus in the touched files",
   all("\u2014" not in open(f"{ROOT}/{f}").read() and "lotus" not in open(f"{ROOT}/{f}").read().lower()
       for f in ["library/app.js","library/i18n.js"]))

Handler=functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address=True
httpd=socketserver.TCPServer(("127.0.0.1",0),Handler); PORT=httpd.server_address[1]
httpd.daemon_threads=True; threading.Thread(target=httpd.serve_forever,daemon=True).start()
base=f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

# A live opp sent 5 days ago with no open/reply is flagged for follow-up; one sent today is not.
SEED = """()=>{
  const iso=(d)=>new Date(Date.now()-d*864e5).toISOString();
  localStorage.setItem('thrive_opps_v1', JSON.stringify([
    {slug:'stale-en', business:'Stale English Co', published:true, doc_lang:'en', template:'Send an opportunity page', sent_on:'2026-08-01'},
    {slug:'stale-ar', business:'شركة عربية', published:true, doc_lang:'ar', template:'إرسال صفحة فرصة', sent_on:'2026-08-01'},
    {slug:'fresh-en', business:'Fresh English Co', published:true, doc_lang:'en', template:'Send an opportunity page', sent_on:'2026-08-12'}]));
  localStorage.setItem('thrive_mail_v1', JSON.stringify([
    {mid:'a1',opp:'stale-en',to:'a@x.com',subject:'Hello',status:'sent',direction:'out',ts:iso(5)},
    {mid:'a2',opp:'stale-ar',to:'b@x.com',subject:'مرحبا',status:'sent',direction:'out',ts:iso(5)},
    {mid:'a3',opp:'fresh-en',to:'c@x.com',subject:'Hi',status:'sent',direction:'out',ts:iso(0)}]));
  localStorage.removeItem('thrive_inbound_v1'); localStorage.removeItem('thrive_hits_v1');
  window.invalidateSends&&window.invalidateSends(); window.invalidateHits&&window.invalidateHits();
}"""

def card_for(pg, slug):
    return pg.evaluate("""(slug)=>{
      const cards=[...document.querySelectorAll('#grid .card')];
      for(const c of cards){ const a=c.querySelector('.link'); if(a && a.textContent.indexOf(slug)>=0) return c.outerHTML; }
      // fall back: match by a follow-up link's data-fu
      for(const c of cards){ const f=c.querySelector('[data-fu]'); if(f && f.getAttribute('data-fu')===slug) return c.outerHTML; }
      return ''; }""", slug)

with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CH)
    for lang, label in (("en","Follow up"),("ar","تابِع")):
        ctx=b.new_context(viewport={"width":1280,"height":900})
        ctx.route("https://api.github.com/**", lambda r:r.abort())
        ctx.route(f"{base}/library/manifest.json", lambda r:r.fulfill(status=200, body='{"opportunities":[]}'))
        pg=ctx.new_page()
        pg.add_init_script(f"try{{localStorage.setItem('thrive_lang','{lang}')}}catch(e){{}}")
        pg.goto(f"{base}/library/console.html")
        pg.wait_for_function("()=>typeof window.goTo==='function' && document.getElementById('grid')", timeout=15000)
        pg.evaluate("()=>{document.documentElement.classList.remove('gate-locked');const g=document.getElementById('thriveGate');if(g)g.remove();}")
        pg.evaluate(SEED)
        pg.evaluate("()=>{ try{ window.goTo('library'); }catch(e){ location.hash='#library'; } }")
        pg.wait_for_timeout(700)
        pg.wait_for_selector("#grid .card", timeout=8000)

        en_card = card_for(pg, "stale-en")
        ar_card = card_for(pg, "stale-ar")
        fresh_card = card_for(pg, "fresh-en")

        # the flagged EN opp: a Follow up button that opens the composer bound to it with the EN nudge
        m = re.search(r'data-fu="stale-en"[^>]*href="([^"]+)"', en_card) or re.search(r'href="([^"]+)"[^>]*data-fu="stale-en"', en_card)
        href = m.group(1) if m else ""
        ck(f"{lang}: the stale EN opp shows a Follow up control bound to it with the EN nudge template",
           bool(m) and "slug=stale-en" in href and "etpl=opp-nudge" in href and "opp-nudge-ar" not in href, href)
        ck(f"{lang}: the Follow up control reads its language label", (">"+label+"<") in en_card, en_card[:200])

        # the flagged AR opp: the AR nudge template id
        ma = re.search(r'data-fu="stale-ar"[^>]*href="([^"]+)"', ar_card) or re.search(r'href="([^"]+)"[^>]*data-fu="stale-ar"', ar_card)
        hrefa = ma.group(1) if ma else ""
        ck(f"{lang}: the stale AR opp's Follow up carries the AR nudge template (opp-nudge-ar)",
           bool(ma) and "slug=stale-ar" in hrefa and "etpl=opp-nudge-ar" in hrefa, hrefa)

        # the fresh opp (sent today) is NOT due a follow-up: no button
        ck(f"{lang}: an opportunity not due a follow-up shows no Follow up control",
           bool(fresh_card) and 'data-fu="fresh-en"' not in fresh_card, fresh_card[:160])

        ctx.close()
    b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
