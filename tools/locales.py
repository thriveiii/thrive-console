"""WO-012 phase 4: two language axes that never touch.

The leak this closes is visible in one sentence: the English composer showed «التحديث الشهري»
beside Monthly update in the same row. That was never a translation problem, it was one
variable doing two jobs. This asserts the separation from both directions: an English document
under Arabic chrome, and an Arabic document under English chrome, four combinations in all.

Run it: python3 tools/locales.py
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

SEED = """()=>{
  saveEmailTemplate({id:'t-en', name:'Monthly update', locale:'EN', subject:'August at Thrive', html:'<p>Hello</p>'});
  saveEmailTemplate({id:'t-ar', name:'التحديث الشهري', locale:'AR', subject:'أغسطس في ثرايف', html:'<p>مرحبًا</p>'});
  saveEmailTemplate({id:'t-none', name:'Needs a language', html:'<p>Hi</p>'});
  saveCustomTemplate({id:'p-en', name:'English page', locale:'EN', lang:'EN', html:'<h1>{{BIZ}}</h1>'});
  saveCustomTemplate({id:'p-ar', name:'صفحة عربية', locale:'AR', lang:'AR', html:'<h1>{{BIZ}}</h1>'});
  saveDraft({slug:'doc-en', business:'English Co', doc_lang:'EN', published:true, template:'p-en', fields:{}});
  saveDraft({slug:'doc-ar', business:'شركة عربية', doc_lang:'AR', published:true, template:'p-ar', fields:{}});
}"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    for ui in ("en", "ar"):
        ctx = b.new_context(viewport={"width": 1280, "height": 900})
        ctx.route("https://api.github.com/**", lambda r: r.abort())
        pg = ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(f"{base}/library/console.html"); pg.wait_for_timeout(400)
        pg.evaluate("l=>localStorage.setItem('thrive_lang',l)", ui)
        if pg.query_selector("#thriveGate"):
            pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1400)
        pg.reload(); pg.wait_for_timeout(2600)
        pg.evaluate(SEED); pg.wait_for_timeout(500)

        ck(f"{ui}: the two axes are separate fields",
           pg.evaluate("()=>typeof docLang==='function' && typeof getLang==='function'"))
        ck(f"{ui}: an English document stays English under {ui} chrome",
           pg.evaluate("""async ()=>{const o=(await mergedOpps()).find(x=>x.slug==='doc-en');
             return docLang(o);}""") == "EN")
        ck(f"{ui}: an Arabic document stays Arabic under {ui} chrome",
           pg.evaluate("""async ()=>{const o=(await mergedOpps()).find(x=>x.slug==='doc-ar');
             return docLang(o);}""") == "AR")

        # the composer, which is where the leak was visible
        for slug, want, other in (("doc-en", "Monthly update", "التحديث الشهري"),
                                  ("doc-ar", "التحديث الشهري", "Monthly update")):
            pg.evaluate("h=>location.hash=h", "#compose?slug=" + slug)
            pg.wait_for_timeout(2200)
            chips = pg.eval_on_selector_all("#etplQuick .lp", "e=>e.map(x=>x.textContent.trim())")
            opts = pg.eval_on_selector_all("#etpl option", "e=>e.map(x=>x.textContent.trim())")
            print(f"  {ui}/{slug} chips:", chips, "options:", opts)
            ck(f"{ui}/{slug}: the chip row offers its own language", want in chips or not chips, chips)
            ck(f"{ui}/{slug}: and never the other one", other not in chips, chips)
            ck(f"{ui}/{slug}: the drop-down agrees with the chips", other not in opts, opts)
            ck(f"{ui}/{slug}: never a mixed row",
               not (want in chips and other in chips), chips)

        # the library tabs
        pg.evaluate("()=>location.hash='#templates'")
        pg.wait_for_timeout(2200)
        tabs = pg.eval_on_selector_all("#emailTplList [data-loc], #customList [data-loc]", "e=>e.map(x=>x.dataset.loc)")
        ck(f"{ui}: exactly two locale tabs and no combined view", set(tabs) == {"EN", "AR"} and len(tabs) in (2, 4), tabs)
        shown = pg.eval_on_selector("#emailTplList", "e=>e.innerText")
        ck(f"{ui}: the English tab shows English templates only",
           "Monthly update" in shown and "التحديث الشهري" not in shown, shown[:160])
        # Scoped to the template items. The migration panel shares the container and names the
        # same template on purpose, so asserting against the whole container asks the wrong thing.
        items = pg.eval_on_selector_all("#emailTplList .item", "e=>e.map(x=>x.innerText)")
        ck(f"{ui}: a template with no language is in neither tab, it is in the migration",
           not any("Needs a language" in x for x in items), items)
        ck(f"{ui}: the migration shows what it read and asks",
           pg.eval_on_selector_all(".loc-mig-sel", "e=>e.length") >= 1)
        ck(f"{ui}: and nothing was assigned before confirming",
           pg.evaluate("()=>!getEmailTemplates().find(x=>x.id==='t-none').locale"))
        pg.click(".loc-tabs [data-loc='AR']"); pg.wait_for_timeout(900)
        ar_shown = pg.eval_on_selector("#emailTplList", "e=>e.innerText")
        ck(f"{ui}: the Arabic tab shows a real count",
           "التحديث الشهري" in ar_shown and "Monthly update" not in ar_shown, ar_shown[:160])

        # confirming the migration writes exactly what was shown
        pg.evaluate("()=>{const s=document.querySelector('.loc-mig-sel'); if(s) s.value='AR';}")
        pg.click(".loc-mig-save"); pg.wait_for_timeout(1200)
        ck(f"{ui}: confirming writes the language that was on screen",
           pg.evaluate("()=>(getEmailTemplates().find(x=>x.id==='t-none')||{}).locale") == "AR")

        # the editor takes its direction from the document, not the chrome
        pg.evaluate("h=>location.hash=h", "#editor?slug=doc-ar")
        pg.wait_for_timeout(2400)
        ck(f"{ui}: the editor badges the document language",
           pg.eval_on_selector("#edLocBadge", "e=>!e.hidden && e.textContent.length>0"))
        ck(f"{ui}: an Arabic document's content fields are right to left",
           pg.eval_on_selector("#f_biz", "e=>e.getAttribute('dir')") == "rtl")
        ck(f"{ui}: identity fields stay left to right in both",
           pg.eval_on_selector("#f_slug", "e=>e.getAttribute('dir')") == "ltr")
        ck(f"{ui}: the editor is grouped into four sections",
           pg.eval_on_selector_all(".sec-h", "e=>e.length") >= 4)
        ck(f"{ui}: nothing threw", not errs, errs[:3])
        ctx.close()
    b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
