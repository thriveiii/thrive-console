"""LAYER 4 · WRITE ACTIONS (board.html, fails-when-broken, device-shaped).

L1-L3 made the standalone board.html a READ-ONLY reader of console_board (stage authority = the server view).
L4 gives it the four write capabilities, each a real Supabase write on the in-memory token, cloned from the
engine's console_opps upsert but adapted to the standalone reader's settle-always pattern:

  1. Stage move (promote draft -> live, and the terminal outcomes won/lost/dropped): a PATCH to console_opps,
     then the board RE-READS console_board and paints the SERVER stage (never a fabricated local one, §3).
  2. Archive / reopen: archiving is the successful terminal state; a replied+archived opp still counts Replied
     (the L2 domain law), so archiving must NOT subtract it from the replied lane count.
  3. Note on the opportunity record (console_opps.data.notes[]): read-modify-write, then a read-back confirms.
  4. Optimistic confirm-or-revert: the card moves at once; on a write FAILURE the card reverts to its prior lane
     and a visible RED status shows - never a silent wrong state, never a hung promise (aborted/rejecting writes
     settle to a defined result via the same bounded authFetchOnce the reads use).

This drives a STATEFUL mock of the Supabase REST surface: a PATCH mutates the server state, so a re-read (and a
full page reload) reflects the persisted change - exactly the device acceptance ("persists across reload").

Fails-when-broken: point any capability at the old read-only board and the matching check goes red (there is no
PATCH, so a move never persists; a forced 500 with no revert leaves the card in the wrong lane).

PRIVACY: every address here is a synthetic *.example.test placeholder; no real prospect data appears anywhere.
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
        if d is not None: print("      " + str(d)[:500])

# ---- stateful server model (ALL addresses synthetic *.example.test) ------------------------------
# Each opp is the console_opps row shape (slug/business/stage/archived/data + send/open counts). The
# console_board VIEW stage is DERIVED here the same way docs/supabase-board-view.sql derives it (rung 1:
# a declared stage that is not sent/replied stands; else replied; else no-send live/draft; else opened/sent).
OPPS = {
  "delta": {"slug":"delta","business":"Delta Co","stage":"","archived":False,"sent_count":0,"open_count":0,"has_page":False,"has_email":False,"data":{}},
  "epsi":  {"slug":"epsi", "business":"Epsilon", "stage":"","archived":False,"sent_count":2,"open_count":3,"has_page":True, "has_email":True, "data":{"prohibition":"synthetic hold"}},
  "gamm":  {"slug":"gamm", "business":"Gamma Inc","stage":"won","archived":False,"sent_count":1,"open_count":0,"has_page":True,"has_email":True,"data":{}},
  "theta": {"slug":"theta","business":"Theta LLC","stage":"","archived":False,"sent_count":0,"open_count":0,"has_page":False,"has_email":False,"data":{}},
  "kappa": {"slug":"kappa","business":"Kappa Ltd","stage":"","archived":False,"sent_count":0,"open_count":0,"has_page":False,"has_email":False,"data":{}},
}
INBOUND = [  # one real reply attributed to epsi, so epsi is Replied by signal (not only by a declared stage)
  {"opp":"epsi","kind":"human","bounce":None,"ts":"2026-01-04T10:00:00Z","data":{"from":"reply1@example.test","subject":"Re: Intro","snippet":"Happy to talk."}},
]
FAULT = {}   # slug -> "500" or "abort": inject a write failure for the optimistic revert test

def replied_signal(slug):
    return any((r.get("opp")==slug and r.get("kind")!="auto" and not r.get("bounce")) for r in INBOUND)

def board_rows():
    rows = []
    for o in OPPS.values():
        st = o.get("stage","") or ""
        sent = int(o.get("sent_count",0)); opens = int(o.get("open_count",0))
        rep = replied_signal(o["slug"]) or (st=="replied")
        page = bool(o.get("has_page")); mail = bool(o.get("has_email"))
        if st and st not in ("sent","replied"):
            stage = st
        elif rep:
            stage = "replied"
        elif sent == 0:
            stage = "live" if (page or mail) else "draft"
        elif opens > 0:
            stage = "opened"
        else:
            stage = "sent"
        rows.append({"slug":o["slug"],"business":o["business"],"stage":stage,"sent_count":sent,
          "open_count":opens,"replied":rep,"idle_days":0,"last_activity_ts":"2026-01-04T00:00:00Z",
          "has_page":page,"has_email":mail,"archived":bool(o.get("archived"))})
    return rows

def slug_of(url):
    m = re.search(r'eq\.([^&]+)', url)
    return m.group(1) if m else ""

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
def route_inbound(r): J(r, INBOUND)
def route_mail(r): J(r, [])
def route_hits(r): J(r, [])

def route_opps(r):
    req = r.request
    slug = slug_of(req.url)
    if req.method == "PATCH":
        # fault injection for the optimistic-revert test
        f = FAULT.get(slug)
        if f == "abort": return r.abort()
        if f == "500":   return J(r, {"message":"synthetic write failure"}, status=500)
        try: body = json.loads(req.post_data or "{}")
        except Exception: body = {}
        o = OPPS.get(slug)
        if o is not None:
            if "stage" in body:    o["stage"] = body["stage"] or ""
            if "archived" in body: o["archived"] = bool(body["archived"])
            if "data" in body and isinstance(body["data"], dict): o["data"] = body["data"]
        return r.fulfill(status=204, body="")
    # GET select=slug,data  (note read + read-back)
    o = OPPS.get(slug, {"slug":slug,"data":{}})
    return J(r, [{"slug":o["slug"],"data":o.get("data",{})}])

def wire(ctx):
    ctx.add_init_script("try{localStorage.setItem('console_sb_session', JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'op@thrive.test',uid:'u'}));}catch(e){}")
    ctx.route("**/rest/v1/console_board**", route_board)
    ctx.route("**/rest/v1/console_inbound**", route_inbound)
    ctx.route("**/rest/v1/console_opps**", route_opps)
    ctx.route("**/rest/v1/console_mail**", route_mail)
    ctx.route("**/rest/v1/console_hits**", route_hits)

# helpers evaluated in the page
LANE_OF = """(biz)=>{ // return the lane <h2> text that contains the card for this business, or ''
  var out=''; document.querySelectorAll('.lane').forEach(function(l){
    var h=l.querySelector('h2'); if(!h) return;
    l.querySelectorAll('.card').forEach(function(c){ if(c.textContent.indexOf(biz)>=0) out=h.textContent; });
  }); return out; }"""
OPEN = """(biz)=>{ var t=null; document.querySelectorAll('.card').forEach(function(c){ if(c.textContent.indexOf(biz)>=0) t=c; }); if(t){ t.click(); return true; } return false; }"""
CLICK_ACT = """(act)=>{ var b=document.querySelector('#drawer .act[data-act='+JSON.stringify(act)+']'); if(b){ b.click(); return true; } return false; }"""
REPLIED_N = """()=>{ var n=''; document.querySelectorAll('.lane h2').forEach(function(h){ if(/Replied|مُجاب/.test(h.textContent)){ var s=h.querySelector('.n'); n=s?s.textContent.trim():''; } }); return n; }"""
TRAY_N = """()=>{ var t=document.getElementById('trayToggle'); return t?(t.querySelector('.n')||{}).textContent||'':''; }"""
ACT_STATUS = """()=>{ var e=document.getElementById('actStatus'); return e?{txt:e.textContent,cls:e.className}:{txt:'',cls:''}; }"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context()
    wire(ctx)
    pg = ctx.new_page()
    perr = []
    pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(700)

    # ===== 1. STAGE MOVE: promote a Draft card to Live; persists across a full reload =====
    ck("1: Delta starts in the Draft lane", "Draft" in pg.evaluate(LANE_OF, "Delta Co"))
    pg.evaluate(OPEN, "Delta Co"); pg.wait_for_timeout(400)
    ck("1: the drawer offers a Promote action on a draft card", pg.evaluate("()=>!!document.querySelector('#drawer .act[data-act=\"promote\"]')"))
    pg.evaluate(CLICK_ACT, "promote"); pg.wait_for_timeout(700)   # optimistic paint + PATCH + re-read
    ck("1: after promote, Delta is in the Live lane (server re-read, not fabricated)", "Live" in pg.evaluate(LANE_OF, "Delta Co"))
    ck("1: the server console_opps row now carries the declared stage 'live'", OPPS["delta"]["stage"]=="live")
    # persists across a FULL reload (the mock server keeps the state, like Supabase would)
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(700)
    ck("1: after a full reload, Delta is STILL Live (the write persisted)", "Live" in pg.evaluate(LANE_OF, "Delta Co"))

    # ===== 3. NOTE: add a note to the opportunity record; read-back confirms; it renders =====
    pg.evaluate(OPEN, "Delta Co"); pg.wait_for_timeout(400)
    pg.evaluate("""()=>{ var i=document.getElementById('noteIn'); if(i){ i.value='Synthetic follow-up note'; } }""")
    pg.evaluate("""()=>{ var b=document.getElementById('noteAdd'); if(b) b.click(); }""")
    pg.wait_for_timeout(700)
    nres = pg.evaluate("""()=>{ var s=document.getElementById('noteStatus'); var host=document.getElementById('notesList');
      return { status:(s?s.textContent:''), shown:(host?host.textContent:'').indexOf('Synthetic follow-up note')>=0 }; }""")
    ck("3: the note saved (read-back confirmed) and shows a saved status", "saved" in nres["status"].lower(), nres)
    ck("3: the new note renders in the drawer notes list", nres["shown"], nres)
    ck("3: the note persisted to the opp record (console_opps.data.notes)",
       any(n.get("text")=="Synthetic follow-up note" for n in OPPS["delta"]["data"].get("notes",[])), OPPS["delta"]["data"])
    ck("3: the note author is the OPERATOR email, never a prospect",
       (OPPS["delta"]["data"].get("notes",[{}])[-1].get("by")=="op@thrive.test"))
    pg.evaluate("()=>{var s=document.getElementById('scrim'); if(s){var e=new KeyboardEvent('keydown',{key:'Escape'});document.dispatchEvent(e);}}")
    pg.wait_for_timeout(200)

    # ===== 2. ARCHIVE: a replied opp archives to the tray; its Replied count is UNCHANGED =====
    repBefore = pg.evaluate(REPLIED_N)
    ck("2: Epsilon (replied) is in the Replied lane before archiving", "Replied" in pg.evaluate(LANE_OF, "Epsilon"))
    pg.evaluate(OPEN, "Epsilon"); pg.wait_for_timeout(400)
    ck("2: the drawer offers Archive on an open card", pg.evaluate("()=>!!document.querySelector('#drawer .act[data-act=\"archive\"]')"))
    pg.evaluate(CLICK_ACT, "archive"); pg.wait_for_timeout(700)
    repAfter = pg.evaluate(REPLIED_N)
    ck("2: the server marked Epsilon archived", OPPS["epsi"]["archived"] is True)
    ck("2: Epsilon STILL counts in Replied after archiving (domain law: archive is not exclusion)",
       repBefore==repAfter and repAfter!="", {"before":repBefore,"after":repAfter})
    ck("2: archived Epsilon also appears in the Closed tray", int(pg.evaluate(TRAY_N) or "0") >= 1)
    pg.evaluate("()=>{var e=new KeyboardEvent('keydown',{key:'Escape'});document.dispatchEvent(e);}"); pg.wait_for_timeout(150)

    # ===== 2b. REOPEN: a won opp in the tray returns to the board =====
    ck("2b: Gamma (won) is NOT in an open lane (it is closed/tray)", pg.evaluate(LANE_OF, "Gamma Inc")=="")
    # open Gamma from the tray
    pg.evaluate("""()=>{ var t=document.getElementById('trayToggle'); if(t) t.click(); }"""); pg.wait_for_timeout(200)
    pg.evaluate(OPEN, "Gamma Inc"); pg.wait_for_timeout(400)
    ck("2b: the drawer offers Reopen on a closed card", pg.evaluate("()=>!!document.querySelector('#drawer .act[data-act=\"reopen\"]')"))
    pg.evaluate(CLICK_ACT, "reopen"); pg.wait_for_timeout(700)
    ck("2b: the server cleared the terminal stage on reopen", OPPS["gamm"]["stage"]=="")
    ck("2b: Gamma returned to an open lane (derived Sent from its one send)", pg.evaluate(LANE_OF, "Gamma Inc")!="")

    # ===== 4. OPTIMISTIC CONFIRM-OR-REVERT: a forced 500 reverts the card and shows RED =====
    FAULT["theta"] = "500"
    ck("4: Theta starts in Draft", "Draft" in pg.evaluate(LANE_OF, "Theta LLC"))
    pg.evaluate(OPEN, "Theta LLC"); pg.wait_for_timeout(400)
    pg.evaluate(CLICK_ACT, "promote"); pg.wait_for_timeout(900)   # optimistic to live, PATCH 500, revert
    st = pg.evaluate(ACT_STATUS)
    ck("4: a forced write failure shows a visible RED status", ("bad" in st["cls"]) and st["txt"].strip()!="", st)
    ck("4: the failed write did NOT persist on the server (stage stayed empty)", OPPS["theta"]["stage"]=="")
    pg.evaluate("()=>{var e=new KeyboardEvent('keydown',{key:'Escape'});document.dispatchEvent(e);}"); pg.wait_for_timeout(150)
    ck("4: the card REVERTED to Draft after the failure (no silent wrong state)", "Draft" in pg.evaluate(LANE_OF, "Theta LLC"))

    # ===== 4b. SETTLE-ALWAYS: an aborted/rejecting write settles to a revert, never a hung promise =====
    FAULT["kappa"] = "abort"
    pg.evaluate(OPEN, "Kappa Ltd"); pg.wait_for_timeout(400)
    pg.evaluate(CLICK_ACT, "promote"); pg.wait_for_timeout(1200)  # network abort -> authFetchOnce rejects -> revert
    st2 = pg.evaluate(ACT_STATUS)
    ck("4b: an aborted write settles to a visible RED status (never a hung promise)", ("bad" in st2["cls"]) and st2["txt"].strip()!="", st2)
    pg.evaluate("()=>{var e=new KeyboardEvent('keydown',{key:'Escape'});document.dispatchEvent(e);}"); pg.wait_for_timeout(150)
    ck("4b: Kappa reverted to Draft after the aborted write", "Draft" in pg.evaluate(LANE_OF, "Kappa Ltd"))

    # ===== 5. AR: the actions surface localizes and the drawer flips RTL =====
    pg.evaluate("()=>{try{localStorage.setItem('thrive_lang','ar');}catch(e){}}")
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(700)
    pg.evaluate(OPEN, "Epsilon"); pg.wait_for_timeout(400)
    arr = pg.evaluate("""()=>{ var dw=document.getElementById('drawer');
      return { dir: getComputedStyle(dw).direction, hasActions: dw.textContent.indexOf('إجراءات')>=0,
               hasReopen: !!dw.querySelector('.act[data-act=\"reopen\"]') }; }""")
    ck("5: AR flips the drawer to RTL", arr["dir"]=="rtl", arr)
    ck("5: the actions section is localized in AR", arr["hasActions"], arr)

    # ===== privacy + no uncaught errors =====
    everything = pg.evaluate("()=>document.body.textContent + '\\n' + (document.getElementById('drawer')||{}).textContent")
    # every '@host' token that appears must resolve to a synthetic placeholder host
    hosts = [re.split(r'[\s<">,]', seg, 1)[0] for seg in re.split(r'@', everything)[1:] if seg.strip()]
    bad = [h for h in hosts if h and not h.startswith("example.test") and not h.startswith("thrive.test")]
    ck("PRIVACY: every address shown is a synthetic example.test / thrive.test placeholder", not bad, bad)
    ck("no uncaught page error fired during any write", not perr, perr)

    ctx.close(); b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL BOARD-WRITE CHECKS PASS"))
raise SystemExit(1 if fails else 0)
