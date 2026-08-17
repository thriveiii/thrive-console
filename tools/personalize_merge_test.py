"""Personalize names (P6 / D4). Engine-independent; WebKit is Thyab's device gate.

The "Personalize names" chip adds the {{NAME}} merge token to the greeting as a soft pill (never raw
braces), placed after a recognized greeting form (EN and AR) or at the cursor; toggling it off heals the
line so a nameless greeting reads "Hi," and never "Hi ,". The pre-send roster shows every recipient of a
campaign with the exact name that will merge and the greeting each will read (the name merged, or the
clean fallback for a nameless one). Nothing here sends; the send path is untouched (P7).
"""
import threading, http.server, socketserver, functools, os, json
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

# Greeting forms the chip recognizes, EN and AR, with the trailing punctuation each is written with.
FORMS = [
  ("Hi,",            "Hi <<N>>,",            "en"),
  ("Hello,",         "Hello <<N>>,",         "en"),
  ("Good day,",      "Good day <<N>>,",      "en"),
  ("Dear",           "Dear <<N>>",           "en"),
  ("مرحبا،",         "مرحبا <<N>>،",         "ar"),
  ("أهلا وسهلا،",    "أهلا وسهلا <<N>>،",    "ar"),
  ("يوم سعيد،",      "يوم سعيد <<N>>،",      "ar"),
  ("عزيزي",          "عزيزي <<N>>",          "ar"),
]

# In-page helpers: set the body, drop any selection, click the chip, read the body with pills marked.
JS_SETUP = r"""
window.__pn = {
  serialize: function(){
    var b=document.getElementById('ebody').cloneNode(true);
    b.querySelectorAll('[data-m="name"]').forEach(function(s){ s.replaceWith(document.createTextNode('<<N>>')); });
    return b.textContent;
  },
  setBody: function(html){ var b=document.getElementById('ebody'); b.innerHTML=html; try{ getSelection().removeAllRanges(); }catch(e){} if(document.activeElement) try{ document.activeElement.blur(); }catch(e){} },
  caretAt: function(off){ var b=document.getElementById('ebody'); var tn=b.firstChild; var r=document.createRange(); r.setStart(tn, off); r.collapse(true); var s=getSelection(); s.removeAllRanges(); s.addRange(r); },
  hasPill: function(){ return !!document.getElementById('ebody').querySelector('[data-m="name"]'); },
  pillEditable: function(){ var p=document.getElementById('ebody').querySelector('[data-m="name"]'); return p? p.getAttribute('contenteditable') : null; }
};
"""

