"""Path A · Supabase Auth: the console signs in and carries a real session, not a secret.

Sentinel Sweep 1 found every console_ table carries a permissive policy `for all to anon using (true)`,
and the anon key ships in the browser, so anyone with it had full CRUD on all console data. Path A closes
that door: one operator account in Supabase Auth, a real sign-in in Settings, and every data call carries
the session JWT instead of the anon key so RLS can scope to the authenticated session. This proves the
client half in the sandbox with a mocked auth endpoint:

  * before sign-in, a data call carries Bearer <anon> (the current, still-open behaviour);
  * sign-in stores a session and a data call then carries Bearer <jwt>, NOT the anon key;
  * a wrong password throws a real error and does not sign in (no secret is accepted as access);
  * sign-out reverts to the anon key;
  * a 401 with a refresh token in hand refreshes once and retries (the session self-heals);
  * a persistent 401 (no session, the door closed) sets authRequired and the board falls back to this
    device, an honest denial, never a blank board.

The sandbox is Chromium-only and cannot reach the live Supabase or run WebKit, so the true close of the
anon door (the run-once removal SQL) and real-device sign-in are Thyab's device gate."""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None:
            print("      " + str(d)[:300])

# ---- source: the token flow is explicit and the anon key is never used as an access token ----
sup = open(os.path.join(ROOT, "library/supabase.js")).read()
ck("rest sends the session bearer, not always the anon key",
   '"Authorization": "Bearer " + bearer()' in sup and "return (s && s.access_token) ? s.access_token : c.anon" in sup)
ck("a persistent 401/403 is marked authRequired for an honest denial",
   "err.authRequired = true" in sup)
ck("signIn/signOut/session are exported on ThriveSupa",
   "signIn: signIn" in sup and "signOut: signOut" in sup and "signedIn: signedIn" in sup)

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

