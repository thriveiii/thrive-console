"""Replies attach to their opportunity, confirmed on the server, numbered and distinct.

The proven gap: the header counted Replies 11 while the Replied lane read 0 and Basel Issa sat in Draft,
because replies reached console_inbound through a fire-and-forget mirror (so they may never have reached
the server the board view reads) AND a reply keyed to a child slug parentSlug--r-<hash> was detached from
its parent. This brief closes both, then numbers replies and sets reply cards apart.

Proven on the real app.js against a faithful fake of the Supabase client:
  1. Part 1: a reply is confirmed to the server (supaConfirmInbound: durable-first, awaited, non-swallowing).
     A failed write is recorded on the diverge ledger and left queued, never silently dropped.
  2. Part 2: a stranded child-slug reply resolves to its parent (replyParentOf), so hasReply(parent) and the
     count attach it to the parent - the same rule the server view applies. A child that has its own card
     keeps its reply.
  3. Part 3: an opportunity's replies are numbered 1..N in arrival order (repliesForOpp); the card badge, the
     inbox by-opportunity rows, and the card's reply list all show the SAME number.
  4. Part 4: the Replied lane reads as its own kind - its title carries the lane's replied-green accent.

FAILS-WHEN-BROKEN: revert replyParentOf to identity and the stranded child no longer attaches to the
parent (hasReply false, count 0). The live Supabase and WebKit are Thyab's device gate.
"""
import threading, http.server, socketserver, functools, os, sys

os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

# ============================ source guards ============================
app = open(f"{ROOT}/library/app.js").read()
i18n = open(f"{ROOT}/library/i18n.js").read()
css = open(f"{ROOT}/library/styles.css").read()
ck("Part 1: console_inbound is confirmed, durable-first and awaited, non-swallowing (supaConfirmInbound)",
   "async function supaConfirmInbound(" in app and 'await window.ThriveSupa.upsert("console_inbound"' in app
   and 'supaRecordDiverge("write", "console_inbound"' in app and "await supaConfirmInbound(fresh)" in app)
ck("Part 2: the one client resolver maps a stranded child slug to its parent (replyParentOf), routed through resolvedReplyOpp",
   "function replyParentOf(" in app and 'return getDraft(k) ? k : k.slice(0, i);' in app
   and "function resolvedReplyOpp(" in app and "resolvedReplyOpp(r)===slug" in app)
ck("Part 3: per-opp reply numbering + count (repliesForOpp, replyCountFor) and the card badge",
   "function repliesForOpp(" in app and "function replyCountFor(" in app
   and 'class="tok-replies"' in app and "const repN = replyCountFor(tk.slug)" in app)
ck("Part 3: the inbox groups replies by opportunity and numbers them, opening the parent card",
   'class="rp-byopp"' in app and "repliesForOpp(o.slug)" in app and 'data-open-slug=' in app
   and 'window.thriveModal.open(slug, "history"' in app)
ck("Part 3: the i18n reply count exists in both languages", i18n.count("tok_replies:") == 2 and i18n.count("rp_by_opp:") == 2)
ck("Part 4: the Replied lane title carries the lane's own replied-green accent (its own kind)",
   '.lane[data-lane="replied"] .lane-title{ color:var(--lane-replied); }' in css
   and '.lane[data-lane="replied"] .lane-body{ background:var(--lane-replied-t)' in css)
ck("no em dash / zero-Lotus in the touched sources",
   "\u2014" not in app and "lotus" not in app.lower() and "\u2014" not in css)

# ============================ live ============================
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True; threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

