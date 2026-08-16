"""P1.6 - harden the living card, the badge, the login routing, per-operator memory.

Closes the device-found defects: the recipients panel rendered a built-HTML time string as literal text
(esc around ltr); the badge opened a silent Overview; the replies badge counted automated mail as human;
sign-in routed to Settings. Adds per-operator memory (prefs keyed to the Supabase uid, on console_settings,
no new SQL). Arabic rendering and three-width layout stay Thyab's device gate."""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
PASSCODE = "ConThrive2030"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:300])

# ---- source: the exact fixed sinks and the routing ----
app = open(os.path.join(ROOT, "library/app.js")).read()
ck("no esc(ltr( double-escape sink remains on the card or inbox path", "esc(ltr(" not in app)
ck("the badge and inbox read one shared unmatched-human derivation", "function unmatchedHuman(" in app and "n=unmatchedHuman().length" in app)
gate = open(os.path.join(ROOT, "library/gate.js")).read()
ck("operator sign-in routes to the board", 'location.hash = "board"' in gate and "showOperatorStep" in gate)
ck("per-operator prefs are keyed to the uid on console_settings (no new SQL)",
   'op_prefs:' in app and "console_settings" in app and "authUid" in app)

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

INIT = r"""
(() => {
  try { localStorage.setItem('console_sb_url','https://fake.supabase.co'); localStorage.setItem('console_sb_anon','anon-key'); } catch(e){}
  // Seed the stores BEFORE any hydrate can run. Post-fix, a signed-in operator is the read authority
  // (reads come from Supabase), so the mock below SERVES these console_ tables from the same seed. This
  // is exactly the signed-in path the old sandbox never exercised: local empty, session on, Supabase
  // has the data. Seeding here (not mid-test) guarantees the hydrate reads it.
  try {
    localStorage.setItem('thrive_opps_v1', JSON.stringify([{slug:'thrive-july', business:'July', published:true,
      recipients:[{addr:'basel.personal@gmail.com',name:'Basel',lang:'ar'},{addr:'lina@school.com',name:'Lina',lang:'en'}]}]));
    localStorage.setItem('thrive_mail_v1', JSON.stringify([
      {mid:'j1',opp:'thrive-july',to:'basel.personal@gmail.com',toName:'Basel',subject:'من جد وجد',status:'sent',direction:'out',ts:'2026-07-31T17:02:00Z'},
      {mid:'j2',opp:'thrive-july',to:'lina@school.com',toName:'Lina',subject:'A page',status:'sent',direction:'out',ts:'2026-07-31T17:03:00Z'}]));
    localStorage.setItem('thrive_inbound_v1', JSON.stringify([
      // Basel's reply subject was stripped, so it matches NO send subject: the subject link cannot attach it
      // and it stays genuinely held (sender-only) until the re-match below. A subject that DID match a send
      // auto-resolves at read time now (reply_link_test), so this fixture keeps testing the held->rematch path.
      {gid:'g1',opp:'',kind:'reply',from:'basel.personal@gmail.com',name:'Basel',subject:'Following up',snippet:'yes',ts:'2026-08-03T09:00:00Z'},
      {gid:'gn',opp:'',kind:'reply',from:'notifications@instagram.com',subject:'New login',snippet:'x',ts:'2026-08-03T02:00:00Z'}]));
    localStorage.setItem('thrive_hits_v1','[]');
  } catch(e){}
  window.__settings = {};                       // the console_settings store (key -> value)
  const g = (k)=>{ try{ return JSON.parse(localStorage.getItem(k)||'[]'); }catch(e){ return []; } };
  const json = (v)=> new Response(JSON.stringify(v), {status:200, headers:{'Content-Type':'application/json'}});
  const real = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = async (url, opts) => {
    const method=(opts&&opts.method)||'GET'; const body=(opts&&opts.body)?JSON.parse(opts.body):null;
    if (typeof url==='string' && url.indexOf('/auth/v1/token')>=0) {
      if (url.indexOf('grant_type=password')>=0) {
        if (body.email==='op@thrive.co' && body.password==='right')
          return json({access_token:'jwt-x', refresh_token:'r', expires_at:9999999999, user:{id:'uid-1'}});
        return new Response(JSON.stringify({error_description:'bad'}), {status:400, headers:{'Content-Type':'application/json'}});
      }
    }
    if (typeof url==='string' && url.indexOf('/rest/v1/console_settings')>=0) {
      if (method==='POST'){ (body||[]).forEach(r=>{ window.__settings[r.key]=r.value; }); return new Response('',{status:201}); }
      const u=new URL(url); const q=u.searchParams.get('key')||''; const m=/^eq\.(.*)$/.exec(q);
      const key=m?decodeURIComponent(m[1]):''; const v=window.__settings[key];
      return json(v!==undefined?[{key:key, value:v}]:[]);
    }
    if (typeof url==='string' && method==='GET' && url.indexOf('/rest/v1/')>=0) {
      if (url.indexOf('console_opps')>=0)    return json(g('thrive_opps_v1').map(o=>({slug:o.slug, data:o})));
      if (url.indexOf('console_mail')>=0)    return json(g('thrive_mail_v1').map(m=>({data:m})));
      if (url.indexOf('console_inbound')>=0) return json(g('thrive_inbound_v1').map(r=>({data:r})));
      if (url.indexOf('console_hits')>=0)    return json(g('thrive_hits_v1').map(h=>({data:h})));
      return json([]);   // console_pages and anything else
    }
    if (typeof url==='string' && url.indexOf('/rest/v1/')>=0) return new Response('',{status:201});  // fire-and-forget writes
    if (typeof url==='string' && url.indexOf('/auth/v1/logout')>=0) return new Response('',{status:204});
    return real?real(url,opts):new Response('',{status:200});
  };
})()
"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page()
    pg.add_init_script(INIT)
    pg.goto(f"{base}/library/console.html"); pg.wait_for_timeout(400)

    # ---- item 4: operator sign-in routes to the board ----
    pg.wait_for_selector("#gateInput", timeout=10000)
    pg.fill("#gateInput", PASSCODE); pg.click(".gate-btn")
    pg.wait_for_selector("#gateEmail", timeout=10000)
    pg.fill("#gateEmail","op@thrive.co"); pg.fill("#gatePass","right"); pg.click(".gate-btn")
    pg.wait_for_function("()=>!document.getElementById('thriveGate')", timeout=10000)
    ck("a successful operator sign-in routes to the board, not Settings", pg.evaluate("()=>location.hash")=="#board")
    pg.wait_for_function("()=>typeof window.recipientsPanelHtml==='function' && typeof window.rematchHeld==='function'", timeout=15000)

    # ---- item 1: the recipients panel renders the time as a node, not literal text ----
    # Data was seeded in INIT (before hydrate) and is served by the mock; here only reset the derived
    # caches and the last-seen marker so the badge sees the reply as new.
    pg.evaluate("""()=>{ localStorage.removeItem('thrive_card_seen_v1');
      window.invalidateSends&&window.invalidateSends(); window.invalidateHits&&window.invalidateHits(); }""")
    html = pg.evaluate("()=>window.recipientsPanelHtml(window.getDraft('thrive-july'))")
    ck("the recipient time renders as markup, not an escaped literal string",
       '<span class="mono-iso">' in html and "&lt;span" not in html, html[:120])

    # ---- item 3: the badge counts human only; automated (incl. notifications@) is folded ----
    ck("notifications@ and platform senders are classified noise",
       pg.evaluate("()=>window.inboundIsNoise({from:'notifications@instagram.com',subject:'New login',kind:'reply'})")==True and
       pg.evaluate("()=>window.inboundIsNoise({from:'basel.personal@gmail.com',subject:'Re: hi',kind:'reply'})")==False)
    ck("the unmatched-human count excludes automated (Basel yes, the Instagram notice no)",
       pg.evaluate("()=>window.unmatchedHuman().length")==1)

    # ---- item 6: re-match attributes Basel, spawns his child in Replied, noise stays folded ----
    r = pg.evaluate("()=>window.rematchHeld()")
    child = pg.evaluate("()=>window.childSlugFor('thrive-july','basel.personal@gmail.com')")
    ck("re-match attributes Basel and spawns his child in Replied, noise folded",
       r["matched"]==1 and r["spawned"]==1 and pg.evaluate("(s)=>window.effStage(window.getDraft(s))",child)=="replied"
       and pg.evaluate("()=>window.unmatchedHuman().length")==0)

    # ---- item 2: the badge leads to the update (target + highlight) ----
    pg.evaluate("()=>localStorage.removeItem('thrive_card_seen_v1')")
    tgt = pg.evaluate("(s)=>window.cardNewTarget(s)", child)
    ck("a card with a new reply targets the reply on the thread tab",
       tgt and tgt["kind"]=="reply" and tgt["tab"]=="history" and tgt["id"], tgt)

    # ---- item 5: per-operator memory persists to console_settings keyed to the uid ----
    saved = pg.evaluate("""async ()=>{
      window.setLang && window.setLang('ar');            // a user language change
      await new Promise(r=>setTimeout(r,600));            // let the debounced write land
      return { uid: window.ThriveSupa.authUid(), store: window.__settings }; }""")
    key = "op_prefs:"+saved["uid"]
    ck("a preference change writes to console_settings keyed to the operator uid, never shared",
       saved["uid"]=="uid-1" and key in saved["store"] and saved["store"][key].get("lang")=="ar", saved)
    read = pg.evaluate("""async ()=>{
      localStorage.setItem('thrive_lang','en');           // simulate a fresh device default
      await window.opPrefsLoad();                          // read on sign-in
      return localStorage.getItem('thrive_lang'); }""")
    ck("prefs are read back on sign-in and applied (language restored to the operator's choice)", read=="ar", read)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL HARDEN CHECKS PASS"))
raise SystemExit(1 if fails else 0)
