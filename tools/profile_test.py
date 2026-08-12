"""A complete operator profile, and the two-tier gate enforced at the database (WO-029 Phase A).

Every operator has a whole profile: an identity header, three self-contained regions (Preferences,
Memory, Performance) with no empty region and no dead control, and a reserved infrastructure zone that
is present-and-functional for the owner and ABSENT for every other operator. The tier is a database
fact (console_admins), not a client flag: the client only ever asks "is my own uid an admin", and no
admin address is a literal in any client. Preferences persist to console_profiles (per-owner RLS) and
reconstruct on a fresh load. Performance derives from the SAME source as the board (operatorStats),
filtered to the operator by the actor now stamped from the signed-in identity.

The real RLS and two real identities are Thyab's device gate; the client's tier read, per-uid keying,
region completeness, and derivation are proven here against a mocked Supabase.
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

# ---- Source guards: the spine and the boundary --------------------------------
app = open(f"{ROOT}/library/app.js").read()
sql = open(f"{ROOT}/docs/supabase-operator-profile.sql").read()

ck("the send is stamped with the signed-in operator, not a hardcoded name (D3)",
   "function currentActor()" in app and "ThriveSupa.authUid" in app
   and "actor:currentActor()" in app and "r.actor=currentActor()" in app)
ck("a profile store keyed to the operator's uid, following the Stage-4 read/cache/write pattern",
   "async function loadProfile()" in app and "console_profiles" in app
   and 'query:"uid=eq."' in app and "profileCacheWrite" in app)
ck("the owner tier is read from console_admins for one's OWN uid, never an address literal",
   "async function loadAdminTier()" in app and 'rest("console_admins"' in app
   and "function isOwnerTier()" in app)
ck("performance derives from the one source (operatorStats reuses outreachOpens / hasReply)",
   "function operatorStats(" in app and "outreachOpens(slug)" in app and "if(hasReply(slug)) replies++" in app)
ck("no admin address is a literal in the shipped client",
   re.search(r"abdu\.thyab", open(f"{ROOT}/library/app.js").read()) is None)

ck("the SQL scopes each profile row to its owner (per-owner RLS), with NO anon access",
   "console_profiles_own on public.console_profiles for all to authenticated using (uid = auth.uid())" in sql
   and "to anon" not in sql)
ck("the admins table is readable only for one's own uid and writable by no client (un-self-promotable)",
   "console_admins_read_own on public.console_admins for select to authenticated using (uid = auth.uid())" in sql
   and "for insert" not in sql and "for update" not in sql)
ck("the admin identity is seeded from auth.users by email, only in the SQL Thyab runs",
   "insert into console_admins" in sql and "from auth.users" in sql and "abdu.thyab@gmail.com" in sql)

# newsroom firewall / isolation: no Lotus, no newsroom identity in the client
libjoin = ""
for f in ["app.js","profile.html","i18n.js","styles.css"]:
    libjoin += open(f"{ROOT}/library/{f}").read()
ck("isolation: no Lotus and no newsroom identity in the profile client",
   re.search(r"lotus", libjoin, re.I) is None)

UID = "op-uid-123"; EMAIL = "mohammed@thrive.test"
MAIL = [
  {"mid":"m1","opp":"x","actor":UID,"to":"a@x.com","subject":"hi","status":"sent","direction":"out","ts":"2026-08-01T10:00:00Z"},
  {"mid":"m2","opp":"y","actor":UID,"to":"b@x.com","subject":"hi","status":"sent","direction":"out","ts":"2026-08-02T10:00:00Z"},
  {"mid":"m3","opp":"z","actor":"thyab","to":"c@x.com","subject":"hi","status":"sent","direction":"out","ts":"2026-08-02T10:00:00Z"},
]
INBOUND = [{"gid":"g1","opp":"x","kind":"reply","from":"a@x.com","snippet":"yes","ts":"2026-08-03T09:00:00Z"}]
ACTIVITY = [{"ts":"2026-08-03T10:00:00Z","action":"lc_mark_won","slug":"x","detail":"","actor":UID}]

def seed(pg):
    pg.evaluate("""(a)=>{ localStorage.setItem('thrive_lang','en');
        localStorage.setItem('thrive_mail_v1',JSON.stringify(a.mail));
        localStorage.setItem('thrive_inbound_v1',JSON.stringify(a.inbound));
        localStorage.setItem('thrive_activity_v1',JSON.stringify(a.activity)); }""",
        {"mail":MAIL,"inbound":INBOUND,"activity":ACTIVITY})

def override_supa(pg, admin, profile_row):
    pg.evaluate("""(a)=>{
        const S = window.ThriveSupa;
        S.ready = ()=>true; S.authUid = ()=>a.uid; S.authEmail = ()=>a.email;
        window.__ups = [];
        S.upsert = (t,r)=>{ window.__ups.push({t:t, r:r}); return Promise.resolve([r]); };
        window.__admin = a.admin; window.__row = a.row;
        S.rest = (t,opts)=>{
          if(t==='console_admins') return Promise.resolve(window.__admin ? [{uid:a.uid}] : []);
          if(t==='console_profiles') return Promise.resolve(window.__row ? [window.__row] : []);
          return Promise.resolve([]);
        };
      }""", {"uid":UID, "email":EMAIL, "admin":admin, "row":profile_row})

def mount(pg, admin, profile_row):
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_function("()=>typeof window.initProfile==='function'", timeout=15000)
    pg.evaluate("()=>{document.documentElement.classList.remove('gate-locked');const g=document.getElementById('thriveGate');if(g)g.remove();}")
    seed(pg)
    override_supa(pg, admin, profile_row)
    pg.evaluate("()=>{ location.hash='profile'; }")
    pg.wait_for_timeout(700)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width":1280,"height":900})
    ctx.route("https://api.github.com/**", lambda r: r.abort())
    ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))

    # ===== Operator tier: full profile, no infrastructure zone =====
    pg = ctx.new_page(); mount(pg, admin=False, profile_row=None)
    st = pg.evaluate("""()=>{
        const vis = id=>{ const e=document.getElementById(id); return !!(e && e.offsetParent!==null); };
        const txt = id=>{ const e=document.getElementById(id); return e? (e.textContent||'').trim() : null; };
        return {
          prefs:vis('pfPrefs'), mem:vis('pfMemory'), perf:vis('pfPerf'),
          infra: document.getElementById('pfInfra'),
          email: txt('pfEmail'), role: txt('pfRole'),
          hasName: !!document.getElementById('pfName'),
          hasLang: !!document.getElementById('pfLang'), hasNotes: !!document.getElementById('pfNotes'),
          sent: txt('pfStSent'), opens: txt('pfStOpens'), replies: txt('pfStReplies'), moved: txt('pfStMoved') }; }""")
    ck("operator: all three regions are present and filled (no empty region)",
       st["prefs"] and st["mem"] and st["perf"] and st["hasName"] and st["hasLang"] and st["hasNotes"], st)
    ck("operator: the identity header shows their own email", st["email"] == EMAIL, st)
    ck("operator: the role reads Operator", st["role"] == "Operator", st)
    ck("operator: the infrastructure zone is ABSENT (removed, not merely hidden)", st["infra"] is None, "present" if st["infra"] else "absent")
    ck("operator: performance derives from the one source, filtered to this operator (2 sends, 1 reply, 1 moved)",
       st["sent"] == "2" and st["replies"] == "1" and st["moved"] == "1", st)
    ck("operator: another operator's sends are not counted (thyab's third send is excluded)", st["sent"] == "2", st)
    pg.close()

    # ===== Owner tier: the infrastructure zone is present =====
    pg = ctx.new_page(); mount(pg, admin=True, profile_row=None)
    ow = pg.evaluate("""()=>{ const i=document.getElementById('pfInfra');
        return { infraPresent: !!i, infraVisible: !!(i && i.offsetParent!==null),
                 role:(document.getElementById('pfRole')||{}).textContent,
                 link: !!document.getElementById('pfInfraLink') }; }""")
    ck("owner: the infrastructure zone is present and functional", ow["infraPresent"] and ow["infraVisible"] and ow["link"], ow)
    ck("owner: the role reads Owner", (ow["role"] or "").strip() == "Owner", ow)
    pg.close()

    # ===== Preferences persist to console_profiles, and reconstruct on a fresh load =====
    pg = ctx.new_page(); mount(pg, admin=False, profile_row=None)
    pg.evaluate("""()=>{ const s=document.getElementById('pfDensity'); s.value='compact'; s.dispatchEvent(new Event('change',{bubbles:true})); }""")
    pg.wait_for_timeout(700)
    ups = pg.evaluate("()=>window.__ups.filter(u=>u.t==='console_profiles')")
    ck("preferences persist: a change upserts the operator's console_profiles row with the new value",
       any(u.get("r",{}).get("uid")==UID and (u.get("r",{}).get("prefs") or {}).get("density")=="compact" for u in ups), ups)
    pg.close()

    # reconstruct on a fresh load: the row comes back from Supabase and the control shows it
    pg = ctx.new_page(); mount(pg, admin=False, profile_row={"uid":UID,"email":EMAIL,"prefs":{"density":"compact","tz":"Asia/Riyadh"},"memory":{"notes":"remember me"}})
    rec = pg.evaluate("""()=>({ density:(document.getElementById('pfDensity')||{}).value,
        tz:(document.getElementById('pfTz')||{}).value, notes:(document.getElementById('pfNotes')||{}).value })""")
    ck("reconstruct: a fresh device reads the operator's saved preferences back (density, timezone, notes)",
       rec.get("density")=="compact" and rec.get("tz")=="Asia/Riyadh" and rec.get("notes")=="remember me", rec)
    pg.close()

    ctx.close(); b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
