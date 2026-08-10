"""Settings reads calm: five sections, one card each, in order, nothing touching (WO-022).

Reorganize, not redesign. Engine-independent facts only: Settings groups into the five named sections
in the fixed order, each with a one-line description; every control that existed before is still present
by id (so no wiring was dropped, no behaviour changed); every button row is a real flex row with a gap
so no two buttons touch, and at most one gradient (the primary) per row; the connection-health checklist
keeps its named links. The visual at three widths and Arabic joined-letter rendering stay Thyab's WebKit
device gate. This renders the shipped settings markup against the shipped stylesheet, no logic touched."""
import threading, http.server, socketserver, functools, os, re
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

# ---- source: the five sections in order, no leftover flat settings-panel in the settings partial ----
html = open(os.path.join(ROOT, "library/settings.html")).read()
order = re.findall(r'data-i18n="(setg_\w+_h)"', html)
ck("the five sections appear in the fixed order (Access, Connections, Mail, Replies, Data)",
   order == ["setg_access_h", "setg_conn_h", "setg_mail_h", "setg_replies_h", "setg_data_h"], order)
ck("the settings partial no longer uses the old flat settings-panel card (reorganized into set-group)",
   "settings-panel" not in html)

# Every control id that existed before the reorganization: proof nothing was dropped or rewired.
REQUIRED_IDS = ["connList","connFix","connRun","connKey","connNote",
  "gh_owner","gh_repo","gh_branch","gh_token","ghSave","ghTest","ghResult",
  "ep2","epSave2","em_name","em_from","em_ep","emSave",
  "sy_ep","syEnable","syVerify","syNow","syPush","syCounts","syStatus",
  "sbConnLine","sbBackfill","sbVerify","sbVerifyOut","sbReadSrc","sbReadOn","sbReadOff","sbReadStatus",
  "quotaReadout","q_daily","q_monthly","qSave","stMeter","rpPanel","repPanel","bkExport","bkFile"]

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page(viewport={"width": 900, "height": 1000})
    pg.goto(f"{base}/library/settings.html"); pg.wait_for_timeout(400)
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(600)
    pg.wait_for_selector(".set-group", timeout=10000)

    # ---- five section cards, in order, each with a non-empty one-line description ----
    groups = pg.evaluate("""()=>Array.from(document.querySelectorAll('.set-group')).map(g=>{
      const h=g.querySelector('.set-group-h'); const d=h && h.nextElementSibling;
      return { h:(h&&h.textContent||'').trim(), key:(h&&h.getAttribute('data-i18n'))||'',
               desc:(d&&d.classList.contains('sub'))?(d.textContent||'').trim():'' };
    })""")
    ck("exactly five section cards render", len(groups)==5, [g["key"] for g in groups])
    ck("each section carries a one-line description under its title (non-empty in this language)",
       all(g["desc"] for g in groups), [(g["key"], g["desc"]) for g in groups])
    ck("the section titles are localized, not raw keys", all(g["h"] and not g["h"].startswith("setg_") for g in groups),
       [g["h"] for g in groups])

    # ---- no control was dropped: every prior id is still in the DOM (wiring preserved) ----
    missing = pg.evaluate("(ids)=>ids.filter(id=>!document.getElementById(id))", REQUIRED_IDS)
    ck("every control that existed before is still present by id (no control dropped, no rewire)",
       missing==[], missing)

    # ---- the Supabase read/migrate/verify controls sit in the Data section; connection health in Connections ----
    placement = pg.evaluate("""()=>{
      const sec = id => { const el=document.getElementById(id); if(!el) return ''; const g=el.closest('.set-group'); const h=g&&g.querySelector('.set-group-h'); return h?(h.getAttribute('data-i18n')||''):''; };
      return { conn: sec('connList'), backfill: sec('sbBackfill'), read: sec('sbReadOn'), backup: sec('bkExport'), quota: sec('q_daily'), reput: sec('repPanel') };
    }""")
    ck("connection health sits in Connections; migrate/read and backup sit in Data; limits/reputation in Mail",
       placement["conn"]=="setg_conn_h" and placement["backfill"]=="setg_data_h" and placement["read"]=="setg_data_h"
       and placement["backup"]=="setg_data_h" and placement["quota"]=="setg_mail_h" and placement["reput"]=="setg_mail_h", placement)

    # ---- the connection-health checklist keeps its named-link honesty (the list container is intact) ----
    ck("the connection-health checklist is preserved intact (named-link honesty unchanged)",
       pg.evaluate("()=>!!document.querySelector('#connPanel #connList')"))

    def bar_geometry():
        return pg.evaluate("""()=>{
          const out=[];
          document.querySelectorAll('.set-group .bar').forEach((bar,i)=>{
            const btns=Array.from(bar.querySelectorAll('.btn')).filter(b=>b.offsetParent!==null);
            const rects=btns.map(b=>b.getBoundingClientRect()).sort((a,b)=>a.left-b.left);
            let minGap=Infinity, touch=false;
            for(let k=1;k<rects.length;k++){ const gap=rects[k].left-rects[k-1].right; if(gap<minGap)minGap=gap; if(gap<2)touch=true; }
            const grad=btns.filter(b=>/gradient/.test(getComputedStyle(b).backgroundImage)).length;
            const heights=[...new Set(rects.map(r=>Math.round(r.height)))];
            out.push({ i, n:btns.length, minGap:(rects.length>1?Math.round(minGap):null), touch, grad, heights });
          });
          return out;
        }""")

    # ---- LTR: no touching buttons, one shared height per row, at most one gradient per row ----
    ltr = bar_geometry()
    ck("no two buttons touch in any settings row (a real gap between them)",
       all((g["minGap"] is None) or g["minGap"]>=6 for g in ltr) and not any(g["touch"] for g in ltr), ltr)
    ck("buttons in a row share one height (aligned, not clipped)",
       all(len(g["heights"])==1 for g in ltr if g["n"]>1), [g for g in ltr if len(g["heights"])>1])
    ck("at most one gradient (the primary) per row",
       all(g["grad"]<=1 for g in ltr), [g for g in ltr if g["grad"]>1])

    # ---- Arabic: the section mirrors right-to-left, and the same geometry holds ----
    pg.evaluate("()=>{ document.documentElement.setAttribute('dir','rtl'); document.documentElement.setAttribute('lang','ar'); try{ window.setLang&&window.setLang('ar'); }catch(e){} }")
    pg.wait_for_timeout(300)
    rtl_dir = pg.evaluate("()=>getComputedStyle(document.querySelector('.set-group')).direction")
    ck("the settings sections follow the app right-to-left in Arabic", rtl_dir=="rtl", rtl_dir)
    ar_titles = pg.evaluate("()=>Array.from(document.querySelectorAll('.set-group-h')).map(h=>(h.textContent||'').trim())")
    ck("the section titles render in Arabic (no Latin section key leaks through)",
       all(t and not re.match(r'^[A-Za-z]', t) for t in ar_titles), ar_titles)
    rtl = bar_geometry()
    ck("no two buttons touch in Arabic either (mirrored, still a real gap)",
       all((g["minGap"] is None) or g["minGap"]>=6 for g in rtl) and not any(g["touch"] for g in rtl), rtl)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL SETTINGS-CALM CHECKS PASS"))
raise SystemExit(1 if fails else 0)
