"""WO-013 phase 4: the editor earns its place.

Every item here removes a failure the team has actually hit. Nothing here schedules, sequences,
tests variants, or adds a tracking pixel: those change what Thrive is.

Run it: python3 tools/editor.py
"""
import threading, http.server, socketserver, functools, os, sys, json, re

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
EP = f"{base}/exec"

from playwright.sync_api import sync_playwright

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

SENT = []
def relay(route):
    if route.request.method == "GET":
        return route.fulfill(status=200, body="Thrive relay v5 is running.")
    d = json.loads(route.request.post_data or "{}")
    if d.get("op"):
        return route.fulfill(status=200, body=json.dumps({"ok": True, "data": None, "events": [], "records": []}))
    SENT.append(d)
    return route.fulfill(status=200, body=json.dumps({"ok": True, "id": "re_1"}))

SEED = """()=>{ const now=Date.now();
 localStorage.setItem('thrive_opps_v1', JSON.stringify([
  { slug:'en-co', business:'English Co', published:true, up:now, doc_lang:'EN',
    contact_tier:'A', channel:{kind:'email', to:'owner@en.example'}, owner:'Sam Owner',
    outreach_subject:'English Co x Thrive',
    outreach_text:'Hello, I built you a page. See [LINK].', descriptor:'a studio' },
  { slug:'ar-co', business:'شركة عربية', published:true, up:now, doc_lang:'AR',
    contact_tier:'A', channel:{kind:'email', to:'owner@ar.example'},
    outreach_text:'مرحبًا، بنيت لك صفحة.', descriptor:'متجر' }
 ]));
}"""


def session(b, lang="en"):
    ctx = b.new_context(viewport={"width": 1280, "height": 950})
    ctx.route("**/exec", relay)
    ctx.route("**/library/sync.json",
              lambda x: x.fulfill(status=200, body=json.dumps({"ep": EP, "up": 1})))
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


