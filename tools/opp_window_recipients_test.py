"""G4 - the Recipients tab (per-recipient status) inside Mode B of the centered window (board.html).

Drives the REAL window Recipients tab (forced open via the exposed window.openOppWindow + window.owSelectMode;
OPP_WINDOW stays OFF in the shipped build, so this bypasses it exactly as the device test would). Proves the
tab lists this opp's recipients and derives ONE correct status per recipient from the existing board ledger
reads (console_mail / console_hits / console_inbound / console_suppressions), mirroring the app engine's
recipientState/campaignStats:
  - a plain send -> Sent; a token-bearing open (console_hits.data.r -> console_mail.id -> to_addr) -> Opened;
    a reply (console_inbound.data.from) -> Replied; a hard/soft bounce naming the address -> Bounced; a
    console_suppressions member -> Do-not-contact (shown distinctly); a queued mail row -> Queued; a recipient
    with no ledger rows -> Not sent;
  - PRECEDENCE on a recipient with multiple events: suppressed > hard-bounced > soft-bounced > replied >
    opened > sent > queued > none (a recipient with BOTH a reply and a hard bounce shows Bounced; a suppressed
    address with a sent row still shows Do-not-contact);
  - the opp filter holds: a reply/open under a DIFFERENT opp never colors this opp's recipient;
  - an untokened open is anonymous - it never marks a person Opened.
Read-only: the tab renders no per-recipient actions in G4. No email is sent and nothing is written.

FAILS-WHEN-BROKEN: reverting owRecipStatus's precedence/derivation (board-upload.src.js) - e.g. returning a
constant - collapses the per-recipient status assertions (proven by revert).
"""
import os, re, json, threading, http.server, socketserver, functools
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:600])

