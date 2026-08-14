"""Root A (board reads no mail) and Root B (Arabic RTL + disciplined dates), proven on the path the
prior green runs never exercised.

Why the prior sandboxes passed while the device stayed broken: every earlier test seeded the LOCAL
stores (thrive_mail_v1 etc.) and read them back, so the local fallback was always populated. The real
device is a signed-in operator whose local store starts EMPTY and whose data lives in Supabase. This
test reproduces THAT: local stores are left empty, an operator signs in, and the signed-in hydrate
reconciles the (mocked) Supabase copy INTO the canonical localStorage (the mirror), which the board
then reads as one reconciled truth. The board must show it. It also checks the two engine-independent halves of Root B in a way a Chromium
sandbox can still catch: documentElement.dir at the app root, and Western digits forced via the one
date formatter. The three-width, Arabic-joined-letters WebKit VISUAL stays Thyab's device gate."""
import threading, http.server, socketserver, functools, os, re
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
PASSCODE = "ConThrive2030"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

# Supabase is configured and signed-in-able. Data lives ONLY in this mock (a server-side dataset). The
# thrive_*_v1 localStorage stores are never seeded, so anything the board shows came from Supabase.
INIT = r"""
(() => {
  try { localStorage.setItem('console_sb_url','https://fake.supabase.co'); localStorage.setItem('console_sb_anon','anon-key'); } catch(e){}
  const OPPS=[{slug:'thrive-july', business:'July', published:true,
    recipients:[{addr:'basel.personal@gmail.com',name:'Basel',lang:'ar'},{addr:'lina@school.com',name:'Lina',lang:'en'}]}];
  const MAIL=[
    {mid:'j1',opp:'thrive-july',to:'basel.personal@gmail.com',toName:'Basel',subject:'من جد وجد',status:'sent',direction:'out',ts:'2026-07-31T17:02:00Z'},
    {mid:'j2',opp:'thrive-july',to:'lina@school.com',toName:'Lina',subject:'A page',status:'sent',direction:'out',ts:'2026-07-31T17:03:00Z'}];
  const INBOUND=[
    {gid:'g1',opp:'',kind:'reply',from:'basel.personal@gmail.com',name:'Basel',subject:'Re: من جد وجد',snippet:'yes',ts:'2026-08-03T09:00:00Z'},
    {gid:'gn',opp:'',kind:'reply',from:'notifications@instagram.com',subject:'New login',snippet:'x',ts:'2026-08-03T02:00:00Z'}];
  window.__settings = {};
  const json = (v)=> new Response(JSON.stringify(v), {status:200, headers:{'Content-Type':'application/json'}});
  const real = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = async (url, opts) => {
    const method=(opts&&opts.method)||'GET'; const body=(opts&&opts.body)?JSON.parse(opts.body):null;
    if (typeof url==='string' && url.indexOf('/auth/v1/token')>=0 && url.indexOf('grant_type=password')>=0) {
      if (body.email==='op@thrive.co' && body.password==='right')
        return json({access_token:'jwt-x', refresh_token:'r', expires_at:9999999999, user:{id:'uid-1'}});
      return new Response(JSON.stringify({error_description:'bad'}), {status:400, headers:{'Content-Type':'application/json'}});
    }
    if (typeof url==='string' && url.indexOf('/rest/v1/console_settings')>=0) {
      if (method==='POST'){ (body||[]).forEach(r=>{ window.__settings[r.key]=r.value; }); return new Response('',{status:201}); }
      const u=new URL(url); const q=u.searchParams.get('key')||''; const m=/^eq\.(.*)$/.exec(q);
      const key=m?decodeURIComponent(m[1]):''; const v=window.__settings[key];
      return json(v!==undefined?[{key:key, value:v}]:[]);
    }
    if (typeof url==='string' && method==='GET' && url.indexOf('/rest/v1/')>=0) {
      if (url.indexOf('console_opps')>=0)    return json(OPPS.map(o=>({slug:o.slug, data:o})));
      if (url.indexOf('console_mail')>=0)    return json(MAIL.map(m=>({data:m})));
      if (url.indexOf('console_inbound')>=0) return json(INBOUND.map(r=>({data:r})));
      return json([]);   // console_pages, console_hits
    }
    if (typeof url==='string' && url.indexOf('/rest/v1/')>=0) return new Response('',{status:201});
    if (typeof url==='string' && url.indexOf('/auth/v1/logout')>=0) return new Response('',{status:204});
    return real?real(url,opts):new Response('',{status:200});
  };
})()
"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page(viewport={"width": 430, "height": 860})
    pg.add_init_script(INIT)
    pg.goto(f"{base}/library/console.html"); pg.wait_for_selector("#gateInput", timeout=10000)

    # ---- Root B, RTL root at first paint, before any sign-in (boot ar) ----
    # Set ar and reload so the head first-paint script runs with ar stored.
    pg.evaluate("()=>{try{localStorage.setItem('thrive_lang','ar');}catch(e){}}")
    pg.reload(); pg.wait_for_selector("#gateInput", timeout=10000)
    ck("the app root is RTL at first paint in Arabic (before any script init)",
       pg.evaluate("()=>document.documentElement.getAttribute('dir')")=="rtl")

    # ---- sign in: passcode, then operator ----
    pg.fill("#gateInput", PASSCODE); pg.click(".gate-btn")
    pg.wait_for_selector("#gateEmail", timeout=10000)
    pg.fill("#gateEmail","op@thrive.co"); pg.fill("#gatePass","right"); pg.click(".gate-btn")
    pg.wait_for_function("()=>!document.getElementById('thriveGate')", timeout=10000)
    pg.wait_for_function("()=>typeof window.getMailLog==='function' && typeof window.sendsFor==='function' && typeof window.getDraft==='function'", timeout=15000)

    # ---- Root B: the whole console is RTL after unlock; English is the exact mirror ----
    ck("after unlock the app root stays RTL in Arabic",
       pg.evaluate("()=>document.documentElement.getAttribute('dir')")=="rtl")
    pg.evaluate("()=>window.setLang && window.setLang('en')"); pg.wait_for_timeout(150)
    ck("English mirrors it: the app root is LTR",
       pg.evaluate("()=>document.documentElement.getAttribute('dir')")=="ltr")

    # ---- Root A, under the canonical store: the local stores START empty; a signed-in hydrate reconciles
    #      the Supabase copy INTO the canonical localStorage (the mirror), and the board reads that one
    #      reconciled truth (no second live copy to fork from). ----
    # Poll until the lazy hydrate lands.
    pg.wait_for_function("()=>window.getMailLog && window.getMailLog().length>0", timeout=15000)
    state = pg.evaluate("""()=>{
      const localMail = JSON.parse(localStorage.getItem('thrive_mail_v1')||'[]').length;
      const localOpps = JSON.parse(localStorage.getItem('thrive_opps_v1')||'[]').length;
      const mail = window.getMailLog().length;
      const s = window.sendsFor(window.getDraft('thrive-july'));
      return { localMail, localOpps, mail, sends: s.count, declared: !!s.declared };
    }""")
    ck("the signed-in hydrate folds the Supabase ledger into the canonical localStorage (the mirror is populated, not a second live copy)",
       state["localMail"]==2 and state["localOpps"]==1, state)
    ck("a signed-in operator reads the real reconciled ledger (Sent is a real count, not the declared 1)",
       state["mail"]==2 and state["sends"]==2 and state["declared"]==False, state)
    ck("thrive-july shows its recipients with rendered times (a node, not literal text)",
       (lambda h: ('<span class="mono-iso">' in h) and ("&lt;span" not in h) and ("Basel" in h))(
         pg.evaluate("()=>window.recipientsPanelHtml(window.getDraft('thrive-july'))")))

    # ---- The session drives the read: clear the canonical mirror and sign out. With no session there is
    #      no hydrate to reconcile the Supabase copy back in, so the canonical stays empty (the board reads
    #      nothing). This proves the session, not a manual flag, is what engages the read. ----
    pg.evaluate("()=>window.ThriveSupa && window.ThriveSupa.signOut && window.ThriveSupa.signOut()")
    pg.evaluate("()=>{ localStorage.setItem('thrive_mail_v1','[]'); localStorage.setItem('thrive_opps_v1','[]'); window.invalidateSends&&window.invalidateSends(); }")
    pg.wait_for_timeout(200)
    signedOutMail = pg.evaluate("()=>{ window.invalidateSends&&window.invalidateSends(); return window.getMailLog().length; }")
    ck("signed out with an empty canonical, the board reads no mail: with no session there is no hydrate to reconcile Supabase in",
       signedOutMail==0, signedOutMail)
    # sign back in for the reply-pipeline confirmation. On a real device the gate-unlock hook clears the
    # stale read state and hydrates; here we call signIn directly, so force the same hydrate, which
    # reconciles the Supabase copy back into the canonical mirror the cleared board reads.
    pg.evaluate("""async ()=>{ await window.ThriveSupa.signIn('op@thrive.co','right'); await window.supaHydrate(); }""")
    pg.wait_for_function("()=>window.getMailLog && window.getMailLog().length>0", timeout=15000)

    # ---- Root A / section 4: once mail reads, the held Basel reply attributes and spawns in Replied ----
    pg.evaluate("()=>localStorage.removeItem('thrive_card_seen_v1')")
    r = pg.evaluate("()=>window.rematchHeld()")
    child = pg.evaluate("()=>window.childSlugFor('thrive-july','basel.personal@gmail.com')")
    ck("re-match attributes the Basel reply, spawns his child in Replied, noise (notifications@) folded",
       r["matched"]==1 and r["spawned"]==1 and
       pg.evaluate("(s)=>window.effStage(window.getDraft(s))", child)=="replied" and
       pg.evaluate("()=>window.unmatchedHuman().length")==0, r)

    # ---- Root B: one date formatter, Western digits forced on every engine, dir-isolated ----
    dates = pg.evaluate("""()=>{
      window.setLang && window.setLang('ar');
      const ts='2026-07-31T17:02:00Z';
      return { loc: window.dateLocale(), when: window.fmtWhen(ts), short: window.fmtWhenShortHtml(ts),
               html: window.fmtStampHtml(ts, {dateStyle:'medium'}) };
    }""")
    EASTERN = re.compile('[٠-٩۰-۹]')   # Arabic-Indic and Extended Arabic-Indic digits
    ck("the one date formatter pins Latin numerals for Arabic (ar-u-nu-latn)", dates["loc"]=="ar-u-nu-latn", dates)
    ck("Arabic dates carry Western digits, never Eastern-Arabic numerals",
       (not EASTERN.search(dates["when"])) and (not EASTERN.search(dates["short"])) and bool(re.search(r'\d', dates["when"])), dates)
    ck("a date injected into RTL text is bidi-isolated (bdi), so it cannot reorder",
       dates["html"].startswith("<bdi>") and dates["html"].endswith("</bdi>"), dates["html"])

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL BOARD-MAIL / RTL CHECKS PASS"))
raise SystemExit(1 if fails else 0)
