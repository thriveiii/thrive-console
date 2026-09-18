"""CAMPAIGN COMMIT writes the MESSAGE per card (board.html, fails-when-broken, ZERO network).

The bug report: a full-campaign zip commit writes the CARD and the PAGE but the message body/subject/recipient
are absent from the opp, leaving an empty card. This test drives the REAL window Full-campaign commit and
asserts, per card, that console_opps.data carries outreach_subject AND outreach_text AND recipients (the SAME
opp shape a hand-composed Mode A message writes) - not just the page. It also round-trips: reopening a committed
card shows its subject + body + recipient in compose. And it proves the "no empty cards, ever" guard: a folder
with a page but NO message is NOT written as an empty card.

Fails-when-broken: revert the body-write (outreach_text:"") so the body assertion fails; remove the guard so
the message-less folder commits an empty card.

Run: python3 tools/campaign_commit_message_test.py
"""
import os, re, io, json, zipfile, threading, http.server, socketserver, functools
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
SCRATCH = os.environ.get("SCRATCH", "/tmp/claude-0"); os.makedirs(SCRATCH, exist_ok=True)

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

# 4 message-bearing folders (each .md opens with a heading that MISMATCHES the folder, so only folder-pairing
# attaches it), plus a 5th folder that has a PAGE but NO .md (no message) - the guard must skip it.
MSG = [("bards-alley", "contact@bards-alley.com", "The Del Ray opening"),
       ("clay-cafe",   "hello@clay-cafe.example", "Your studio, online"),
       ("rise-dance",  "front@rise-dance.example", "Rise Dance, easier to book"),
       ("gov-rfp",     "proc@agency.example",     "RFP follow-up")]
NOMSG_FOLDER = "leftover-page"
ZIP = os.path.join(SCRATCH, "ccm.zip")
buf = io.BytesIO(); z = zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED)
for folder, to, subj in MSG:
    z.writestr("%s/index.html" % folder, "<!doctype html><h1>%s</h1>" % folder)
    md = ("# A heading unrelated to the folder\nSubject: %s\n{\"to\":\"%s\"}\n\nHi %s team,\n\nHere is your page: [LINK]\n\nThyab\n" % (subj, to, folder))
    z.writestr("%s/msg.md" % folder, md)
z.writestr("%s/index.html" % NOMSG_FOLDER, "<!doctype html><h1>leftover</h1>")   # a page with NO message
z.close(); open(ZIP, "wb").write(buf.getvalue())

OPPS = {}   # slug -> {business, data}; stores the committed data and returns it on GET (round-trip)
def slugq(u): m = re.search(r'slug=eq\.([^&]+)', u); return m.group(1) if m else ""
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(H, directory=ROOT)); PORT = srv.server_address[1]
srv.daemon_threads = True; threading.Thread(target=srv.serve_forever, daemon=True).start(); base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright
def J(r, o): r.fulfill(status=200, headers={"content-type":"application/json"}, body=json.dumps(o))
def empt(r): J(r, [])
def route_opps(r):
    q = r.request
    if q.method == "POST":
        for row in json.loads(q.post_data or "[]"):
            if row.get("slug"): OPPS[row["slug"]] = {"slug":row["slug"], "business":row.get("business",""), "data":row.get("data",{})}
        return r.fulfill(status=204, body="")
    if q.method == "PATCH":
        s = slugq(q.url); body = json.loads(q.post_data or "{}")
        if s in OPPS and isinstance(body.get("data"), dict): OPPS[s]["data"] = body["data"]
        return r.fulfill(status=204, body="")
    s = slugq(q.url); o = OPPS.get(s)
    return J(r, [{"slug":s, "data":o.get("data", {})}] if o else [{"slug":s, "data":{}}])
def route_board(r):
    J(r, [{"slug":s, "business":o.get("business",""), "stage":"live", "sent_count":0, "open_count":0, "replied":False, "idle_days":0, "last_activity_ts":"2026-01-01T00:00:00Z", "has_page":True, "has_email":True, "archived":False} for s, o in OPPS.items()])
def route_pages(r):
    q = r.request
    if q.method in ("POST", "PATCH"): return r.fulfill(status=204, body="")
    s = slugq(q.url)
    if s: return J(r, [{"slug":s, "html":"<h1>p</h1>", "live_verified_at":None}])
    return J(r, [])
