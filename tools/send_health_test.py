"""SEND HEALTH (PR) - real group send (loop ALL recipients) + a live send-cap counter/gate.

runSend used to email only firstRecipient - a group card silently reached one person. Now runSend loops every
recipient (allRecipients): one throttled relay call + one console_mail row each, settling per recipient so one
failure never aborts the batch, and gated by the daily/monthly cap counted from the console_mail ledger.

Mocked Supabase + relay harness. Synthetic *.example.test only. Assertions:
  (a) a card with 3 recipients sends 3 messages / writes 3 console_mail rows (not 1);
  (b) one failing recipient does not abort the other two - the result reports 2 sent / 1 failed, 2 rows written;
  (c) the relay calls are SPACED (throttle), not simultaneous;
  (d) the header counter reflects today / month sent counts from console_mail;
  (e) a send that would exceed the daily cap sends only what fits and reports the rest blocked, never silently.
"""
import os, re, json, time, threading, http.server, socketserver, functools
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:600])

UID = "u"; DISPLAY_NAME = "Alice Op"
NOWISO = "2026-08-29T12:00:00Z"   # inside today/this month for the ledger counts

def mk(slug, biz, recs):
    return {"slug":slug, "business":biz, "stage":"live", "archived":False,
            "data":{"outreach_subject":"Hello", "outreach_text":"Hi there, see [LINK]",
                    "recipients":[{"addr":a, "name":"", "lang":"en"} for a in recs]}}
OPPS = {
  "trio":  mk("trio",  "Trio Co",  ["a1@grp.example.test","a2@grp.example.test","a3@grp.example.test"]),
  "mixed": mk("mixed", "Mixed Co", ["m1@grp.example.test","bad@grp.example.test","m3@grp.example.test"]),
  "capme": mk("capme", "Cap Co",   ["c1@grp.example.test","c2@grp.example.test","c3@grp.example.test"]),
}
# console_mail ledger: pre-seed rows so the cap tests have a known baseline. Each is a synthetic "sent" row today.
MAIL = []
RELAY_SEND = []; RELAY_TIMES = []
REJECT_ADDR = "bad@grp.example.test"   # this recipient's relay call returns {ok:false}

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
def route_opps(r):
    req=r.request; url=req.url; slug=slug_of(url)
    if req.method=="PATCH":
        try: body=json.loads(req.post_data or "{}")
        except Exception: body={}
        o=OPPS.get(slug)
        if o is not None and isinstance(body.get("data"),dict): o["data"]=body["data"]
        return r.fulfill(status=204, body="")
    o=OPPS.get(slug,{"slug":slug,"data":{}})
    return J(r, [{"slug":o["slug"],"data":o.get("data",{})}])
def route_mail(r):
    req=r.request
    if req.method=="POST":
        try: rows=json.loads(req.post_data or "[]")
        except Exception: rows=[]
        for row in (rows if isinstance(rows,list) else [rows]):
            if isinstance(row,dict) and row.get("opp"): MAIL.append(row)
        return r.fulfill(status=204, body="")
    # GET: the send-cap counter (status=eq.sent). Return the sent rows (all synthetic rows are "today").
    return J(r, [m for m in MAIL if m.get("status")=="sent"])
def route_relay(r):
    body=r.request.post_data or ""
    try: payload=json.loads(body)
    except Exception: payload={"_raw":body[:120]}
    RELAY_SEND.append(payload); RELAY_TIMES.append(time.time())
    if payload.get("to")==REJECT_ADDR:
        return J(r, {"ok":False, "error":"synthetic reject", "relay_version":9})
    return J(r, {"ok":True, "id":"resend_"+str(len(RELAY_SEND)), "relay_version":9, "delivered":True})

