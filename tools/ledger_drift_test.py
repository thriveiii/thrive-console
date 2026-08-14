"""The write-invariant self-check: the board shows when the local ledger is ahead of the server view.

Sends (console_mail) and replies (console_inbound) reach Supabase only through a best-effort, signed-in-only
mirror queue, and the board reads the server-computed console_board view. So a send or a reply the operator
made can sit in the local ledger while the view still reads Ready/Draft (the cozy-calico and Basel gap).
This brief makes that drift VISIBLE: boardDrift() counts the visible cards whose local ledger holds a
delivered send or a reply the view has not caught up to, and a small warning pill shows the count next to
the sync pill. This proves, on the real app.js against a faithful fake of PostgREST:

  1. Source: the mirror writes no longer swallow a failure (they record it on the diverge ledger); boardDrift
     and the driftBadge exist; the i18n line is present in both languages.
  2. A card with a LOCAL delivered send the view still files as live is counted as drift; a card the view
     agrees is sent is not. A local reply the view has not marked replied is counted too.
  3. With no view loaded there is nothing to be behind, so drift is silent (count 0, no badge).
  4. The badge renders next to the sync pill with the count when drift is nonzero, and hides at zero.
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
ck("boardDrift + driftBadge exist and the badge is wired into the board render",
   "function boardDrift()" in app and "function driftBadge()" in app and "driftBadge();" in app)
ck("the mail and inbound mirror failures are recorded on the diverge ledger, not swallowed (no silent catch)",
   'supaRecordDiverge("mirror", "console_mail"' in app and 'supaRecordDiverge("mirror", "console_inbound"' in app)
ck("the drift line exists in English and Arabic (board_drift, board_drift_t)",
   i18n.count("board_drift:") == 2 and i18n.count("board_drift_t:") == 2)
ck("no em dash / zero-Lotus in the touched sources",
   "\u2014" not in app and "lotus" not in app.lower())

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
    pg.wait_for_function("()=>typeof window.thriveBoardRefresh==='function' && typeof window.boardDrift==='function'", timeout=15000)
    pg.evaluate("()=>{ document.documentElement.classList.remove('gate-locked'); const g=document.getElementById('thriveGate'); if(g) g.remove(); }")

    # Local ledger: cozy has a delivered send, basel has a reply, insync has a send. inbound for basel.
    pg.evaluate("""()=>{
      localStorage.setItem('thrive_opps_v1', JSON.stringify([
        {slug:'cozy', business:'Cozy Calico', published:true, up:1},
        {slug:'basel', business:'Basel Issa', published:true, up:1},
        {slug:'insync', business:'In Sync', published:true, up:1}]));
      localStorage.setItem('thrive_mail_v1', JSON.stringify([
        {mid:'mc', opp:'cozy', to:'tracy@x', status:'sent', direction:'out', ts:'2026-08-01T10:00:00Z'},
        {mid:'mi', opp:'insync', to:'y@y', status:'sent', direction:'out', ts:'2026-08-01T10:00:00Z'}]));
      localStorage.setItem('thrive_inbound_v1', JSON.stringify([
        {gid:'gb', opp:'basel', kind:'reply', from:'basel@x', ts:'2026-08-03T09:00:00Z'}]));
      localStorage.setItem('thrive_hits_v1','[]');
      window.invalidateSends&&window.invalidateSends(); window.invalidateHits&&window.invalidateHits();
    }""")

    # 3. No view loaded -> drift is silent.
    pg.evaluate("()=>window.__boardViewClear()")
    d0 = pg.evaluate("()=>window.boardDrift()")
    ck("with no view loaded, drift is silent (count 0)", d0["count"] == 0, d0)

    # 2. The view is behind: cozy reads live (send not landed), basel not replied, insync agrees sent.
    pg.evaluate("""()=>window.__boardViewSet([
      {slug:'cozy', stage:'live', open_count:0, replied:false, idle_days:1, has_page:true, has_email:false, archived:false},
      {slug:'basel', stage:'sent', open_count:0, replied:false, idle_days:1, has_page:true, has_email:false, archived:false},
      {slug:'insync', stage:'sent', open_count:0, replied:false, idle_days:1, has_page:true, has_email:false, archived:false}
    ])""")
    d1 = pg.evaluate("()=>window.boardDrift()")
    ck("a local send the view still files as live is drift; a reply the view has not marked replied is drift",
       d1["count"] == 2 and set(d1["slugs"]) == {"cozy","basel"}, d1)
    ck("a card the view agrees is sent is NOT drift (insync excluded)", "insync" not in d1["slugs"], d1)

    # 4. The badge renders next to the sync pill with the count, then hides when the drift clears.
    pg.evaluate("()=>{ location.hash='board'; window.thriveBoardRefresh(); }")
    pg.wait_for_timeout(300)
    badge = pg.evaluate("""()=>{ const el=document.getElementById('boardDrift');
      if(!el) return null; const sib=el.previousElementSibling;
      return { shown: el.offsetParent!==null && !el.hidden, text: el.textContent, nextToSync: !!(sib && sib.id==='boardSync') }; }""")
    ck("the drift badge renders next to the sync pill and shows the count", bool(badge) and badge["shown"] and ("2" in badge["text"]) and badge["nextToSync"], badge)

    # Clear the drift (view now agrees everything is sent/replied) -> badge hides.
    pg.evaluate("""()=>window.__boardViewSet([
      {slug:'cozy', stage:'sent', open_count:0, replied:false, idle_days:1, has_page:true, has_email:false, archived:false},
      {slug:'basel', stage:'replied', open_count:0, replied:true, idle_days:1, has_page:true, has_email:false, archived:false},
      {slug:'insync', stage:'sent', open_count:0, replied:false, idle_days:1, has_page:true, has_email:false, archived:false}
    ])""")
    pg.evaluate("()=>window.thriveBoardRefresh()"); pg.wait_for_timeout(200)
    hid = pg.evaluate("""()=>{ const el=document.getElementById('boardDrift'); return { count:window.boardDrift().count, hidden: !el || el.hidden }; }""")
    ck("when the view catches up, drift is zero and the badge hides", hid["count"] == 0 and hid["hidden"], hid)

    ctx.close(); b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
