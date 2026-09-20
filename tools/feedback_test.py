"""FEEDBACK (PR) - close the three send-blindness gaps + unify result-tied feedback.

The console already settles green-after-confirm; this closes the real blind spots: (1) a standalone New-message
send used to show its result nowhere (overlay closed first); (2) a partial group send rendered neutral grey;
(3) a campaign upload hid which files failed. Feedback stays result-tied: green on full success, amber on a
partial (any failed/capped), red on failure - never a cosmetic toast.

Mocked Supabase + relay harness. Synthetic *.example.test only. Assertions:
  (a) a standalone New-message send shows its "Sent K of N" result visibly (the overlay stays open, not swallowed);
  (b) a PARTIAL group result renders the amber WARNING class, not neutral grey;
  (c) a campaign upload with a failing file NAMES it (result-tied), overlay stays open;
  (d) a FULL success still renders green.
"""
import os, re, json, io, zipfile, threading, http.server, socketserver, functools
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
SCRATCH = "/tmp/claude-0/-home-user-thrive-console/c3d00e60-6b80-5853-a1c6-18cd12c9bc26/scratchpad"
try: os.makedirs(SCRATCH, exist_ok=True)
except Exception: SCRATCH = "/tmp"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:600])

UID = "u"; DISPLAY_NAME = "Alice Op"; NOWISO = "2026-08-29T12:00:00Z"
REJECT_ADDR = "bad@grp.example.test"

def mk(slug, biz, recs):
    return {"slug":slug, "business":biz, "stage":"live", "archived":False,
            "data":{"outreach_subject":"Hello", "outreach_text":"Hi, see [LINK]",
                    "recipients":[{"addr":a,"name":"","lang":"en"} for a in recs]}}
OPPS = {
  "trio":  mk("trio", "Trio Co", ["g1@grp.example.test", REJECT_ADDR, "g3@grp.example.test"]),   # partial: one rejects
  "solo":  mk("solo", "Solo Co", ["ok@grp.example.test"]),                                        # full success
}
MAIL = []; RELAY_SEND = []
UP_FAIL_SLUG = "fail-co"   # console_opps POST for this slug returns 500 -> a failed upload file

# a campaign zip: two pages + one consolidated message file (whole-file-per-page style)
def build_zip():
    buf = io.BytesIO(); z = zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED)
    z.writestr("good-co/index.html", "<!doctype html><title>Good</title><h1>Good Co</h1>")
    z.writestr("good-co/good-co.md", "Subject: Hello Good\n\n```json\n{\"to\":\"buyer.good@example.test\"}\n```\n\nHi, see {{LINK}}\n")
    z.writestr("fail-co/index.html", "<!doctype html><title>Fail</title><h1>Fail Co</h1>")
    z.writestr("fail-co/fail-co.md", "Subject: Hello Fail\n\n```json\n{\"to\":\"buyer.fail@example.test\"}\n```\n\nHi, see {{LINK}}\n")
    path = os.path.join(SCRATCH, "fb_campaign.zip")
    z.close()
    with open(path, "wb") as f: f.write(buf.getvalue())
    return path
CAMPAIGN_ZIP = build_zip()

def slug_of(url):
    m = re.search(r'slug=eq\.([^&]+)', url); return m.group(1) if m else ""
def sent_count(slug): return sum(1 for m in MAIL if m.get("opp")==slug)
def board_rows():
    out=[]
    for slug,o in OPPS.items():
        d=o.get("data") or {}
        he=bool(str(d.get("outreach_text","")).strip() or str(d.get("outreach_subject","")).strip())
        sc=sent_count(slug)
        out.append({"slug":slug,"business":o.get("business"),"stage":("sent" if sc>0 else "live"),"sent_count":sc,
                    "open_count":0,"replied":False,"idle_days":0,"last_activity_ts":NOWISO,
                    "has_page":False,"has_email":he,"archived":False})
    return out

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
def route_empty(r): J(r, [])
def route_board(r): J(r, board_rows())
def route_pnames(r): J(r, [{"uid":UID,"display_name":DISPLAY_NAME,"email":"op@thrive.test"}])
def route_profiles(r): J(r, [{"uid":UID,"display_name":DISPLAY_NAME,"prefs":{},"signature_title":"T"}])
def route_members(r): J(r, [{"id":UID,"role":"member"}])
def route_mail(r):
    req=r.request
    if req.method=="POST":
        try: rows=json.loads(req.post_data or "[]")
        except Exception: rows=[]
        for row in (rows if isinstance(rows,list) else [rows]):
            if isinstance(row,dict) and row.get("opp"): MAIL.append(row)
        return r.fulfill(status=204, body="")
    return J(r, [m for m in MAIL if m.get("status")=="sent"])