def wire(ctx, lang=None):
    init="try{localStorage.setItem('console_sb_session', JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'op@thrive.test',uid:'"+UID+"'}));"
    if lang: init+="localStorage.setItem('thrive_lang','"+lang+"');"
    init+="}catch(e){}"
    ctx.add_init_script(init)
    ctx.route(re.compile(r"script\.google\.com/.*"), route_relay)
    ctx.route("**/rest/v1/console_board**", route_board)
    ctx.route("**/rest/v1/console_inbound**", route_empty)
    ctx.route("**/rest/v1/console_hits**", route_empty)
    ctx.route("**/rest/v1/console_mail**", route_mail)
    ctx.route("**/rest/v1/console_pages**", route_empty)
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
    pg.evaluate("(s)=>{var c=document.querySelector('.card[data-slug=\"'+s+'\"]'); if(c) c.click();}", slug)
    # wait for the ENRICHED drawer paint (fetchDetail done): the editor is prefilled and the recipient field is
    # populated, so a Send click is not raced by the enrichment re-render that replaces #actStatus.
    pg.wait_for_function("""()=>{ var b=document.querySelector('#drawer .act[data-act="send"]');
        var s=document.getElementById('edSubj'), r=document.getElementById('recIn');
        return !!b && !b.disabled && s && s.value.trim() && r && r.value.indexOf('@')>=0; }""", timeout=8000)
    pg.wait_for_timeout(200)
def click_send(pg):
    pg.evaluate("()=>{var b=document.querySelector('#drawer .act[data-act=\"send\"]'); if(b) b.click();}")
