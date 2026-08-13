"""The card's closing actions read as ONE designed control, not a scatter (WO-034).

On the device the card footer showed a loose row of bare text buttons - convert, won, lost, drop, archive,
page-gone - with no icons, no hierarchy, and crowding the campaign chip above. These are the lifecycle
terminus actions (the Closed states) plus a convert. This redesign, presentation only, gives them one
standard control:
  - the terminal outcomes are ONE labeled section ("Close this opportunity"), each choice icon-led with a
    one-line quiet description, one height, one gap;
  - convert (and any recover move) is a PROMOTION: primary-styled, above, apart from the closing set, so
    closing and advancing never read as siblings;
  - every choice keeps its data-move and still routes through the same bind - the lifecycle logic from the
    terminus PR is unchanged.

Proven here on the real app.js by opening a replied card's window and reading its structure, in both
languages. WebKit at three widths is Thyab's device gate.
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
        if d is not None: print("      " + str(d)[:400])

# Source guard: one control, promotion apart, lifecycle logic untouched (still data-move -> bindMoves).
app = open(f"{ROOT}/library/app.js").read()
ck("the terminal outcomes are a named set, convert is not one of them",
   'const CLOSE_MOVES=["mark_won","mark_lost","drop","archive","retire_page"];' in app
   and "CLOSE_MOVES.indexOf(m)<0" in app)
ck("the closing choices are icon-led with a description, promotion sits apart",
   'class="close-opt' in app and 'class="close-ic"' in app and 'class="close-desc"' in app
   and 'class="mw-advance"' in app and 'function ocIcon(' in app)
ck("every choice still carries data-move (lifecycle binding unchanged)",
   'data-move="' in app and 'box.querySelectorAll("[data-move]")' in app)

OPPS = [{"slug":"rep","business":"Rep Co","published":True,"stage":"replied","up":1}]
MAIL = [{"mid":"m1","opp":"rep","to":"x@x.com","subject":"Hi","status":"sent","direction":"out","ts":"2026-08-01T10:00:00Z"}]
INB  = [{"gid":"g1","opp":"rep","kind":"reply","from":"x@x.com","name":"X","subject":"Re","snippet":"Yes.","ts":"2026-08-03T09:00:00Z"}]

def boot(pg, lang):
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_function("()=>typeof window.thriveBoardRefresh==='function' && !!window.thriveModal", timeout=15000)
    pg.evaluate("()=>{document.documentElement.classList.remove('gate-locked');const g=document.getElementById('thriveGate');if(g)g.remove();}")
    pg.evaluate("""(a)=>{ localStorage.setItem('thrive_lang',a.lang);
        localStorage.setItem('thrive_opps_v1',JSON.stringify(a.opps));
        localStorage.setItem('thrive_mail_v1',JSON.stringify(a.mail));
        localStorage.setItem('thrive_inbound_v1',JSON.stringify(a.inb)); }""",
        {"lang":lang,"opps":OPPS,"mail":MAIL,"inb":INB})
    pg.reload()
    pg.wait_for_function("()=>typeof window.thriveBoardRefresh==='function' && !!window.thriveModal", timeout=15000)
    pg.evaluate("()=>{document.documentElement.classList.remove('gate-locked');const g=document.getElementById('thriveGate');if(g)g.remove();}")
    pg.evaluate("()=>location.hash='board'"); pg.wait_for_timeout(400)
    pg.evaluate("()=>window.thriveModal.open('rep','overview','rep')"); pg.wait_for_timeout(400)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width":1280,"height":900})
    ctx.route("https://api.github.com/**", lambda r: r.abort())
    ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))
    pg = ctx.new_page()

    # ======================= ENGLISH =======================
    boot(pg, "en")
    struct = pg.evaluate("""()=>{
      const ov=document.getElementById('modalOverview');
      const T=k=>window.t(k);
      const closeOpts=[...ov.querySelectorAll('.close-set .close-opt')];
      const opt=(m)=>closeOpts.find(o=>o.getAttribute('data-move')===m);
      const advance=[...ov.querySelectorAll('.mw-advance [data-move]')].map(b=>b.getAttribute('data-move'));
      const allMoves=[...ov.querySelectorAll('[data-move]')].map(b=>b.getAttribute('data-move'));
      // every actionable move sits inside either the promotion row or the close set (no loose peer)
      const stray=[...ov.querySelectorAll('[data-move]')].filter(b=> !b.closest('.mw-advance') && !b.closest('.close-set'));
      // DOM order: advance before close
      const adv=ov.querySelector('.mw-advance'), clo=ov.querySelector('.mw-close');
      const advBeforeClose = !!(adv && clo) && (adv.compareDocumentPosition(clo) & Node.DOCUMENT_POSITION_FOLLOWING);
      const detail=(m)=>{ const o=opt(m); if(!o) return null;
        const svg=o.querySelector('.close-ic svg');
        return { label:(o.querySelector('.close-label')||{}).textContent||'',
                 desc:(o.querySelector('.close-desc')||{}).textContent||'',
                 hasSvg:!!svg, w:svg&&svg.getAttribute('width'), h:svg&&svg.getAttribute('height') }; };
      return {
        hasOutcome: !!ov.querySelector('.mw-outcome'),
        oldFlatBar: !!ov.querySelector('.mw-moves'),
        closeH: (ov.querySelector('.mw-close .mw-h')||{}).textContent||'',
        closeH_expected: T('lc_close_h'),
        closeMoves: closeOpts.map(o=>o.getAttribute('data-move')),
        advance, allMoves, strayCount: stray.length, advBeforeClose,
        convertInAdvance: advance.indexOf('convert')>=0,
        convertNotClosing: !opt('convert'),
        convertPrimary: (()=>{ const c=ov.querySelector('.mw-advance [data-move=\"convert\"]'); return !!c && c.className.indexOf('ghost')<0; })(),
        won: detail('mark_won'), lost: detail('mark_lost'), drop: detail('drop'),
        archive: detail('archive'), retire: detail('retire_page'),
        wonDescExpected: T('lc_mark_won_d')
      }; }""")

    ck("ONE outcome control is present; the old flat moves bar is gone",
       struct["hasOutcome"] and not struct["oldFlatBar"], struct)
    ck("no scattered bare move buttons remain (every move sits in the promotion row or the close set)",
       struct["strayCount"] == 0, struct)
    ck("the close section is labeled 'Close this opportunity'", struct["closeH"] == struct["closeH_expected"] and struct["closeH"], struct)
    ck("the terminal choices are the Closed states plus page-gone",
       set(struct["closeMoves"]) == {"mark_won","mark_lost","drop","archive","retire_page"}, struct["closeMoves"])
    ck("convert is a PROMOTION: primary-styled, in the advance row, never in the closing set",
       struct["convertInAdvance"] and struct["convertNotClosing"] and struct["convertPrimary"], struct)
    ck("the promotion row sits ABOVE the closing set", bool(struct["advBeforeClose"]), struct)
    ck("lifecycle unchanged: the legal moves still include convert and every terminal move",
       all(m in struct["allMoves"] for m in ["convert","mark_won","mark_lost","drop","archive","retire_page"]), struct["allMoves"])
    for key,m in [("won","mark_won"),("lost","mark_lost"),("drop","drop"),("archive","archive"),("retire","retire_page")]:
        d=struct[key]
        ck(f"the {m} choice is icon-led (inline svg with width+height) with a label and a one-line description",
           bool(d) and d["hasSvg"] and d["w"] and d["h"] and d["label"] and d["desc"], d)
    ck("the Won description reads its i18n copy (value in the flow is spelled out)",
       struct["won"]["desc"] == struct["wonDescExpected"] and len(struct["won"]["desc"])>10, struct["won"])

    # ======================= ARABIC (RTL) =======================
    boot(pg, "ar")
    ar = pg.evaluate("""()=>{
      const ov=document.getElementById('modalOverview');
      const opt=ov.querySelector('.close-set .close-opt[data-move=\"mark_won\"]');
      return { dir: opt?getComputedStyle(opt).direction:'',
               flex: opt?getComputedStyle(opt).flexDirection:'',
               label: opt?(opt.querySelector('.close-label')||{}).textContent:'',
               desc: opt?(opt.querySelector('.close-desc')||{}).textContent:'',
               header:(ov.querySelector('.mw-close .mw-h')||{}).textContent||'',
               hasOutcome: !!ov.querySelector('.mw-outcome') }; }""")
    ck("Arabic: the outcome control mirrors RTL (the option computes right-to-left)",
       ar["dir"]=="rtl" and ar["flex"]=="row" and ar["hasOutcome"], ar)
    ck("Arabic: the choice carries its Arabic label and description",
       ar["label"]=="نجحت" and "المغلقة" in ar["desc"] and ar["header"]=="إغلاق الفرصة", ar)

    ctx.close(); b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
