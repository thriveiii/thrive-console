"""Acceptance 5, the half that was open: a multi-reply card lists its replies numbered 1..N with the
LATEST one marked, so an operator reads at a glance which reply is the newest. Per-opportunity numbering
(repliesForOpp) already numbered them; this proves the newest (highest per-opportunity number) is the one
carrying the mark, that a lone reply is NOT marked (there is no "latest" to distinguish), and that the
mark uses the console's own lane-replied token, no new chrome.

Proven on the real app.js. The reply list is threadListHtml(slug) (a window global, classic script).

FAILS-WHEN-BROKEN: drop the `is-latest`/`rp-latest` marking in threadListHtml and the newest reply is no
longer distinguished (marked count 0). The live Supabase and WebKit stay Thyab's device gate.
"""
import threading, http.server, socketserver, functools, os, sys

os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

# ============================ source guards ============================
app = open(f"{ROOT}/library/app.js").read()
i18n = open(f"{ROOT}/library/i18n.js").read()
css = open(f"{ROOT}/library/styles.css").read()
ck("the latest marker is derived from the per-opportunity max number (not a global one)",
   "__repMax" in app and "rn===__repMax" in app and "is-latest" in app)
ck("the latest marker is applied in the card reply list and only when there is more than one reply",
   "rn && __repMax>1 && rn===__repMax" in app and 'class="rp-latest"' in app)
ck("the rp_latest label exists in both languages", i18n.count("rp_latest:") == 2)
ck("the mark uses the console's own lane-replied token, no new chrome",
   ".rp-latest{" in css and "var(--lane-replied)" in css and ".rp-card.is-latest{" in css)
ck("no em dash / zero-Lotus in the touched sources",
   "—" not in app and "lotus" not in app.lower() and "—" not in css and "—" not in i18n)

# ============================ live ============================
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True; threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width":1280,"height":900})
    ctx.route("https://api.github.com/**", lambda r: r.fulfill(status=404, body="{}"))
    ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))
    pg = ctx.new_page()
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_function("()=>typeof window.repliesForOpp==='function' && typeof window.threadListHtml==='function'", timeout=15000)
    pg.evaluate("()=>{ document.documentElement.classList.remove('gate-locked'); const g=document.getElementById('thriveGate'); if(g) g.remove(); }")

    # 'madar' has THREE distinct repliers (arrival order head < dept < board); the newest is 'board'. 'solo'
    # has a single reply, which must NOT be marked latest.
    pg.evaluate("""()=>{
      localStorage.setItem('thrive_opps_v1', JSON.stringify([
        {slug:'madar', business:'مدارس المدار الدولية', published:true, up:1},
        {slug:'solo', business:'Solo Co', published:true, up:1}]));
      localStorage.setItem('thrive_inbound_v1', JSON.stringify([
        {gid:'r1', opp:'madar', kind:'reply', from:'head@madar.example', subject:'Re: one', ts:'2026-08-03T09:00:00Z'},
        {gid:'r2', opp:'madar--r-9a9', kind:'reply', from:'dept@madar.example', subject:'Re: two', ts:'2026-08-05T09:00:00Z'},
        {gid:'r3', opp:'madar', kind:'reply', from:'board@madar.example', subject:'Re: three', ts:'2026-08-07T09:00:00Z'},
        {gid:'r4', opp:'solo', kind:'reply', from:'one@solo.example', subject:'Re: hi', ts:'2026-08-04T09:00:00Z'}]));
      localStorage.setItem('thrive_mail_v1','[]'); localStorage.setItem('thrive_hits_v1','[]');
      window.invalidateSends&&window.invalidateSends();
    }""")

    # numbering sanity: three distinct repliers, newest is #3 (board@)
    nums = pg.evaluate("()=>window.repliesForOpp('madar').map(function(x){return {who:x.addr,n:x.num};})")
    ck("madar has three replies numbered 1..3, newest (board@) is #3",
       [x["n"] for x in nums]==[1,2,3] and nums[-1]["who"]=="board@madar.example", nums)

    # the card reply list marks exactly one reply as latest, and it is the highest number (#3)
    marked = pg.evaluate("""()=>{ const host=document.createElement('div'); host.innerHTML=window.threadListHtml('madar');
      const latest=[...host.querySelectorAll('.rp-card.is-latest')];
      const badge=[...host.querySelectorAll('.rp-latest')];
      const nums=[...host.querySelectorAll('.th-reply')].map(li=>{ const n=li.querySelector('.rp-num'); const isL=!!li.querySelector('.rp-card.is-latest'); return {num:n?n.textContent:null, latest:isL}; });
      return { latestCards:latest.length, badges:badge.length, nums:nums }; }""")
    ck("the card marks exactly one reply as the latest", marked["latestCards"]==1 and marked["badges"]==1, marked)
    latest_num = [r["num"] for r in marked["nums"] if r["latest"]]
    ck("the marked reply is the newest, the highest per-opportunity number (#3)", latest_num==["#3"], marked)

    # a single-reply opportunity marks NOTHING as latest (nothing to distinguish)
    solo = pg.evaluate("""()=>{ const host=document.createElement('div'); host.innerHTML=window.threadListHtml('solo');
      return { latest:host.querySelectorAll('.rp-card.is-latest').length, badges:host.querySelectorAll('.rp-latest').length, replies:host.querySelectorAll('.th-reply').length }; }""")
    ck("a single-reply card marks no latest (a lone reply is trivially the newest)",
       solo["replies"]==1 and solo["latest"]==0 and solo["badges"]==0, solo)

    ctx.close(); b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
