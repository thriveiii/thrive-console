"""Open team discussion inside every card (console_comments).

Every operator writes, replies and reads inside any card, openly: one shared room. A comment is stamped
with the REAL operator (currentActor, which is the Supabase auth.uid once signed in) and carries a SNAPSHOT
of the poster's display name taken from their own console_profiles at post time, because the profile RLS is
own-read-only and another operator's name cannot be read live. Writes go through the SAME Stage-4 durable
queue as every other mutation, so a signed-out post is queued and drains on sign-in, and there is no second
write path. Bodies are escaped and direction-isolated, so a hostile body renders as text and an Arabic
comment reads right-to-left. The discussion NEVER leaves the console: no send composer reads it.

This suite proves, against a mocked two-operator Supabase:
  A. two identities post/reply/read the SAME card, and each sees the other's comment with the real name
     (the author_name snapshot, since a cross-operator profile read is forbidden);
  B. the Stage-4 queue: a signed-out post is queued (honest pending state) and drains on sign-in;
  C. a hostile body is escaped, never a live <script>/<img> node, no XSS sink;
  D. both languages render, dir resolves per comment, Arabic carries no letter-spacing;
  E. by source: the RLS is read-all-authenticated + own-write + no-anon, additive and idempotent;
  F. by source: no outbound send composer references the discussion, so it can never reach a mail body;
  G. by source: nothing here touches Lotus-V1 (zero-Lotus).
WebKit at three widths in both languages is Thyab's device gate; this proves the wiring.
"""
import threading, http.server, socketserver, functools, os, sys, re
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

# ============================ source guards (no browser) ============================
sql = open(f"{ROOT}/docs/supabase-comments.sql").read()
app = open(f"{ROOT}/library/app.js").read()
sup = open(f"{ROOT}/library/supabase.js").read()
store = open(f"{ROOT}/library/store.js").read()

# --- E. the RLS: open read, owned writes, no anon; additive + idempotent ---
ck("SQL: the table is additive and idempotent (create if not exists, enable RLS, guarded policies)",
   "create table if not exists console_comments" in sql
   and "enable row level security" in sql
   and sql.count("if not exists (select 1 from pg_policies") == 4
   and "drop " not in sql.lower())
ck("SQL: read is OPEN to every authenticated operator (using (true)), and there is NO anon grant",
   re.search(r"for select\s+to authenticated\s+using \(true\)", sql) is not None
   and "to anon" not in sql)
ck("SQL: insert/update/delete are OWNED (author = auth.uid()), to authenticated only",
   re.search(r"for insert\s+to authenticated\s+with check \(author = auth\.uid\(\)\)", sql) is not None
   and re.search(r"for update\s+to authenticated\s+using \(author = auth\.uid\(\)\)\s+with check \(author = auth\.uid\(\)\)", sql) is not None
   and re.search(r"for delete\s+to authenticated\s+using \(author = auth\.uid\(\)\)", sql) is not None)
ck("SQL: the author-name snapshot column exists (the own-read-only profile RLS makes it necessary)",
   "author_name" in sql and "snapshot" in sql.lower())
ck("client: console_comments is on the REST allow-list, so the queue can actually reach it",
   "console_comments: 1" in sup)

# --- F. no outbound send composer references the discussion (it never leaves the console) ---
def body_of(src, name):
    """Extract a function body by brace matching from `function NAME(` (or `NAME = function(`)."""
    m = re.search(r"function\s+" + re.escape(name) + r"\s*\(", src)
    if not m:
        m = re.search(re.escape(name) + r"\s*[:=]\s*function\s*\(", src)
    if not m: return None
    i = src.index("{", m.end() - 1); depth = 0
    for j in range(i, len(src)):
        if src[j] == "{": depth += 1
        elif src[j] == "}":
            depth -= 1
            if depth == 0: return src[i:j+1]
    return None

LEAK = re.compile(r"comment|discussion|ThriveComments|__supa\.comments|console_comments", re.I)
composers = { "brandWrap":app, "toPlainText":app, "composedHtml":app, "composedText":app,
              "sendBody":app, "relaySend":app, "sendThreadReply":app,
              "footerHtml":store, "footerText":store }
missing, leaking = [], []
for fn, src in composers.items():
    b = body_of(src, fn)
    if b is None: missing.append(fn)
    elif LEAK.search(b): leaking.append(fn)