def route_opps(r):
    req=r.request; url=req.url; slug=slug_of(url)
    if req.method=="POST":
        try: rows=json.loads(req.post_data or "[]")
        except Exception: rows=[]
        for row in (rows if isinstance(rows,list) else [rows]):
            if isinstance(row,dict) and row.get("slug"):
                if row["slug"]==UP_FAIL_SLUG: return r.fulfill(status=500, headers={"content-type":"application/json"}, body=json.dumps({"message":"synthetic opp write failure"}))
                OPPS[row["slug"]]=row
        return r.fulfill(status=204, body="")
    if req.method=="PATCH":
        try: body=json.loads(req.post_data or "{}")
        except Exception: body={}
        o=OPPS.get(slug)
        if o is not None and isinstance(body.get("data"),dict): o["data"]=body["data"]
        return r.fulfill(status=204, body="")
    o=OPPS.get(slug,{"slug":slug,"data":{}})
    return J(r, [{"slug":o["slug"],"data":o.get("data",{})}])
def route_pages(r):
    if r.request.method in ("POST","PATCH"): return r.fulfill(status=204, body="")
    return J(r, [])
def route_relay(r):
    body=r.request.post_data or ""
    try: payload=json.loads(body)
    except Exception: payload={"_raw":body[:120]}
    RELAY_SEND.append(payload)
    if payload.get("to")==REJECT_ADDR: return J(r, {"ok":False,"error":"synthetic reject","relay_version":9})
    return J(r, {"ok":True,"id":"resend_"+str(len(RELAY_SEND)),"relay_version":9,"delivered":True})

def wire(ctx, lang=None):
    init="try{localStorage.setItem('console_sb_session', JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'op@thrive.test',uid:'"+UID+"'}));"
    if lang: init+="localStorage.setItem('thrive_lang','"+lang+"');"
    init+="}catch(e){}"
    ctx.add_init_script(init)
    ctx.route(re.compile(r"script\.google\.com/.*"), route_relay)
    ctx.route("**/rest/v1/console_board**", route_board)
    ctx.route("**/rest/v1/console_inbound**", route_empty)
    ctx.route("**/rest/v1/console_hits**", route_empty)
    # B2 fail-closed: the send path reads console_suppressions and blocks if it never loads; serve an
    # empty do-not-contact list (200, nobody suppressed) so sends proceed, as real Supabase (B1) does.
    ctx.route("**/rest/v1/console_suppressions**", route_empty)
    ctx.route("**/rest/v1/console_mail**", route_mail)
    ctx.route("**/rest/v1/console_pages**", route_pages)
    ctx.route("**/rest/v1/console_profile_names**", route_pnames)
    ctx.route("**/rest/v1/console_team_roster**", route_empty)
    ctx.route("**/rest/v1/console_profiles**", route_profiles)
    ctx.route("**/rest/v1/console_members**", route_members)
    ctx.route("**/rest/v1/console_admins**", route_empty)
    ctx.route("**/rest/v1/console_opps**", route_opps)

def wait_ident(pg, tries=40):
    for _ in range(tries):
        if pg.evaluate("()=>!!(window.__thriveIdentity && window.__thriveIdentity.loaded)"): return True
        pg.wait_for_timeout(150)
    return False
def open_card(pg, slug):
    pg.evaluate("(s)=>{var c=document.querySelector('.card[data-slug=\"'+s+'\"]'); if(c){ window.openOppWindow(s); window.owSelectMode('a'); }}", slug)
    pg.wait_for_selector("#owModeA #edSubj", timeout=8000)
    # the Send button enables once the async prefill lands (subject+body+recipient); poll for the ready state
    for _ in range(40):
        if pg.evaluate("""()=>{ var b=document.querySelector('#owModeA #nmSend'); var s=document.getElementById('edSubj'), r=document.getElementById('recIn'); return !!b && !b.disabled && s && s.value.trim() && r && r.value.indexOf('@')>=0; }"""): break
        pg.wait_for_timeout(150)
    pg.wait_for_timeout(200)
def click_send_drawer(pg):
    pg.evaluate("()=>{var b=document.querySelector('#owModeA #nmSend'); if(b) b.click();}")