FAKE = r"""
() => {
  window.__real_fetch = window.fetch.bind(window);
  window.__srv = { mode:"ok", signed:true, console_inbound:{}, console_mail:{}, console_opps:{}, console_pages:{}, console_hits:{}, console_comments:{}, console_templates:{}, console_board:{} };
  window.ThriveSupa = {
    ready: () => true, signedIn: () => window.__srv.signed,
    rest: async (table, opts) => { const st=window.__srv[table]||{}; return Object.values(st); },
    upsert: async (table, rows) => { if(window.__srv.mode==="reject") throw new Error("offline");
      const st=window.__srv[table]||(window.__srv[table]={}); (Array.isArray(rows)?rows:[rows]).forEach(r=>{ st[r.id||r.slug||r.key]=r; }); return null; },
    del: async () => null, session: () => ({}), cfg: () => ({ url:"x" })
  };
  return true;
}
"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width":1280,"height":900})
    ctx.route("https://api.github.com/**", lambda r: r.fulfill(status=404, body="{}"))
    ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))
    pg = ctx.new_page()
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_function("()=>typeof window.repliesForOpp==='function' && typeof window.replyParentOf==='function' && typeof window.thriveBoardRefresh==='function'", timeout=15000)
    pg.evaluate("()=>{ document.documentElement.classList.remove('gate-locked'); const g=document.getElementById('thriveGate'); if(g) g.remove(); }")
    pg.evaluate(FAKE)
    pg.evaluate("()=>{ localStorage.setItem('console_sb_read','1'); localStorage.setItem('console_sb_session', JSON.stringify({access_token:'jwt', uid:'op', email:'op@x'})); }")

    # 'madar' is a single opportunity (مدارس المدار الدولية). One reply is keyed directly to it, one to a
    # STRANDED child slug madar--r-xyz (no such opp card) - both must attach to madar. 'grp' is a group whose
    # child card grp--r-kid exists, so that reply stays on the child.
    pg.evaluate("""()=>{
      localStorage.setItem('thrive_opps_v1', JSON.stringify([
        {slug:'madar', business:'مدارس المدار الدولية', published:true, up:1},
        {slug:'grp', business:'Group', published:true, recipients:[{addr:'a@x'},{addr:'b@x'}], up:1},
        {slug:'grp--r-kid', business:'Kid', published:true, spawned_from:{parent:'grp',addr:'b@x'}, up:1}]));
      localStorage.setItem('thrive_inbound_v1', JSON.stringify([
        {gid:'r1', opp:'madar', kind:'reply', from:'head@madar.example', subject:'Re: hello', ts:'2026-08-03T09:00:00Z'},
        {gid:'r2', opp:'madar--r-9a9', kind:'reply', from:'dept@madar.example', subject:'Re: again', ts:'2026-08-05T09:00:00Z'},
        {gid:'r3', opp:'grp--r-kid', kind:'reply', from:'b@x', subject:'Re: group', ts:'2026-08-04T09:00:00Z'}]));
      localStorage.setItem('thrive_mail_v1','[]'); localStorage.setItem('thrive_hits_v1','[]');
      window.invalidateSends&&window.invalidateSends();
    }""")

    # 2. Attachment: the stranded child resolves to the parent; hasReply(madar) is true; the count is 2.
    rp = pg.evaluate("()=>({ pMadarStray: window.replyParentOf('madar--r-9a9'), pKid: window.replyParentOf('grp--r-kid'), has: window.hasReply('madar'), count: window.replyCountFor('madar'), nums: window.repliesForOpp('madar').map(function(x){return {who:x.addr, n:x.num};}) })")
    ck("Part 2: a stranded child slug resolves to its parent opportunity", rp["pMadarStray"]=="madar", rp)
    ck("Part 2: a child that has its own card keeps its key (no over-collapse)", rp["pKid"]=="grp--r-kid", rp)
    ck("Part 2: hasReply(madar) is true - Basel's opportunity attaches its stranded-child reply", rp["has"] is True, rp)
    ck("Part 3: the parent's replies count is 2 (direct + resolved stranded child)", rp["count"]==2, rp)
    ck("Part 3: replies are numbered 1..N in arrival order (earliest is #1)",
       [x["n"] for x in rp["nums"]]==[1,2] and rp["nums"][0]["who"]=="head@madar.example", rp)
    ck("Part 2: the child card keeps its own single reply", pg.evaluate("()=>window.replyCountFor('grp--r-kid')")==1)

    # 1. Confirm: supaConfirmInbound writes the replies to the server and awaits it.
    conf = pg.evaluate("""async ()=>{ window.__srv.mode='ok'; window.__srv.console_inbound={};
      const r=await window.supaConfirmInbound(window.getInbound().filter(x=>x.opp));
      return { ok:r&&r.confirmed, held:Object.keys(window.__srv.console_inbound).length }; }""")
    ck("Part 1: supaConfirmInbound writes the replies to the server and confirms", conf["ok"] is True and conf["held"]>=3, conf)
    div = pg.evaluate("""async ()=>{ window.__srv.mode='reject'; localStorage.setItem('console_sb_diverge','[]');
      await window.supaConfirmInbound([{gid:'r9', opp:'madar', kind:'reply', from:'x@x', ts:'2026-08-06T09:00:00Z'}]);
      return JSON.parse(localStorage.getItem('console_sb_diverge')||'[]'); }""")
    ck("Part 1: a failed inbound write is recorded on the diverge ledger, never swallowed",
       any('console_inbound' in str(e.get('key','')) for e in div), div)
    pg.evaluate("()=>{ window.__srv.mode='ok'; }")

    # 3 + 4. Render the board (madar in Replied via the view), check the card badge, the inbox numbering, and
    # the distinct Replied lane. The view says madar is replied.
    pg.evaluate("""()=>window.__boardViewSet([
      {slug:'madar', stage:'replied', open_count:0, replied:true, idle_days:1, has_page:true, has_email:false, archived:false},
      {slug:'grp', stage:'live', open_count:0, replied:false, idle_days:1, has_page:true, has_email:false, archived:false},
      {slug:'grp--r-kid', stage:'replied', open_count:0, replied:true, idle_days:1, has_page:true, has_email:false, archived:false}
    ])""")
    pg.evaluate("()=>{ location.hash='board'; }")
    pg.evaluate("async ()=>{ await window.thriveBoardRefresh(); }"); pg.wait_for_timeout(300)
    badge = pg.evaluate("""()=>{ const t=document.querySelector('.tok[data-slug=\"madar\"] .tok-replies'); return t? t.textContent : null; }""")
    ck("Part 3: the madar card shows a reply badge with its count (2)", bool(badge) and "2" in badge, badge)
    lane_ok = pg.evaluate("""()=>{ const el=document.querySelector('.lane[data-lane=\"replied\"] .lane-title'); if(!el) return false;
      const c=getComputedStyle(el).color; return c && c!=='rgb(0, 0, 0)' && c!==getComputedStyle(document.querySelector('.lane[data-lane=\"sent\"] .lane-title')).color; }""")
    ck("Part 4: the Replied lane title reads distinct from a first-contact (sent) lane title", lane_ok is True, lane_ok)

    # inbox: by-opportunity numbering, opening the parent card
    inbox = pg.evaluate("""()=>{ const host=document.createElement('div'); window.renderInboxInto(host);
      const rows=[...host.querySelectorAll('.rp-byopp-row')].map(r=>({ num:(r.querySelector('.rp-num')||{}).textContent, slug:r.getAttribute('data-open-slug') }));
      return rows; }""")
    madar_rows = [r for r in inbox if r["slug"]=="madar"]
    ck("Part 3: the inbox lists madar's replies numbered #1..#N, opening the parent card",
       len(madar_rows)==2 and madar_rows[0]["num"]=="#1" and madar_rows[1]["num"]=="#2", inbox)

    ctx.close(); b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
