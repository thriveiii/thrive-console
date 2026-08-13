"""The unsaved-changes dialog says exactly what each button does (WO-035).

«تخلّص منه» could read as "delete the card" when it must mean only "discard the edits". This proves, on
the real app.js, that each of the three answers does exactly its (renamed) label and nothing more:
  - Keep editing returns to the editor with the text intact (the secondary, and the Escape/backdrop cancel);
  - Save and close persists the edits then closes (the PRIMARY, focused, safe default);
  - Discard edits closes WITHOUT persisting and drops ONLY the autosaved edits - it never deletes the
    opportunity card or any of its saved content.
The dialog is one shared component (threeWay) reached from one gate (askBeforeClose, bound to the back,
close, scrim and Escape). Renamed labels and a truthful subtitle render in both languages; save-and-close
is primary. The modal is mounted directly (thriveModal.open) so the proof does not depend on the board's
cold-start card animation. WebKit in both languages is Thyab's device gate.
"""
import threading, http.server, socketserver, functools, os, sys
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True; threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:300])

# ---- Source guards: one shared component, one gate, discard drops only the draft scratch ----
app = open(f"{ROOT}/library/app.js").read()
ck("save-and-close is the primary (focused) and the Escape/backdrop cancel is keep-editing",
   '{ label:t("df_saveclose"), kind:"primary" }' in app
   and '{ label:t("df_keep"),      kind:"ghost", cancel:true }' in app
   and '{ label:t("df_throw"),     kind:"danger" }' in app)
ck("threeWay focuses the primary and resolves Escape/backdrop to the cancel choice",
   'box.querySelector(\'[data-tw-primary="1"]\')' in app and "done(cancelIx)" in app)
ck("discard drops only the autosaved edits (ThriveDrafts.drop), never the card",
   'ThriveDrafts.drop(FLOW, current); return true; }       // discard edits (never the card)' in app)
ck("the unsaved gate is one shared component reached from back, close, scrim and Escape",
   "async function askBeforeClose()" in app
   and app.count("if(await askBeforeClose())") >= 4)

OPPS = [{"slug":"one","business":"Acme One","published":True,"up":1,"doc_lang":"EN",
         "contact_tier":"A","channel":{"kind":"email","to":"a@one.example"},"outreach_text":"Hello from One."}]

def boot(pg, lang):
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_function("()=>!!window.thriveModal && !!window.ThriveDrafts", timeout=15000)
    pg.evaluate("()=>{document.documentElement.classList.remove('gate-locked');const g=document.getElementById('thriveGate');if(g)g.remove();}")
    pg.evaluate("(a)=>{ localStorage.setItem('thrive_lang',a.lang); localStorage.setItem('thrive_opps_v1',JSON.stringify(a.opps)); }",
                {"lang": lang, "opps": OPPS})
    pg.reload()
    pg.wait_for_function("()=>!!window.thriveModal && !!window.ThriveDrafts", timeout=15000)
    pg.evaluate("()=>{document.documentElement.classList.remove('gate-locked');const g=document.getElementById('thriveGate');if(g)g.remove();}")
    pg.evaluate("()=>ThriveDrafts.drop('opportunity','one')")

def open_dirty(pg, text="middle of writing"):
    pg.evaluate("()=>window.thriveModal.open('one','text','one')"); pg.wait_for_timeout(600)
    pg.evaluate("""(t)=>{ const e=document.getElementById('otBox'); e.value=t; e.dispatchEvent(new Event('input',{bubbles:true})); }""", text)
    pg.wait_for_timeout(700)