ck("every named outbound composer was found (the leak grep actually reads real code)", not missing, missing)
ck("NO outbound send composer references the discussion (it can never reach a mail body)", not leaking, leaking)

# --- G. zero-Lotus: nothing in the touched files mentions Lotus-V1 ---
touched = ["library/app.js","library/supabase.js","library/console.html","library/styles.css",
           "library/i18n.js","docs/supabase-comments.sql"]
lotus = [f for f in touched if "lotus" in open(f"{ROOT}/{f}").read().lower()]
ck("zero-Lotus: no touched file references Lotus-V1", not lotus, lotus)

# --- the client wiring is present (the store + the Stage-4 mirror, one write path) ---
ck("client: writes go through the Stage-4 queue (supaMirrorComment -> supaQueueUpsert), no bare upsert",
   "supaQueueUpsert(\"console_comments\"" in app
   and "function supaMirrorComment" in app and "function supaDeleteComment" in app
   and "ThriveSupa.upsert(\"console_comments\"" not in app)
ck("client: the author name is SNAPSHOT from the poster's own profile at post time",
   "author_name:String(prof.display_name" in app or "author_name:String(prof.display_name||\"\").trim()" in app)
ck("client: the comment id is client-minted (the Stage-4 idempotency key = primary key)",
   "function mintCommentId" in app and "id:mintCommentId()" in app)

# ============================ live behaviour (browser) ============================
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True; threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

