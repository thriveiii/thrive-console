"""LAYER 5.5 · RECIPIENT FIELD (board.html, fails-when-broken, ZERO real network send).

opps show has_email true but data.recipients[] is empty, so L5's Send gate refuses. L5.5 adds a "Recipient email"
field above Send that writes data.recipients[] through the board's L4 oppPatch (the SAME console_opps.data column
the engine's saveDraft writes, app.js:2198/3882), then re-reads so L5's gate clears in the same drawer session.

Stateful mock of Supabase REST + the relay (never a real send). Assertions:
  1. the recipient field appears above Send, pre-filled from the opp's known email (channels[]) as a suggestion,
     or from an existing data.recipients[] address;
  2. Save writes data.recipients[] via a PATCH to console_opps (data column), and it persists across a full reload;
  3. the L5 Send gate flips: before a recipient exists, tapping Send refuses with red and makes NO relay call;
     after a valid recipient is saved, tapping Send proceeds (a relay call is made) in the same session;
  4. multiple comma/newline addresses parse and store as a list; malformed and empty inputs are rejected with red
     and write nothing; AR RTL; privacy synthetic *.example.test only.
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

# ---- stateful model (ALL addresses synthetic *.example.test) -------------------------------------
OPPS = {
  # known email in the R11 channels[], recipients[] empty -> pre-fill suggestion, gate refuses until saved
  "alpha": {"slug":"alpha","business":"Alpha Co","has_email":True,"archived":False,
            "data":{"recipients":[], "channels":[{"type":"email","value":"known.alpha@example.test","primary":True}],
                    "outreach_subject":"{}", "outreach_text":"hi {}"}},
  # an existing recipient already on the record -> field shows it
  "beta":  {"slug":"beta","business":"Beta LLC","has_email":True,"archived":False,
            "data":{"recipients":[{"addr":"buyer.beta@example.test","name":"","lang":""}], "channels":[]}},
  # no email anywhere (channel.to is a url) -> field empty; used for malformed/empty rejection
  "gamma": {"slug":"gamma","business":"Gamma Inc","has_email":True,"archived":False,
            "data":{"recipients":[], "channel":{"kind":"page","to":"https://gamma.example.test"}}},
}
PATCH_CALLS = []   # captured PATCH bodies to console_opps
RELAY_CALLS = []   # captured relay payloads (never a real send)

def board_rows():
    rows = []
    for o in OPPS.values():
        rows.append({"slug":o["slug"], "business":o["business"], "stage":"live", "sent_count":0, "open_count":0,
          "replied":False, "idle_days":0, "last_activity_ts":"2026-01-04T00:00:00Z",
          "has_page":False, "has_email":bool(o.get("has_email")), "archived":bool(o.get("archived"))})
    return rows

def slug_of(url):
    m = re.search(r'eq\.([^&]+)', url); return m.group(1) if m else ""

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
    req = r.request; slug = slug_of(req.url)
    if req.method == "PATCH":
        try: body = json.loads(req.post_data or "{}")
        except Exception: body = {}
        PATCH_CALLS.append({"slug":slug, "body":body})
        o = OPPS.get(slug)
        if o is not None and isinstance(body.get("data"), dict): o["data"] = body["data"]
        return r.fulfill(status=204, body="")
    o = OPPS.get(slug, {"slug":slug,"data":{}})
    return J(r, [{"slug":o["slug"], "data":o.get("data",{})}])
def route_mail(r):
    if r.request.method == "POST": return r.fulfill(status=204, body="")
    return J(r, [])
def route_relay(r):
    body = r.request.post_data or ""
    try: RELAY_CALLS.append(json.loads(body))
    except Exception: RELAY_CALLS.append({"_raw":body[:120]})
    slug = ""
    try: slug = (json.loads(body) or {}).get("slug","")
    except Exception: pass
    return J(r, {"ok":True, "id":"resend_"+slug, "relay_version":5})

def wire(ctx):
    ctx.add_init_script("try{localStorage.setItem('console_sb_session', JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'op@thrive.test',uid:'u'}));}catch(e){}")
    ctx.route(re.compile(r"script\.google\.com/.*"), route_relay)
    ctx.route("**/rest/v1/console_board**", route_board)
    ctx.route("**/rest/v1/console_inbound**", route_empty)
    ctx.route("**/rest/v1/console_opps**", route_opps)
    ctx.route("**/rest/v1/console_mail**", route_mail)
    ctx.route("**/rest/v1/console_hits**", route_empty)

OPEN = """(biz)=>{ var t=null; document.querySelectorAll('.card').forEach(function(c){ if(c.textContent.indexOf(biz)>=0) t=c; }); if(t){ t.click(); return true; } return false; }"""
CLICK_ACT = """(act)=>{ var b=document.querySelector('#drawer .act[data-act='+JSON.stringify(act)+']'); if(b){ b.click(); return true; } return false; }"""
REC_VAL = """()=>{ var i=document.getElementById('recIn'); return i?i.value:null; }"""
REC_ABOVE_SEND = """()=>{ var dw=document.getElementById('drawer'); var rec=document.getElementById('recIn'); var snd=dw.querySelector('.act[data-act="send"]'); if(!rec||!snd) return false; return (rec.compareDocumentPosition(snd) & Node.DOCUMENT_POSITION_FOLLOWING)!==0; }"""
SET_REC = """(v)=>{ var i=document.getElementById('recIn'); if(i){ i.value=v; return true; } return false; }"""
REC_STATUS = """()=>{ var e=document.getElementById('recStatus'); return e?{txt:e.textContent,cls:e.className}:{txt:'',cls:''}; }"""
ACT_STATUS = """()=>{ var e=document.getElementById('actStatus'); return e?{txt:e.textContent,cls:e.className}:{txt:'',cls:''}; }"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(); wire(ctx)
    pg = ctx.new_page(); perr = []
    pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(700)

    # ===== 1. field appears above Send, pre-filled from the known email (channels[]) =====
    pg.evaluate(OPEN, "Alpha Co"); pg.wait_for_timeout(500)  # > detail fetch
    ck("1: the Recipient field is present and sits ABOVE the Send button", pg.evaluate(REC_ABOVE_SEND))
    ck("1: the field is pre-filled from the opp's known email (channels[]) as a suggestion",
       pg.evaluate(REC_VAL) == "known.alpha@example.test", pg.evaluate(REC_VAL))
    ck("1: nothing is auto-saved (data.recipients still empty before Save)", OPPS["alpha"]["data"]["recipients"]==[], OPPS["alpha"]["data"]["recipients"])

    # ===== 3a. the gate refuses BEFORE a recipient exists: Send makes no relay call =====
    relay_before = len(RELAY_CALLS)
    pg.evaluate(CLICK_ACT, "send"); pg.wait_for_timeout(700)
    st0 = pg.evaluate(ACT_STATUS)
    ck("3: before a recipient, tapping Send refuses with red and makes NO relay call",
       ("bad" in st0["cls"]) and len(RELAY_CALLS)==relay_before, {"st":st0, "relay":len(RELAY_CALLS)-relay_before})

    # ===== 2. Save writes data.recipients[] via PATCH to console_opps (data column) =====
    patch_before = len(PATCH_CALLS)
    pg.evaluate("()=>{var b=document.getElementById('recSave'); if(b) b.click();}"); pg.wait_for_timeout(900)
    ck("2: Save issued a PATCH to console_opps carrying data.recipients[]",
       len(PATCH_CALLS)>patch_before and isinstance(PATCH_CALLS[-1]["body"].get("data",{}).get("recipients"), list), PATCH_CALLS[-1] if PATCH_CALLS else None)
    saved = OPPS["alpha"]["data"].get("recipients", [])
    ck("2: the saved recipient is the suggested address, shaped {addr,name,lang}",
       len(saved)==1 and saved[0].get("addr")=="known.alpha@example.test" and "name" in saved[0], saved)
    rst = pg.evaluate(REC_STATUS)
    ck("2: a green Saved. status shows", "ok" in rst["cls"], rst)

    # persists across a full reload
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(500)
    pg.evaluate(OPEN, "Alpha Co"); pg.wait_for_timeout(500)
    ck("2: after a full reload, the field shows the saved recipient", pg.evaluate(REC_VAL)=="known.alpha@example.test", pg.evaluate(REC_VAL))

    # ===== 3b. the gate CLEARS: tapping Send now proceeds (a relay call is made) =====
    relay_before2 = len(RELAY_CALLS)
    pg.evaluate(CLICK_ACT, "send"); pg.wait_for_timeout(1100)
    ck("3: after a recipient is saved, tapping Send proceeds and makes a relay call (gate cleared)",
       len(RELAY_CALLS) > relay_before2 and (RELAY_CALLS[-1].get("to")=="known.alpha@example.test"), {"relay":len(RELAY_CALLS)-relay_before2, "to":(RELAY_CALLS[-1].get('to') if RELAY_CALLS else None)})
    pg.evaluate("()=>{var e=new KeyboardEvent('keydown',{key:'Escape'});document.dispatchEvent(e);}"); pg.wait_for_timeout(150)

    # ===== 1b. an existing recipient shows in the field =====
    pg.evaluate(OPEN, "Beta LLC"); pg.wait_for_timeout(500)
    ck("1: an opp with an existing data.recipients[] shows that address in the field", pg.evaluate(REC_VAL)=="buyer.beta@example.test", pg.evaluate(REC_VAL))
    pg.evaluate("()=>{var e=new KeyboardEvent('keydown',{key:'Escape'});document.dispatchEvent(e);}"); pg.wait_for_timeout(150)

    # ===== 4. multiple addresses parse + store; malformed + empty rejected with red, no write =====
    pg.evaluate(OPEN, "Gamma Inc"); pg.wait_for_timeout(500)
    ck("4: an opp with no known email starts with an empty field", (pg.evaluate(REC_VAL) or "")=="", pg.evaluate(REC_VAL))
    # malformed
    pbad = len(PATCH_CALLS)
    pg.evaluate(SET_REC, "notanemail"); pg.evaluate("()=>{document.getElementById('recSave').click();}"); pg.wait_for_timeout(400)
    ck("4: a malformed address is rejected with red and writes nothing", ("bad" in pg.evaluate(REC_STATUS)["cls"]) and len(PATCH_CALLS)==pbad, {"st":pg.evaluate(REC_STATUS), "n":len(PATCH_CALLS)-pbad})
    # empty
    pg.evaluate(SET_REC, "   "); pg.evaluate("()=>{document.getElementById('recSave').click();}"); pg.wait_for_timeout(400)
    ck("4: an empty input is rejected with red and writes nothing", ("bad" in pg.evaluate(REC_STATUS)["cls"]) and len(PATCH_CALLS)==pbad, {"st":pg.evaluate(REC_STATUS), "n":len(PATCH_CALLS)-pbad})
    # multiple valid
    pg.evaluate(SET_REC, "one@example.test, two@example.test\nthree@example.test")
    pg.evaluate("()=>{document.getElementById('recSave').click();}"); pg.wait_for_timeout(900)
    gsaved = OPPS["gamma"]["data"].get("recipients", [])
    ck("4: multiple comma/newline addresses parse and store as a list", len(gsaved)==3 and gsaved[0]["addr"]=="one@example.test", gsaved)

    # ===== 5. AR RTL + localized Save =====
    pg.evaluate("()=>{try{localStorage.setItem('thrive_lang','ar');}catch(e){}}")
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(600)
    pg.evaluate(OPEN, "Beta LLC"); pg.wait_for_timeout(500)
    arr = pg.evaluate("""()=>{ var dw=document.getElementById('drawer'); return { dir:getComputedStyle(dw).direction, save:dw.textContent.indexOf('حفظ المستلم')>=0, hasField:!!document.getElementById('recIn') }; }""")
    ck("5: AR flips the drawer to RTL and the recipient field is present", arr["dir"]=="rtl" and arr["hasField"], arr)
    ck("5: the Save action is localized in AR", arr["save"], arr)

    # ===== privacy + no uncaught error =====
    blob = json.dumps([o["data"] for o in OPPS.values()]) + json.dumps(RELAY_CALLS) + json.dumps(PATCH_CALLS)
    hosts = [re.split(r'[\s<">,\\]', seg, 1)[0] for seg in re.split(r'@', blob)[1:] if seg.strip()]
    bad = [h for h in hosts if h and not h.startswith("example.test") and not h.startswith("thrive.test") and not h.startswith("thriveiii.com")]
    ck("PRIVACY: every address stored/sent is a synthetic placeholder", not bad, bad)
    ck("no uncaught page error during any recipient save", not perr, perr)

    ctx.close(); b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL BOARD-RECIPIENT CHECKS PASS"))
raise SystemExit(1 if fails else 0)