def ask(pg):
    pg.evaluate("()=>document.getElementById('modalClose').click()"); pg.wait_for_timeout(500)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width":1280,"height":900})
    ctx.route("https://api.github.com/**", lambda r: r.abort())
    ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))
    pg = ctx.new_page()

    # ============================ ENGLISH ============================
    boot(pg, "en")
    open_dirty(pg)
    ck("editing the outreach makes the window dirty (otBox holds the text)",
       "middle of writing" in pg.eval_on_selector("#otBox", "e=>e.value"))
    ask(pg)
    d = pg.evaluate("""()=>{
      const T=k=>window.t(k); const btn=i=>document.querySelector('#threeWay [data-tw="'+i+'"]');
      const b0=btn(0), b1=btn(1), b2=btn(2);
      return {
        present: !!document.getElementById('threeWay'),
        count: document.querySelectorAll('#threeWay [data-tw]').length,
        l0:b0&&b0.textContent, l1:b1&&b1.textContent, l2:b2&&b2.textContent,
        e0:T('df_saveclose'), e1:T('df_keep'), e2:T('df_throw'),
        primary0: !!b0 && b0.className.indexOf('ghost')<0,
        ghost1: !!b1 && b1.className.indexOf('ghost')>=0,
        danger2: !!b2 && b2.className.indexOf('danger')>=0,
        focusedPrimary: document.activeElement===b0,
        sub: (document.querySelector('#threeWay .tw-p')||{}).textContent,
        subE: T('df_ask_p'),
        head: (document.querySelector('#threeWay .tw-t')||{}).textContent,
        headE: T('df_ask_h') }; }""")
    ck("the dialog offers three answers", d["present"] and d["count"]==3, d)
    ck("index 0 is Save and close (primary, focused), the safe default",
       d["l0"]==d["e0"] and d["primary0"] and d["focusedPrimary"], d)
    ck("index 1 is Keep editing (secondary/ghost)", d["l1"]==d["e1"] and d["ghost1"], d)
    ck("index 2 is Discard edits (quiet-destructive), renamed away from 'throw it away'",
       d["l2"]==d["e2"] and d["l2"]=="Discard edits" and d["danger2"], d)
    ck("the subtitle states the stakes plainly (what is kept, what is lost)",
       d["sub"]==d["subE"] and "Save keeps" in d["sub"] and "Discard drops only these edits" in d["sub"], d)
    ck("the header reads its truthful copy", d["head"]==d["headE"], d)

    # ---- Keep editing (index 1): window stays, text intact ----
    pg.evaluate("()=>document.querySelector('#threeWay [data-tw=\"1\"]').click()"); pg.wait_for_timeout(500)
    ck("Keep editing keeps the window open with the text intact",
       (not pg.eval_on_selector("#modal","e=>e.hidden")) and "middle of writing" in pg.eval_on_selector("#otBox","e=>e.value"))

    # ---- Escape on the dialog resolves to Keep editing (never loses work) ----
    ask(pg)
    pg.evaluate("()=>{ const b=document.getElementById('threeWay'); b.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); }")
    pg.wait_for_timeout(400)
    ck("Escape on the dialog keeps editing (the dialog closes, the window stays)",
       (pg.eval_on_selector_all("#threeWay","e=>e.length")==0) and (not pg.eval_on_selector("#modal","e=>e.hidden")), )

    # ---- Save and close (index 0): closes, edits persisted ----
    ask(pg)
    pg.evaluate("()=>document.querySelector('#threeWay [data-tw=\"0\"]').click()"); pg.wait_for_timeout(700)
    ck("Save and close closes the window", pg.eval_on_selector("#modal","e=>e.hidden") is True)
    ck("and persists the edits (the draft holds them)",
       pg.evaluate("""()=>{ const d=ThriveDrafts.load('opportunity','one'); return !!(d && JSON.stringify(d.data).indexOf('middle of writing')>=0); }"""))

    # ---- Discard edits (index 2): closes, draft dropped, CARD SURVIVES ----
    open_dirty(pg, "second draft words")
    ask(pg)
    pg.evaluate("()=>document.querySelector('#threeWay [data-tw=\"2\"]').click()"); pg.wait_for_timeout(700)
    surv = pg.evaluate("""()=>{
      const opps=JSON.parse(localStorage.getItem('thrive_opps_v1')||'[]');
      const card=opps.find(o=>o.slug==='one');
      return { closed: document.getElementById('modal').hidden,
               draftGone: ThriveDrafts.load('opportunity','one')===null,
               cardExists: !!card, cardBusiness: card&&card.business }; }""")
    ck("Discard edits closes the window", surv["closed"] is True, surv)
    ck("Discard drops ONLY the edits (the autosaved draft is gone)", surv["draftGone"] is True, surv)
    ck("Discard NEVER deletes the card: the opportunity and its saved content survive",
       surv["cardExists"] and surv["cardBusiness"]=="Acme One", surv)

    # ============================ ARABIC ============================
    boot(pg, "ar")
    open_dirty(pg, "نص عربي مكتوب")
    ask(pg)
    ar = pg.evaluate("""()=>{ const btn=i=>document.querySelector('#threeWay [data-tw="'+i+'"]');
      return { l0:(btn(0)||{}).textContent, l1:(btn(1)||{}).textContent, l2:(btn(2)||{}).textContent,
               primary0: !!btn(0) && btn(0).className.indexOf('ghost')<0,
               sub:(document.querySelector('#threeWay .tw-p')||{}).textContent }; }""")
    ck("Arabic: the renamed discard label reads «تجاهل التعديلات», not «تخلّص منه»",
       ar["l2"]=="تجاهل التعديلات", ar)
    ck("Arabic: save-and-close «احفظ وأغلق» is the primary; keep-editing «أكمل التحرير» is secondary",
       ar["l0"]=="احفظ وأغلق" and ar["primary0"] and ar["l1"]=="أكمل التحرير", ar)
    ck("Arabic: the subtitle spells out what stays and what is dropped",
       "تبقى الفرصة" in ar["sub"] and "التعديلات" in ar["sub"], ar)

    ctx.close(); b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
