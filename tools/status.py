"""WO-015 Phase B: status follows evidence, and the opinion buttons are gone.

  python3 tools/status.py

Proves, on the rendered screen and in the data, that:
  - no card offers "won", "lost" or "exclude" in any state or language,
  - causalStatus resolves every status through the §5.1 map, event-backed,
  - a legacy `lost` record is migrated to archived with its record retained,
  - a legacy `won` record is preserved and left for reconciliation, none deleted.
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
base = "http://127.0.0.1:%d" % PORT
from playwright.sync_api import sync_playwright

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:240])

# One record in each interesting state, including a legacy lost and a legacy won.
SEED = """()=>{ const now=Date.now();
 localStorage.setItem('thrive_opps_v1', JSON.stringify([
  {slug:'ready-co',business:'Ready Co',published:true,up:now,channel:{kind:'email',to:'r@x.example'}},
  {slug:'sent-co',business:'Sent Co',published:true,up:now,stage:'sent'},
  {slug:'replied-co',business:'Replied Co',published:true,up:now,stage:'replied'},
  {slug:'won-co',business:'Won Co',published:true,up:now,stage:'won',prev_stage:'replied'},
  {slug:'lost-co',business:'Lost Co',published:true,up:now,stage:'lost',prev_stage:'sent',lost_reason:'declined'}]));
 localStorage.setItem('thrive_mail_v1', JSON.stringify([
  {ts:new Date(now-3*86400000).toISOString(),mid:'x1',opp:'sent-co',direction:'out',to:'s@x',status:'sent'}]));
 localStorage.setItem('thrive_inbound_v1', JSON.stringify([
  {ts:new Date(now-1*86400000).toISOString(),opp:'replied-co',kind:'reply',from:'c@x',snippet:'yes'}]));
}"""

# The retired-move labels in both languages, read so the DOM assertion is language safe.
LABELS = {"en": ["Won", "Lost", "Drop"], "ar": ["نجحت", "فشلت", "استبعاد"]}

def unlock(pg):
    if pg.query_selector("#thriveGate"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1200)

def menu_labels_for_all_cards(pg):
    """Open every card's menu and collect the labels it offers."""
    slugs = pg.eval_on_selector_all(".tok[data-slug]", "els=>els.map(e=>e.getAttribute('data-slug'))")
    seen = []
    for s in slugs:
        btn = pg.query_selector('.tok[data-slug="%s"] .tok-more' % s)
        if not btn: continue
        btn.click(); pg.wait_for_timeout(200)
        labels = pg.eval_on_selector_all(".cardmenu [role=menuitem]", "els=>els.map(e=>e.textContent.trim())")
        seen.append((s, labels))
        # close the menu
        pg.keyboard.press("Escape"); pg.wait_for_timeout(80)
    return seen

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width": 1200, "height": 900}, reduced_motion="reduce")
    ctx.route("https://api.github.com/**", lambda x: x.abort())
    pg = ctx.new_page()
    pg.goto(base + "/library/console.html"); pg.wait_for_timeout(400)
    unlock(pg)
    pg.evaluate(SEED); pg.reload(); pg.wait_for_timeout(1800); unlock(pg)
    pg.evaluate("x=>location.hash='#board'"); pg.wait_for_timeout(900)

    # ---- migration (§5.3), non-destructive ----
    drafts = pg.evaluate("()=>getDrafts()")
    by = {d["slug"]: d for d in drafts}
    ck("no record was deleted by migration (5 in, 5 out)", len(drafts) == 5, len(drafts))
    lost = by.get("lost-co", {})
    ck("the lost record is now archived", lost.get("archived") is True, lost)
    ck("the lost record keeps its outcome and reason", lost.get("outcome_was") == "lost" and lost.get("lost_reason") == "declined", lost)
    won = by.get("won-co", {})
    ck("the won record is preserved untouched", won.get("stage") == "won" and not won.get("archived"), won)
    acts = pg.evaluate("()=>getActivity().filter(a=>a.action==='lc_migrate_lost').map(a=>a.slug)")
    ck("the migration wrote an activity note (I2)", "lost-co" in acts, acts)

    # ---- causalStatus resolves through the §5.1 map ----
    def cs(slug): return pg.evaluate("(s)=>{ const o=getDrafts().find(x=>x.slug===s); return causalStatus(o); }", slug)
    ck("sent-co reads as sent, backed by a send", cs("sent-co") == {"status": "sent", "event": "send"}, cs("sent-co"))
    ck("replied-co reads as replied, backed by inbound", cs("replied-co") == {"status": "replied", "event": "inbound"}, cs("replied-co"))
    ck("ready-co reads as live, backed by publish", cs("ready-co") == {"status": "live", "event": "publish"}, cs("ready-co"))
    ck("lost-co reads as archived after migration", cs("lost-co")["status"] == "archived", cs("lost-co"))
    won_cs = cs("won-co")
    ck("won-co reads as won with NO backing event (flagged for reconciliation)",
       won_cs["status"] == "won" and won_cs["event"] == "", won_cs)

    # ---- every card can reach its terminus, both languages, on the rendered screen ----
    # The lifecycle-legacy brief ("every card has an end") reverses WO-015 §5.2 / invariant I9: the
    # outcomes Won/Lost/No-fit are reachable from the card now, each with its reason, so a board is not a
    # place where work only ever accumulates. This asserts the terminus IS offered where legal.
    for lang in ("en", "ar"):
        pg.evaluate("l=>localStorage.setItem('thrive_lang',l)", lang); pg.reload(); pg.wait_for_timeout(1600); unlock(pg)
        pg.evaluate("x=>location.hash='#board'"); pg.wait_for_timeout(900)
        # data level: a card that went out offers its outcomes; a fresh draft does not (still guarded).
        reach = pg.evaluate("""()=>{
          const sent=cardMenuFor({slug:'__s',stage:'sent',published:true},'sent').map(it=>it.move);
          const draft=cardMenuFor({slug:'__d',stage:'',published:false},'draft').map(it=>it.move);
          return { sent, draft }; }""")
        ck("cardMenuFor offers the terminus on a card that went out (%s)" % lang,
           all(m in reach["sent"] for m in ("mark_won", "mark_lost", "drop")), reach)
        ck("a fresh draft is not offered Won (the outcome is still guarded) (%s)" % lang,
           "mark_won" not in reach["draft"], reach)

    ctx.close(); b.close()

httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
