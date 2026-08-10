"""P1.5 PR A - the living card: recipient-level state, a smart Replied column, the personalized send.

Recipient state derives from records, never stored. A group campaign aggregates and never enters Replied;
a recipient's reply spawns exactly one individual child that carries the Replied state, linked both ways
and idempotent. The card's numbers come from one shared derivation. The group send renders each recipient's
own greeting and blocks a recipient with no name. The Basel reply is the named case: his child in Replied,
thrive-july stays in Opened with his row marked Replied.

Per the settled decision, per-recipient Opened is not derived (the send link is shared and opens are keyed
by visitor, not recipient); opens are reported at the campaign aggregate. Arabic rendering and three-width
layout are Thyab's device gate."""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:300])

# no stored per-recipient stage anywhere in the source
app = open(os.path.join(ROOT, "library/app.js")).read()
ck("no per-recipient stage is stored (derive, never stamp)",
   "recipient_stage" not in app and "recipientStage" not in app and "setRecipientStage" not in app)

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page()
    pg.goto(f"{base}/library/console.html"); pg.wait_for_timeout(500)
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(700)
    pg.wait_for_function("()=>typeof window.isGroupOpp==='function' && typeof window.spawnChildrenFromReplies==='function'", timeout=15000)

    # A campaign (thrive-july, three recipients incl. Basel) and a normal single opportunity (acme).
    pg.evaluate("""()=>{
      localStorage.setItem('thrive_opps_v1', JSON.stringify([
        {slug:'thrive-july', business:'July campaign', published:true,
         recipients:[{addr:'basel.personal@gmail.com', name:'Basel', lang:'ar'},
                     {addr:'lina@school.com', name:'Lina', lang:'en'},
                     {addr:'omar@co.com', name:'Omar', lang:'ar'}]},
        {slug:'acme', business:'Acme', published:true}
      ]));
      localStorage.setItem('thrive_mail_v1', JSON.stringify([
        {mid:'j1', opp:'thrive-july', to:'basel.personal@gmail.com', toName:'Basel', subject:'من جد وجد', status:'sent', direction:'out', ts:'2026-08-01T10:00:00Z', actor:'thyab'},
        {mid:'j2', opp:'thrive-july', to:'lina@school.com', toName:'Lina', subject:'A page for you', status:'sent', direction:'out', ts:'2026-08-01T10:01:00Z', actor:'thyab'},
        {mid:'j3', opp:'thrive-july', to:'omar@co.com', toName:'Omar', subject:'A page for you', status:'sent', direction:'out', ts:'2026-08-01T10:02:00Z', actor:'thyab'},
        {mid:'a1', opp:'acme', to:'hi@acme.com', toName:'Acme', subject:'Hello', status:'sent', direction:'out', ts:'2026-08-01T10:00:00Z', actor:'thyab'}
      ]));
      localStorage.setItem('thrive_inbound_v1','[]'); localStorage.setItem('thrive_hits_v1','[]');
      window.invalidateSends&&window.invalidateSends(); window.invalidateHits&&window.invalidateHits();
    }""")

    # ---- group vs single classification, and the never-Replied lane ----
    ck("a campaign with many recipients is a group; a single opportunity is not",
       pg.evaluate("()=>window.isGroupOpp(window.getDraft('thrive-july'))")==True and
       pg.evaluate("()=>window.isGroupOpp(window.getDraft('acme'))")==False)
    ck("a group with sends and no opens sits in Sent",
       pg.evaluate("()=>window.effStage(window.getDraft('thrive-july'))")=="sent")
    pg.evaluate("""()=>{ localStorage.setItem('thrive_hits_v1', JSON.stringify([
        {type:'open', slug:'thrive-july', ts:'2026-08-02T10:00:00Z', vid:'v1'}])); window.invalidateHits&&window.invalidateHits(); }""")
    ck("a group with one open sits in Opened", pg.evaluate("()=>window.effStage(window.getDraft('thrive-july'))")=="opened")

    # ---- a recipient reply spawns exactly one child in Replied, linked both ways ----
    pg.evaluate("""()=>{ localStorage.setItem('thrive_inbound_v1', JSON.stringify([
        {gid:'g1', opp:'', kind:'reply', from:'basel.personal@gmail.com', name:'Basel', subject:'Re: من جد وجد', snippet:'yes', ts:'2026-08-03T09:00:00Z'}])); }""")
    r1 = pg.evaluate("()=>window.rematchHeld()")
    ck("the reply matches the campaign, then spawns one child", r1["matched"]==1 and r1["spawned"]==1, r1)
    childSlug = pg.evaluate("()=>window.childSlugFor('thrive-july','basel.personal@gmail.com')")
    ck("the child exists and is linked back to the parent and recipient",
       pg.evaluate("(s)=>{ const c=window.getDraft(s); return !!(c && c.spawned_from && c.spawned_from.parent==='thrive-july' && c.spawned_from.addr==='basel.personal@gmail.com'); }", childSlug))
    ck("the child derives to Replied", pg.evaluate("(s)=>window.effStage(window.getDraft(s))", childSlug)=="replied")
    ck("the parent campaign stays in Opened, never Replied",
       pg.evaluate("()=>window.effStage(window.getDraft('thrive-july'))")=="opened")
    ck("the parent's stored stage was never stamped replied",
       (pg.evaluate("()=>window.getDraft('thrive-july').stage")) in (None, "", "sent"))
    bs = pg.evaluate("()=>window.recipientState('thrive-july','basel.personal@gmail.com')")
    ck("Basel's recipient row reads Replied and links to his child card",
       bs["chip"]=="replied" and bs["replied"]==True and bs["child"]==childSlug, bs)
    ck("a recipient who did not reply reads Sent",
       pg.evaluate("()=>window.recipientState('thrive-july','lina@school.com').chip")=="sent")

    # ---- idempotent: re-running spawns no duplicate; a second reply appends to the child thread ----
    n_before = pg.evaluate("()=>JSON.parse(localStorage.getItem('thrive_opps_v1')).length")
    r2 = pg.evaluate("()=>window.rematchHeld()")
    ck("re-running re-match spawns no duplicate child", r2["spawned"]==0 and
       pg.evaluate("()=>JSON.parse(localStorage.getItem('thrive_opps_v1')).length")==n_before, r2)
    pg.evaluate("""()=>{ const inb=JSON.parse(localStorage.getItem('thrive_inbound_v1'));
        inb.push({gid:'g2', opp:'', kind:'reply', from:'basel.personal@gmail.com', subject:'Re: من جد وجد', snippet:'following up', ts:'2026-08-05T09:00:00Z'});
        localStorage.setItem('thrive_inbound_v1', JSON.stringify(inb)); }""")
    pg.evaluate("()=>window.rematchHeld()")
    conv = pg.evaluate("(s)=>window.buildThread(s).filter(x=>x.kind==='sent'||x.kind==='reply').map(x=>x.kind+'@'+x.ts)", childSlug)
    ck("the child thread carries the answered send then both replies, oldest to newest",
       conv==['sent@2026-08-01T10:00:00Z','reply@2026-08-03T09:00:00Z','reply@2026-08-05T09:00:00Z'], conv)

    # ---- one shared derivation for the campaign's numbers ----
    st = pg.evaluate("()=>window.campaignStats('thrive-july')")
    ck("campaignStats reports 3 recipients, 3 sends, 1 unique open, 1 reply",
       st["recipients"]==3 and st["sent"]==3 and st["unique"]==1 and st["replies"]==1, st)
    manual = pg.evaluate("""()=>{ const mail=window.getMailLog().filter(m=>m.opp==='thrive-july'&&m.direction!=='in');
        return { sent:mail.length, opens:window.opensForSlug('thrive-july') }; }""")
    ck("the shared derivation equals a direct recomputation (no dual source)",
       st["sent"]==manual["sent"] and st["opens"]==manual["opens"], (st, manual))

    # ---- the single opportunity still behaves exactly as before (Replied via #82) ----
    pg.evaluate("""()=>{ const inb=JSON.parse(localStorage.getItem('thrive_inbound_v1'));
        inb.push({gid:'ga', opp:'acme', kind:'reply', from:'hi@acme.com', subject:'Re: Hello', snippet:'sure', ts:'2026-08-03T09:00:00Z'});
        localStorage.setItem('thrive_inbound_v1', JSON.stringify(inb)); window.invalidateSends&&window.invalidateSends(); }""")
    ck("a single-recipient opportunity still derives Replied directly",
       pg.evaluate("()=>window.effStage(window.getDraft('acme'))")=="replied")

    # ---- personalized group send: per-recipient greeting, missing name blocks that recipient only ----
    tpl = {"subject":"For {{NAME}}","html":"Hi {{NAME}}, here is your page."}
    en = pg.evaluate("(t)=>window.renderPersonalized(t, {addr:'lina@school.com', name:'Lina', lang:'en'})", tpl)
    ar = pg.evaluate("(t)=>window.renderPersonalized(t, {addr:'omar@co.com', name:'عمر', lang:'ar'})", tpl)
    ck("each recipient's own greeting renders, never a bare placeholder",
       "Lina" in en["html"] and "{{" not in en["html"] and "عمر" in ar["html"] and ar["lang"]=="ar", (en, ar))
    blocked = pg.evaluate("(t)=>window.renderPersonalized(t, {addr:'x@y.com', name:'', lang:'en'})", tpl)
    ck("a recipient with no greeting name is blocked, never sent with an empty greeting",
       blocked["ok"]==False and blocked["reason"]=="no-greeting", blocked)
    plan = pg.evaluate("""(t)=>window.groupSendPlan([
        {addr:'lina@school.com', name:'Lina', lang:'en'},
        {addr:'x@y.com', name:'', lang:'en'}], t)""", tpl)
    ck("the pre-send review lists every recipient and blocks only the nameless one",
       len(plan)==2 and plan[0]["blocked"]==False and plan[1]["blocked"]==True, plan)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL LIVING CARD CHECKS PASS"))
raise SystemExit(1 if fails else 0)
