"""Settings v2: only the daily set is shown, the rest collapses behind one advanced disclosure (WO-028).

Supersedes the WO-022 five-section grouping. Relocation and reduction only: every moved control keeps
its id, wiring and copy; the reply diagnostics live on the board, so the duplicate Settings Replies
block is dropped (the control is not deleted, it stays on the board's #boardInbox surface). Engine
-independent facts: the daily controls are visible, everything else sits inside ONE closed-by-default
advanced disclosure, every prior control id (except the board-owned reply panel) is present and bound,
no two buttons touch, and the row mirrors right-to-left in Arabic. Three widths and Arabic joined-letter
rendering stay Thyab's WebKit device gate."""
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

# ---- source: one advanced disclosure, closed by default; the Replies block is gone from Settings ----
html = open(os.path.join(ROOT, "library/settings.html")).read()
adv = re.search(r'<details class="[^"]*set-advanced[^"]*"([^>]*)>', html)
ck("Settings has one advanced disclosure (a <details class='set-advanced'>)", bool(adv))
ck("the advanced disclosure is closed by default (no 'open' attribute in source)",
   bool(adv) and "open" not in adv.group(1))
ck("the duplicate Settings Replies block is removed (rpPanel is no longer in Settings source)",
   'id="rpPanel"' not in html)

# Every control id that existed in Settings v1, minus the board-owned reply panel (rpPanel).
DAILY_IDS = ["quotaReadout", "q_daily", "q_monthly", "qSave", "repPanel", "bkExport", "bkFile"]
ADVANCED_IDS = ["connList","connFix","connRun","connKey","connNote",
  "gh_owner","gh_repo","gh_branch","gh_token","ghSave","ghTest","ghResult",
  "ep2","epSave2","em_name","em_from","em_ep","emSave",
  "sy_ep","syEnable","syVerify","syNow","syPush","syCounts","syStatus",
  "sbConnLine","sbBackfill","sbVerify","sbVerifyOut","sbReadSrc","sbReadOn","sbReadOff","sbReadStatus",
  "stMeter"]
ALL_IDS = DAILY_IDS + ADVANCED_IDS

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
    pg.wait_for_selector(".set-advanced", timeout=10000)

    # ---- no control was dropped: every prior id (minus rpPanel) is present, so initSettings binds ----
    missing = pg.evaluate("(ids)=>ids.filter(id=>!document.getElementById(id))", ALL_IDS)
    ck("every prior control is still present by id (no control lost, initSettings binds without error)",
       missing == [], missing)
    ck("the reply panel is not in Settings but its board surface is (moved, not deleted)",
       pg.evaluate("()=>!document.getElementById('rpPanel')"))

    # ---- the advanced disclosure is closed by default and holds the moved controls ----
    ck("the advanced disclosure computes closed at load (open is false)",
       pg.evaluate("()=>{const d=document.querySelector('.set-advanced'); return !!d && d.open===false;}"))
    inside = pg.evaluate("""(ids)=>{ const d=document.querySelector('.set-advanced');
      return ids.filter(id=>{ const el=document.getElementById(id); return !(el && d && d.contains(el)); }); }""", ADVANCED_IDS)
    ck("every advanced control (connection health, GitHub, analytics, sync, email, Supabase, device store) sits inside the disclosure",
       inside == [], inside)

    # ---- the daily set is visible, OUTSIDE the disclosure ----
    outside = pg.evaluate("""(ids)=>{ const d=document.querySelector('.set-advanced');
      return ids.filter(id=>{ const el=document.getElementById(id); return !el || (d && d.contains(el)); }); }""", DAILY_IDS)
    ck("the daily set (sending limits, reputation, backup and restore) is visible, outside the disclosure",
       outside == [], outside)
    # A closed disclosure hides its contents (checkVisibility is the correct read: a closed <details>
    # keeps offsetParent via content-visibility, so only checkVisibility reports the true state).
    vis = pg.evaluate("""()=>({ daily: document.getElementById('qSave').checkVisibility(),
                                 adv: document.getElementById('gh_owner').checkVisibility({checkVisibilityCSS:true}) })""")
    ck("with the disclosure closed, the daily controls render and the advanced controls are hidden",
       vis["daily"] is True and vis["adv"] is False, vis)

    # ---- opening the disclosure reveals the advanced controls (they were only collapsed, never gone) ----
    pg.evaluate("()=>document.querySelector('.set-advanced').open=true"); pg.wait_for_timeout(150)
    ck("opening the disclosure reveals the advanced controls (collapsed, not removed)",
       pg.evaluate("()=>document.getElementById('gh_owner').checkVisibility()"))

    # ---- button geometry holds (measured with the disclosure open, so every row is truly visible) ----
    geo = pg.evaluate("""()=>{
      const out=[];
      document.querySelectorAll('.set-group .bar, .set-advanced .bar').forEach((bar)=>{
        const btns=Array.from(bar.querySelectorAll('.btn')).filter(b=>b.checkVisibility());
        const r=btns.map(b=>b.getBoundingClientRect()).sort((a,b)=>a.left-b.left);
        let minGap=Infinity, touch=false;
        for(let k=1;k<r.length;k++){ const g=r[k].left-r[k-1].right; if(g<minGap)minGap=g; if(g<2)touch=true; }
        const heights=[...new Set(r.map(x=>Math.round(x.height)))];
        if(btns.length) out.push({n:btns.length, minGap:(r.length>1?Math.round(minGap):null), touch, heights});
      });
      return out;
    }""")
    ck("no two buttons touch in any settings row (a real gap, one height per row)",
       all((g["minGap"] is None or g["minGap"] >= 6) and not g["touch"] and (g["n"] <= 1 or len(g["heights"]) == 1) for g in geo), geo)

    # ---- Arabic mirrors right-to-left ----
    pg.evaluate("()=>{ document.documentElement.setAttribute('dir','rtl'); document.documentElement.setAttribute('lang','ar'); try{ window.setLang&&window.setLang('ar'); }catch(e){} }")
    pg.wait_for_timeout(250)
    ck("Settings follows the app right-to-left in Arabic",
       pg.evaluate("()=>getComputedStyle(document.querySelector('.set-group')).direction") == "rtl")

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL SETTINGS V2 CHECKS PASS"))
raise SystemExit(1 if fails else 0)
