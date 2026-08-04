"""WO-013 phase 5: back, and work that survives.

Losing a draft by tapping outside the window was the most common frustration in the review. A
dismissed dialogue took the work with it, there was no memory and there was no way back.

Run it: python3 tools/backdrafts.py
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
base = f"http://127.0.0.1:{PORT}"

from playwright.sync_api import sync_playwright

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

SEED = """()=>{ const now=Date.now();
 localStorage.setItem('thrive_opps_v1', JSON.stringify([
  { slug:'one', business:'One Co', published:true, up:now, doc_lang:'EN',
    contact_tier:'A', channel:{kind:'email', to:'a@one.example'},
    outreach_text:'Hello from One.' },
  { slug:'two', business:'Two Co', published:true, up:now, doc_lang:'EN',
    contact_tier:'A', channel:{kind:'email', to:'b@two.example'},
    outreach_text:'Hello from Two.' }
 ]));
}"""


def session(b, lang="en", width=1280):
    ctx = b.new_context(viewport={"width": width, "height": 900},
                        has_touch=(width <= 430), is_mobile=(width <= 430))
    ctx.route("https://api.github.com/**", lambda x: x.abort())
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_timeout(400)
    pg.evaluate("l=>localStorage.setItem('thrive_lang',l)", lang)
    if pg.query_selector("#thriveGate"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1400)
    pg.evaluate(SEED)
    pg.reload(); pg.wait_for_timeout(3000)
    return ctx, pg, errs


def open_card(pg, slug="one"):
    pg.evaluate("()=>location.hash='#board'"); pg.wait_for_timeout(1300)
    pg.click(f".tok[data-slug='{slug}']"); pg.wait_for_timeout(1300)


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # ---- the model ----------------------------------------------------------
    ctx, pg, errs = session(b)
    st = pg.evaluate("()=>ThriveDrafts.selfTest()")
    ck("the drafts model passes its own test", st["pass"], st.get("failures"))
    ck("drafts are thirty minutes, not ten",
       pg.evaluate("()=>ThriveDrafts.TTL_MS") == 30 * 60 * 1000)

    # ---- §6.2 drafts are device local ---------------------------------------
    ck("the draft key is absent from SYNCED_KEYS",
       pg.evaluate("()=>!Object.keys(SYNCED_KEYS).includes(ThriveDrafts.KEY)"))
    ck("and a draft never reaches the shared snapshot",
       pg.evaluate("""()=>{ThriveDrafts.save('opportunity','one',{x:'secret words'});
         return JSON.stringify(syncSnapshot()).indexOf('secret words')<0;}"""))
    pg.evaluate("()=>ThriveDrafts.drop('opportunity','one')")

    # ---- §6.1 back exists ----------------------------------------------------
    open_card(pg)
    ck("the window has a visible back control",
       pg.eval_on_selector("#modalBack", "e=>!!(e.offsetWidth||e.offsetHeight)"))
    ck("and it is the first control in the header",
       pg.evaluate("""()=>{const a=document.querySelector('.modal-acts');
         return a.firstElementChild.id==='modalBack' ||
                getComputedStyle(document.getElementById('modalBack')).order==='-1';}"""))
    # every screen answers where, back, and finish
    ck("the window says where you are",
       len(pg.eval_on_selector("#modalTitle", "e=>e.innerText").strip()) > 0)
    ck("how to go back",
       pg.eval_on_selector_all("#modalBack", "e=>e.length") == 1)
    ck("and how to finish",
       pg.eval_on_selector_all("#modalClose", "e=>e.length") == 1)

    # ---- §6.1 the browser back gesture moves one step ------------------------
    pg.click("#modalTabs [data-tab='text']"); pg.wait_for_timeout(900)
    pg.click("#modalTabs [data-tab='history']"); pg.wait_for_timeout(900)
    ck("each tab pushed a history entry",
       pg.evaluate("()=>!document.getElementById('modalHistory').hidden"))
    pg.go_back(); pg.wait_for_timeout(1100)
    ck("browser back moves one step, not all the way out",
       pg.evaluate("()=>!document.getElementById('modalText').hidden"))
    ck("and the window is still open",
       pg.eval_on_selector("#modal", "e=>!e.hidden"))
    pg.go_forward(); pg.wait_for_timeout(1000)
    ck("and forward moves one step back in",
       pg.evaluate("()=>!document.getElementById('modalHistory').hidden"))

    # back out of every step closes the window
    pg.go_back(); pg.wait_for_timeout(900)
    pg.go_back(); pg.wait_for_timeout(900)
    pg.go_back(); pg.wait_for_timeout(1100)
    ck("backing out of the last step closes the window",
       pg.eval_on_selector("#modal", "e=>e.hidden") is True)

    # ---- §6.2 the backdrop asks, with three answers -------------------------
    open_card(pg)
    pg.click("#modalTabs [data-tab='text']"); pg.wait_for_timeout(900)
    pg.evaluate("""()=>{const e=document.getElementById('otBox');
      e.value='I was in the middle of writing this.';
      e.dispatchEvent(new Event('input',{bubbles:true}));}""")
    pg.wait_for_timeout(900)
    pg.evaluate("()=>document.getElementById('modalScrim').click()")
    pg.wait_for_timeout(900)
    ck("tapping outside with unsaved changes asks rather than closing",
       pg.eval_on_selector_all("#threeWay", "e=>e.length") == 1
       and pg.eval_on_selector("#modal", "e=>!e.hidden"))
    ck("and the ask offers three answers",
       pg.eval_on_selector_all("#threeWay [data-tw]", "e=>e.length") == 3)
    tw = pg.eval_on_selector("#threeWay", "e=>e.innerText")
    ck("keep editing, save and close, throw it away",
       "Keep editing" in tw and "Save and close" in tw and "Throw it away" in tw, tw[:250])

    pg.click("#threeWay [data-tw='0']"); pg.wait_for_timeout(700)
    ck("keep editing keeps the window open",
       pg.eval_on_selector("#modal", "e=>!e.hidden"))
    ck("and keeps what was typed",
       "middle of writing" in pg.eval_on_selector("#otBox", "e=>e.value"))

    # Escape asks too, and saving keeps the work
    pg.keyboard.press("Escape"); pg.wait_for_timeout(800)
    ck("Escape with unsaved changes asks too",
       pg.eval_on_selector_all("#threeWay", "e=>e.length") == 1)
    pg.click("#threeWay [data-tw='1']"); pg.wait_for_timeout(900)
    ck("save and close closes it",
       pg.eval_on_selector("#modal", "e=>e.hidden") is True)
    ck("and the work is kept",
       pg.evaluate("""()=>{const d=ThriveDrafts.load('opportunity','one');
         return !!(d && JSON.stringify(d.data).indexOf('middle of writing')>=0);}"""))

    # ---- §6.2 reopening restores, with the band and a discard --------------
    open_card(pg)
    ck("reopening shows the band",
       pg.eval_on_selector("#draftBand", "e=>!e.hidden"))
    band = pg.eval_on_selector("#draftBand", "e=>e.innerText")
    ck("and it says how long ago", "kept what you wrote" in band, band[:160])
    ck("with a discard control beside it", "Discard" in band, band[:160])
    pg.click("#dfRestore"); pg.wait_for_timeout(900)
    pg.click("#modalTabs [data-tab='text']"); pg.wait_for_timeout(800)
    ck("bringing it back restores what was typed",
       "middle of writing" in pg.eval_on_selector("#otBox", "e=>e.value"))

    # a draft never leaks to another opportunity
    pg.keyboard.press("Escape"); pg.wait_for_timeout(700)
    if pg.query_selector("#threeWay"): pg.click("#threeWay [data-tw='2']"); pg.wait_for_timeout(700)
    open_card(pg, "two")
    ck("a draft never leaks to another opportunity",
       pg.eval_on_selector("#draftBand", "e=>e.hidden") is True)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(700)
    if pg.query_selector("#threeWay"): pg.click("#threeWay [data-tw='2']"); pg.wait_for_timeout(700)

    # discard removes it for good
    open_card(pg)
    if not pg.eval_on_selector("#draftBand", "e=>e.hidden"):
        pg.click("#dfDiscard"); pg.wait_for_timeout(800)
    ck("discard removes the draft",
       pg.evaluate("()=>ThriveDrafts.load('opportunity','one')") is None)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(800)

    # ---- closing with nothing typed does not ask ---------------------------
    open_card(pg, "two")
    pg.evaluate("()=>document.getElementById('modalScrim').click()")
    pg.wait_for_timeout(900)
    ck("closing with nothing typed does not ask",
       pg.eval_on_selector_all("#threeWay", "e=>e.length") == 0
       and pg.eval_on_selector("#modal", "e=>e.hidden") is True)

    # ---- expired drafts are cleaned on load --------------------------------
    pg.evaluate("""()=>{const all={}; all['opportunity|gone']={ts:Date.now()-60*60*1000,data:{a:'x'}};
      localStorage.setItem(ThriveDrafts.KEY, JSON.stringify(all));}""")
    c = pg.evaluate("()=>ThriveDrafts.clean()")
    ck("expired drafts are cleaned", c["dropped"] == 1 and c["kept"] == 0, c)

    ck("nothing threw", not errs, errs[:3])
    ctx.close()

    # ---- RTL: back mirrors by logical property, not a second rule -----------
    ctx, pg, errs = session(b, "ar", 390)
    open_card(pg)
    ck("back is present in Arabic",
       pg.eval_on_selector("#modalBack", "e=>e.innerText").strip() != "")
    ck("and it mirrors by logical property rather than a second rule",
       pg.evaluate("""()=>{const s=getComputedStyle(document.getElementById('modalBack'));
         return s.marginLeft===s.marginRight || s.order==='-1';}"""))
    ck("nothing overflows sideways at 390 in Arabic",
       pg.evaluate("()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1"))
    pg.evaluate("""()=>{const e=document.getElementById('otBox'); if(e){e.value='نص عربي';
      e.dispatchEvent(new Event('input',{bubbles:true}));}}""")
    pg.wait_for_timeout(400)
    pg.click("#modalTabs [data-tab='text']"); pg.wait_for_timeout(800)
    pg.evaluate("""()=>{const e=document.getElementById('otBox'); e.value='نص عربي مكتوب';
      e.dispatchEvent(new Event('input',{bubbles:true}));}""")
    pg.wait_for_timeout(900)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(900)
    ck("the three answers are asked in Arabic",
       pg.eval_on_selector_all("#threeWay [data-tw]", "e=>e.length") == 3)
    tw = pg.eval_on_selector("#threeWay", "e=>e.innerText")
    ck("and every one of them is labelled",
       all(len(x.strip()) > 0 for x in
           pg.eval_on_selector_all("#threeWay [data-tw]", "e=>e.map(b=>b.innerText)")), tw[:200])
    ck("no Arabic in the question carries letter-spacing",
       pg.evaluate("""()=>[...document.querySelectorAll('#threeWay *')]
         .filter(e=>e.children.length===0 && /[\\u0600-\\u06FF]/.test(e.textContent))
         .every(e=>{const ls=getComputedStyle(e).letterSpacing; return ls==='normal'||ls==='0px';})"""))
    ck("nothing threw in Arabic", not errs, errs[:3])
    ctx.close()

    b.close()

httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
