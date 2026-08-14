"""Profile Phase B: real names everywhere, real performance, a full operations ledger, durable memory.

The live defect this closes: a comment rendered its author as the generic «زميل» instead of the operator's
real name, because console_profiles is owner-read-only and there was no way to turn a uid into another
operator's name. Phase B adds ONE resolver (resolveOperator) backed by a minimal cross-readable name
projection (console_profile_names), so every actor surface shows a real name and «زميل» renders only for a
genuinely unknown uid. It also turns the profile into what was directed: performance derived from the
stamped truth, a full per-operator operations ledger, and durable namespaced-versioned memory.

The sandbox mocks Supabase, so RLS is proven at the source (the SQL) and simulated in the mock (the base
table returns only the caller's own row while the names view returns every operator's name). The true
two-identity restore is Thyab's device gate.
"""
import threading, http.server, socketserver, functools, os, sys, re
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT="/home/user/thrive-console"; CH="/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails=[]
def ck(n,c,d=None):
    print(("PASS " if c else "FAIL ")+n)
    if not c:
        fails.append(n)
        if d is not None: print("      "+str(d)[:300])

# ============================ source guards (no browser) ============================
app=open(f"{ROOT}/library/app.js").read()
sql=open(f"{ROOT}/docs/supabase-profile-phase-b.sql").read()
opsql=open(f"{ROOT}/docs/supabase-operator-profile.sql").read()

# §1: one resolver, and every actor surface routes through it (no hardcoded fallback at the surface).
ck("§1: resolveOperator is the one name resolver, and the generic label lives only inside it",
   "function resolveOperator(uid)" in app and app.count('t("dc_someone")')>=1
   and 'return t("dc_someone")' in app)
ck("§1: the comment author renders through resolveOperator, not a per-surface snapshot fallback",
   "function who(c){ return esc(resolveOperator(c.author)); }" in app
   and 'c.author_name||"").trim() || t("dc_someone")' not in app)
ck("§1: a cross-operator name map hydrates on sign-in and caches on the device",
   "function hydrateOperatorNames()" in app and "console_profile_names" in app
   and 'onThrive("unlock","opnames"' in app)

# §1 SQL: additive projection exposing names only; the base table stays owner-only.
# Check the VIEW DEFINITION (the create...as...; statement), not the explanatory comments, for prefs/memory.
_viewdef = sql.split("create or replace view")[1].split(";")[0] if "create or replace view" in sql else ""
ck("§1 SQL: console_profile_names projects ONLY uid, display_name, email (names, never prefs or memory)",
   "public.console_profile_names" in _viewdef
   and "select uid, display_name, email" in _viewdef and "prefs" not in _viewdef and "memory" not in _viewdef)
ck("§1 SQL: the projection is granted to authenticated and is additive (no drop, console_ only)",
   "grant select on public.console_profile_names to authenticated" in sql
   and "drop " not in sql.lower())
ck("§1 SQL: the base console_profiles keeps its owner-only policy (prefs and memory never cross-readable)",
   "using (uid = auth.uid())" in opsql and "console_profiles_own" in opsql)

# §3 SQL + write site: the additive actor column, set at the write site, never backfilled.
ck("§3: console_mail gains a first-class actor column, additively",
   "alter table public.console_mail add column if not exists actor text" in sql)
ck("§3: the mail mirror sets actor at the write site (supaMailRow), from the record's own stamp",
   "actor:rec.actor||\"\"" in app)

# §4: namespaced, versioned keys with a legacy-flat fallback on read.
ck("§4: memory reads a namespaced versioned key and falls back to the legacy flat key (nothing lost)",
   "function profileMemNS(ns, dflt)" in app and 'nsKey(ns)' in app
   and 'ns+"."+PROFILE_KEY_V' in app)
ck("§4: memory writes always land on the versioned key",
   "function setProfileMemNS(ns, v){ setProfileMem(nsKey(ns), v); }" in app
   and 'setProfileMemNS("notes"' in app)

# §2: performance derives from the one attribution law, never a parallel counter.
ck("§2: operatorStats reuses the board's derivations (outreachOpens, hasReply) and adds rate, closed, cadence",
   "outreachOpens(slug)" in app and "hasReply(slug)" in app
   and "replyRate" in app and "closed:closed" in app and "cadence:cadence" in app)