def wire(ctx):
    ctx.add_init_script("try{localStorage.setItem('console_sb_session',JSON.stringify({access_token:'T',refresh_token:'R',expires_at:9999999999,email:'op@x',uid:'u1'}));}catch(e){}")
    ctx.route("**/rest/v1/**", empt); ctx.route("**/rest/v1/console_board**", route_board); ctx.route("**/rest/v1/console_suppressions**", empt)
    ctx.route("**/rest/v1/console_profile_names**", lambda r: J(r, [{"uid":"u1","display_name":"Op","email":"op@x"}]))
    ctx.route("**/rest/v1/console_profiles**", lambda r: J(r, [{"uid":"u1","display_name":"Op","prefs":{}}]))
    ctx.route("**/rest/v1/console_members**", empt); ctx.route("**/rest/v1/console_mail**", empt); ctx.route("**/rest/v1/console_hits**", empt); ctx.route("**/rest/v1/console_inbound**", empt)
    ctx.route("**/rest/v1/console_opps**", route_opps); ctx.route("**/rest/v1/console_pages**", route_pages)
    ctx.route(re.compile(r"script\.google\.com/.*"), lambda r: J(r, {"ok":True, "id":"x"}))
    ctx.route(re.compile(r"console\.thriveiii\.com/opp/.*"), lambda r: r.fulfill(status=200, body="<h1>live</h1>"))

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(); wire(ctx); pg = ctx.new_page(); perr = []
    pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(600)
    pg.evaluate("()=>window.owNewMessage()"); pg.wait_for_timeout(120)
    pg.evaluate("()=>window.owSelectMode('b')"); pg.wait_for_timeout(120)
    pg.click('#owTabs [data-ow-tab="page"]'); pg.wait_for_timeout(120)
    pg.click("#owPathCampaign"); pg.wait_for_timeout(120)
    pg.set_input_files("#owCampaignFile", ZIP); pg.wait_for_timeout(1600)
    pg.click("#owCommit")
    for _ in range(40):
        cls = pg.evaluate("()=>{var e=document.getElementById('owCommitStatus');return e?e.className:'';}")
        if "ok" in cls or "warn" in cls or "bad" in cls: break
        pg.wait_for_timeout(150)
    pg.wait_for_timeout(600)

    # ---- THE CORE ASSERTION: every message-bearing card carries subject + body + recipients on the OPP ----
    ck("4 message cards were committed (one per message folder)", all(f[0] in OPPS for f in MSG), sorted(OPPS.keys()))
    for folder, to, subj in MSG:
        d = (OPPS.get(folder, {}).get("data") or {})
        full = bool(str(d.get("outreach_subject","")).strip()) and bool(str(d.get("outreach_text","")).strip()) and bool(d.get("recipients") or [])
        ck("card '%s': data has outreach_subject AND outreach_text AND recipients (not just the page)" % folder, full,
           {"subj": d.get("outreach_subject"), "body_len": len(str(d.get("outreach_text",""))), "recips": d.get("recipients")})
        r0 = (d.get("recipients") or [{}])[0]
        ck("card '%s': the recipient is the one from its own .md" % folder, r0.get("addr") == to, r0)

    # ---- NO EMPTY CARDS, EVER: the page-only folder is NOT written as an empty card ----
    ck("the message-less folder was NOT committed as an empty card (guard)", NOMSG_FOLDER not in OPPS, list(OPPS.keys()))
    ck("the commit status names the skipped no-message page (never silent)",
       pg.evaluate("()=>{var e=document.getElementById('owCommitStatus'); return !!e && (e.textContent||'').indexOf('no message')>=0;}"),
       pg.evaluate("()=>{var e=document.getElementById('owCommitStatus');return e?e.textContent:'';}"))

    # ---- ROUND TRIP: reopen a committed card and confirm its message loads into compose ----
    pg.evaluate("()=>window.closeOppWindow && window.closeOppWindow()"); pg.wait_for_timeout(200)
    pg.evaluate("()=>window.openOppWindow('bards-alley','detail')"); pg.wait_for_timeout(500)
    pg.evaluate("()=>window.owSelectMode && window.owSelectMode('b')"); pg.wait_for_timeout(500)
    f = pg.evaluate("""()=>{var s=document.querySelector('#owMsgPanel #edSubj')||document.getElementById('edSubj');var b=document.querySelector('#owMsgPanel #edBody')||document.getElementById('edBody');var rc=document.querySelector('#owMsgPanel #recIn')||document.getElementById('recIn');return {subj:s?s.value:'',body:b?b.value:'',recip:rc?rc.value:''};}""")
    ck("round-trip: reopening the card loads its subject into compose", f.get("subj") == "The Del Ray opening", f.get("subj"))
    ck("round-trip: reopening the card loads its body into compose", "bards-alley team" in str(f.get("body","")) and len(str(f.get("body","")).strip()) > 40, str(f.get("body",""))[:80])
    ck("round-trip: reopening the card loads its recipient", f.get("recip") == "contact@bards-alley.com", f.get("recip"))

    ck("no page errors were thrown", len(perr) == 0, perr)
    pg.close(); ctx.close(); b.close()

srv.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL CAMPAIGN-COMMIT-MESSAGE CHECKS PASS"))
raise SystemExit(1 if fails else 0)