def open_compose(pg, slug):
    pg.evaluate("()=>location.hash='#board'"); pg.wait_for_timeout(1300)
    pg.click(f".tok[data-slug='{slug}']"); pg.wait_for_timeout(1300)
    pg.click("#modalTabs [data-tab='outreach']"); pg.wait_for_timeout(1200)
    if pg.query_selector("#modalOutreach [data-path='email']"):
        pg.click("#modalOutreach [data-path='email']"); pg.wait_for_timeout(1800)


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx, pg, errs = session(b)
    open_compose(pg, "en-co")

    # The three panels are disclosures, so they are opened the way a person does.
    for d in ("#sigWrap", "#plainWrap"):
        pg.evaluate("(sel)=>{const e=document.querySelector(sel); if(e) e.open=true;}", d)
    pg.wait_for_timeout(500)

    # ---- §5.1 the closing block is a real object ---------------------------
    ck("the closing block is on screen and editable",
       pg.eval_on_selector_all("#sigBox", "e=>e.length") == 1)
    ck("and it says which saved block is in use",
       "English" in pg.eval_on_selector("#sigLoc", "e=>e.innerText"),
       pg.eval_on_selector("#sigLoc", "e=>e.innerText"))

    pg.click("#prevWrap summary"); pg.wait_for_timeout(900)
    fr = pg.frame_locator("#cmpPreview")
    body_txt = fr.locator("body").inner_text()
    ck("the preview shows the whole message as the recipient sees it",
       "I built you a page" in body_txt, body_txt[:200])
    ck("including the closing block", "thriveiii.com" in body_txt, body_txt[:250])
    ck("and including the link card", "English Co" in body_txt, body_txt[:250])

    # editable for this message only, without changing the stored block
    pg.fill("#sigBox", "Just for this one\nnothing saved")
    pg.wait_for_timeout(900)
    body_txt = fr.locator("body").inner_text()
    ck("editing it changes this message", "Just for this one" in body_txt, body_txt[:250])
    ck("and does not change the saved block",
       pg.evaluate("()=>signatureFor('EN')").find("Just for this one") < 0,
       pg.evaluate("()=>signatureFor('EN')"))

    pg.click("#sigSave"); pg.wait_for_timeout(700)
    ck("saving it stores it for that language",
       "Just for this one" in pg.evaluate("()=>signatureFor('EN')"))
    ck("and the other language is untouched",
       "Just for this one" not in pg.evaluate("()=>signatureFor('AR')"))

    # ---- §5.2 plain text ----------------------------------------------------
    pt = pg.eval_on_selector("#plainBox", "e=>e.value")
    ck("a plain text alternative is generated", "I built you a page" in pt, pt[:200])
    ck("and it carries no markup", "<" not in pt and ">" not in pt, pt[:200])
    ck("and it ends with the closing block", "Just for this one" in pt, pt[-120:])
    pg.fill("#plainBox", "I wrote this one by hand.")
    pg.wait_for_timeout(600)
    pg.fill("#esubject", "A new subject entirely")
    pg.wait_for_timeout(900)
    ck("an edited plain text is not overwritten by a later change",
       pg.eval_on_selector("#plainBox", "e=>e.value") == "I wrote this one by hand.")
    pg.click("#plainRegen"); pg.wait_for_timeout(700)
    ck("and generating again restores it from the message",
       "I built you a page" in pg.eval_on_selector("#plainBox", "e=>e.value"))

    # ---- §5.2 the subject meter --------------------------------------------
    pg.fill("#esubject", "Short one")
    pg.wait_for_timeout(700)
    m = pg.eval_on_selector("#subjMeter", "e=>e.innerText")
    ck("the subject meter counts characters", "9" in m, m)
    ck("and does not warn under 60", "truncate" not in m, m)
    pg.fill("#esubject", "x" * 75)
    pg.wait_for_timeout(700)
    m = pg.eval_on_selector("#subjMeter", "e=>e.innerText")
    ck("and warns past 60", "truncate" in m, m)
    ck("and marks itself", pg.eval_on_selector("#subjMeter", "e=>e.classList.contains('is-long')"))
    pg.fill("#esubject", "English Co x Thrive")
    pg.wait_for_timeout(600)

    # ---- §5.2 tokens preview resolved, unresolved blocks send --------------
    pg.evaluate("""()=>{document.getElementById('ebody').innerHTML='Hi {{NAME}}, about {{BIZ}}.';
                     document.getElementById('ebody').dispatchEvent(new Event('input',{bubbles:true}));}""")
    pg.wait_for_timeout(900)
    body_txt = fr.locator("body").inner_text()
    ck("tokens preview resolved, not as braces",
       "Sam Owner" in body_txt and "{{NAME}}" not in body_txt, body_txt[:250])

    pg.evaluate("""()=>{document.getElementById('ebody').innerHTML='Hi {{NOBODY}}.';
                     document.getElementById('ebody').dispatchEvent(new Event('input',{bubbles:true}));}""")
    pg.wait_for_timeout(900)
    ps = pg.eval_on_selector("#preSend", "e=>e.innerText")
    ck("an unresolved token is named in the checklist", "NOBODY" in ps, ps[:250])
    before = len(SENT)
    pg.click("#eSend"); pg.wait_for_timeout(1400)
    ck("and it blocks the send", len(SENT) == before, (before, len(SENT)))

    # ---- §5.2 the pre-send checklist is three lines ------------------------
    ck("the checklist is exactly three lines",
       pg.eval_on_selector_all("#preSend .ps-list li", "e=>e.length") == 3)
    ck("and it names all three things",
       all(w in ps for w in ("page link", "placeholder", "closing block")), ps[:300])

    # ---- §5.2 send to myself ------------------------------------------------
    pg.evaluate("""()=>{document.getElementById('ebody').innerHTML='Hi {{NAME}}, a clean message.';
                     document.getElementById('ebody').dispatchEvent(new Event('input',{bubbles:true}));}""")
    pg.wait_for_timeout(900)
    SENT.clear()
    quota_before = pg.evaluate("()=>quotaUsage().day")
    mail_before = pg.evaluate("()=>getMailLog().length")
    pg.click("#eSelf"); pg.wait_for_timeout(1600)
    ck("send to myself sends", len(SENT) == 1, SENT[:1])
    if SENT:
        ck("to hi@thriveiii.com", SENT[0].get("to") == "hi@thriveiii.com", SENT[0].get("to"))
        ck("with the exact composed message",
           "a clean message" in SENT[0].get("html", "") and "Sam Owner" in SENT[0].get("html", ""),
           SENT[0].get("html", "")[:200])
        ck("and its plain text alternative", "a clean message" in SENT[0].get("text", ""),
           SENT[0].get("text", "")[:160])
    ck("a proof copy does not spend the quota",
       pg.evaluate("()=>quotaUsage().day") == quota_before)
    ck("and does not enter the ledger",
       pg.evaluate("()=>getMailLog().length") == mail_before)

    # ---- a real send carries the composed html, text and the reply-to slug --
    SENT.clear()
    pg.click("#eSend"); pg.wait_for_timeout(2200)
    why = pg.evaluate("()=>{const t=document.getElementById('toast'); return t? t.innerText : '(no toast)';}")
    ck("a clean message sends", len(SENT) == 1, (SENT[:1], why))
    if SENT:
        ck("carrying the closing block", "Just for this one" in SENT[0].get("html", ""),
           SENT[0].get("html", "")[:200])
        ck("carrying the plain text alternative", bool(SENT[0].get("text")), SENT[0].keys())
        ck("and the slug the relay needs for the reply-to tag",
           SENT[0].get("slug") == "en-co", SENT[0].get("slug"))

    ck("nothing threw", not errs, errs[:3])
    ctx.close()

    # ---- §5.1 the block follows the DOCUMENT language, not the chrome ------
    ctx, pg, errs = session(b, "en")
    pg.evaluate("""()=>{ setSignature('EN','English sign off'); setSignature('AR','خاتمة عربية'); }""")
    pg.wait_for_timeout(400)
    open_compose(pg, "ar-co")
    pg.evaluate("()=>{const e=document.querySelector('#sigWrap'); if(e) e.open=true;}")
    pg.wait_for_timeout(400)
    ck("an Arabic document uses the Arabic block under English chrome",
       "خاتمة عربية" in pg.eval_on_selector("#sigBox", "e=>e.value"),
       pg.eval_on_selector("#sigBox", "e=>e.value"))
    ck("and the panel says which one it is using",
       "العربية" in pg.eval_on_selector("#sigLoc", "e=>e.innerText"),
       pg.eval_on_selector("#sigLoc", "e=>e.innerText"))
    ck("nothing threw on the Arabic document", not errs, errs[:3])
    ctx.close()

    b.close()

httpd.shutdown()

# ---- §5.3, asserted as an absence ------------------------------------------
src = ""
for f in ("library/app.js", "library/compose.html", "library/i18n.js"):
    with open(os.path.join(ROOT, f), encoding="utf-8") as fh:
        src += fh.read()
# The prose that says these were NOT built is not an implementation of them, so the
# one comment naming them is excluded before the source is judged.
src = re.sub(r"/\*[\s\S]*?\*/", "", src)
banned = {
    "scheduling": r"scheduleSend|sendLater|sendAt\b|cron",
    "sequences": r"sequenceStep|followUpSequence|drip",
    "A/B testing": r"variantA|abTest|splitTest",
    "tracking pixels": r"trackingPixel|openPixel|<img[^>]*width=\"1\"[^>]*height=\"1\"",
}
found = [k for k, r in banned.items() if re.search(r, src, re.I)]
ck("nothing from §5.3 was built", not found, found)

print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