# A mocked Supabase: the password grant issues a JWT for the right password only; the refresh grant issues
# a fresh JWT when armed; the REST endpoint records the Authorization header it saw and can be told to deny.
FAKE = r"""
() => {
  window.__real_fetch = window.fetch.bind(window);
  window.__auth = { denyRest:false, refreshOk:false, refreshCount:0, lastAuth:null, lastKey:null, calls:[] };
  window.fetch = async (url, opts) => {
    const method = (opts&&opts.method)||'GET';
    const headers = (opts&&opts.headers)||{};
    const body = (opts&&opts.body) ? JSON.parse(opts.body) : {};
    if (typeof url==='string' && url.indexOf('/auth/v1/token')>=0) {
      if (url.indexOf('grant_type=password')>=0) {
        if (body.password==='right')
          return new Response(JSON.stringify({access_token:'jwt-good', refresh_token:'refresh-1', expires_at:9999999999}), {status:200, headers:{'Content-Type':'application/json'}});
        return new Response(JSON.stringify({error_description:'Invalid login credentials'}), {status:400, headers:{'Content-Type':'application/json'}});
      }
      if (url.indexOf('grant_type=refresh_token')>=0) {
        window.__auth.refreshCount++;
        if (window.__auth.refreshOk)
          return new Response(JSON.stringify({access_token:'jwt-refreshed', refresh_token:'refresh-2', expires_at:9999999999}), {status:200, headers:{'Content-Type':'application/json'}});
        return new Response(JSON.stringify({error:'bad refresh'}), {status:400, headers:{'Content-Type':'application/json'}});
      }
    }
    if (typeof url==='string' && url.indexOf('/auth/v1/logout')>=0)
      return new Response('', {status:204});
    if (typeof url==='string' && url.indexOf('/rest/v1/')>=0) {
      window.__auth.lastAuth = headers['Authorization']||'';
      window.__auth.lastKey = headers['apikey']||'';
      window.__auth.calls.push({auth:headers['Authorization']||'', key:headers['apikey']||''});
      if (window.__auth.denyRest)
        return new Response(JSON.stringify({message:'permission denied'}), {status:401, headers:{'Content-Type':'application/json'}});
      return new Response('[]', {status:200, headers:{'Content-Type':'application/json'}});
    }
    return window.__real_fetch(url, opts);
  };
  return true;
}
"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page()
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_timeout(500)
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(700)
    pg.wait_for_function("()=>window.ThriveSupa && typeof window.ThriveSupa.signIn==='function'", timeout=15000)

    pg.evaluate(FAKE)
    pg.evaluate("()=>{ window.ThriveSupa.setCfg('https://fake.supabase.co','anon-key'); try{ window.ThriveSupa.signOut(); }catch(e){} }")

    # 1. Before sign-in, a data call carries the anon key as the bearer. This is the still-open behaviour.
    r1 = pg.evaluate("""async ()=>{ window.__auth.lastAuth=null;
       await window.ThriveSupa.rest('console_opps', {query:'select=slug'});
       return { auth: window.__auth.lastAuth, key: window.__auth.lastKey }; }""")
    ck("before sign-in the data call carries Bearer <anon>", r1["auth"] == "Bearer anon-key", r1)
    ck("the apikey header is always the anon key (Supabase requires it)", r1["key"] == "anon-key", r1)
    ck("not signed in reports false", pg.evaluate("()=>window.ThriveSupa.signedIn()") == False)

    # 2. A wrong password throws a real error and does not sign in. No secret is accepted as access.
    wrong = pg.evaluate("""async ()=>{ try{ await window.ThriveSupa.signIn('op@x.com','wrong'); return {threw:false}; }
       catch(e){ return {threw:true, msg:String(e&&e.message||'')}; } }""")
    ck("a wrong password throws a real error", wrong["threw"] and "credential" in wrong["msg"].lower(), wrong)
    ck("a failed sign-in leaves the operator signed out", pg.evaluate("()=>window.ThriveSupa.signedIn()") == False)

    # 3. Sign-in stores a session; the email is remembered.
    ok = pg.evaluate("""async ()=>{ const r=await window.ThriveSupa.signIn('op@x.com','right');
       return { ok:r&&r.ok, inn:window.ThriveSupa.signedIn(), email:window.ThriveSupa.authEmail() }; }""")
    ck("the right password signs in", ok["ok"] == True and ok["inn"] == True, ok)
    ck("the signed-in email is remembered", ok["email"] == "op@x.com", ok)

    # 4. Signed in, a data call carries the session JWT, NOT the anon key.
    r2 = pg.evaluate("""async ()=>{ window.__auth.lastAuth=null;
       await window.ThriveSupa.rest('console_opps', {query:'select=slug'});
       return { auth: window.__auth.lastAuth, key: window.__auth.lastKey }; }""")
    ck("signed in the data call carries Bearer <jwt>, not the anon key", r2["auth"] == "Bearer jwt-good", r2)
    ck("the token is the session token, never the anon key as an access control", r2["auth"] != "Bearer anon-key", r2)

    # 5. A 401 with a refresh token in hand refreshes once and retries; the session self-heals.
    heal = pg.evaluate("""async ()=>{
       window.__auth.refreshOk=true; window.__auth.refreshCount=0;
       let deniedFirst=true, calls=0;
       const real=window.fetch;
       window.fetch=async(u,o)=>{ if(typeof u==='string'&&u.indexOf('/rest/v1/')>=0){ calls++;
         if(calls===1) return new Response(JSON.stringify({message:'jwt expired'}),{status:401,headers:{'Content-Type':'application/json'}});
       } return real(u,o); };
       let okAfter=false, err=null;
       try{ await window.ThriveSupa.rest('console_opps',{query:'select=slug'}); okAfter=true; }catch(e){ err=String(e&&e.message||''); }
       window.fetch=real;
       return { okAfter, refreshCount:window.__auth.refreshCount, calls, err, token:(window.ThriveSupa.session()||{}).access_token }; }""")
    ck("a 401 with a refresh token refreshes once and retries to success", heal["okAfter"] == True and heal["refreshCount"] == 1, heal)
    ck("the refreshed token replaces the expired one", heal["token"] == "jwt-refreshed", heal)

    # 6. Sign-out reverts to the anon key.
    r3 = pg.evaluate("""async ()=>{ await window.ThriveSupa.signOut(); window.__auth.lastAuth=null;
       await window.ThriveSupa.rest('console_opps', {query:'select=slug'});
       return { inn:window.ThriveSupa.signedIn(), auth:window.__auth.lastAuth }; }""")
    ck("sign-out reverts to the anon key", r3["inn"] == False and r3["auth"] == "Bearer anon-key", r3)

    # 7. A persistent 401 with no session (the door closed, not signed in) marks authRequired, and the
    #    board falls back to this device: an honest denial, never a blank board.
    denied = pg.evaluate("""async ()=>{
       localStorage.setItem('thrive_opps_v1', JSON.stringify([{slug:'local-a', business:'Local A', published:true}]));
       localStorage.setItem('console_sb_read','1');
       window.__auth.denyRest=true;
       await window.supaHydrate();
       const st=window.supaReadStatus();
       const drafts=window.getDrafts();
       return { authRequired:st.authRequired, degraded:st.degraded, source:st.source, draftCount:drafts.length }; }""")
    ck("a persistent 401 sets authRequired", denied["authRequired"] == True, denied)
    ck("the denial is distinct from a plain degrade but still degrades reads", denied["degraded"] == True, denied)
    ck("the board falls back to this device, never blank", denied["draftCount"] >= 1 and denied["source"] == "local", denied)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL SUPABASE AUTH CHECKS PASS"))
raise SystemExit(1 if fails else 0)
