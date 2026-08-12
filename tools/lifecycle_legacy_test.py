"""Every card has an end, and every old card lives in the new world.

Two joined defects from the device pass, proven fixed here:

  1. Legacy parity. A card made before Stage 4 was written with a `status` (the manifest only ever
     wrote "sent") where the board now reads `stage`, so a card sent months ago derived to the Ready
     lane as if it had never gone out. A read-time normalizer (normalizeOpp, applied once in the one
     chokepoint every screen reads through, mergedOpps) maps a legacy status to the stage the
     derivation honors, and defaults an absent roster, without ever writing back: the board, the
     window and the library all read the normalized view, but the stored row is untouched (the
     persist is the additive SQL Thyab runs).

  2. The terminus. A closed card (won/lost/dropped/bounced/failed) lived in the tray as a plain
     <span> with no handler: unresponsive, unreadable, with no way back to it, and a dropped card was
     not even shown. Now every tray item is a real control that opens its window, dropped is included,
     the derivation still holds the terminus (a closed card never re-derives into an active lane), and
     a reply that arrives after a card closed surfaces (a quiet dot on the tray item, a notice in the
     window) with a one-tap reopen rather than silently reopening the card.

This suite drives the real board and window on legacy and closed shapes. WebKit at three widths is
Thyab's device gate; the structure is proven here.
"""
import threading, http.server, socketserver, functools, os, sys, re
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

# ---- Source guards ----------------------------------------------------------
app = open(f"{ROOT}/library/app.js").read()
ck("a read-time normalizer maps a legacy status to the stage the derivation honors",
   "function normalizeOpp(o)" in app and "LEGACY_DECLARED_STAGES[n.status]" in app
   and "n.stage=n.status" in app)
ck("only the declared stages are carried across, never draft/ready/live",
   "sent:1, opened:1, replied:1, won:1, lost:1, dropped:1, bounced:1, failed:1" in app)
ck("the normalizer runs in mergedOpps, the one read chokepoint",
   re.search(r"o\.archived=!!o\.archived; normalizeOpp\(o\);", app) is not None)
ck("a tray item is a real control that opens its window (not a dead span)",
   "data-tray-open" in app and "class=\"tray-item " in app
   and "#trayList [data-tray-open]" in app)
ck("dropped joins the tray instead of vanishing",
   "dropped=b.closed.dropped||[]" in app and "dropped.map(o=>trayItem(o" in app)
ck("a reply on a closed card surfaces with a one-tap reopen, not a silent one",
   "function closedReplyNotice(o)" in app and "data-reopen=" in app
   and 'runMove("reopen", b.getAttribute("data-reopen"), { confirmed:true })' in app)
ck("an old message template is typed on read like a new one",
   "(x && !x.type) ? {...x, type:T_SNIPPET} : x" in app)

life = open(f"{ROOT}/library/lifecycle.js").read()
ck("reopen is legal from a dropped card too",
   'reopen:          { from: ["won", "lost", "dropped"]' in life)

sql = open(f"{ROOT}/docs/supabase-lifecycle-legacy.sql").read()
ck("the persisted normalization is additive idempotent console_ SQL",
   "update public.console_opps" in sql and "stage is null or stage = ''" in sql
   and "drop " not in sql.lower() and "delete " not in sql.lower())

# ---- Sandbox: the real board and window -------------------------------------
# Legacy shapes and closed shapes, all local drafts (manifest stubbed empty).
OPPS = [
  {"slug":"sent-legacy","business":"Sent Legacy","status":"sent","published":True,"sent_on":"2026-05-01"},
  {"slug":"won-co","business":"Won Co","stage":"won","published":True},
  {"slug":"drop-co","business":"Drop Co","stage":"dropped","drop_reason":"not our line of work","published":True},
  {"slug":"won-reply","business":"Won Reply","stage":"won","published":True},
]
# A reply that arrived on the won-reply card AFTER it was closed.
INBOUND = [{"id":"g1","opp":"won-reply","kind":"","from":"a@x.com","ts":"2026-07-20T10:00:00Z","snippet":"still interested"}]
# An old message template with no type, no name, no up: it must still list and render.
OLDTPL = [{"id":"legacy-tpl","locale":"EN","subject":"Hi {{BIZ}}","html":"Hello {{NAME}}"}]

def boot(pg, lang="en"):
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_function("()=>typeof window.thriveBoardRefresh==='function'", timeout=15000)
    pg.evaluate("()=>{document.documentElement.classList.remove('gate-locked');const g=document.getElementById('thriveGate');if(g)g.remove();}")
    pg.evaluate("""(a)=>{ localStorage.setItem('thrive_lang',a.lang);
        localStorage.setItem('thrive_opps_v1',JSON.stringify(a.opps));
        localStorage.setItem('thrive_inbound_v1',JSON.stringify(a.inbound));
        localStorage.setItem('thrive_email_templates_v1',JSON.stringify(a.tpl)); }""",
        {"lang":lang,"opps":OPPS,"inbound":INBOUND,"tpl":OLDTPL})
    pg.reload()
    pg.wait_for_function("()=>typeof window.thriveBoardRefresh==='function'", timeout=15000)
    pg.evaluate("()=>{document.documentElement.classList.remove('gate-locked');const g=document.getElementById('thriveGate');if(g)g.remove();}")
    pg.evaluate("()=>location.hash='board'"); pg.wait_for_timeout(500)
    pg.evaluate("()=>window.thriveBoardRefresh()"); pg.wait_for_timeout(400)