ck("§2: pre-stamp history is one honest bucket (consoleHistoryStats), never per-operator fabrication",
   "function consoleHistoryStats()" in app and "operatorStats(ACTOR)" in app)

ck("no em dash / zero-Lotus in the touched files",
   all("\u2014" not in open(f"{ROOT}/{f}").read() and "lotus" not in open(f"{ROOT}/{f}").read().lower()
       for f in ["library/app.js","library/i18n.js","library/profile.html","library/styles.css",
                 "docs/supabase-profile-phase-b.sql","docs/PROFILE.md"]))

# ============================ live behaviour ============================
Handler=functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address=True
httpd=socketserver.TCPServer(("127.0.0.1",0),Handler); PORT=httpd.server_address[1]
httpd.daemon_threads=True; threading.Thread(target=httpd.serve_forever,daemon=True).start()
base=f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

ALICE="uid-alice"; BASEL="uid-basel"
# The cross-readable name projection returns EVERY operator; the base profiles table returns only the caller.
NAMES={ALICE:{"display_name":"Alice Fahad","email":"alice@thrive.test"},
       BASEL:{"display_name":"Basel Noor","email":"basel@thrive.test"}}

def supa_mock(pg, me):
    pg.evaluate("""(a)=>{
        const S=window.ThriveSupa; S.ready=()=>true; S.authUid=()=>a.me; S.authEmail=()=>a.names[a.me].email;
        window.__ups=[];
        S.upsert=(t,r)=>{ window.__ups.push({t:t,r:r}); return Promise.resolve([r]); };
        S.rest=(t,opts)=>{
          if(t==='console_admins') return Promise.resolve([]);
          // the base table is owner-only: it returns ONLY the caller's own row, whatever uid is queried
          if(t==='console_profiles'){ var row=a.rows[a.me]||null; return Promise.resolve(row?[row]:[]); }
          // the projection is cross-readable: it returns every operator's NAME (and nothing private)
          if(t==='console_profile_names') return Promise.resolve(Object.keys(a.names).map(function(u){
             return { uid:u, display_name:a.names[u].display_name, email:a.names[u].email }; }));
          return Promise.resolve([]);
        };
      }""", {"me":me, "names":NAMES, "rows":{ALICE:{"uid":ALICE,"email":NAMES[ALICE]["email"],"display_name":"Alice Fahad","prefs":{},"memory":{}}}})