def act_status(pg):
    return pg.evaluate("()=>{var e=document.getElementById('nmStatus'); return e?{txt:e.textContent,cls:e.className,live:e.getAttribute('aria-live')}:{};}")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # ===== (b)+(d) drawer sends: partial => amber warning, full => green =====
    ctx = b.new_context(); wire(ctx); pg = ctx.new_page(); perr=[]
    pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(500); wait_ident(pg)
    pg.wait_for_function("()=>!!document.querySelector('.card[data-slug=\"trio\"]')", timeout=8000)

    open_card(pg, "trio")   # 3 recipients, one rejects -> partial
    click_send_drawer(pg)
    try:
        pg.wait_for_function("()=>{var e=document.getElementById('nmStatus'); return e && /ok|bad|warn/.test(e.className) && e.textContent.trim().length>0;}", timeout=15000)
    except Exception:
        pg.wait_for_timeout(1000)   # let the ck assertions report the exact class cleanly rather than crashing
    stp = act_status(pg)
    ck("(b) a PARTIAL group send renders the amber WARNING class (not neutral, not green)",
       ("warn" in stp.get("cls","")) and ("ok" not in stp.get("cls","")), stp)
    ck("(b) the partial result names the counts and the failed recipient",
       ("2" in stp.get("txt","")) and ("3" in stp.get("txt","")) and (REJECT_ADDR in stp.get("txt","")), stp)
    ck("(status) the shared status region carries aria-live for accessibility", stp.get("live")=="polite", stp)

    open_card(pg, "solo")   # single good recipient -> full success
    click_send_drawer(pg)
    pg.wait_for_function("()=>{var e=document.getElementById('nmStatus'); return e && /ok|bad|warn/.test(e.className);}", timeout=15000)
    sts = act_status(pg)
    ck("(d) a FULL success renders GREEN (ok), never warn/bad", ("ok" in sts.get("cls","")) and ("warn" not in sts.get("cls","")) and ("bad" not in sts.get("cls","")), sts)
    ck("no uncaught page error (drawer sends)", not perr, perr)
    pg.close(); ctx.close()

    # ===== (a) standalone New-message send shows its result visibly (overlay stays open) =====
    MAIL.clear(); RELAY_SEND.clear()
    ctx2 = b.new_context(); wire(ctx2); pg2 = ctx2.new_page(); perr2=[]
    pg2.on("pageerror", lambda e: perr2.append(str(e)))
    pg2.goto(f"{base}/library/board.html", wait_until="load"); pg2.wait_for_timeout(500); wait_ident(pg2)
    pg2.evaluate("()=>{var b=document.getElementById('newMsgBtn'); if(b) b.click();}")   # New message opens the window on the THREE-option first screen
    pg2.wait_for_selector("#owPickText", timeout=8000)
    pg2.evaluate("()=>window.owSelectMode('a')")                                          # text message only
    pg2.wait_for_selector("#owModeA #edSubj", timeout=8000)
    pg2.fill("#owModeA #edSubj", "A standalone note")
    pg2.fill("#owModeA #edBody", "Hello there.")
    pg2.fill("#owModeA #recIn", "standalone@buyer.example.test")
    pg2.wait_for_timeout(400)
    pg2.evaluate("()=>{var b=document.querySelector('#owModeA #nmSend'); if(b) b.click();}")
    pg2.wait_for_function("()=>{var e=document.getElementById('nmStatus'); return e && /ok|bad|warn/.test(e.className) && e.textContent.trim().length>0;}", timeout=15000)
    nmst = pg2.evaluate("()=>{var e=document.getElementById('nmStatus'); var sc=document.getElementById('owScrim'); return {txt:e?e.textContent:'', cls:e?e.className:'', open:sc? !sc.hidden : None, live:e?e.getAttribute('aria-live'):None};}")
    ck("(a) the standalone send result is VISIBLE (the window stays open, not swallowed by close)", nmst.get("open")==True, nmst)
    ck("(a) the window shows the real 'Sent' result in GREEN", ("Sent" in nmst.get("txt","")) and ("ok" in nmst.get("cls","")), nmst)
    ck("(a) exactly one relay call was made for the standalone recipient", len(RELAY_SEND)==1 and RELAY_SEND[0].get("to")=="standalone@buyer.example.test", [x.get("to") for x in RELAY_SEND])
    ck("(a) the new-message status region carries aria-live", nmst.get("live")=="polite", nmst)
    ck("no uncaught page error (standalone send)", not perr2, perr2)
    pg2.close(); ctx2.close()

    # ===== (c) campaign upload result feedback: RETIRED as a standalone scenario at G5 =====
    # The separate "Upload campaign" overlay (openUpload / #upScrim) was retired at the flip - campaign upload now
    # lives in the window's Mode B Page tab. Its result-tied feedback (a failing row named, the commit status
    # staying visible) is exercised by opp_window_mode_b_test.py (the Page-tab review + the validation-gate commit
    # status), so it is no longer duplicated here.
    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL FEEDBACK CHECKS PASS"))
raise SystemExit(1 if fails else 0)