def lane_of(pg, slug):
    return pg.evaluate("""(s)=>{ const tok=document.querySelector('.tok[data-slug=\"'+s+'\"]');
        if(!tok) return null; const l=tok.closest('[data-body]'); return l?l.getAttribute('data-body'):null; }""", slug)

def open_modal(pg, slug):
    pg.evaluate("(s)=>window.thriveModal.open(s,'overview',s)", slug); pg.wait_for_timeout(300)

def close_modal(pg):
    pg.evaluate("()=>{ if(window.thriveModal) window.thriveModal.close(true); }"); pg.wait_for_timeout(150)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width":1280,"height":900})
    ctx.route("https://api.github.com/**", lambda r: r.abort())
    ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))
    pg = ctx.new_page()
    boot(pg)

    # ---- Legacy parity: a legacy status:sent card derives, clicks, can be closed ----
    ck("legacy status:sent derives to the Sent lane, not a never-sent Ready", lane_of(pg,"sent-legacy")=="sent", lane_of(pg,"sent-legacy"))
    open_modal(pg,"sent-legacy")
    ck("a legacy card clicks open into its window", pg.evaluate("()=>{const m=document.getElementById('modal');return m && !m.hidden;}"))
    moves=pg.evaluate("()=>[...document.querySelectorAll('#modalOverview [data-move]')].map(b=>b.getAttribute('data-move'))")
    ck("a legacy card can reach a terminal state (Won/Lost/No-fit) from its window",
       any(m in moves for m in ["mark_won","mark_lost","drop"]), moves)
    close_modal(pg)

    # ---- The terminus: every closed card is countable and retrievable ----
    tray=pg.evaluate("""()=>{ const items=[...document.querySelectorAll('#trayList .tray-item')].map(e=>({
        tag:e.tagName, slug:e.getAttribute('data-slug'), reply:e.classList.contains('has-reply'),
        dot:!!e.querySelector('.tray-dot'), open:e.hasAttribute('data-tray-open') }));
        return { count:document.getElementById('trayList').querySelectorAll('.tray-item').length, items }; }""")
    slugs={i["slug"] for i in tray["items"]}
    ck("won, dropped and won-reply are all in the Closed tray (dropped no longer vanishes)",
       {"won-co","drop-co","won-reply"}.issubset(slugs), tray)
    ck("every tray item is a real button that opens its window",
       all(i["tag"]=="BUTTON" and i["open"] and i["slug"] for i in tray["items"]), tray)

    # click a closed card -> it opens
    pg.evaluate("()=>{ const b=document.querySelector('#trayList [data-slug=\"won-co\"]'); if(b) b.click(); }")
    pg.wait_for_timeout(350)
    ck("a closed card in the tray opens its window on one tap", pg.evaluate("()=>{const m=document.getElementById('modal');return m && !m.hidden;}"))
    close_modal(pg)

    # ---- The terminus holds: a closed card never re-derives active ----
    ck("a won card stays won, never re-derived into an active lane",
       pg.evaluate("()=>window.effStage({slug:'won-co',stage:'won',published:true})")=="won")
    ck("the won card is not present in any active lane", lane_of(pg,"won-co") is None, lane_of(pg,"won-co"))

    # ---- Reply on a closed card: surfaces, does not silently reopen ----
    rep=[i for i in tray["items"] if i["slug"]=="won-reply"][0]
    ck("a reply that arrived after closing is marked on the tray item (a dot), not a silent reopen",
       rep["reply"] and rep["dot"], rep)
    ck("the replied-on card is still closed (won), not silently reopened", lane_of(pg,"won-reply") is None)
    open_modal(pg,"won-reply")
    notice=pg.evaluate("""()=>{ const n=document.querySelector('#modalOverview .mw-reopen');
        return { has:!!n, btn:!!(n && n.querySelector('[data-reopen]')) }; }""")
    ck("the window surfaces the reply with a one-tap reopen control", notice["has"] and notice["btn"], notice)
    # one tap reopen -> the card moves to the Replied lane
    pg.evaluate("()=>{ const b=document.querySelector('#modalOverview [data-reopen]'); if(b) b.click(); }")
    pg.wait_for_timeout(500)
    close_modal(pg)
    pg.evaluate("()=>window.thriveBoardRefresh()"); pg.wait_for_timeout(400)
    ck("one-tap reopen moves the card into the Replied lane", lane_of(pg,"won-reply")=="replied", lane_of(pg,"won-reply"))
    ck("the reopened card is no longer in the Closed tray",
       pg.evaluate("()=>!document.querySelector('#trayList [data-slug=\"won-reply\"]')"))

    # ---- Old templates render with current defaults, no crash ----
    tpl=pg.evaluate("""()=>{ const all=window.getEmailTemplates();
        const t=all.find(x=>x.id==='legacy-tpl');
        let rendered=null, threw=false;
        try{ rendered=window.mergeFieldsHtml(t.html,{slug:'x',business:'Biz'},'Sam',''); }catch(e){ threw=true; }
        return { found:!!t, type:t&&t.type, threw, rendered }; }""")
    ck("an old template is typed on read (defaults to a text snippet)", tpl["found"] and tpl["type"]=="text-snippet", tpl)
    ck("an old template renders with defaults, no broken layout, no crash",
       (not tpl["threw"]) and tpl["rendered"] and "Sam" in tpl["rendered"], tpl)

    ctx.close(); b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
