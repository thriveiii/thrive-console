"""PERSONAL SEND MODE (board.html, fails-when-broken, ZERO real network send).

Root cause (DELIVERABILITY_EVIDENCE): every send was bulk-shaped. sendCompile unconditionally attached three
Promotions triggers - a List-Unsubscribe / List-Unsubscribe-Post header pair, a "Reply STOP" + postal footer,
and a 1x1 off-domain open-tracking pixel - so a genuine 1:1 note landed in Gmail Promotions, not Inbox.

The fix threads a send MODE through the compile/send path. The mode is data-driven so preview == send:
an uploaded-page opp (data.source==="upload") is a "campaign" and keeps the bulk shape; every other opp - the
standalone New message - is "personal" and drops ALL THREE markers while keeping the text/plain part.

This locks the contract, exercising the SAME compiler the send path uses (window.__thriveComposeArtifact ->
edCompileFrom -> sendCompile, mode derived from data.source) and the SAME header builder the send stamps
(window.__thriveSendHeaders -> outboundHeaders(slug, sendMode(data))):
  (a) a PERSONAL send emits NO open pixel, NO "Reply STOP"/postal footer, and NO List-Unsubscribe header,
      but DOES keep a non-empty text/plain part and a slug-scoped Reply-To;
  (b) a CAMPAIGN send still emits all three (exactly one 1x1 pixel, the footer in html+text, both list headers);
  (c) the mode defaults correctly from the record alone - a standalone opp => "personal", source:"upload" => "campaign".

Same mocked GoTrue + console_board + console_opps harness as board_editor_test. Synthetic *.example.test only.
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

# ---- two opps: a standalone 1:1 (personal) and an uploaded-page campaign (source:"upload") ----------
def opp(slug, biz, addr, source=None):
    data = {"recipients":[{"addr":addr, "name":"Buyer "+slug}],
            "outreach_subject":"Quick note for "+biz, "outreach_text":"Hi, wanted to reach out about "+biz+". See {{LINK}}.",
            "branded":False}
    if source: data["source"] = source
    return {"slug":slug, "business":biz, "archived":False, "data":data}
OPPS = {
  "pers1": opp("pers1", "Personal Co", "buyer.pers1@example.test"),                    # standalone 1:1 -> personal
  "camp1": opp("camp1", "Campaign Co", "buyer.camp1@example.test", source="upload"),   # uploaded page -> campaign
}

def has_msg(o):
    d=o.get("data",{}); return bool(str(d.get("outreach_subject","")).strip() or str(d.get("outreach_text","")).strip())
def board_rows():
    rows=[]
    for o in OPPS.values():
        rows.append({"slug":o["slug"], "business":o["business"], "stage":"live", "sent_count":0, "open_count":0,
          "replied":False, "idle_days":0, "last_activity_ts":"2026-01-04T00:00:00Z",
          "has_page":(o["data"].get("source")=="upload"), "has_email":has_msg(o), "archived":False})
    return rows
def slug_of(url):
    m=re.search(r'slug=eq\.([^&]+)', url); return m.group(1) if m else ""

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
handler = functools.partial(Handler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

def J(route, obj, status=200):
    route.fulfill(status=status, headers={"content-type":"application/json"}, body=json.dumps(obj))
def route_board(r): J(r, board_rows())
def route_empty(r): J(r, [])
def route_opps(r):
    o = OPPS.get(slug_of(r.request.url), {"slug":"","data":{}})
    J(r, [{"slug":o["slug"], "data":o.get("data",{})}])

def wire(ctx):
    ctx.add_init_script("try{localStorage.setItem('console_sb_session', JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'op@thrive.test',uid:'u'}));}catch(e){}")
    ctx.route("**/rest/v1/console_board**", route_board)
    ctx.route("**/rest/v1/console_inbound**", route_empty)
    ctx.route("**/rest/v1/console_hits**", route_empty)
    ctx.route("**/rest/v1/console_mail**", route_empty)
    ctx.route("**/rest/v1/console_opps**", route_opps)

PIXEL = re.compile(r'op=hit[^"\'<>]*?r=[^&;"\'\s<]+')

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(); wire(ctx); pg = ctx.new_page(); perr=[]
    pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(500)
    pg.wait_for_function("()=>typeof window.__thriveComposeArtifact==='function' && typeof window.__thriveSendHeaders==='function'", timeout=8000)

    # compile BOTH opps through the real send compiler, and read the exact headers the send stamps for each mode
    art_p = pg.evaluate("async()=>await window.__thriveComposeArtifact('pers1')")
    art_c = pg.evaluate("async()=>await window.__thriveComposeArtifact('camp1')")
    hdr_p = pg.evaluate("async()=>await window.__thriveSendHeaders('pers1')")
    hdr_c = pg.evaluate("async()=>await window.__thriveSendHeaders('camp1')")
    hp, tp = art_p.get("html",""), art_p.get("text","")
    hc, tc = art_c.get("html",""), art_c.get("text","")

    # ---- (c) the mode is derived from the record alone (no caller passes it here) --------------------
    ck("(c) a standalone 1:1 opp derives mode='personal'", art_p.get("mode")=="personal", art_p.get("mode"))
    ck("(c) an uploaded-page opp (data.source=='upload') derives mode='campaign'", art_c.get("mode")=="campaign", art_c.get("mode"))

    # ---- (a) PERSONAL: none of the three bulk markers, but the text/plain part + Reply-To stay --------
    ck("(a) PERSONAL html carries NO open pixel (no op=hit) and ZERO images",
       PIXEL.search(hp) is None and "op=hit" not in hp and hp.count("<img")==0, hp[-260:])
    ck("(a) PERSONAL has NO 'Reply STOP' / postal footer in html OR text",
       "Reply STOP" not in hp and "Reply STOP" not in tp and "Not interested" not in hp
       and "Thrive Digital Solutions, VA, USA" not in hp and "Thrive Digital Solutions, VA, USA" not in tp,
       {"html":hp[-200:], "text":tp[-200:]})
    ck("(a) PERSONAL headers carry NO List-Unsubscribe and NO List-Unsubscribe-Post",
       "List-Unsubscribe" not in hdr_p and "List-Unsubscribe-Post" not in hdr_p, list(hdr_p.keys()))
    ck("(a) PERSONAL still keeps a non-empty text/plain part (multipart/alternative)",
       bool(tp.strip()) and "wanted to reach out" in tp, tp[:160])
    ck("(a) PERSONAL still routes replies to the opp slug (Reply-To hi+pers1@thriveiii.com)",
       hdr_p.get("Reply-To")=="hi+pers1@thriveiii.com", hdr_p.get("Reply-To"))
    ck("(a) PERSONAL body renders (a real <p> paragraph, the operator's text verbatim)",
       ("<p " in hp or "<p>" in hp) and "wanted to reach out" in hp, hp[:200])

    # ---- (b) CAMPAIGN: all three markers present -----------------------------------------------------
    ck("(b) CAMPAIGN html carries EXACTLY ONE 1x1 open pixel (op=hit, r=<token>)",
       PIXEL.search(hc) is not None and hc.count("<img")==1 and 'width="1" height="1"' in hc, hc[-260:])
    ck("(b) CAMPAIGN carries the 'Reply STOP' / postal footer in BOTH html and text",
       "Reply STOP" in hc and "Reply STOP" in tc and "Thrive Digital Solutions, VA, USA" in hc
       and "Thrive Digital Solutions, VA, USA" in tc, {"html":hc[-220:], "text":tc[-220:]})
    ck("(b) CAMPAIGN headers carry List-Unsubscribe AND List-Unsubscribe-Post: List-Unsubscribe=One-Click",
       "List-Unsubscribe" in hdr_c and hdr_c.get("List-Unsubscribe-Post")=="List-Unsubscribe=One-Click", hdr_c)
    ck("(b) CAMPAIGN also keeps its slug-scoped Reply-To (hi+camp1@thriveiii.com)",
       hdr_c.get("Reply-To")=="hi+camp1@thriveiii.com", hdr_c.get("Reply-To"))

    # ---- the channel-2 tokenized page link is mode-INDEPENDENT (present in both) ----------------------
    ck("channel-2: the tokenized opp-page link r=<token> rides in the text for BOTH modes",
       re.search(r"[?&]r=", tp) is not None and re.search(r"[?&]r=", tc) is not None,
       {"pers":tp[-160:], "camp":tc[-160:]})

    # ---- privacy + no error --------------------------------------------------------------------------
    blob = json.dumps([art_p, art_c, hdr_p, hdr_c])
    hosts = [re.split(r'[\s<">,\\]', seg, 1)[0] for seg in re.split(r'@', blob)[1:] if seg.strip()]
    bad = [h for h in hosts if h and not h.startswith("example.test") and not h.startswith("thrive.test") and not h.startswith("thriveiii.com")]
    ck("PRIVACY: every address is a synthetic placeholder", not bad, bad)
    ck("no uncaught page error", not perr, perr)

    pg.close(); ctx.close(); b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL PERSONAL-MODE CHECKS PASS"))
raise SystemExit(1 if fails else 0)
