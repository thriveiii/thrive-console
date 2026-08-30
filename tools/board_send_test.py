"""LAYER 5 · SINGLE-RECIPIENT SEND (board.html, fails-when-broken, ZERO real network send).

L5 adds a Send capability to the L4 drawer: a faithful clone of relaySend (app.js:7423) + compile (app.js:1438)
for ONE recipient, with the body-read fix (the relay response is read INSIDE authFetchOnce's timeout race, not
the engine's bare await r.text() at app.js:7453). Ordering is the engine's: local optimistic UI first, POST to the
relay, and ONLY on Resend acceptance is the console_mail server row written (supaConfirmMail shape); a relay error /
Resend reject / aborted body-read reverts the card with red and leaves NO phantom Sent row.

This drives a STATEFUL mock of BOTH the relay (script.google.com /exec) and Supabase REST. NO email is ever sent:
the relay is intercepted and answered by the mock. Assertions:
  1. a send writes console_mail and the SENT lane reflects it across a full reload;
  2. pending-then-confirm ordering: the console_mail write happens AFTER the relay POST, never before acceptance;
  3. the payload carries slug, a Message-ID, and a CLEAN opp-page link (no ?r= tail; channel-2 removed);
     PERSONAL MODE: a standalone 1:1 opp (no data.source==="upload") sends personal-shaped - NO open pixel, NO
     "Reply STOP"/postal footer, NO List-Unsubscribe header - while the text/plain part and Reply-To remain;
  4. forced relay 500, forced Resend reject, and an aborted body-read all revert the card with red and write NO row;
  5. AR RTL; privacy: every address is a synthetic *.example.test placeholder.
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

# ---- stateful server model (ALL addresses synthetic *.example.test) ------------------------------
def mkopp(slug, biz, addr):
    return {"slug":slug, "business":biz, "has_email":True, "archived":False,
            "data":{"recipients":([{"addr":addr, "name":"Buyer "+slug}] if addr else []),
                    "outreach_subject":"{{BIZ}} x Thrive", "outreach_text":"Hi {{NAME}}, see {{LINK}} for "+biz+".",
                    "branded":False}}
OPPS = {
  "alpha": mkopp("alpha","Alpha Co","buyer.alpha@example.test"),   # happy send
  "beta":  mkopp("beta","Beta LLC","buyer.beta@example.test"),     # relay 500
  "gamma": mkopp("gamma","Gamma Inc","buyer.gamma@example.test"),  # Resend reject
  "delta": mkopp("delta","Delta Ltd","buyer.delta@example.test"),  # aborted body-read
  "norec": mkopp("norec","NoRecipient Co",""),                     # eligible message, no sighted email
}
MAIL = []              # console_mail rows written (server truth)
RELAY_CALLS = []       # captured relay payloads (never a real send)
ORDER = []             # "relay" / "mail" append order, to prove ordering
RELAY_FAULT = {}       # slug -> "500" | "reject" | "abort"
MAIL_FAULT = {}        # slug -> "500"

def sent_count(slug):
    return sum(1 for m in MAIL if (m.get("opp")==slug))

def board_rows():
    rows = []
    for o in OPPS.values():
        sc = sent_count(o["slug"])
        stage = "sent" if sc>0 else ("live" if o.get("has_email") else "draft")
        rows.append({"slug":o["slug"], "business":o["business"], "stage":stage, "sent_count":sc,
          "open_count":0, "replied":False, "idle_days":0, "last_activity_ts":"2026-01-04T00:00:00Z",
          "has_page":False, "has_email":bool(o.get("has_email")), "archived":bool(o.get("archived"))})
    return rows

def slug_of(url):
    m = re.search(r'eq\.([^&]+)', url); return m.group(1) if m else ""

def slug_of_payload(body):
    try: return (json.loads(body) or {}).get("slug","")
    except Exception: return ""

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
def route_mail(r):
    req = r.request
    if req.method == "POST":
        slug = slug_of_payload(req.post_data or "")
        if MAIL_FAULT.get(slug) == "500": return J(r, {"message":"synthetic mail write failure"}, status=500)
        try: rows = json.loads(req.post_data or "[]")
        except Exception: rows = []
        for row in (rows if isinstance(rows, list) else [rows]):
            if isinstance(row, dict) and row.get("opp"): MAIL.append(row); ORDER.append("mail")
        return r.fulfill(status=204, body="")
    return J(r, [])
def route_relay(r):
    body = r.request.post_data or ""
    slug = slug_of_payload(body)
    f = RELAY_FAULT.get(slug)
    if f == "abort": ORDER.append("relay"); return r.abort()
    if f == "500":   ORDER.append("relay"); return J(r, {"message":"relay boom"}, status=500)
    if f == "reject":ORDER.append("relay"); return J(r, {"ok":False, "error":"resend rejected", "relay_version":5})
    ORDER.append("relay")
    try: RELAY_CALLS.append(json.loads(body))
    except Exception: RELAY_CALLS.append({"_raw":body[:200]})
    return J(r, {"ok":True, "id":"resend_"+slug, "relay_version":5, "delivered":True})

def wire(ctx):
    ctx.add_init_script("try{localStorage.setItem('console_sb_session', JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'op@thrive.test',uid:'u'}));}catch(e){}")
    ctx.route(re.compile(r"script\.google\.com/.*"), route_relay)
    ctx.route("**/rest/v1/console_board**", route_board)
    ctx.route("**/rest/v1/console_inbound**", route_empty)
    ctx.route("**/rest/v1/console_opps**", route_opps)
    ctx.route("**/rest/v1/console_mail**", route_mail)
    ctx.route("**/rest/v1/console_hits**", route_empty)

LANE_OF = """(biz)=>{ var out=''; document.querySelectorAll('.lane').forEach(function(l){ var h=l.querySelector('h2'); if(!h) return; l.querySelectorAll('.card').forEach(function(c){ if(c.textContent.indexOf(biz)>=0) out=h.textContent; }); }); return out; }"""
OPEN = """(biz)=>{ var t=null; document.querySelectorAll('.card').forEach(function(c){ if(c.textContent.indexOf(biz)>=0) t=c; }); if(t){ t.click(); return true; } return false; }"""
CLICK_ACT = """(act)=>{ var b=document.querySelector('#drawer .act[data-act='+JSON.stringify(act)+']'); if(b){ b.click(); return true; } return false; }"""
ACT_STATUS = """()=>{ var e=document.getElementById('actStatus'); return e?{txt:e.textContent,cls:e.className}:{txt:'',cls:''}; }"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context()
    wire(ctx)
    pg = ctx.new_page()
    perr = []
    pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(700)

    # ===== gate: Send appears on an eligible opp (has_email + not closed + endpoint) =====
    ck("gate: Alpha is in the Live lane (a prepared message, ready to send)", "Live" in pg.evaluate(LANE_OF, "Alpha Co"))
    pg.evaluate(OPEN, "Alpha Co"); pg.wait_for_timeout(400)
    ck("gate: the drawer offers a Send action on an eligible opp", pg.evaluate("()=>!!document.querySelector('#drawer .act[data-act=\"send\"]')"))

    # ===== 1 + 2 + 3: happy send -> console_mail written AFTER relay, SENT lane, payload carries slug/msgid/token =====
    pg.evaluate(CLICK_ACT, "send"); pg.wait_for_timeout(1100)
    ck("1: Alpha moved to the Sent lane (optimistic + server re-read)", "Sent" in pg.evaluate(LANE_OF, "Alpha Co"))
    ck("1: exactly one console_mail row was written for Alpha", sent_count("alpha")==1, MAIL)
    ck("2: ordering - the relay POST happened BEFORE the console_mail write", ORDER[:2]==["relay","mail"], ORDER)
    pay = RELAY_CALLS[0] if RELAY_CALLS else {}
    ck("3: the payload carries slug=alpha", pay.get("slug")=="alpha", pay.get("slug"))
    mid = (pay.get("headers") or {}).get("Message-ID","")
    ck("3: the payload carries a Message-ID (<c...@thriveiii.com>)", bool(re.match(r"^<c.+@thriveiii\.com>$", mid)), mid)
    # CLEAN LINK (launch-send 2a / LINK_OWNERSHIP_EVIDENCE A): the body carries the BARE opp-page link with NO
    # ?r= tail. The channel-2 tokenization was removed because /opp/<slug>?r=... did not resolve on GitHub Pages
    # while the bare short form works; per-recipient email-open attribution rides on the campaign pixel (channel 1).
    ck("3: the text carries the CLEAN opp-page link /opp/alpha (bare short form)",
       "https://console.thriveiii.com/opp/alpha" in pay.get("text",""), pay.get("text","")[:200])
    ck("3: the body link has NO ?r= token tail (channel-2 tokenization removed)",
       re.search(r"[?&]r=", pay.get("text","")) is None, pay.get("text","")[:200])
    html = pay.get("html",""); text = pay.get("text",""); hdrs = pay.get("headers") or {}
    # PERSONAL MODE: Alpha is a standalone 1:1 opp (no data.source==="upload"), so the send drops all three
    # Promotions markers. The open pixel (channel 1) does NOT ride in a personal html; no bulk footer; no list header.
    ck("3 PERSONAL: NO open-tracking pixel in a 1:1 send (no op=hit, zero <img>)",
       "op=hit" not in html and html.count("<img")==0, html[-300:])
    ck("3 PERSONAL: NO 'Reply STOP' / postal footer in the html OR the text",
       "Reply STOP" not in html and "Reply STOP" not in text and "Not interested" not in html, {"html":html[-200:], "text":text[-200:]})
    ck("3 PERSONAL: NO List-Unsubscribe / List-Unsubscribe-Post header on a 1:1 send",
       "List-Unsubscribe" not in hdrs and "List-Unsubscribe-Post" not in hdrs, list(hdrs.keys()))
    ck("3 PERSONAL: the reply path still routes to the opp slug (Reply-To hi+alpha@thriveiii.com)",
       hdrs.get("Reply-To")=="hi+alpha@thriveiii.com", hdrs.get("Reply-To"))
    ck("3 PERSONAL: the text/plain alternative part is still present (multipart/alternative)",
       bool(text.strip()), text[:120])
    ck("3: LIGHT-HTML: real paragraph breaks (a <p> body paragraph), never a run-on block",
       "<p " in html or "<p>" in html, html[:220])
    ck("3: LIGHT-HTML: no logo / table / background (a clean light body)",
       "thrive-logo.png" not in html and "<table" not in html and "background" not in html, html[:220])
    ck("3: the payload preserves the faithful contract keys", all(k in pay for k in ["v","from","to","subject","html","text","idempotencyKey","headers","slug"]), list(pay.keys()))
    ck("3: provider is the relay (never a direct client Resend call)", not any("api.resend.com" in json.dumps(c) for c in RELAY_CALLS))

    # persists across a FULL reload
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(700)
    ck("1: after a full reload, Alpha is STILL in the Sent lane (server truth)", "Sent" in pg.evaluate(LANE_OF, "Alpha Co"))

    # ===== 4a: forced relay 500 -> revert + red, NO console_mail row (no phantom Sent) =====
    RELAY_FAULT["beta"] = "500"
    ck("4a: Beta starts Live", "Live" in pg.evaluate(LANE_OF, "Beta LLC"))
    pg.evaluate(OPEN, "Beta LLC"); pg.wait_for_timeout(400)
    pg.evaluate(CLICK_ACT, "send"); pg.wait_for_timeout(1000)
    st = pg.evaluate(ACT_STATUS)
    ck("4a: a relay 500 shows a visible RED status", "bad" in st["cls"] and st["txt"].strip()!="", st)
    ck("4a: NO console_mail row was written for Beta (no phantom Sent)", sent_count("beta")==0, MAIL)
    pg.evaluate("()=>{var e=new KeyboardEvent('keydown',{key:'Escape'});document.dispatchEvent(e);}"); pg.wait_for_timeout(150)
    ck("4a: Beta reverted to the Live lane", "Live" in pg.evaluate(LANE_OF, "Beta LLC"))

    # ===== 4b: forced Resend reject ({ok:false}) -> revert + red, NO row =====
    RELAY_FAULT["gamma"] = "reject"
    pg.evaluate(OPEN, "Gamma Inc"); pg.wait_for_timeout(400)
    pg.evaluate(CLICK_ACT, "send"); pg.wait_for_timeout(1000)
    st2 = pg.evaluate(ACT_STATUS)
    ck("4b: a Resend reject shows RED and writes NO row", ("bad" in st2["cls"]) and sent_count("gamma")==0, {"st":st2, "n":sent_count("gamma")})
    pg.evaluate("()=>{var e=new KeyboardEvent('keydown',{key:'Escape'});document.dispatchEvent(e);}"); pg.wait_for_timeout(150)
    ck("4b: Gamma reverted to the Live lane", "Live" in pg.evaluate(LANE_OF, "Gamma Inc"))

    # ===== 4c: aborted body-read (the exact engine hang) -> settles to revert + red, NO row =====
    RELAY_FAULT["delta"] = "abort"
    pg.evaluate(OPEN, "Delta Ltd"); pg.wait_for_timeout(400)
    pg.evaluate(CLICK_ACT, "send"); pg.wait_for_timeout(1400)
    st3 = pg.evaluate(ACT_STATUS)
    ck("4c: an aborted relay body settles to a RED status (never a hung promise)", "bad" in st3["cls"] and st3["txt"].strip()!="", st3)
    ck("4c: the aborted send wrote NO console_mail row", sent_count("delta")==0, MAIL)
    pg.evaluate("()=>{var e=new KeyboardEvent('keydown',{key:'Escape'});document.dispatchEvent(e);}"); pg.wait_for_timeout(150)
    ck("4c: Delta reverted to the Live lane", "Live" in pg.evaluate(LANE_OF, "Delta Ltd"))

    # ===== gate: no sighted recipient -> Send is DISABLED (the unified gate blocks it up front), no relay, no row =====
    relay_before = len(ORDER)
    pg.evaluate(OPEN, "NoRecipient Co"); pg.wait_for_timeout(400)
    sd4 = pg.evaluate("()=>{ var b=document.querySelector('#drawer .act[data-act=\"send\"]'); return b? !!b.disabled : null; }")
    pg.evaluate(CLICK_ACT, "send"); pg.wait_for_timeout(700)                # a disabled Send does nothing
    ck("gate: an opp with no sighted recipient cannot send - Send is DISABLED, no relay call, no row",
       sd4==True and sent_count("norec")==0 and len(ORDER)==relay_before, {"disabled":sd4, "order":ORDER[relay_before:]})
    pg.evaluate("()=>{var e=new KeyboardEvent('keydown',{key:'Escape'});document.dispatchEvent(e);}"); pg.wait_for_timeout(150)

    # ===== 5: AR RTL + localized Send =====
    pg.evaluate("()=>{try{localStorage.setItem('thrive_lang','ar');}catch(e){}}")
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(700)
    pg.evaluate(OPEN, "Gamma Inc"); pg.wait_for_timeout(400)
    arr = pg.evaluate("""()=>{ var dw=document.getElementById('drawer'); return { dir:getComputedStyle(dw).direction, send:dw.textContent.indexOf('إرسال بريد')>=0 }; }""")
    ck("5: AR flips the drawer to RTL", arr["dir"]=="rtl", arr)
    ck("5: the Send action is localized in AR", arr["send"], arr)

    # ===== privacy + no uncaught error =====
    blob = json.dumps(RELAY_CALLS) + json.dumps(MAIL)
    hosts = [re.split(r'[\s<">,\\]', seg, 1)[0] for seg in re.split(r'@', blob)[1:] if seg.strip()]
    bad = [h for h in hosts if h and not h.startswith("example.test") and not h.startswith("thrive.test") and not h.startswith("thriveiii.com")]
    ck("PRIVACY: every address in the payload/ledger is a synthetic placeholder", not bad, bad)
    ck("no uncaught page error fired during any send", not perr, perr)

    ctx.close(); b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL BOARD-SEND CHECKS PASS"))
raise SystemExit(1 if fails else 0)