def unlock(pg):
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn")
    pg.evaluate("()=>{ var g=document.getElementById('thriveGate'); if(g) g.remove(); document.documentElement.classList.remove('gate-locked'); }")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page(viewport={"width": 1280, "height": 900})
    pg.goto(f"{base}/library/compose.html")
    unlock(pg)
    pg.wait_for_function("()=>window.__composeReady && typeof window.stripNameTokenClean==='function' && document.getElementById('tbPersonalize')", timeout=15000)
    pg.evaluate(JS_SETUP)

    # ---- the pure fallback helpers: token removed cleanly, no stray comma or double space ----
    ck('stripNameTokenClean heals "Hi {{NAME}}," to "Hi," (never "Hi ,")',
       pg.evaluate("()=>window.stripNameTokenClean('Hi {{NAME}},')")=="Hi,")
    ck('stripNameTokenClean leaves "Hi {{NAME}}" as "Hi"',
       pg.evaluate("()=>window.stripNameTokenClean('Hi {{NAME}}')")=="Hi")
    ck('stripNameTokenClean heals an Arabic greeting "مرحبا {{NAME}}،" to "مرحبا،"',
       pg.evaluate("()=>window.stripNameTokenClean('مرحبا {{NAME}}،')")=="مرحبا،")
    ck('mergeGreetingLine merges the name: "Hi {{NAME}}," + Basel -> "Hi Basel,"',
       pg.evaluate("()=>window.mergeGreetingLine('Hi {{NAME}},','Basel')")=="Hi Basel,")
    ck('mergeGreetingLine, no name -> clean fallback "Hi,"',
       pg.evaluate("()=>window.mergeGreetingLine('Hi {{NAME}},','')")=="Hi,")
    ck('mergeGreetingLine keeps an Arabic name intact: "مرحبا ليّا،"',
       pg.evaluate("()=>window.mergeGreetingLine('مرحبا {{NAME}}،','ليّا')")=="مرحبا ليّا،")

    # ---- the chip inserts the pill after each supported greeting form (EN and AR), RTL in logical order ----
    for src, want, lang in FORMS:
        pg.evaluate("(h)=>window.__pn.setBody(h)", src)
        pg.click("#tbPersonalize")
        got = pg.evaluate("()=>window.__pn.serialize()")
        ck(f'the chip inserts {{{{NAME}}}} after the greeting "{src}" ({lang})', got==want, got)

    # ---- the pill is a real pill, never raw braces, and is atomic (contenteditable=false) ----
    pg.evaluate("()=>window.__pn.setBody('Hi,')"); pg.click("#tbPersonalize")
    ck("the token renders as a pill, not raw braces", pg.evaluate("()=>window.__pn.hasPill()") and "{{" not in pg.evaluate("()=>document.getElementById('ebody').textContent"))
    ck("the pill is atomic (contenteditable=false), so a delete removes the whole token",
       pg.evaluate("()=>window.__pn.pillEditable()")=="false")

    # ---- toggling the chip off restores the body with no token residue ----
    pg.evaluate("()=>window.__pn.setBody('Hi,')"); pg.click("#tbPersonalize")   # on
    ck("after enable the greeting carries the pill", pg.evaluate("()=>window.__pn.serialize()")=="Hi <<N>>,")
    pg.click("#esubject")                                                        # move focus out of the body
    pg.click("#tbPersonalize")                                                   # off
    off = pg.evaluate("()=>window.__pn.serialize()")
    ck('toggling off leaves no residue: "Hi," (no token, no "Hi ,", no double space)',
       off=="Hi," and "<<N>>" not in off and " ," not in off and "  " not in off, off)

    # ---- manual token insertion at the cursor also works (no greeting to detect) ----
    pg.evaluate("()=>window.__pn.setBody('See you soon')")
    pg.evaluate("()=>window.__pn.caretAt(8)")                                    # caret before "soon"
    pg.click("#tbPersonalize")
    man = pg.evaluate("()=>window.__pn.serialize()")
    ck('manual insertion drops the pill at the cursor: "See you <<N>> soon"', man=="See you <<N>> soon", man)

    # ---- nothing was sent from the composer while personalizing ----
    ck("no mail row was written while personalizing", pg.evaluate("()=>window.getMailLog().length")==0)

    # ---- the pre-send roster: three recipients, three correct greetings, EN and AR bodies ----
    pg.evaluate("""()=>{ localStorage.setItem('thrive_opps_v1', JSON.stringify([{slug:'camp1', business:'Campaign One', published:true, up:1,
      recipients:[{addr:'basel@shop.example',name:'Basel'},{addr:'laya@atelier.example',name:'ليّا',lang:'ar'},{addr:'no@name.example',name:''}]}])); }""")
    pg.goto(f"{base}/library/compose.html?slug=camp1")
    unlock(pg)
    pg.wait_for_function("()=>window.__composeReady && document.getElementById('tbPersonalize') && document.getElementById('mergeRoster')", timeout=15000)
    pg.evaluate(JS_SETUP)

    def roster_greets(body_html):
        pg.evaluate("(h)=>window.__pn.setBody(h)", body_html)
        pg.click("#tbPersonalize")                                               # personalize on -> roster shows
        pg.wait_for_selector(".merge-roster .mr-row", timeout=6000)
        return pg.evaluate("""()=>Array.from(document.querySelectorAll('.merge-roster .mr-row')).map(function(li){
          return { greet:(li.querySelector('.mr-greet')||{}).textContent||'', noname:li.classList.contains('mr-noname') }; })""")

    en = roster_greets("Hi,")
    ck("the roster shows every recipient (3 rows)", len(en)==3, en)
    ck("EN body: the named recipients merge, the nameless one falls back cleanly",
       [r["greet"] for r in en]==["Hi Basel,","Hi ليّا,","Hi,"], en)
    ck("the nameless recipient is flagged, not invented", any(r["noname"] for r in en) and en[2]["noname"], en)

    # toggle off then an Arabic body
    pg.click("#esubject"); pg.click("#tbPersonalize")
    ar = roster_greets("مرحبا،")
    ck("AR body: greetings merge in Arabic, nameless falls back to a clean Arabic greeting",
       [r["greet"] for r in ar]==["مرحبا Basel،","مرحبا ليّا،","مرحبا،"], ar)

    ck("still nothing sent from the roster screen (no mail rows for camp1)",
       pg.evaluate("()=>window.getMailLog().filter(function(m){return m&&m.opp==='camp1';}).length")==0)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL PERSONALIZE MERGE CHECKS PASS"))
raise SystemExit(1 if fails else 0)
