"""WO-002 layer 3: render quality for the centred opportunity window.

Six shots, three widths in each direction, with the window open on a real opportunity. It asserts
what a screenshot cannot: that the document never scrolls sideways, that the margins are equal,
that the window respects 88vh, that only its body scrolls, and that below 720 it is a sheet on
the bottom edge rather than a centred card.

Run it: python3 tools/wo002-render.py
Shots land in shots/wo002/.
"""
import threading, http.server, socketserver, functools, os, sys, json

os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
OUT = os.path.join(ROOT, "shots", "wo002")
os.makedirs(OUT, exist_ok=True)

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
        if d is not None: print("      " + str(d)[:300])

WIDTHS = (390, 1024, 1440)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    for lang in ("en", "ar"):
        for w in WIDTHS:
            tag = f"{lang}/{w}"
            ctx = b.new_context(viewport={"width": w, "height": 900},
                                has_touch=(w <= 430), is_mobile=(w <= 430))
            ctx.route("https://api.github.com/**", lambda r: r.abort())
            pg = ctx.new_page()
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto(f"{base}/library/console.html")
            pg.wait_for_function("()=>typeof window.mergedOpps==='function'", timeout=15000)
            pg.evaluate("l=>localStorage.setItem('thrive_lang',l)", lang)
            pg.reload()
            pg.wait_for_function("()=>typeof window.mergedOpps==='function'", timeout=15000)
            # WO-026 harness refresh: the password gate no longer clears via the UI fill in the sandbox and
            # the fill hung the harness for 30s. The gate is not the subject; the board renders regardless,
            # so reveal the content by dropping gate-locked. Every render/geometry assertion is unchanged.
            pg.evaluate("()=>{ document.documentElement.classList.remove('gate-locked'); const g=document.getElementById('thriveGate'); if(g) g.remove(); document.body.style.overflow=''; }")
            pg.wait_for_timeout(1200)
            pg.evaluate("()=>location.hash='#board'")
            pg.wait_for_timeout(1600)

            tok = pg.query_selector(".tok[data-slug]")
            if not tok:
                ck(f"{tag}: there is a card to open", False)
                ctx.close()
                continue
            # Open by the card's own control (the .tok-open button), which is what a finger lands on. A real
            # click focuses that button, so the window records it as the opener and focus returns to it on
            # close, the behaviour the focus assertions below check.
            pg.click(".tok[data-slug] .tok-open")
            pg.wait_for_timeout(1400)

            geo = pg.evaluate("""()=>{const m=document.getElementById('modal');
              const r=m.getBoundingClientRect();
              const b=document.getElementById('modalBody');
              const h=document.querySelector('.modal-head');
              return {left:r.left, right:innerWidth-r.right, top:r.top, bottom:innerHeight-r.bottom,
                      width:r.width, height:r.height, vw:innerWidth, vh:innerHeight,
                      bodyScroll:getComputedStyle(b).overflowY,
                      headScroll:getComputedStyle(h).overflowY,
                      docW:document.documentElement.scrollWidth,
                      cliW:document.documentElement.clientWidth};}""")
            print(f"  {tag}: {json.dumps(geo)}")

            ck(f"{tag}: the document never scrolls sideways", geo["docW"] <= geo["cliW"] + 1,
               (geo["docW"], geo["cliW"]))
            ck(f"{tag}: the inline margins are equal", abs(geo["left"] - geo["right"]) <= 2,
               (geo["left"], geo["right"]))
            ck(f"{tag}: only the body scrolls",
               geo["bodyScroll"] == "auto" and geo["headScroll"] != "auto",
               (geo["bodyScroll"], geo["headScroll"]))
            if w > 720:
                ck(f"{tag}: it is centred on the block axis too",
                   abs(geo["top"] - geo["bottom"]) <= 2, (geo["top"], geo["bottom"]))
                ck(f"{tag}: it never exceeds 88vh", geo["height"] <= geo["vh"] * 0.881,
                   (geo["height"], geo["vh"]))
                ck(f"{tag}: width is min(920, 92vw)",
                   abs(geo["width"] - min(920, geo["vw"] * 0.92)) <= 2, geo["width"])
            else:
                # a sheet on the bottom edge, same header and same tabs
                ck(f"{tag}: it sits on the bottom edge", geo["bottom"] <= 1, geo["bottom"])
                ck(f"{tag}: it is a full height sheet", geo["height"] >= geo["vh"] * 0.9,
                   (geo["height"], geo["vh"]))
                # Overview, Text, Page, Outreach, History, and the open team Discussion.
                ck(f"{tag}: the sheet keeps the same six tabs",
                   pg.eval_on_selector_all("#modalTabs .modal-tab", "e=>e.length") == 6)

            ck(f"{tag}: nothing overflows its own container", pg.evaluate(
                """()=>{const m=document.getElementById('modal');
                  const r=m.getBoundingClientRect();
                  return [...m.querySelectorAll('*')].every(e=>{
                    const q=e.getBoundingClientRect();
                    if(!q.width && !q.height) return true;
                    return q.left>=r.left-1 && q.right<=r.right+1;});}"""))
            ck(f"{tag}: nothing threw", not errs, errs[:2])

            pg.screenshot(path=os.path.join(OUT, f"modal-{lang}-{w}.png"))

            # The Text tab is the one the acceptance list names in both languages, so it is
            # photographed rather than only asserted. One width is enough for an empty state.
            if w == 1024:
                pg.click("#modalTabs [data-tab='text']")
                pg.wait_for_timeout(800)
                # The rule is about the empty state, not about everything that shares its
                # panel. Scoped to .mw-empty and tightened: exactly one icon, exactly one
                # sentence, and nothing operable inside it.
                ck(f"{tag}: the text empty state is one icon, one sentence, no action",
                   pg.eval_on_selector("#modalText .mw-empty",
                     "e=>e.querySelectorAll('svg').length===1 && e.querySelectorAll('p').length===1 "
                     "&& e.querySelectorAll('button,a,input,textarea,select').length===0"))
                ck(f"{tag}: the icon is 32px and dimmed to 40%", pg.eval_on_selector(
                   "#modalText .mw-empty svg",
                   "e=>{const r=e.getBoundingClientRect();"
                   "return Math.round(r.width)===32 && Math.abs(parseFloat(getComputedStyle(e).opacity)-0.4)<0.01;}"))
                pg.screenshot(path=os.path.join(OUT, f"text-tab-{lang}.png"))
                pg.click("#modalTabs [data-tab='overview']")
                pg.wait_for_timeout(600)

            # The behaviours that need one width, not six. Run on the widest English pass.
            if lang == "en" and w == 1440:
                # the clipboard, and its fallback. Chromium is not Safari, but a fallback that
                # cannot run at all here will not run there either.
                ctx.grant_permissions(["clipboard-read", "clipboard-write"])
                ck("copy link is offered for a published opportunity",
                   pg.eval_on_selector("#modalCopy", "e=>!e.disabled"))
                pg.click("#modalCopy")
                pg.wait_for_timeout(700)
                ck("and it puts the opportunity's own URL on the clipboard",
                   "/opp/" in pg.evaluate("()=>navigator.clipboard.readText()"))
                ck("the fallback path copies on its own, without the clipboard API",
                   pg.evaluate("""()=>{const before=document.body.childElementCount;
                     const ok=(function(text){
                       try{ const ta=document.createElement('textarea');
                         ta.value=text; ta.setAttribute('readonly','');
                         ta.className='mw-offscreen'; document.body.appendChild(ta);
                         ta.select(); ta.setSelectionRange(0,text.length);
                         const r=document.execCommand('copy'); ta.remove(); return !!r;
                       }catch(e){ return false; }})('probe');
                     return ok && document.body.childElementCount===before;}"""))

                # backdrop click closes, and focus goes back to the card that opened it
                opened_from = pg.evaluate("()=>document.querySelector('.tok[data-slug]').dataset.slug")
                pg.evaluate("()=>document.getElementById('modalScrim').click()")
                pg.wait_for_timeout(900)
                ck("clicking the backdrop closes the window",
                   pg.eval_on_selector("#modal", "e=>e.hidden") is True)
                # Stricter than it was. The card is now a container whose control is the
                # button, so "focus is on an element carrying .tok" no longer describes the
                # right thing. What matters is that focus came back to the control of the
                # SPECIFIC card that opened the window, which the old assertion never checked.
                ck("and focus returns to the card that opened it",
                   pg.evaluate("""(slug)=>{const a=document.activeElement; if(!a) return false;
                     const c=a.closest && a.closest('.tok[data-slug]');
                     return !!(c && c.dataset.slug===slug && a.classList.contains('tok-open'));}""",
                               opened_from))
                ck("the body scrolls again once it is closed",
                   pg.evaluate("()=>getComputedStyle(document.body).position!=='fixed'"))

                # the scroll position survives opening and closing
                pg.evaluate("()=>window.scrollTo(0, 260)")
                pg.wait_for_timeout(400)
                was = pg.evaluate("()=>Math.round(window.scrollY)")
                pg.click(".tok[data-slug] .tok-open")
                pg.wait_for_timeout(1200)
                pg.keyboard.press("Escape")
                pg.wait_for_timeout(900)
                now = pg.evaluate("()=>Math.round(window.scrollY)")
                ck("the scroll position is put back on close", abs(now - was) <= 2, (was, now))
                ck("the close control closes it too", pg.evaluate(
                    """async ()=>{document.querySelector('.tok[data-slug] .tok-open').click();
                       await new Promise(r=>setTimeout(r,1200));
                       document.getElementById('modalClose').click();
                       await new Promise(r=>setTimeout(r,900));
                       return document.getElementById('modal').hidden===true;}"""))

            ctx.close()
    # A reader who asked for less motion keeps the fade and loses the travel. Asserted in a
    # context that actually reports the preference, not by reading the stylesheet.
    ctx = b.new_context(viewport={"width": 1280, "height": 900}, reduced_motion="reduce")
    ctx.route("https://api.github.com/**", lambda r: r.abort())
    pg = ctx.new_page()
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_function("()=>typeof window.mergedOpps==='function'", timeout=15000)
    pg.evaluate("()=>{ document.documentElement.classList.remove('gate-locked'); const g=document.getElementById('thriveGate'); if(g) g.remove(); document.body.style.overflow=''; }")
    pg.wait_for_timeout(1200)
    pg.evaluate("()=>location.hash='#board'"); pg.wait_for_timeout(1600)
    pg.click(".tok[data-slug] .tok-open"); pg.wait_for_timeout(1200)
    rm = pg.evaluate("""()=>{const m=document.getElementById('modal'), s=getComputedStyle(m);
      return {transform:s.transform, props:s.transitionProperty, dur:s.transitionDuration};}""")
    print("  reduced motion:", json.dumps(rm))
    ck("reduced motion drops the transform",
       rm["transform"] in ("none", "matrix(1, 0, 0, 1, 0, 0)"), rm)
    ck("reduced motion keeps an opacity fade",
       "opacity" in rm["props"] and "transform" not in rm["props"], rm)
    ck("and the fade is the quick duration", rm["dur"].startswith("0.16"), rm["dur"])
    ctx.close()

    b.close()

httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
print("shots in", OUT)
sys.exit(1 if fails else 0)
