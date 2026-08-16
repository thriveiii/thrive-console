"""Replies are filtered from noise, linked to their opportunity by NORMALIZED SUBJECT, and confirmed.

The proven root: console_inbound.opp is empty for every row (the relay writes a reply with no opp), and the
inbox ingests everything, so most rows are machinery (github / google DMARC / repo invites), not campaign
replies. threadId does not join; the sender address must not be the link (Basel answered from a personal
gmail that never received the send). The one key that links is the normalized subject matched to
console_mail.subject. This test drives the REAL pullInbound through a faithful fake relay + Supabase, and
proves: a real reply is linked by subject on write and confirmed to the server; automated senders never
link; an unmatched or ambiguous subject stays unlinked; and the link path touches no user/permission state.

FAILS-WHEN-BROKEN: neutralize subjectLinkOpp (return "") and Basel no longer links; drop the noise lines in
inboundIsNoise and the github/dmarc rows link. The live Supabase and WebKit are Thyab's device gate.
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

# ============================ source guards ============================
app = open(f"{ROOT}/library/app.js").read()

ck("the link key is the normalized subject, matched to console_mail (subjLinkKey / subjectLinkOpp)",
   "function subjLinkKey(" in app and "function subjectLinkOpp(" in app
   and "keys.length===1" in app)   # unambiguous only
ck("pullInbound fills opp by subject on write, never overwriting a set opp, skipping noise",
   "var opp=subjectLinkOpp(r, __sends);" in app
   and "if(!r || r.kind===\"auto\" || r.opp || inboundIsNoise(r)) return;" in app)
ck("the noise filter excludes DMARC anywhere and the google.com / github.com report domains",
   "/dmarc/.test(from)" in app and "/^(google|github)\\.com$/.test(host0)" in app)
ck("newly-linked replies are confirmed with the send-path discipline (durable, awaited, diverge)",
   "if(fresh.length) await supaConfirmInbound(fresh);" in app and "prev===undefined || prev===\"\"" in app)

# Firewall: the inbound link/write region reads or writes no user/permission/role state.
def region(src, start, end_marker):
    i = src.index(start); j = src.index(end_marker, i); return src[i:j]
link_region = region(app, "function subjLinkKey(", "function rematchHeld(")
pull_region = region(app, "async function pullInbound(", "let __inboxScan")
firewall_tokens = ["permission", "isAdmin", "authRole", "user_role", "roleOf", "grantRole", "console_profiles", "console_members"]
leak = [tok for tok in firewall_tokens if tok in link_region or tok in pull_region]
ck("the reply link/write path touches no user or permission state (contexts firewalled)", not leak, leak)
ck("no em dash in the touched sources", "—" not in app)

# ============================ live ============================
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True; threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

FAKE = r"""
() => {
  window.__srv = { mode:"ok", signed:true, console_inbound:{}, console_mail:{}, console_opps:{} };
  window.ThriveSupa = {
    ready: () => true, signedIn: () => window.__srv.signed,
    rest: async (table) => Object.values(window.__srv[table]||{}),
    upsert: async (table, rows) => { if(window.__srv.mode==="reject") throw new Error("offline");
      const st=window.__srv[table]||(window.__srv[table]={}); (Array.isArray(rows)?rows:[rows]).forEach(r=>{ st[r.id||r.slug]=r; }); return null; },
    del: async () => null, session: () => ({}), cfg: () => ({ url:"x" })
  };
  return true;
}
"""

# the fake relay: one inbound_get response carrying a real reply (Basel, personal gmail), two automated
# senders (github, google DMARC), and an unmatched real reply. Every record has an EMPTY opp, as the relay writes it.
REC = ('[{"gid":"b1","from":"alnajjarjawad97@gmail.com","subject":"Re: من جد وجد","kind":"reply","ts":"2026-08-03T09:18:00Z","opp":""},'
       '{"gid":"g1","from":"notifications@github.com","subject":"Re: من جد وجد","kind":"reply","ts":"2026-08-03T09:00:00Z","opp":""},'
       '{"gid":"d1","from":"noreply-dmarc-support@google.com","subject":"Report Domain: x","kind":"reply","ts":"2026-08-03T02:00:00Z","opp":""},'
       '{"gid":"u1","from":"friend@gmail.com","subject":"Re: Nothing We Sent","kind":"reply","ts":"2026-08-03T09:00:00Z","opp":""}]')

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width":1100,"height":800})
    ctx.route("https://api.github.com/**", lambda r: r.fulfill(status=404, body="{}"))
    ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))
    ctx.route(f"{base}/relay", lambda r: r.fulfill(status=200, headers={"content-type":"application/json"},
                                                   body='{"ok":true,"records":'+REC+'}'))
    pg = ctx.new_page()
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_function("()=>typeof window.subjectLinkOpp==='function' && typeof window.pullInbound==='function' && typeof window.getInbound==='function'", timeout=15000)
    pg.evaluate("()=>{ document.documentElement.classList.remove('gate-locked'); const g=document.getElementById('thriveGate'); if(g) g.remove(); }")
    pg.evaluate(FAKE)
    pg.evaluate("()=>{ localStorage.setItem('console_sb_read','1'); localStorage.setItem('console_sb_session', JSON.stringify({access_token:'jwt',uid:'op',email:'op@x'})); }")

    # the send ledger: one send to madar with the subject Basel answers. Basel's From never received it.
    pg.evaluate("""()=>{
      localStorage.setItem('thrive_opps_v1', JSON.stringify([
        {slug:'madar', business:'مدارس المدار الدولية', published:true, up:1},
        {slug:'ambi1', business:'Ambi One', published:true, up:1},
        {slug:'ambi2', business:'Ambi Two', published:true, up:1}]));
      localStorage.setItem('thrive_mail_v1', JSON.stringify([
        {mid:'s1', opp:'madar', to:'head@madar.example', subject:'من جد وجد', status:'sent', direction:'out', ts:'2026-08-01T10:00:00Z'},
        {mid:'s2', opp:'ambi1', to:'a@x', subject:'Shared Offer', status:'sent', direction:'out', ts:'2026-08-01T10:00:00Z'},
        {mid:'s3', opp:'ambi2', to:'b@x', subject:'Shared Offer', status:'sent', direction:'out', ts:'2026-08-01T10:00:00Z'}]));
      localStorage.setItem('thrive_inbound_v1','[]'); localStorage.setItem('thrive_hits_v1','[]');
      window.invalidateSends&&window.invalidateSends();
    }""")

    # --- direct: the link function resolves by subject alone (Basel), and refuses ambiguity / no-match ---
    d = pg.evaluate("""()=>({
      basel: window.subjectLinkOpp({from:'alnajjarjawad97@gmail.com', subject:'Re: من جد وجد'}),
      ambiguous: window.subjectLinkOpp({from:'x@y.com', subject:'Re: Shared Offer'}),
      nomatch: window.subjectLinkOpp({from:'x@y.com', subject:'Re: Nothing We Sent'}),
      key: window.subjLinkKey('Re:  من جد وجد  ')
    })""")
    ck("subjectLinkOpp links Basel to madar by subject (sender address ignored)", d["basel"]=="madar", d)
    ck("subjectLinkOpp refuses an ambiguous subject (sent from two campaigns)", d["ambiguous"]=="", d)
    ck("subjectLinkOpp refuses a subject that matches no send", d["nomatch"]=="", d)
    ck("subjLinkKey strips the Re: prefix and lower-trims", d["key"]=="من جد وجد", d)

    # --- the noise classifier catches the automated senders, and passes a real person ---
    noise = pg.evaluate("""()=>({
      gh: window.inboundIsNoise({from:'notifications@github.com', subject:'Re: من جد وجد'}),
      dmarc: window.inboundIsNoise({from:'noreply-dmarc-support@google.com', subject:'Report Domain'}),
      person: window.inboundIsNoise({from:'alnajjarjawad97@gmail.com', subject:'Re: من جد وجد'})
    })""")
    ck("github and google-DMARC senders are noise; a real gmail person is not",
       noise["gh"] is True and noise["dmarc"] is True and noise["person"] is False, noise)

    # --- end to end: pullInbound links the real reply on write and confirms it to the server ---
    n = pg.evaluate("async ()=>{ return await window.pullInbound('%s/relay', {u:'x'}); }" % base)
    state = pg.evaluate("""()=>{ const by={}; window.getInbound().forEach(r=>by[r.gid]=r.opp||'');
      return { by, srv: Object.keys(window.__srv.console_inbound).reduce((a,k)=>{a[k]=window.__srv.console_inbound[k].opp||''; return a;},{}) }; }""")
    ck("pullInbound merged the 4 relay records", n==4, n)
    ck("Basel's reply is linked to madar on write (by subject, from a personal address)", state["by"].get("b1")=="madar", state["by"])
    ck("the github noise reply stays unlinked (opp empty)", state["by"].get("g1")=="", state["by"])
    ck("the google DMARC reply stays unlinked (opp empty)", state["by"].get("d1")=="", state["by"])
    ck("the unmatched real reply stays unlinked (opp empty)", state["by"].get("u1")=="", state["by"])
    ck("the confirmed write reached the server with madar on the row (not the noise)",
       state["srv"].get("b1")=="madar", state["srv"])

    # --- hasReply / the count now attach to madar; the noise is invisible to the board ---
    board = pg.evaluate("""()=>({ has: window.hasReply('madar'), count: window.replyCountFor('madar') })""")
    ck("hasReply(madar) is true and its reply count is 1 (only the real, linked reply)",
       board["has"] is True and board["count"]==1, board)

    ctx.close(); b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
