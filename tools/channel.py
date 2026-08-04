"""WO-013 phase 3: channel first, then the message.

The Outreach tab opened on a row of send-from options, and one of them rendered as [.] because
its label was a literal ".". That is the second question asked before the first. At that moment
the only thing that matters is whether this is going by email or through one of their own
channels, and everything after it follows from the answer.

Run it: python3 tools/channel.py
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

# Three records, each exercising a different answer to the one question.
SEED = """()=>{ const now=Date.now();
 localStorage.setItem('thrive_opps_v1', JSON.stringify([
  { slug:'tier-a', business:'Tier A Co', published:true, up:now,
    contact_tier:'A', channel:{kind:'email', to:'owner@tiera.example'},
    outreach_text:'Hello, I built you a page. See [LINK] when you have a minute.',
    descriptor:'a bakery in Jeddah' },
  { slug:'web-form', business:'Wise Butterfly', published:true, up:now,
    contact_tier:'B', channel:{kind:'web_form', to:'https://wise.example/contact'},
    channel_alternates:[{channel:'instagram', url:'https://instagram.com/wise'}],
    outreach_text:'Hello, I built you a page. It is here and it is yours.',
    descriptor:'a florist in Riyadh' },
  { slug:'still-link', business:'Broken Co', published:true, up:now,
    contact_tier:'B', channel:{kind:'web_form', to:'https://broken.example/c'},
    outreach_text:'Have a look at [LINK] please.' },
  { slug:'no-way', business:'Nobody Co', published:true, up:now,
    contact_tier:'C', channel:{kind:'', to:''} }
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
        pg.fill("#gateInput", "ConThrive2030")
        pg.click(".gate-btn")
        pg.wait_for_timeout(1400)
    pg.evaluate(SEED)
    pg.reload()
    pg.wait_for_timeout(3000)
    return ctx, pg, errs


def open_outreach(pg, slug):
    pg.evaluate("()=>location.hash='#board'")
    pg.wait_for_timeout(1300)
    pg.click(f".tok[data-slug='{slug}']")
    pg.wait_for_timeout(1300)
    pg.click("#modalTabs [data-tab='outreach']")
    pg.wait_for_timeout(1200)


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx, pg, errs = session(b)

    # ---- the tab opens on the question ---------------------------------------
    open_outreach(pg, "web-form")
    ck("the tab opens on the channel question, not on send options",
       pg.eval_on_selector_all("#modalOutreach .och-grid", "e=>e.length") == 1)
    ck("and the composer is not adopted before the question is answered",
       pg.eval_on_selector("#modalBorrow", "e=>e.hidden") is True
       if pg.query_selector("#modalBorrow") else True)
    txt = pg.eval_on_selector("#modalOutreach", "e=>e.innerText")
    ck("the question is asked in words", "How are you reaching them" in txt, txt[:200])

    # ---- email is offered only with a Tier A address ------------------------
    cards = pg.eval_on_selector_all("#modalOutreach .och-card",
                                    "e=>e.map(x=>({t:x.innerText, off:x.classList.contains('is-off'), p:x.dataset.path||''}))")
    email = [c for c in cards if "email" in c["t"].lower() or "By email" in c["t"]]
    ck("email is present but not offered when there is no Tier A address",
       email and email[0]["off"] is True, cards)
    # Either reason is correct; what matters is that it gives one rather than
    # showing a dead control with no explanation.
    ck("and it says why",
       "Tier A" in email[0]["t"] or "No address" in email[0]["t"], email[0]["t"])
    chan = [c for c in cards if c["p"] in ("web_form", "instagram")]
    ck("the channels come from the opportunity's own manifest data",
       sorted(c["p"] for c in chan) == ["instagram", "web_form"], cards)
    ck("and each one names its destination",
       all("http" in c["t"] for c in chan), chan)

    # ---- no label is ever empty ---------------------------------------------
    ck("no control on this tab renders an empty label",
       pg.evaluate("""()=>[...document.querySelectorAll('#modalOutreach button, #modalOutreach option')]
         .every(e=>e.textContent.replace(/[\\s.\\u00b7\\u2013\\u2014_-]/g,'').length>0)"""))

    # ---- choosing a channel ---------------------------------------------------
    pg.click("#modalOutreach [data-path='web_form']")
    pg.wait_for_timeout(1300)
    ck("choosing a channel opens the channel screen",
       pg.eval_on_selector_all("#modalOutreach #ocBody", "e=>e.length") == 1)
    ck("the outreach text is prefilled and editable",
       pg.eval_on_selector("#ocBody", "e=>e.value").startswith("Hello, I built"))
    ck("the link card is there",
       pg.eval_on_selector_all("#modalOutreach .link-card", "e=>e.length") == 1)
    lc = pg.eval_on_selector("#modalOutreach .link-card", "e=>e.innerText")
    ck("and it carries the title, a description and the URL",
       "Wise Butterfly" in lc and "florist" in lc and "/opp/web-form" in lc, lc[:200])
    ck("Go to their channel uses the manifest URL",
       "wise.example/contact" in pg.eval_on_selector_all(
           "#modalOutreach a[href]", "e=>e.map(x=>x.href).join(' ')"))

    # ---- the choice persists and the tab resumes ----------------------------
    ck("the choice is stored on the opportunity",
       pg.evaluate("""async ()=>{const o=(await mergedOpps()).find(x=>x.slug==='web-form');
         return o.outreach_path;}""") == "web_form")
    pg.click("#modalTabs [data-tab='overview']")
    pg.wait_for_timeout(700)
    pg.click("#modalTabs [data-tab='outreach']")
    pg.wait_for_timeout(1100)
    ck("returning to the tab resumes rather than asking again",
       pg.eval_on_selector_all("#modalOutreach .och-grid", "e=>e.length") == 0
       and pg.eval_on_selector_all("#modalOutreach #ocBody", "e=>e.length") == 1)

    # ---- changing the channel keeps what was written -----------------------
    pg.fill("#ocBody", "I rewrote this before sending it.")
    pg.wait_for_timeout(300)
    pg.click("#ochChange")
    pg.wait_for_timeout(1100)
    ck("Change how you reach them asks again",
       pg.eval_on_selector_all("#modalOutreach .och-grid", "e=>e.length") == 1)
    pg.click("#modalOutreach [data-path='instagram']")
    pg.wait_for_timeout(1200)
    ck("and the stored outreach text survives the change",
       pg.eval_on_selector("#ocBody", "e=>e.value").startswith("Hello, I built"))
    ck("the new channel is the one now shown",
       "instagram.com/wise" in pg.eval_on_selector_all(
           "#modalOutreach a[href]", "e=>e.map(x=>x.href).join(' ')"))

    # ---- the body stored is the body as edited, byte for byte --------------
    pg.fill("#ocBody", "This is exactly what I sent, word for word.")
    pg.fill("#ocNote", "sent through the DM")
    pg.click("#ocDo")
    pg.wait_for_timeout(1500)
    rec = pg.evaluate("""async ()=>{const o=(await mergedOpps()).find(x=>x.slug==='web-form');
      const c=(o.manual_contacts||[])[0]||{};
      return {body:c.body, ch:c.channel, note:c.note, stage:ThriveLifecycle.stageOf(o)};}""")
    ck("the body stored is the body as edited, byte for byte",
       rec["body"] == "This is exactly what I sent, word for word.", rec)
    ck("with its channel", rec["ch"] == "instagram", rec)
    ck("and its note", rec["note"] == "sent through the DM", rec)
    ck("and the card moved", rec["stage"] == "sent", rec)

    pg.keyboard.press("Escape"); pg.wait_for_timeout(700)

    # ---- the email path ------------------------------------------------------
    open_outreach(pg, "tier-a")
    cards = pg.eval_on_selector_all("#modalOutreach .och-card",
                                    "e=>e.map(x=>({t:x.innerText, off:x.classList.contains('is-off'), p:x.dataset.path||''}))")
    em = [c for c in cards if c["p"] == "email"]
    ck("email is offered when a Tier A address exists", len(em) == 1, cards)
    ck("and it says the address", "owner@tiera.example" in em[0]["t"], em[0]["t"])
    pg.click("#modalOutreach [data-path='email']")
    pg.wait_for_timeout(1800)
    ck("choosing email adopts the composer",
       pg.eval_on_selector_all("#view-compose:not([hidden])", "e=>e.length") == 1)
    ck("and the link card is shown above it, the same component",
       pg.eval_on_selector_all("#modalOutreach .link-card", "e=>e.length") == 1)
    pre = pg.evaluate("""()=>({to:(document.getElementById('eto')||{}).value,
      name:(document.getElementById('ename')||{}).value,
      subj:(document.getElementById('esubject')||{}).value,
      body:(document.getElementById('ebody')||{}).innerText||''})""")
    ck("the composer is prefilled with the recipient", pre["to"] == "owner@tiera.example", pre)
    ck("and with the recipient name", pre["name"] == "Tier A Co", pre)
    ck("and the outreach text is the body", "I built you a page" in pre["body"], pre)
    ck("and the page link is already substituted for [LINK]",
       "/opp/tier-a" in pre["body"] and "[LINK]" not in pre["body"], pre)

    # ---- the [LINK] guard stays ---------------------------------------------
    pg.keyboard.press("Escape"); pg.wait_for_timeout(700)
    open_outreach(pg, "still-link")
    pg.click("#modalOutreach [data-path='web_form']")
    pg.wait_for_timeout(1200)
    ck("copy is blocked while the literal placeholder is still in the text",
       pg.eval_on_selector("#ocCopy", "e=>e.disabled") is True)
    ck("and it says why",
       "[LINK]" in pg.eval_on_selector("#modalOutreach", "e=>e.innerText"))

    # ---- no channel at all: it says so rather than offering nothing --------
    pg.keyboard.press("Escape"); pg.wait_for_timeout(700)
    open_outreach(pg, "no-way")
    txt = pg.eval_on_selector("#modalOutreach", "e=>e.innerText")
    ck("an opportunity with no channel says so", "no channel" in txt, txt[:250])
    ck("and still renders no empty label",
       pg.evaluate("""()=>[...document.querySelectorAll('#modalOutreach button')]
         .every(e=>e.textContent.trim().length>0)"""))

    ck("nothing threw", not errs, errs[:3])
    ctx.close()

    # ---- Arabic, at the width Thyab holds -----------------------------------
    ctx, pg, errs = session(b, "ar", 390)
    open_outreach(pg, "web-form")
    txt = pg.eval_on_selector("#modalOutreach", "e=>e.innerText")
    ck("the question is asked in Arabic", "كيف ستصل إليهم" in txt, txt[:200])
    ck("no Arabic on this tab carries letter-spacing",
       pg.evaluate("""()=>[...document.querySelectorAll('#modalOutreach *')]
         .filter(e=>e.children.length===0 && /[\\u0600-\\u06FF]/.test(e.textContent))
         .every(e=>{const ls=getComputedStyle(e).letterSpacing; return ls==='normal'||ls==='0px';})"""))
    ck("nothing overflows sideways at 390",
       pg.evaluate("()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1"))
    ck("and no choice card truncates its Arabic label",
       pg.evaluate("""()=>[...document.querySelectorAll('#modalOutreach .och-t')]
         .every(e=>e.scrollWidth<=e.clientWidth+1)"""))
    ck("nothing threw in Arabic", not errs, errs[:3])
    ctx.close()

    b.close()

httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