SLUG = "alpha"
RECIPS = [
    {"addr":"sent@ex.example",    "name":"Sent One"},
    {"addr":"opened@ex.example",  "name":"Opened One"},
    {"addr":"replied@ex.example", "name":"Replied One"},
    {"addr":"hard@ex.example",    "name":"Hard Bounce"},
    {"addr":"soft@ex.example",    "name":"Soft Bounce"},
    {"addr":"supp@ex.example",    "name":"Suppressed One"},
    {"addr":"queued@ex.example",  "name":"Queued One"},
    {"addr":"fresh@ex.example",   "name":"Fresh One"},
    {"addr":"multi@ex.example",   "name":"Multi One"},
]
OPP = {"slug":SLUG, "data":{"recipients":RECIPS}}
# console_mail (opp=alpha): the id is the open token (P2). supp@ has a sent row too, to prove suppressed wins.
MAIL = [
    {"id":"m_sent", "opp":SLUG, "to_addr":"sent@ex.example",    "status":"sent",   "ts":"2026-08-01T10:00:00Z", "data":{"direction":"out"}},
    {"id":"m_open", "opp":SLUG, "to_addr":"opened@ex.example",  "status":"sent",   "ts":"2026-08-01T10:01:00Z", "data":{"direction":"out"}},
    {"id":"m_rep",  "opp":SLUG, "to_addr":"replied@ex.example", "status":"sent",   "ts":"2026-08-01T10:02:00Z", "data":{"direction":"out"}},
    {"id":"m_hard", "opp":SLUG, "to_addr":"hard@ex.example",    "status":"sent",   "ts":"2026-08-01T10:03:00Z", "data":{"direction":"out"}},
    {"id":"m_soft", "opp":SLUG, "to_addr":"soft@ex.example",    "status":"sent",   "ts":"2026-08-01T10:04:00Z", "data":{"direction":"out"}},
    {"id":"m_supp", "opp":SLUG, "to_addr":"supp@ex.example",    "status":"sent",   "ts":"2026-08-01T10:05:00Z", "data":{"direction":"out"}},
    {"id":"m_q",    "opp":SLUG, "to_addr":"queued@ex.example",  "status":"queued", "ts":"2026-08-01T10:06:00Z", "data":{"direction":"out"}},
    {"id":"m_mult", "opp":SLUG, "to_addr":"multi@ex.example",   "status":"sent",   "ts":"2026-08-01T10:07:00Z", "data":{"direction":"out"}},
]
# console_hits: one TOKENED open for opened@ (data.r == its mail id), plus one UNTOKENED open (anonymous).
HITS = [
    {"id":"h_open",  "slug":SLUG, "ts":"2026-08-02T10:00:00Z", "self":False, "data":{"type":"open","r":"m_open"}},
    {"id":"h_anon",  "slug":SLUG, "ts":"2026-08-02T11:00:00Z", "self":False, "data":{"type":"open"}},
    {"id":"h_self",  "slug":SLUG, "ts":"2026-08-02T12:00:00Z", "self":True,  "data":{"type":"open","r":"m_sent"}},
]
# console_inbound (all opps; the code filters opp===slug). A reply for a DIFFERENT opp must not leak.
INBOUND = [
    {"id":"i_rep",   "opp":SLUG,  "kind":"reply", "bounce":"",     "ts":"2026-08-03T09:00:00Z", "data":{"from":"replied@ex.example","subject":"Re: hello"}},
    {"id":"i_hard",  "opp":SLUG,  "kind":"auto",  "bounce":"hard", "ts":"2026-08-01T10:10:00Z", "data":{"snippet":"550 hard@ex.example mailbox unavailable"}},
    {"id":"i_soft",  "opp":SLUG,  "kind":"auto",  "bounce":"soft", "ts":"2026-08-01T10:11:00Z", "data":{"snippet":"soft@ex.example temporarily deferred, will retry"}},
    {"id":"i_mrep",  "opp":SLUG,  "kind":"reply", "bounce":"",     "ts":"2026-08-03T09:30:00Z", "data":{"from":"multi@ex.example","subject":"Re: hi"}},
    {"id":"i_mbnc",  "opp":SLUG,  "kind":"auto",  "bounce":"hard", "ts":"2026-08-01T10:12:00Z", "data":{"snippet":"550 multi@ex.example no such user"}},
    {"id":"i_other", "opp":"beta","kind":"reply", "bounce":"",     "ts":"2026-08-03T09:00:00Z", "data":{"from":"sent@ex.example","subject":"Re: elsewhere"}},
]
SUPP = ["supp@ex.example"]
EXPECT = {
    "sent@ex.example":"sent", "opened@ex.example":"opened", "replied@ex.example":"replied",
    "hard@ex.example":"bounced_hard", "soft@ex.example":"bounced_soft", "supp@ex.example":"suppressed",
    "queued@ex.example":"queued", "fresh@ex.example":"none", "multi@ex.example":"bounced_hard",
}