def act_status(pg):
    return pg.evaluate("()=>{var e=document.getElementById('actStatus'); return e?{txt:e.textContent,cls:e.className}:{};}")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # ===== (a)+(c) group of 3: 3 relay calls, 3 console_mail rows, spaced =====
    ctx = b.new_context(); wire(ctx); pg = ctx.new_page(); perr=[]
    pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(500); wait_ident(pg)
    pg.wait_for_function("()=>!!document.querySelector('.card[data-slug=\"trio\"]')", timeout=8000)
    open_card(pg, "trio")
    RELAY_SEND.clear(); RELAY_TIMES.clear()
    click_send(pg)
    pg.wait_for_function("()=>{var e=document.getElementById('actStatus'); return e && /ok|bad/.test(e.className);}", timeout=15000)
    trio_relay = [x for x in RELAY_SEND if x.get("slug")=="trio"]
    ck("(a) a 3-recipient card made 3 relay calls (one per recipient), not 1", len(trio_relay)==3, [x.get("to") for x in trio_relay])
    ck("(a) 3 console_mail rows were written for the group (not 1)", sent_count("trio")==3, sent_count("trio"))
    ck("(a) each recipient got its own message (3 distinct To addresses)",
       sorted(x.get("to") for x in trio_relay)==["a1@grp.example.test","a2@grp.example.test","a3@grp.example.test"], [x.get("to") for x in trio_relay])
    ck("(a) each console_mail row has a distinct id (per-recipient token)", len(set(m.get("id") for m in MAIL if m.get("opp")=="trio"))==3)
    # (c) throttle: consecutive relay calls are spaced (SEND_GAP_MS ~1100ms), never simultaneous
    gaps = [RELAY_TIMES[i+1]-RELAY_TIMES[i] for i in range(len(RELAY_TIMES)-1)]
    ck("(c) the relay calls are SPACED by a throttle, not fired simultaneously", len(gaps)>=2 and min(gaps)>=0.8, gaps)
    ck("no uncaught page error (group send)", not perr, perr)
    pg.close(); ctx.close()

    # ===== (b) one failing recipient does not abort the other two =====
    MAIL.clear(); RELAY_SEND.clear(); RELAY_TIMES.clear()
    ctx2 = b.new_context(); wire(ctx2); pg2 = ctx2.new_page(); perr2=[]
    pg2.on("pageerror", lambda e: perr2.append(str(e)))
    pg2.goto(f"{base}/library/board.html", wait_until="load"); pg2.wait_for_timeout(500); wait_ident(pg2)
    pg2.wait_for_function("()=>!!document.querySelector('.card[data-slug=\"mixed\"]')", timeout=8000)
    open_card(pg2, "mixed")
    click_send(pg2)
    pg2.wait_for_function("()=>{var e=document.getElementById('actStatus'); return e && /ok|bad|[0-9]/.test(e.textContent);}", timeout=15000)
    pg2.wait_for_timeout(500)
    ck("(b) the two good recipients still sent (2 console_mail rows), the bad one did not abort them", sent_count("mixed")==2, sent_count("mixed"))
    st = act_status(pg2)
    ck("(b) the result reports 2 sent of 3 and 1 failed (never a silent partial)",
       ("2" in st.get("txt","")) and ("3" in st.get("txt","")) and ("1" in st.get("txt","")) and ("bad@grp.example.test" in st.get("txt","")), st)
    ck("(b) the failed recipient wrote NO console_mail row", not any(m.get("to_addr")==REJECT_ADDR for m in MAIL), MAIL)
    ck("no uncaught page error (partial send)", not perr2, perr2)
    pg2.close(); ctx2.close()

    # ===== (d) the header counter reflects today / month sent counts =====
    MAIL.clear(); RELAY_SEND.clear()
    ctx3 = b.new_context(); wire(ctx3, lang="ar"); pg3 = ctx3.new_page()
    pg3.goto(f"{base}/library/board.html", wait_until="load"); pg3.wait_for_timeout(500); wait_ident(pg3)
    pg3.wait_for_function("()=>{var e=document.getElementById('sendCap'); return e && e.textContent.indexOf('/ 100')>=0;}", timeout=8000)
    cap0 = pg3.text_content("#sendCap") or ""
    ck("(d) the counter shows the daily and monthly caps", ("/ 100" in cap0) and ("/ 1000" in cap0) and ("اليوم" in cap0) and ("الشهر" in cap0), cap0)
    ck("(d) the counter starts at 0 sent today", cap0.strip().startswith("0 / 100"), cap0)
    open_card(pg3, "trio")
    click_send(pg3)
    pg3.wait_for_function("()=>{var e=document.getElementById('sendCap'); return e && e.textContent.trim().indexOf('3 / 100')==0;}", timeout=15000)
    ck("(d) after a group send of 3, the counter reads 3 / 100 today", (pg3.text_content("#sendCap") or "").strip().startswith("3 / 100"), pg3.text_content("#sendCap"))
    pg3.close(); ctx3.close()

    # ===== (e) exceeding the daily cap: send only what fits, report the rest blocked =====
    MAIL.clear(); RELAY_SEND.clear()
    for i in range(99):   # 99 already sent today -> only 1 of the daily 100 remains
        MAIL.append({"id":"seed"+str(i),"opp":"seed","status":"sent","to_addr":"seed"+str(i)+"@x.example.test","ts":NOWISO,"data":{"direction":"out"}})
    ctx4 = b.new_context(); wire(ctx4); pg4 = ctx4.new_page(); perr4=[]
    pg4.on("pageerror", lambda e: perr4.append(str(e)))
    pg4.goto(f"{base}/library/board.html", wait_until="load"); pg4.wait_for_timeout(500); wait_ident(pg4)
    pg4.wait_for_function("()=>!!document.querySelector('.card[data-slug=\"capme\"]')", timeout=8000)
    open_card(pg4, "capme")
    click_send(pg4)
    try:
        pg4.wait_for_function("()=>{var e=document.getElementById('actStatus'); return e && /ok|bad|[0-9]/.test(e.textContent) && e.textContent.length>3;}", timeout=15000)
    except Exception:
        pass   # let the ck assertions below report the exact state cleanly rather than crashing
    pg4.wait_for_timeout(800)
    capme_sent = sent_count("capme")
    ck("(e) with only 1 of the daily cap left, a group of 3 sent exactly 1 (only what fits)", capme_sent==1, capme_sent)
    st4 = act_status(pg4)
    ck("(e) the result reports the remaining 2 as blocked by the cap (never silently dropped)",
       ("2" in st4.get("txt","")), st4)
    ck("(e) exactly 1 relay call was made (the cap stopped the other 2 before sending)",
       len([x for x in RELAY_SEND if x.get("slug")=="capme"])==1, [x.get("to") for x in RELAY_SEND if x.get("slug")=="capme"])
    ck("no uncaught page error (cap send)", not perr4, perr4)
    pg4.close(); ctx4.close()
    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL SEND-HEALTH CHECKS PASS"))
raise SystemExit(1 if fails else 0)
