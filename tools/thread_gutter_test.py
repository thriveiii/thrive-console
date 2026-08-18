"""P12 · The thread panel shares the composer's gutters, and nothing overflows.

The live bug: the thread panel's left and right margins did not match the reply composer directly beneath it,
and content overflowed. This opens the REAL card window on the History tab (thread above, the send editor in
reply mode beneath it), at phone / iPad-landscape / desktop, EN and AR, and asserts:
  - the thread's content column and the composer's content column line up on both the inline-start and the
    inline-end edge (equal gutters, matching the composer);
  - neither the page nor the thread panel scrolls horizontally (every element inside its box).
Engine-independent geometry in Chromium; the WebKit look is Thyab's device gate (thread_render_shots.py).
"""
import threading, http.server, socketserver, functools, os, sys
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
Hh = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.TCPServer(("127.0.0.1", 0), Hh); PORT = srv.server_address[1]; srv.daemon_threads = True
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:300])

BASEL = ("نعم، هذا رائع. شكرًا لكم، نتطلع إلى العرض.\n\n"
         "في اثنين، ٣ آب ٢٠٢٦ في ٩:٣٧ م، كتب Thrive Digital Solutions <hi@thriveiii.com>:\n"
         "> اطّلعوا على العرض هنا https://console.thriveiii.com/opp/madar\n"
         "> نتطلع إلى ردكم.")

SEED = """(a)=>{
 localStorage.setItem('thrive_opps_v1',JSON.stringify([
  {slug:'madar',business:'مدارس المدار الدولية',published:true,up:1,recipients:[{addr:'basel@issa.example',name:'باسل عيسى',lang:'ar'}]}]));
 localStorage.setItem('thrive_inbound_v1',JSON.stringify([
  {gid:'i1',opp:'madar',kind:'reply',from:'basel@issa.example',name:'باسل عيسى عبد الله الطويل',subject:'Re: من جد وجد',snippet:a.basel,ts:'2026-08-03T09:00:00Z',messageId:'<wire-basel-1@issa.example>'}]));
 localStorage.setItem('thrive_mail_v1',JSON.stringify([
  {mid:'s1',opp:'madar',to:'head@madar.example',toName:'إدارة المدار',subject:'من جد وجد',preview:'مرحبا، إليكم العرض الذي أعددناه لمدارس المدار الدولية. اطّلعوا عليه في صفحة واحدة. [LINK]',status:'sent',direction:'out',ts:'2026-08-01T10:00:00Z',msgid:'<send-madar-1@thriveiii.com>'}]));
 localStorage.setItem('thrive_hits_v1','[]');
 window.__boardViewSet([
  {slug:'madar',stage:'replied',open_count:0,replied:true,idle_days:1,has_page:true,has_email:false,archived:false}]);
 window.invalidateSends&&window.invalidateSends();
}"""

def enter(pg, lang):
    pg.goto(base + "/library/console.html"); pg.wait_for_timeout(400)
    pg.evaluate("l=>localStorage.setItem('thrive_lang',l)", lang)
    pg.evaluate("()=>{ localStorage.setItem('console_sb_read','1'); localStorage.setItem('console_sb_session', JSON.stringify({access_token:'jwt',uid:'op',email:'op@x'})); }")
    pg.reload(); pg.wait_for_function("()=>typeof window.thriveBoardRefresh==='function' && typeof window.__boardViewSet==='function' && window.thriveModal", timeout=15000)
    pg.evaluate("()=>{ document.documentElement.classList.remove('gate-locked'); const g=document.getElementById('thriveGate'); if(g) g.remove(); }")
    pg.evaluate(SEED, {"basel": BASEL})
    pg.evaluate("()=>{ location.hash='#board'; }")
    pg.evaluate("async ()=>{ await window.thriveBoardRefresh(); }"); pg.wait_for_timeout(500)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    for lang in ("en", "ar"):
        for (w, h, tag) in [(390, 860, "phone"), (1024, 768, "ipad"), (1440, 900, "desktop")]:
            ctx = b.new_context(viewport={"width": w, "height": h}, has_touch=(w <= 834), is_mobile=(w <= 430))
            ctx.route("https://api.github.com/**", lambda x: x.abort())
            ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))
            pg = ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
            enter(pg, lang)
            try:
                pg.evaluate("()=>window.thriveModal.open('madar','history','مدارس المدار الدولية')")
                pg.wait_for_selector('#modalHistory .th-list', timeout=8000)
                pg.wait_for_timeout(700)
            except Exception as e:
                ck(f"{lang}/{tag}: the History conversation opens", False, str(e)); ctx.close(); continue

            m = pg.evaluate("""()=>{
              function contentBox(el){ if(!el) return null; var r=el.getBoundingClientRect(); var s=getComputedStyle(el);
                return { left:r.left+parseFloat(s.paddingLeft), right:r.right-parseFloat(s.paddingRight) }; }
              var list=document.querySelector('#modalHistory .th-list');
              // the composer directly beneath: the send editor moved into #modalHost (its bounding panel)
              var comp=document.querySelector('#modalHost .compose-panel') || document.querySelector('#modalHost .panel') || document.querySelector('#modalHost .view');
              var lb=contentBox(list), cb=contentBox(comp);
              var de=document.scrollingElement||document.documentElement;
              var hist=document.getElementById('modalHistory');
              return {
                haveList:!!list, haveComp:!!comp,
                leftGap: (lb&&cb)? Math.abs(lb.left-cb.left) : -1,
                rightGap:(lb&&cb)? Math.abs(lb.right-cb.right) : -1,
                pageOverflow: de.scrollWidth - de.clientWidth,
                histOverflow: hist? (hist.scrollWidth - hist.clientWidth) : 0,
                bodyHasOutbound: !!(document.querySelector('#modalHistory .th-sent .rp-snip'))
              };
            }""")
            ck(f"{lang}/{tag}: the thread and the composer are both present in the window",
               m["haveList"] and m["haveComp"], m)
            ck(f"{lang}/{tag}: the outbound send now shows its body block (the fix is on screen)",
               m["bodyHasOutbound"] is True, m)
            ck(f"{lang}/{tag}: the thread's inline-start edge matches the composer (equal gutter)",
               0 <= m["leftGap"] <= 3, m)
            ck(f"{lang}/{tag}: the thread's inline-end edge matches the composer (equal gutter)",
               0 <= m["rightGap"] <= 3, m)
            ck(f"{lang}/{tag}: the page does not scroll horizontally",
               m["pageOverflow"] <= 1, m)
            ck(f"{lang}/{tag}: the thread panel does not scroll horizontally (every element in its box)",
               m["histOverflow"] <= 1, m)
            ck(f"{lang}/{tag}: no page errors", len(errs) == 0, errs)
            ctx.close()
    b.close()
srv.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