def board_rows():
    return [{"slug":SLUG,"business":"Alpha Co","stage":"sent","sent_count":8,"open_count":1,"replied":True,
             "idle_days":0,"last_activity_ts":"2026-08-03T09:00:00Z","has_page":False,"has_email":True,"archived":False}]

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
handler = functools.partial(Handler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

def J(route, obj, status=200): route.fulfill(status=status, headers={"content-type":"application/json"}, body=json.dumps(obj))
def route_board(r): J(r, board_rows())
def route_empty(r): J(r, [])
def route_opps(r): J(r, [{"slug":OPP["slug"],"data":OPP["data"]}])
def route_mail(r): J(r, MAIL)                 # queried by opp=eq.alpha
def route_hits(r): J(r, HITS)                 # queried by slug=eq.alpha
def route_inbound(r): J(r, INBOUND)           # queried with no opp filter; code filters opp===slug
def route_supp(r): J(r, [{"email":e} for e in SUPP])

def wire(ctx):
    ctx.add_init_script("try{localStorage.setItem('console_sb_session', JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'op@thrive.test',uid:'u'}));}catch(e){}")
    ctx.route("**/rest/v1/console_board**", route_board)
    ctx.route("**/rest/v1/console_opps**", route_opps)
    ctx.route("**/rest/v1/console_mail**", route_mail)
    ctx.route("**/rest/v1/console_hits**", route_hits)
    ctx.route("**/rest/v1/console_inbound**", route_inbound)
    ctx.route("**/rest/v1/console_suppressions**", route_supp)
    ctx.route("**/rest/v1/console_pages**", route_empty)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(); wire(ctx)
    pg = ctx.new_page(); perr=[]; pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(700)
    pg.wait_for_selector(".card[data-slug='alpha']", timeout=8000)

    # open Mode B, switch to the Recipients tab
    pg.evaluate("(s)=>window.openOppWindow(s)", SLUG)
    pg.evaluate("()=>window.owSelectMode('b')")
    pg.wait_for_selector("#owMsgPanel #edSubj", timeout=6000)
    pg.click("#owTabs [data-ow-tab='recip']")
    pg.wait_for_selector("#owRecipPanel .ow-recip-list .ow-recip", timeout=6000); pg.wait_for_timeout(400)

    # ===== 1: the tab lists every recipient of this opp =====
    n = pg.evaluate("()=>document.querySelectorAll('#owRecipPanel .ow-recip').length")
    ck("the Recipients tab lists one row per recipient", n == len(RECIPS), n)

    # read each row -> {addr: status-class}
    rows = pg.evaluate("""()=>Array.prototype.map.call(document.querySelectorAll('#owRecipPanel .ow-recip'), function(li){
        var addr=(li.querySelector('.ow-recip-addr')||{}).textContent||'';
        var chip=li.querySelector('.ow-rs'); var cls='';
        if(chip){ chip.classList.forEach(function(c){ if(c.indexOf('ow-rs-')===0) cls=c.slice(6); }); }
        return { addr:addr.trim().toLowerCase(), status:cls, supp:li.classList.contains('supp'), chipText:(chip?chip.textContent:'') };
    })""")
    got = { r["addr"]: r["status"] for r in rows }

    # ===== 2: each recipient's ONE status is correct =====
    for addr, want in EXPECT.items():
        ck(f"{addr} -> {want}", got.get(addr) == want, got.get(addr))

    # ===== 3: precedence + isolation spot-checks =====
    ck("PRECEDENCE: multi@ (reply + hard bounce) shows bounced, not replied", got.get("multi@ex.example") == "bounced_hard", got.get("multi@ex.example"))
    ck("PRECEDENCE: supp@ (suppressed + a sent row) shows suppressed, not sent", got.get("supp@ex.example") == "suppressed", got.get("supp@ex.example"))
    ck("OPP FILTER: sent@ (a reply only under opp 'beta') stays sent, never replied", got.get("sent@ex.example") == "sent", got.get("sent@ex.example"))
    ck("NO INVENTED OPEN: an untokened hit marks nobody Opened (only opened@ is Opened)",
       [a for a,s in got.items() if s == "opened"] == ["opened@ex.example"], [a for a,s in got.items() if s == "opened"])

    # ===== 4: a suppressed row is shown distinctly + every chip has a non-empty label =====
    supp_row = next((r for r in rows if r["addr"] == "supp@ex.example"), {})
    ck("the suppressed row is visually distinct (li.supp)", supp_row.get("supp") is True, supp_row)
    ck("every recipient chip has a visible label", all((r.get("chipText") or "").strip() for r in rows), [r.get("chipText") for r in rows])

    # ===== 5: the read-only hook returns the same derivation =====
    hookrows = pg.evaluate("()=>window.__thriveOppRecipients('alpha')")
    hookmap = { (r.get("addr") or "").strip().lower(): r.get("status") for r in (hookrows or []) }
    ck("the __thriveOppRecipients hook matches the rendered statuses", hookmap == got, {"hook":hookmap, "dom":got})

    # ===== 6: read-only in G4 (no per-recipient action controls yet) =====
    ck("no per-recipient action buttons in G4 (read-only)", pg.evaluate("()=>document.querySelectorAll('#owRecipPanel button, #owRecipPanel .act').length") == 0)

    ck("no uncaught page error fired", len(perr) == 0, perr)
    pg.close(); b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL OPP-WINDOW-RECIPIENTS CHECKS PASS"))
import sys; sys.exit(1 if fails else 0)