# A mock Supabase whose console_comments store is SHARED across identities (one server, two operators).
# authUid/signedIn are switched per identity; rest() returns the current identity's own profile row only
# (faithful to the own-read-only profile RLS), so a name only travels via the snapshot on the comment.
INSTALL = r"""
() => {
  window.__server = { comments: [] };
  window.__ident  = { uid:"", email:"", name:"", signed:false };
  window.__alerts = 0;
  const _alert = window.alert; window.alert = function(){ window.__alerts++; };
  const S = window.ThriveSupa;
  S.authUid   = () => window.__ident.uid;
  S.authEmail = () => window.__ident.email;
  S.signedIn  = () => !!window.__ident.signed;
  S.upsert = (table, rows) => {
    if(table==="console_comments"){ (Array.isArray(rows)?rows:[rows]).forEach(r=>{
      const i=window.__server.comments.findIndex(x=>x.id===r.id);
      if(i>=0) window.__server.comments[i]=Object.assign({},r); else window.__server.comments.push(Object.assign({},r)); }); }
    return Promise.resolve();
  };
  S.del = (table, q) => {
    if(table==="console_comments"){ const id=decodeURIComponent(String(q).replace("id=eq.",""));
      window.__server.comments = window.__server.comments.filter(x=>x.id!==id); }
    return Promise.resolve();
  };
  S.rest = (table, opts) => {
    if(table==="console_comments") return Promise.resolve(window.__server.comments.map(x=>Object.assign({},x)));
    if(table==="console_opps")     return Promise.resolve([{slug:"one", data:{slug:"one", business:"One", published:true}}]);
    if(table==="console_profiles") return Promise.resolve(window.__ident.uid ?
        [{uid:window.__ident.uid, email:window.__ident.email, display_name:window.__ident.name, prefs:{}, memory:{}}] : []);
    return Promise.resolve([]);   // pages, mail, inbound, hits, templates, admins
  };
}
"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width":1280,"height":900})
    ctx.route("https://api.github.com/**", lambda r: r.abort())
    ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))
    pg = ctx.new_page()
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_function("()=>window.ThriveComments && window.thriveModal && window.ThriveSupa", timeout=15000)
    pg.evaluate("()=>{document.documentElement.classList.remove('gate-locked');const g=document.getElementById('thriveGate');if(g)g.remove();}")
    pg.evaluate(INSTALL)
    pg.evaluate("()=>{ localStorage.setItem('thrive_opps_v1', JSON.stringify([{slug:'one',business:'One',published:true}])); }")

    def wait_seen(n):
        pg.wait_for_function("(n)=>window.ThriveComments.all().filter(c=>c.opp==='one').length===n", arg=n, timeout=6000)

    # ---- A. two identities, one shared card ----
    # Alice signs in on a clean device and posts.
    pg.evaluate("""()=>{ window.__ident={uid:'alice',email:'a@t',name:'Alice',signed:true};
      localStorage.removeItem('thrive_comments_v1');
      localStorage.setItem('thrive_profile:alice', JSON.stringify({uid:'alice',display_name:'Alice'}));
      window.onGateUnlocked(); }""")
    wait_seen(0)
    c1 = pg.evaluate("()=>ThriveComments.post('one','Kickoff notes for this account.',null)")
    pg.wait_for_function("()=>window.thriveSupaPendingCount()===0", timeout=6000)   # drained to the server
    ck("Alice's comment stamps her real uid and a snapshot of her display name",
       c1 and c1["author"]=="alice" and c1["author_name"]=="Alice", c1)
    server_after_a = pg.evaluate("()=>window.__server.comments.map(c=>({id:c.id,author:c.author,author_name:c.author_name,opp:c.opp}))")
    ck("Alice's comment reached the shared server through the Stage-4 queue",
       len(server_after_a)==1 and server_after_a[0]["author_name"]=="Alice", server_after_a)

    # Basel signs in on his own clean device: he reads Alice's comment from the server, with her real name,
    # although he can NOT read her profile (rest(console_profiles) only ever returns the caller's own row).
    pg.evaluate("""()=>{ window.__ident={uid:'basel',email:'b@t',name:'Basel',signed:true};
      localStorage.removeItem('thrive_comments_v1');
      localStorage.setItem('thrive_profile:basel', JSON.stringify({uid:'basel',display_name:'Basel'}));
      window.onGateUnlocked(); }""")
    wait_seen(1)
    basel_sees = pg.evaluate("()=>ThriveComments.list('one').map(c=>({who:c.author_name,author:c.author,body:c.body}))")
    ck("Basel (a different operator) sees Alice's comment with her REAL name, via the snapshot",
       len(basel_sees)==1 and basel_sees[0]["who"]=="Alice" and basel_sees[0]["author"]=="alice", basel_sees)

    # Basel replies (one level, parent = Alice's root comment).
    c2 = pg.evaluate("(pid)=>ThriveComments.post('one','On it, sending the page today.',pid)", c1["id"])
    pg.wait_for_function("()=>window.thriveSupaPendingCount()===0", timeout=6000)
    ck("Basel's reply is stamped to Basel and threaded under Alice's comment (one level)",
       c2 and c2["author"]=="basel" and c2["author_name"]=="Basel" and c2["parent_id"]==c1["id"], c2)

    # Alice signs back in on her clean device and now sees BOTH, each with the right real name.
    pg.evaluate("""()=>{ window.__ident={uid:'alice',email:'a@t',name:'Alice',signed:true};
      localStorage.removeItem('thrive_comments_v1');
      window.onGateUnlocked(); }""")
    wait_seen(2)
    both = pg.evaluate("""()=>ThriveComments.list('one').map(c=>({who:c.author_name,parent:c.parent_id}))""")
    ck("both operators, both comments: the room is OPEN and each name is the real author",
       len(both)==2 and set(x["who"] for x in both)=={"Alice","Basel"}
       and any(x["parent"] for x in both) and any(not x["parent"] for x in both), both)

    # ---- own-only edit/delete (mirrors the RLS) ----
    edited = pg.evaluate("(id)=>!!ThriveComments.edit(id,'Kickoff notes, updated.')", c1["id"])   # Alice edits her own
    ck("an operator edits their OWN comment", edited and
       pg.evaluate("(id)=>ThriveComments.all().find(c=>c.id===id).body", c1["id"])=="Kickoff notes, updated.")
    refused = pg.evaluate("(id)=>ThriveComments.del(id)", c2["id"])   # Alice cannot delete Basel's reply
    ck("an operator canNOT delete another operator's comment (own-only, mirrors RLS delete policy)",
       refused is False and pg.evaluate("()=>ThriveComments.all().length")==2)

    # ---- B. the Stage-4 queue: signed-out queues, drains on sign-in ----
    pg.evaluate("""()=>{ localStorage.removeItem('thrive_comments_v1'); localStorage.removeItem('console_sb_pending');
      window.__server.comments=[]; window.__ident={uid:'',email:'',name:'',signed:false}; }""")
    cq = pg.evaluate("()=>ThriveComments.post('one','Queued while offline.',null)")
    q_state = pg.evaluate("(id)=>({pending:window.thriveSupaPendingCount(), flagged:ThriveComments.pending(id), server:window.__server.comments.length})", cq["id"])
    ck("a signed-out post is durably QUEUED (honest pending state), and nothing reached the server yet",
       q_state["pending"]>=1 and q_state["flagged"] is True and q_state["server"]==0, q_state)
    # sign in (as the default actor, so the queued author matches) and flush.
    pg.evaluate("""()=>{ window.__ident={uid:'thyab',email:'t@t',name:'Thyab',signed:true}; }""")
    pg.evaluate("()=>window.thriveSupaFlush()")
    pg.wait_for_function("()=>window.thriveSupaPendingCount()===0", timeout=6000)
    drained = pg.evaluate("(id)=>({pending:window.thriveSupaPendingCount(), flagged:ThriveComments.pending(id), server:window.__server.comments.length})", cq["id"])
    ck("on sign-in the queue DRAINS: the pending post reaches the server and the pending marker clears",
       drained["pending"]==0 and drained["flagged"] is False and drained["server"]==1, drained)

    # ---- C. hostile body is escaped, never a live node (no XSS sink) ----
    pg.evaluate("""()=>{ localStorage.removeItem('thrive_comments_v1'); localStorage.removeItem('console_sb_pending');
      window.__server.comments=[]; window.__ident={uid:'alice',email:'a@t',name:'Alice',signed:true};
      localStorage.setItem('thrive_profile:alice', JSON.stringify({uid:'alice',display_name:'Alice'}));
      window.onGateUnlocked(); }""")
    wait_seen(0)
    pg.evaluate("""()=>ThriveComments.post('one', '<img src=x onerror="window.__alerts++"><script>window.__alerts++<\\/script> hi', null)""")
    pg.evaluate("()=>window.thriveModal.open('one','discussion','One')")
    pg.wait_for_selector(".dc-body", timeout=6000)
    xss = pg.evaluate("""()=>{ const box=document.getElementById('modalDiscussion');
      return { imgs: box.querySelectorAll('img').length, scripts: box.querySelectorAll('script').length,
               hasText: box.querySelector('.dc-body').textContent.indexOf('<img')>=0,
               alerts: window.__alerts }; }""")
    ck("a hostile body renders as TEXT: no live <img>/<script> node, no handler fired, the markup is visible",
       xss["imgs"]==0 and xss["scripts"]==0 and xss["hasText"] and xss["alerts"]==0, xss)

    # ---- D. both languages render; dir resolves per comment; Arabic carries no letter-spacing ----
    pg.evaluate("""()=>ThriveComments.post('one','نبدأ التواصل مع هذا العميل اليوم.', null)""")
    pg.evaluate("()=>window.thriveModal.reread()")
    pg.wait_for_selector(".dc-body[dir=auto]", timeout=4000)
    dirs = pg.evaluate("""()=>[...document.querySelectorAll('#modalDiscussion .dc-body')].map(el=>{
      const cs=getComputedStyle(el); return { dir: cs.direction, ls: cs.letterSpacing, txt: el.textContent.slice(0,4) }; })""")
    ar = [d for d in dirs if any('؀' <= ch <= 'ۿ' for ch in d["txt"])]
    en = [d for d in dirs if d not in ar]
    ck("the Arabic comment resolves right-to-left (dir=auto honoured) and carries NO letter-spacing",
       len(ar)>=1 and ar[0]["dir"]=="rtl" and ar[0]["ls"] in ("normal","0px"), ar)
    ck("the English comment resolves left-to-right in the same list (per-comment direction)",
       len(en)>=1 and en[0]["dir"]=="ltr", en)

    # switch the whole console to Arabic (the real control, fired directly since the modal scrim overlays it).
    pg.eval_on_selector("#langbtn", "el=>el.click()")
    pg.wait_for_timeout(300)
    tab = pg.evaluate("""()=>{ const t=[...document.querySelectorAll('.modal-tab')].find(b=>b.getAttribute('data-tab')==='discussion');
      return t? t.textContent.trim() : ''; }""")
    ck("the Discussion tab shows its Arabic label after a language switch", tab=="النقاش", tab)

    ctx.close(); b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
