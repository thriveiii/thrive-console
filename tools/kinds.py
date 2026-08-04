"""WO-013 phase 2: three kinds, one logic.

The review named a confusion that is structural, not cosmetic. A page template, a finished offer
and outreach text were handled through overlapping paths, so nobody could predict what uploading a
file would do.

This asserts the whole upload path in a browser, and it asserts it against the templates that
actually ship rather than against a syntax invented for the test.

Run it: python3 tools/kinds.py
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

from playwright.sync_api import sync_playwright

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

HEAD = '<!DOCTYPE html><html><head><title>A page</title>'
TPL_AR = (HEAD + '<meta name="thrive-kind" content="page-template">'
          '<meta name="thrive-locale" content="ar">'
          '<meta name="thrive-name" content="Daily Arabic">'
          '</head><body><h1>{{BIZ}}</h1><p>{{PROOF1}}{{PROOF2}}{{PROOF3}}{{WANT}}</p>'
          '<!--QUOTE_START--><q>{{QUOTE}}</q><cite>{{QUOTE_BY}}</cite><!--QUOTE_END-->'
          '</body></html>')
OFFER = (HEAD + '<meta name="thrive-kind" content="offer">'
         '<meta name="thrive-name" content="Real Co">'
         '</head><body><h1>Real Co</h1></body></html>')
BARE = HEAD + '</head><body><h1>{{BIZ}}</h1></body></html>'
NOFIELDS = (HEAD + '<meta name="thrive-kind" content="page-template">'
            '<meta name="thrive-locale" content="en"></head><body><h1>Done</h1></body></html>')
NOLOC = (HEAD + '<meta name="thrive-kind" content="page-template">'
         '</head><body>{{BIZ}}</body></html>')
ODD = (HEAD + '<meta name="thrive-kind" content="page-template">'
       '<meta name="thrive-locale" content="en"></head><body>{{BIZ}} {{FOOTNOTE}}</body></html>')
WRONGKIND = (HEAD + '<meta name="thrive-kind" content="brochure">'
             '</head><body>{{BIZ}}</body></html>')


def session(b, lang="en"):
    ctx = b.new_context(viewport={"width": 1280, "height": 900})
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
    pg.reload()
    pg.wait_for_timeout(2800)
    return ctx, pg, errs


def upload(pg, html, name):
    """Drive the real file picker. Playwright cannot synthesise a DataTransfer file drop, and the
    picker is the path that shares every line from readTpl onward."""
    pg.set_input_files("#tplFile", files=[{"name": name, "mimeType": "text/html",
                                           "buffer": html.encode("utf-8")}])
    pg.wait_for_timeout(900)


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # ---- the model, against the templates that actually ship -----------------
    ctx, pg, errs = session(b)
    st = pg.evaluate("()=>ThriveKinds.selfTest()")
    ck("the kinds model passes its own test", st["pass"], st.get("failures"))

    shipped = pg.evaluate("""async ()=>{const o={};
      for(const id of ['en-opp1','ar-opp1']){
        const h=await fetchTemplateHtml(id);
        o[id]={fields:ThriveKinds.fillableFields(h), quote:ThriveKinds.usesQuoteBlock(h),
               unknown:ThriveKinds.unknownFields(h)};
      } return o;}""")
    want = ["BIZ", "QUOTE", "QUOTE_BY", "PROOF1", "PROOF2", "PROOF3", "WANT"]
    ck("the shipped English template reads with the syntax it already uses",
       sorted(shipped["en-opp1"]["fields"]) == sorted(want), shipped["en-opp1"])
    ck("and the Arabic one reads identically",
       sorted(shipped["ar-opp1"]["fields"]) == sorted(want), shipped["ar-opp1"])
    ck("neither has a field the editor does not know",
       not shipped["en-opp1"]["unknown"] and not shipped["ar-opp1"]["unknown"], shipped)
    ck("the conditional quote block is part of the contract, and is read",
       shipped["en-opp1"]["quote"] and shipped["ar-opp1"]["quote"], shipped)

    # ---- the Library rule is where the question gets asked -------------------
    pg.evaluate("()=>location.hash='#templates'")
    pg.wait_for_timeout(1800)
    rule = pg.eval_on_selector(".lib-rule", "e=>e.innerText")
    ck("the Library rule is at the top of the Library",
       "only what gets reused" in rule, rule[:160])

    # ---- a declared page template lands in its own locale library -----------
    upload(pg, TPL_AR, "daily-ar.html")
    rep = pg.eval_on_selector("#tplReport", "e=>e.innerText")
    ck("a declared page template is read as one", "page template" in rep, rep[:200])
    ck("and its fields are shown before it is saved", "7 fields to fill" in rep, rep[:300])
    ck("and its locale is shown", "العربية" in rep or "Arabic" in rep, rep[:300])
    lang_sel = pg.eval_on_selector("#tpl_lang", "e=>e.value")
    ck("and the locale field is set from the declaration, not guessed", lang_sel == "AR", lang_sel)
    pg.click("#tplAdd")
    pg.wait_for_timeout(900)
    said = pg.eval_on_selector("#tplReport", "e=>e.innerText")
    ck("and the upload says where it went", "library" in said.lower(), said[:200])
    where = pg.evaluate("""()=>{const c=getCustomTemplates().find(x=>x.name==='Daily Arabic');
      return c? {loc:localeOf(c), fields:(c.fields||[]).length} : null;}""")
    ck("it is in the Arabic library", where and where["loc"] == "AR", where)
    ck("and it remembered its fields", where and where["fields"] == 7, where)

    # ---- a declared offer goes to the board, never the Library --------------
    pg.reload(); pg.wait_for_timeout(2600)
    pg.evaluate("()=>location.hash='#templates'"); pg.wait_for_timeout(1600)
    upload(pg, OFFER, "realco.html")
    rep = pg.eval_on_selector("#tplReport", "e=>e.innerText")
    ck("a declared offer is read as one", "finished offer" in rep, rep[:200])
    pg.click("#kdMakeOpp")
    pg.wait_for_timeout(1200)
    said = pg.eval_on_selector("#tplReport", "e=>e.innerText")
    ck("and the upload says where it went", "board" in said.lower(), said[:250])
    on = pg.evaluate("""()=>{const d=getDrafts().find(x=>x.business==='Real Co');
      const inLib=getCustomTemplates().some(x=>x.name==='Real Co');
      return d? {mode:d.mode, inLib:inLib} : null;}""")
    ck("it is an opportunity", on and on["mode"] == "upload", on)
    ck("and it is not in the Library", on and on["inLib"] is False, on)

    # ---- a file that declares nothing is ASKED about, never guessed ---------
    pg.reload(); pg.wait_for_timeout(2600)
    pg.evaluate("()=>location.hash='#templates'"); pg.wait_for_timeout(1600)
    upload(pg, BARE, "mystery.html")
    ck("an undeclared file triggers one question",
       pg.eval_on_selector_all("#tplReport .kd-ask", "e=>e.length") == 1)
    q = pg.eval_on_selector("#tplReport .kd-q", "e=>e.innerText")
    ck("and the question names the file", "mystery.html" in q, q)
    ck("and shows a preview",
       pg.eval_on_selector_all("#tplReport .kd-prev iframe", "e=>e.length") == 1)
    ck("and offers exactly two choices",
       pg.eval_on_selector_all("#tplReport [data-kd]", "e=>e.length") == 2)
    ck("and nothing was written while it was asking",
       pg.evaluate("()=>getCustomTemplates().length===1 && getDrafts().length===1"))
    # answering page-template on a file with no locale must still refuse
    pg.click("#tplReport [data-kd='page-template']")
    pg.wait_for_timeout(700)
    rep = pg.eval_on_selector("#tplReport", "e=>e.innerText")
    ck("answering does not skip the locale rule", "which library" in rep, rep[:250])

    # ---- the refusals ------------------------------------------------------
    for html, name, want_text, label in (
        (NOFIELDS, "done.html", "no fields to fill", "a page template with zero fields is refused"),
        (NOLOC, "noloc.html", "which library", "a page template with no locale is refused"),
        (WRONGKIND, "odd.html", "brochure", "an unknown kind is refused, and named"),
    ):
        pg.evaluate("()=>{const b=document.getElementById('tplReport'); if(b) b.innerHTML='';}")
        upload(pg, html, name)
        rep = pg.eval_on_selector("#tplReport", "e=>e.innerText")
        ck(label, want_text in rep, rep[:250])
        ck("  and it says so rather than saving it silently",
           pg.eval_on_selector_all("#tplReport .kd-said.bad", "e=>e.length") == 1)

    # ---- an unknown field is accepted, and named ---------------------------
    pg.evaluate("()=>{const b=document.getElementById('tplReport'); if(b) b.innerHTML='';}")
    upload(pg, ODD, "odd-field.html")
    rep = pg.eval_on_selector("#tplReport", "e=>e.innerText")
    ck("an unknown field does not refuse the template", "page template" in rep, rep[:250])
    ck("and it is named", "FOOTNOTE" in rep, rep[:300])
    ck("and it is called out as unknown", "does not know" in rep, rep[:300])

    # ---- adding without answering is refused --------------------------------
    pg.evaluate("()=>{const b=document.getElementById('tplReport'); if(b) b.innerHTML='';}")
    upload(pg, BARE, "mystery2.html")
    before = pg.evaluate("()=>getCustomTemplates().length")
    pg.click("#tplAdd")
    pg.wait_for_timeout(700)
    ck("a file nobody answered about cannot be added to the Library",
       pg.evaluate("()=>getCustomTemplates().length") == before)

    ck("nothing threw", not errs, errs[:3])
    ctx.close()

    # ---- the blank skeleton -------------------------------------------------
    ctx, pg, errs = session(b)
    pg.evaluate("()=>location.hash='#templates'")
    pg.wait_for_timeout(1800)
    ck("a blank skeleton is offered per locale",
       pg.eval_on_selector_all("#tplBlank [data-blank]", "e=>e.length") == 2)
    for loc in ("EN", "AR"):
        got = pg.evaluate("""async (loc)=>{
          const src = loc==='AR' ? 'ar-opp1' : 'en-opp1';
          const html = await fetchTemplateHtml(src);
          const blank = ThriveKinds.blankFrom(html, loc, 'Blank');
          const c = ThriveKinds.classify(blank, 'blank.html');
          return { kind:c.kind, locale:c.locale, fields:c.fields.length, ok:c.ok,
                   quote:c.quoteBlock, decls:(blank.match(/thrive-kind/g)||[]).length };}""", loc)
        ck(f"the {loc} blank is a working page template",
           got["ok"] and got["kind"] == "page-template", got)
        ck(f"  it declares the {loc} locale", got["locale"] == loc, got)
        ck("  it keeps every field", got["fields"] == 7, got)
        ck("  it keeps the conditional block", got["quote"] is True, got)
        ck("  and it declares itself exactly once", got["decls"] == 1, got)

    # ---- three kinds, three treatments --------------------------------------
    pg.evaluate("""()=>{ saveCustomTemplate({id:'p1',name:'A template',locale:'EN',lang:'EN',
                    html:'<body>{{BIZ}}{{WANT}}</body>'});
                   saveDraft({slug:'off1',business:'Offer Co',mode:'upload',html:'<h1>x</h1>',
                    published:false,up:Date.now()});
                   saveDraft({slug:'tpl1',business:'Template Co',template:'en-opp1',
                    published:false,up:Date.now(),outreach_text:'Hello there'}); }""")
    # A hash that is already current fires no change, so the view is re-entered by reloading.
    pg.reload()
    pg.wait_for_timeout(2600)
    pg.evaluate("()=>location.hash='#templates'")
    pg.wait_for_timeout(2000)
    # innerText reflects the rendered text-transform, so these compare case-insensitively:
    # the assertion is about what the card says, not about how the stylesheet cases it.
    card = pg.eval_on_selector(".tpl.kind-page", "e=>e.innerText").lower()
    ck("a page template card names its kind", "page template" in card, card[:200])
    ck("and always carries its field count", "field" in card, card[:200])
    ck("and always carries its locale", "english" in card, card[:200])
    ck("and carries the page symbol",
       pg.eval_on_selector_all(".tpl.kind-page .name .ic", "e=>e.length") >= 1)

    pg.evaluate("()=>location.hash='#board'")
    pg.wait_for_timeout(1800)
    ck("a finished offer is marked on the board",
       pg.eval_on_selector_all(".tok[data-slug='off1'] .tok-name .ic", "e=>e.length") == 1)
    ck("and an ordinary opportunity is not",
       pg.eval_on_selector_all(".tok[data-slug='tpl1'] .tok-name .ic", "e=>e.length") == 0)

    pg.click(".tok[data-slug='tpl1']")
    pg.wait_for_timeout(1300)
    pg.click("#modalTabs [data-tab='text']")
    pg.wait_for_timeout(800)
    ck("outreach text names its kind",
       "outreach text" in pg.eval_on_selector("#modalText", "e=>e.innerText"))
    ck("and is a block of content, never a form field",
       pg.eval_on_selector_all("#modalText .mw-sec > pre.mw-pitch", "e=>e.length") == 1)
    ck("and carries a copy control",
       pg.eval_on_selector_all("#modalText #otCopy", "e=>e.length") == 1)

    ck("nothing threw in the treatments walk", not errs, errs[:3])
    ctx.close()

    # ---- Arabic: the rule and the question both speak Arabic ----------------
    ctx, pg, errs = session(b, "ar")
    pg.evaluate("()=>location.hash='#templates'")
    pg.wait_for_timeout(1800)
    rule = pg.eval_on_selector(".lib-rule", "e=>e.innerText")
    ck("the Library rule is in Arabic too", "المكتبة" in rule, rule[:160])
    # Tracking breaks the cursive joins, so no Arabic on this page may carry it.
    ck("no Arabic on the Library page carries letter-spacing",
       pg.evaluate("""()=>[...document.querySelectorAll('#view-templates *, main *')]
         .filter(e=>e.children.length===0 && /[\\u0600-\\u06FF]/.test(e.textContent))
         .every(e=>{const ls=getComputedStyle(e).letterSpacing;
                    return ls==='normal'||ls==='0px';})"""))
    upload(pg, BARE, "mystery.html")
    q = pg.eval_on_selector("#tplReport .kd-q", "e=>e.innerText")
    ck("and so is the question", "الكونسول" in q, q)
    ck("no Arabic label is left empty",
       pg.evaluate("""()=>[...document.querySelectorAll('#tplReport button,.lib-rule')]
         .every(e=>e.textContent.trim().length>0)"""))
    ck("nothing threw in Arabic", not errs, errs[:3])
    ctx.close()

    b.close()

httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
