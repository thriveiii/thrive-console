"""Two devices, one shared store. Is it a complete mirror?

Not "did the data arrive" but "are the two consoles the same console". Every kind of change
made on either side has to appear on the other, and that includes the changes that remove
something. A store that only ever unions is not a mirror: it is an archive that argues with
you, and it is why a deleted opportunity used to come back.

Run it: python3 tools/mirror.py
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
base = f"http://127.0.0.1:{PORT}"
EP = f"{base}/exec"

from playwright.sync_api import sync_playwright

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:500])

# The shared store, exactly as the relay holds it: one blob, last writer wins.
STORE = {"data": None}
PUTS = [0]

def relay(route):
    if route.request.method == "GET":
        return route.fulfill(status=200, body="Thrive relay v4 (email + sync + analytics) is running.")
    d = json.loads(route.request.post_data or "{}")
    op = d.get("op")
    if op == "state_get":
        return route.fulfill(status=200, body=json.dumps({"ok": True, "data": STORE["data"]}))
    if op == "state_put":
        STORE["data"] = d.get("data")
        PUTS[0] += 1
        return route.fulfill(status=200, body=json.dumps({"ok": True}))
    if op == "hits_get":
        return route.fulfill(status=200, body=json.dumps({"ok": True, "events": []}))
    return route.fulfill(status=200, body=json.dumps({"ok": True, "id": "x"}))


def device(b, name):
    ctx = b.new_context(viewport={"width": 1280, "height": 900})
    ctx.route("**/exec", relay)
    ctx.route("**/library/sync.json",
              lambda r: r.fulfill(status=200, body=json.dumps({"ep": EP, "up": 1})))
    ctx.route("https://api.github.com/**", lambda r: r.abort())
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(name + ": " + str(e)))
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_timeout(400)
    pg.fill("#gateInput", "ConThrive2030")
    pg.click(".gate-btn")
    pg.wait_for_timeout(2500)
    return ctx, pg, errs


def sync(pg):
    pg.evaluate("async ()=>{ await syncNow(); }")
    pg.wait_for_timeout(900)


def state(pg):
    """What this console holds, in the terms a person would compare two devices in."""
    return pg.evaluate("""async ()=>{
      const opps=(await mergedOpps()).filter(o=>o._local||o._edited).map(o=>o.slug).sort();
      return {
        drafts: getDrafts().map(d=>d.slug).sort(),
        mail: getMailLog().map(m=>m.mid).sort(),
        etpl: getEmailTemplates().map(x=>x.id).sort(),
        tpl: getCustomTemplates().map(x=>x.id).sort(),
        stages: getDrafts().map(d=>d.slug+"="+(d.stage||"")).sort(),
        archived: getDrafts().filter(d=>d.archived).map(d=>d.slug).sort(),
        quota: getSendStamps().length,
        removed: Object.keys(tombs()).sort(),
        fromName: getFromName(),
        touched: opps
      };
    }""")


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ca, A, ea = device(b, "A")
    cb, B, eb = device(b, "B")

    # ---------------------------------------------------------------- 1. creation
    A.evaluate("""()=>{
      saveDraft({slug:'mirror-one', business:'Mirror One', template:'en-opp1',
                 sent_on:'2026-08-01', published:false, mode:'fill', fields:{}});
      saveEmailTemplate({id:'mine', name:'My message', subject:'Hello {{BIZ}}', html:'Hi {{NAME}}'});
      saveCustomTemplate({id:'my-page', name:'My page template', lang:'EN',
                          created:'2026-08-01', html:'<h1>{{BIZ}}</h1>'});
      logMail({opp:'mirror-one', to:'a@b.example', toName:'A', subject:'s', status:'sent', direction:'out'});
    }""")
    sync(A)
    sync(B)
    sa, sb = state(A), state(B)
    ck("an opportunity made on A reaches B", "mirror-one" in sb["drafts"], sb["drafts"])
    ck("a message template made on A reaches B", "mine" in sb["etpl"], sb["etpl"])
    ck("a PAGE template made on A reaches B", "my-page" in sb["tpl"], sb["tpl"])
    ck("and its html travels with it, so B can use it",
       B.evaluate("()=>{const t=getCustomTemplate('my-page');return !!(t&&t.html&&t.html.length);}"))
    ck("a send made on A reaches B's ledger", len(sb["mail"]) == len(sa["mail"]), (sa["mail"], sb["mail"]))

    # ---------------------------------------------------------------- 2. editing
    B.evaluate("""()=>{ saveDraft({slug:'mirror-one', stage:'replied'});
                        saveEmailTemplate({id:'mine', name:'My message, edited'}); }""")
    sync(B)
    sync(A)
    ck("a stage set on B reaches A",
       A.evaluate("()=>getDrafts().find(d=>d.slug==='mirror-one').stage") == "replied")
    ck("an edit to a message template on B reaches A",
       A.evaluate("()=>getEmailTemplates().find(x=>x.id==='mine').name") == "My message, edited")

    # ---------------------------------------------------------------- 3. removal
    # The whole point. A removal is a fact, and it has to travel like one.
    A.evaluate("""()=>{ removeDraft('mirror-one');
                        removeEmailTemplate('mine');
                        removeCustomTemplate('my-page'); }""")
    sync(A)
    sync(B)
    sb = state(B)
    ck("an opportunity removed on A is gone from B", "mirror-one" not in sb["drafts"], sb["drafts"])
    ck("a message template removed on A is gone from B", "mine" not in sb["etpl"], sb["etpl"])
    ck("a page template removed on A is gone from B", "my-page" not in sb["tpl"], sb["tpl"])

    # and it must STAY gone: B pushing its own state must not resurrect it on A
    sync(B)
    sync(A)
    sync(B)
    sa, sb = state(A), state(B)
    ck("and it stays gone after both devices sync again",
       "mirror-one" not in sa["drafts"] and "mirror-one" not in sb["drafts"], (sa["drafts"], sb["drafts"]))
    ck("the removal itself is carried, not just its effect",
       "opp:mirror-one" in sb["removed"], sb["removed"])

    # ---------------------------------------------------------------- 4. re-creation
    # A record made again AFTER it was removed is a new decision and must survive.
    B.evaluate("""()=>{ saveDraft({slug:'mirror-one', business:'Mirror One, again',
                                   published:false, mode:'fill', fields:{}}); }""")
    sync(B)
    sync(A)
    ck("re-creating it after the removal brings it back everywhere",
       A.evaluate("()=>!!getDrafts().find(d=>d.slug==='mirror-one')"))
    ck("with the new content, not the old",
       A.evaluate("()=>(getDrafts().find(d=>d.slug==='mirror-one')||{}).business") == "Mirror One, again")

    # ---------------------------------------------------------------- 5. a deleted stock message
    A.evaluate("()=>removeEmailTemplate('opp-nudge')")
    sync(A)
    sync(B)
    B.reload(); B.wait_for_timeout(2200)          # a reload is where re-seeding used to happen
    sync(B)
    ck("a stock message deleted on A does not re-seed itself on B",
       "opp-nudge" not in B.evaluate("()=>getEmailTemplates().map(x=>x.id)"),
       B.evaluate("()=>getEmailTemplates().map(x=>x.id)"))

    # ---------------------------------------------------------------- 6. archive and settings
    A.evaluate("""()=>{ saveDraft({slug:'mirror-one', archived:true}); setFromName('Thrive Team');
        try{ localStorage.setItem('thrive_scalars_up', String(Date.now())); }catch(e){} }""")
    sync(A)
    sync(B)
    ck("archiving on A reaches B",
       B.evaluate("()=>!!(getDrafts().find(d=>d.slug==='mirror-one')||{}).archived"))
    ck("the sender name reaches B", B.evaluate("()=>getFromName()") == "Thrive Team")

    # ------------------------------------------------- 6b. a hand send, and an order
    # The correction that started this: it does not matter which device the message left from.
    # It left. A send made by hand on A through somebody's contact form has to reach B as a
    # send, and B's board has to move on it, or the two consoles are not one console.
    A.evaluate("""()=>{ saveDraft({slug:'mirror-two', business:'Form Co', published:false,
                                   mode:'fill', fields:{}, channel:{kind:'form',to:'formco.example',note:''},
                                   pitch:{subject:'S', body:'Hi [LINK]'}, owner:'Owner'});
        const o={slug:'mirror-two', business:'Form Co', channel:{kind:'form',to:'formco.example'},
                 pitch:{subject:'S'}, owner:'Owner'};
        recordOffChannelSend(o,'form','','through their form'); }""")
    sync(A)
    sync(B)
    hand = B.evaluate("""()=>{const r=getMailLog().filter(m=>m.opp==='mirror-two');
        return r.length? {provider:r[0].provider, channel:r[0].channel, status:r[0].status} : null;}""")
    ck("a send made by hand on A reaches B's ledger", hand is not None, hand)
    ck("and B can still see it was your confirmation, not a mail server",
       bool(hand) and hand["provider"] == "manual", hand)
    ck("and B can see which door it went through", bool(hand) and hand["channel"] == "form", hand)
    ck("B's board moves it to Sent on that evidence",
       B.evaluate("""async ()=>{const o=(await mergedOpps()).find(x=>x.slug==='mirror-two');
           return effStage(o);}""") == "sent")

    # An order arranged by hand on one device is a decision, and decisions mirror.
    B.evaluate("()=>setLaneOrder(['mirror-two'])")
    sync(B)
    sync(A)
    ck("an order arranged on B reaches A",
       A.evaluate("()=>(getDrafts().find(d=>d.slug==='mirror-two')||{}).ord") == 1)
    A.evaluate("()=>removeDraft('mirror-two')")
    sync(A)
    sync(B)

    # ---------------------------------------------------------------- 7. the whole state
    sa, sb = state(A), state(B)
    for k in ("drafts", "mail", "etpl", "tpl", "stages", "archived", "removed"):
        ck(f"both devices hold the same {k}", sa[k] == sb[k], (k, sa[k], sb[k]))

    # ---------------------------------------------------------------- 8. a third device, empty
    cc, C, ec = device(b, "C")
    sync(C)
    sc = state(C)
    for k in ("drafts", "etpl", "tpl", "stages", "archived"):
        ck(f"a device that has never seen any of it receives the same {k}", sc[k] == sa[k],
           (k, sc[k], sa[k]))
    ck("and the board on the new device reads the same as the others",
       C.evaluate("""async ()=>{const o=await mergedOpps();const op={},vw={};
           o.forEach(x=>{op[x.slug]=outreachOpens(x);vw[x.slug]=opensForSlug(x.slug);});
           return JSON.stringify(ThriveBoard.build(o,{opens:op,views:vw,mail:getMailLog()}).summary.counts);}""")
       == A.evaluate("""async ()=>{const o=await mergedOpps();const op={},vw={};
           o.forEach(x=>{op[x.slug]=outreachOpens(x);vw[x.slug]=opensForSlug(x.slug);});
           return JSON.stringify(ThriveBoard.build(o,{opens:op,views:vw,mail:getMailLog()}).summary.counts);}"""))

    # ---------------------------------------------------------------- 9. a full store
    # The relay refuses a state over 400,000 bytes outright, and a refused push is not a
    # smaller mirror, it is no mirror. A console that has outgrown the store must shed in a
    # fixed order and never shed the evidence.
    A.evaluate("""()=>{
      const log=[]; for(let i=0;i<700;i++) log.push({ts:new Date(Date.now()-i*60000).toISOString(),
        action:'stage', slug:'filler-'+i, detail:'x'.repeat(300)});
      setActivity(log);
      const mail=getMailLog();
      for(let i=0;i<300;i++) mail.push({mid:'big'+i, ts:new Date(Date.now()-i*60000).toISOString(),
        opp:'mirror-one', to:'p'+i+'@x.example', subject:'s', status:'sent', direction:'out',
        preview:'y'.repeat(400)});
      setMailLog(mail);
      saveCustomTemplate({id:'huge-page', name:'Huge', lang:'EN', html:'<p>'+'z'.repeat(120000)+'</p>'});
    }""")
    z = A.evaluate("()=>{ const s=syncSnapshot(); return {bytes:JSON.stringify(s).length, info:syncSize(),"
                   "  mail:(s.mail||[]).length, opps:(s.opps||[]).length, tombs:Object.keys(s.tombs||{}).length}; }")
    print("full store:", z)
    ck("the snapshot stays under the relay's hard cap", z["bytes"] < 400000, z)
    ck("and it says what it shed", bool(z["info"]["shed"]), z["info"])
    ck("the mail ledger is never shed", z["mail"] >= 300, z["mail"])
    ck("the opportunities are never shed", z["opps"] >= 1, z["opps"])
    ck("the removals are never shed", z["tombs"] >= 1, z["tombs"])
    sync(A)
    sync(C)
    ck("and a device still receives the ledger through a full store",
       C.evaluate("()=>getMailLog().length") >= 300, C.evaluate("()=>getMailLog().length"))

    ck("nothing threw on any device", not (ea + eb + ec), (ea + eb + ec)[:4])
    b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