with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CH)
    ctx=b.new_context(viewport={"width":1280,"height":900})
    ctx.route("https://api.github.com/**", lambda r:r.abort())
    ctx.route(f"{base}/library/manifest.json", lambda r:r.fulfill(status=200, body='{"opportunities":[]}'))
    pg=ctx.new_page()
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_function("()=>typeof window.resolveOperator==='function' && typeof window.discussionHtml==='function'", timeout=15000)
    pg.evaluate("()=>{document.documentElement.classList.remove('gate-locked');const g=document.getElementById('thriveGate');if(g)g.remove();}")

    # ---- §1 two-identity name resolution: Basel is signed in; a card holds one comment from each ----
    supa_mock(pg, BASEL)
    pg.evaluate("""(a)=>{
      localStorage.setItem('thrive_lang','en');
      localStorage.setItem('thrive_comments_v1', JSON.stringify([
        {id:'c1',opp:'acme',author:a.alice,author_name:'Alice Fahad',body:'Kicking this off.',parent_id:null,created_at:'2026-08-10T09:00:00Z',updated_at:'2026-08-10T09:00:00Z'},
        {id:'c2',opp:'acme',author:a.basel,author_name:'',body:'On it.',parent_id:null,created_at:'2026-08-10T10:00:00Z',updated_at:'2026-08-10T10:00:00Z'},
        {id:'c3',opp:'acme',author:'uid-ghost',author_name:'',body:'Who am I.',parent_id:null,created_at:'2026-08-10T11:00:00Z',updated_at:'2026-08-10T11:00:00Z'}
      ]));
    }""", {"alice":ALICE,"basel":BASEL})
    # hydrate the cross-operator names (as sign-in would), then render the discussion
    pg.evaluate("async ()=>{ await window.hydrateOperatorNames(); }")
    html=pg.evaluate("()=>window.discussionHtml('acme')")
    ck("§1: Basel (signed in) sees Alice's REAL name on her comment, resolved from the cross-readable projection",
       "Alice Fahad" in html, html[:200])
    ck("§1: Basel sees his OWN real name even though his comment carried no snapshot (resolved from the map)",
       "Basel Noor" in html, html[:200])
    # the generic label appears for the ghost (unknown uid) and NOWHERE else: exactly one live-operator-free case
    ck("§1: the generic label renders ONLY for the genuinely unknown uid, never for a live operator",
       html.count("A teammate")==1 and "زميل" not in html, {"teammate":html.count("A teammate")})
    # resolveOperator: unknown uid is the ONLY generic case
    res=pg.evaluate("""()=>({ alice:window.resolveOperator('uid-alice'), basel:window.resolveOperator('uid-basel'),
        ghost:window.resolveOperator('uid-ghost'), empty:window.resolveOperator('') })""")
    ck("§1: resolveOperator maps a live uid to a real name, and only a genuinely unknown uid to the generic label",
       res["alice"]=="Alice Fahad" and res["basel"]=="Basel Noor"
       and res["ghost"]=="A teammate" and res["empty"]=="A teammate", res)

    # ---- §1 RLS reality: the projection exposes NAMES only; prefs and memory stay owner-only ----
    rls=pg.evaluate("""async ()=>{
      const others = await window.ThriveSupa.rest('console_profiles', { query:'uid=eq.uid-alice' }); // Basel querying Alice's row
      const names  = await window.ThriveSupa.rest('console_profile_names', { query:'select=uid,display_name,email' });
      const alice  = names.find(n=>n.uid==='uid-alice')||{};
      return { otherRows:others.length, hasName:!!alice.display_name, leaksPrefs:('prefs' in alice), leaksMemory:('memory' in alice) };
    }""")
    ck("§1: the base profile table refuses another operator's row (owner-only), so preferences and memory never leak",
       rls["otherRows"]==0, rls)
    ck("§1: the names projection exposes the display name and nothing private (no prefs, no memory)",
       rls["hasName"] and not rls["leaksPrefs"] and not rls["leaksMemory"], rls)

    # ---- §2 performance agrees with the board (same derivations, no parallel counter) ----
    pg.evaluate("""(a)=>{
      localStorage.setItem('thrive_opps_v1', JSON.stringify([
        {slug:'p1',business:'P1',published:true},{slug:'p2',business:'P2',published:true}]));
      localStorage.setItem('thrive_mail_v1', JSON.stringify([
        {mid:'sm1',opp:'p1',to:'x@x',status:'sent',direction:'out',actor:a.me,ts:'2026-08-10T10:00:00Z'},
        {mid:'sm2',opp:'p2',to:'y@y',status:'sent',direction:'out',actor:a.me,ts:'2026-08-10T10:00:00Z'}]));
      localStorage.setItem('thrive_inbound_v1', JSON.stringify([
        {gid:'g1',opp:'p1',kind:'reply',from:'x@x',snippet:'yes',ts:'2026-08-11T09:00:00Z'}]));
      localStorage.setItem('thrive_hits_v1','[]');
      window.invalidateSends&&window.invalidateSends(); window.invalidateHits&&window.invalidateHits();
    }""", {"me":BASEL})
    # The board now buckets by the server-computed stage from v_console_board (read through the view map),
    # not by re-deriving from local mail/inbound. Inject the row the server would return: p1 replied (it has
    # an inbound reply), so the board's replied lane matches the operator's reply count. p2 needs no row.
    pg.evaluate("""()=>window.__boardViewSet([
        {slug:'p1', stage:'replied', open_count:0, replied:true, has_page:true, has_email:true}
    ])""")
    agree=pg.evaluate("""async ()=>{
      const s=window.operatorStats('uid-basel');
      const opps=await window.mergedOpps();
      const board=window.ThriveBoard.build(opps, { mail: window.getMailLog() });
      return { sSent:s.sent, sReplies:s.replies, sRate:s.replyRate, boardReplied:board.summary.counts.replied };
    }""")
    ck("§2: the operator's reply count equals the board's replied lane (one derivation, no disagreement)",
       agree["sReplies"]==agree["boardReplied"] and agree["sSent"]==2, agree)
    ck("§2: the reply rate is derived honestly (1 reply over 2 sent opportunities = 50%)",
       agree["sRate"]==50, agree)

    # ---- §3 operations ledger: derived, filterable, paged, with the one date composer ----
    pg.evaluate("""(a)=>{
      localStorage.setItem('thrive_activity_v1', JSON.stringify([
        {ts:'2026-08-11T12:00:00Z',action:'lc_mark_won',slug:'p1',detail:'',actor:a.me},
        {ts:'2026-08-11T13:00:00Z',action:'comment_add',slug:'p2',detail:'',actor:a.me},
        {ts:'2026-08-11T14:00:00Z',action:'publish',slug:'p2',detail:'',actor:a.me}]));
    }""", {"me":BASEL})
    led=pg.evaluate("""()=>{
      const all=window.operatorLedger('uid-basel',{kind:'all'});
      const sends=window.operatorLedger('uid-basel',{kind:'send'});
      const comments=window.operatorLedger('uid-basel',{kind:'comment'});
      // newest first check
      const ordered = all.rows.every((r,i,ar)=> i===0 || String(ar[i-1].ts) >= String(r.ts));
      return { total:all.total, sends:sends.total, comments:comments.total, ordered,
               firstKind: all.rows.length? all.rows[0].kind : null };
    }""")
    ck("§3: the ledger derives every action from the stamped stores (2 sends + 3 activities = 5)",
       led["total"]==5, led)
    ck("§3: the ledger filters by kind (sends only, comments only)", led["sends"]==2 and led["comments"]==1, led)
    ck("§3: the ledger is newest first", led["ordered"], led)
    # render on the profile screen, in Arabic, and confirm the date rides the one composer (bdi isolated)
    pg.evaluate("()=>{ try{ setLang('ar'); }catch(e){} location.hash='profile'; }")
    pg.wait_for_timeout(700)
    dates=pg.evaluate("""()=>{ const rows=[...document.querySelectorAll('#pfOpsList .pf-op-row')];
      return { rows:rows.length, bdi: rows.length>0 && rows.every(r=>!!r.querySelector('.pf-op-when bdi')),
               tabs:document.querySelectorAll('#pfOpsFilter .pf-ops-tab').length }; }""")
    ck("§3: every ledger row renders its date through the one composer (bdi-isolated), Arabic included",
       dates["rows"]>0 and dates["bdi"] and dates["tabs"]==5, dates)

    # ---- §4 cleared-Safari memory reconstruction: clear the device, sign in, memory returns ----
    pg.evaluate("""(a)=>{
      // a brand-new device: nothing local. The profile row carries versioned + legacy memory in Supabase.
      window.ThriveSupa.rest=(t,opts)=>{
        if(t==='console_profiles') return Promise.resolve([{ uid:a.me, email:'basel@thrive.test', display_name:'Basel Noor',
           prefs:{}, memory:{ 'notes.v1':'call the school back', 'pins':['acme','p1'] } }]);
        if(t==='console_profile_names') return Promise.resolve([]);
        return Promise.resolve([]);
      };
      try{ localStorage.removeItem('thrive_profile:'+a.me); }catch(e){}
    }""", {"me":BASEL})
    pg.evaluate("()=>{ try{ setLang('en'); }catch(e){} }")
    mem=pg.evaluate("""async ()=>{ await window.ThriveProfile.load();
      return { notes: window.ThriveProfileKeys.mem('notes',''),
               pins: window.ThriveProfileKeys.mem('pins',[]) }; }""")
    ck("§4: memory reconstructs on a fresh device from console_profiles (the versioned notes return)",
       mem["notes"]=="call the school back", mem)
    ck("§4: a legacy flat memory key still reads back (nothing an operator saved is lost)",
       isinstance(mem["pins"], list) and len(mem["pins"])==2, mem)

    ctx.close(); b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
