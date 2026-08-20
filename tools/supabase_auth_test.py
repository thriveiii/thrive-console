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
app_src = open(os.path.join(ROOT, "library/app.js")).read()
ck("supaHydrate has the signed-out empty read guard (empty 200 is not trusted as an empty board)",
   "if(supaReadFlagOn() && !supaSignedIn() && __supa.opps.length===0){" in app_src)

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
  window.__auth = { denyRest:false, closed:false, rows:[], refreshOk:false, refreshCount:0, lastAuth:null, lastKey:null, calls:[], authReq:null };
  window.fetch = async (url, opts) => {
    const method = (opts&&opts.method)||'GET';
    const headers = (opts&&opts.headers)||{};
    const body = (opts&&opts.body) ? JSON.parse(opts.body) : {};
    if (typeof url==='string' && url.indexOf('/auth/v1/token')>=0) {
      // P34 regression guard: record exactly how the auth call authenticated. GoTrue rejects a header-less,
      // query-param-only apikey with "Invalid API key"; the assertions below prove the apikey HEADER is sent.
      window.__auth.authReq = { apikey: headers['apikey']||'', authz: headers['Authorization']||'', ctype: (headers['Content-Type']||headers['content-type']||''), urlHasApikey: url.indexOf('apikey=')>=0 };
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
      window.__auth.calls.push({auth:headers['Authorization']||'', key:headers['apikey']||'', method});
      // A session token is Bearer jwt-...; the anon key is Bearer anon-key. authed = a real session.
      const authed = (headers['Authorization']||'').indexOf('Bearer jwt-')===0;
      if (window.__auth.closed && !authed) {
        // The real shape after the anon door closes: the anon key is a VALID JWT (role anon), so a SELECT
        // returns an empty 200 (RLS filters every row), not a 401; a write is refused with a 403.
        if (method==='GET') return new Response('[]', {status:200, headers:{'Content-Type':'application/json'}});
        return new Response(JSON.stringify({message:'permission denied'}), {status:403, headers:{'Content-Type':'application/json'}});
      }
      if (window.__auth.denyRest)
        return new Response(JSON.stringify({message:'jwt expired'}), {status:401, headers:{'Content-Type':'application/json'}});
      return new Response(JSON.stringify(window.__auth.rows||[]), {status:200, headers:{'Content-Type':'application/json'}});
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

    # 3b. P34 REGRESSION GUARD: the sign-in POST must carry the standard headers. A header-less request that
    #     puts the apikey only in the query string is what GoTrue rejects as "Invalid API key" (the P32
    #     regression, proven on device). This proves the apikey HEADER (+ Authorization Bearer anon + JSON
    #     content type) is sent, exactly as rest() and every other call do.
    areq = pg.evaluate("()=>window.__auth.authReq")
    ck("the sign-in POST sends the apikey HEADER (not query-param-only)", bool(areq) and areq["apikey"] == "anon-key", areq)
    ck("the sign-in POST sends Authorization: Bearer <anon>", bool(areq) and areq["authz"] == "Bearer anon-key", areq)
    ck("the sign-in POST sends Content-Type application/json", bool(areq) and "application/json" in (areq["ctype"] or ""), areq)

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

    # 7. THE GAP FIX. After the close, a signed-out READ is an empty 200 (RLS filters the rows), NOT a 401.
    #    The old code trusted that as an empty board. The guard now marks it authRequired so the UI asks
    #    for a sign-in. The device is emptied too (the Safari-data-clear shape), so there is nothing to
    #    fall back to: the only honest state is the prompt, never a blank board.
    signedout_empty = pg.evaluate("""async ()=>{
       await window.ThriveSupa.signOut();
       localStorage.setItem('thrive_opps_v1','[]');       // this device cleared too: no fallback data
       localStorage.setItem('console_sb_read','1');
       window.__auth.closed=true; window.__auth.denyRest=false; window.__auth.rows=[];
       await window.supaHydrate();
       const st=window.supaReadStatus();
       return { authRequired:st.authRequired, degraded:st.degraded, signedIn:st.signedIn }; }""")
    ck("a signed-out empty read (RLS empty 200) sets authRequired, not a trusted empty board", signedout_empty["authRequired"] == True, signedout_empty)
    ck("the empty-200 denial is signed out and degrades off Supabase", signedout_empty["signedIn"] == False and signedout_empty["degraded"] == True, signedout_empty)

    # The board shows the sign-in prompt, never a blank empty board, even with nothing on this device.
    dom = pg.evaluate("""async ()=>{
       if(window.goTo) window.goTo('board'); else location.hash='#board';
       await new Promise(r=>setTimeout(r,400));
       if(typeof window.thriveBoardRefresh==='function') await window.thriveBoardRefresh();
       await new Promise(r=>setTimeout(r,200));
       const a=document.getElementById('boardAuth'), e=document.getElementById('boardEmpty'), lanes=document.getElementById('boardLanes');
       return { authShown: !!(a && !a.hidden), emptyShown: !!(e && !e.hidden), lanesShown: !!(lanes && !lanes.hidden) }; }""")
    ck("the board shows the sign-in prompt, never a blank empty board", dom["authShown"] == True and dom["emptyShown"] == False, dom)
    ck("the lanes are hidden behind the prompt", dom["lanesShown"] == False, dom)

    # 8. Signed in with a genuinely empty dataset is a normal empty board, no false prompt.
    signedin_empty = pg.evaluate("""async ()=>{
       await window.ThriveSupa.signIn('op@x.com','right');
       window.__auth.rows=[];                              // signed in, legitimately empty
       await window.supaHydrate();
       const st=window.supaReadStatus();
       return { authRequired:st.authRequired, hydrated:st.hydrated, signedIn:st.signedIn }; }""")
    ck("a signed-in empty dataset does not prompt (a normal empty board)", signedin_empty["authRequired"] == False and signedin_empty["hydrated"] == True, signedin_empty)

    # 9. A network degrade (fetch throws) falls back to this device, no sign-in nag: authRequired stays off.
    degrade = pg.evaluate("""async ()=>{
       await window.ThriveSupa.signOut();
       const real=window.fetch;
       window.fetch=async(u,o)=>{ if(typeof u==='string'&&u.indexOf('/rest/v1/')>=0) throw new TypeError('network down'); return real(u,o); };
       await window.supaHydrate();
       window.fetch=real;
       const st=window.supaReadStatus();
       return { authRequired:st.authRequired, degraded:st.degraded }; }""")
    ck("a network degrade does not nag a sign-in (authRequired false)", degrade["authRequired"] == False, degrade)
    ck("a network degrade still degrades to this device", degrade["degraded"] == True, degrade)

    # 10. The write path is unchanged: a signed-out write after the close fails honestly with authRequired.
    write403 = pg.evaluate("""async ()=>{
       window.__auth.closed=true;
       try{ await window.ThriveSupa.upsert('console_opps', {slug:'x', data:{slug:'x'}}); return {threw:false}; }
       catch(e){ return {threw:true, status:e&&e.status, authRequired:!!(e&&e.authRequired)}; } }""")
    ck("a signed-out write after the close fails honestly with authRequired (403)",
       write403["threw"] == True and write403["authRequired"] == True and write403["status"] == 403, write403)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL SUPABASE AUTH CHECKS PASS"))
raise SystemExit(1 if fails else 0)
