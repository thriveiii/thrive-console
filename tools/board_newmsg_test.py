"""E1 NEW MESSAGE (board.html standalone editor overlay, fails-when-broken, ZERO real network send).

A header "New message" button opens the unified editor as its OWN overlay (#nmScrim/#nmPanel, not the card
drawer), to compose and send a message to any recipient, with or without an opp link, with no opp required up
front and no draft lost on accidental close. Stateful mock of Supabase REST + the relay (never a real send).
Assertions:
  1. the header New message button opens a STANDALONE editor overlay (its editor is in #nmPanel, not #drawer);
  2. composing creates a LIGHTWEIGHT opp (a console_opps upsert) and auto-saves subject/body to it;
  3. closing and reopening RESTORES the draft (subject/body/recipient), so nothing is lost on close;
  E0. the optional signature: an empty signature field yields NO sig block in the compiled message;
  4. a message with NO link SENDS (linkless allowed): the payload carries no opp-page link, console_mail is
     written through the unchanged L5 runSend, and the draft becomes a Sent opp on the board;
  5. a forced relay failure reverts with NO phantom console_mail row and the draft opp is not lost;
  6. AR RTL; privacy: every address is a synthetic *.example.test placeholder.
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

UID = "u"; DISPLAY_NAME = "Alice Op"; TITLE = "Growth Lead"

# ---- stateful server model (ALL addresses synthetic *.example.test) ------------------------------
OPPS = {}              # slug -> {"slug","business","data"} ; created by the New Message upsert
MAIL = []              # console_mail rows written (server truth)
RELAY_CALLS = []       # captured relay payloads (never a real send)
UPSERTS = []           # captured console_opps POST bodies (the lightweight-opp create/update)
RELAY_FAULT = {}       # slug (or "*") -> "500"

def sent_count(slug): return sum(1 for m in MAIL if m.get("opp")==slug)

def board_rows():
    rows = []
    for o in OPPS.values():
        d = o.get("data",{}) or {}
        he = bool(str(d.get("outreach_text","")).strip() or str(d.get("outreach_subject","")).strip())
        sc = sent_count(o["slug"])
        stage = "sent" if sc>0 else ("live" if he else "draft")
        rows.append({"slug":o["slug"], "business":o.get("business",""), "stage":stage, "sent_count":sc,
          "open_count":0, "replied":False, "idle_days":0, "last_activity_ts":"2026-01-04T00:00:00Z",
          "has_page":False, "has_email":he, "archived":False})
    return rows

def slug_of(url):
    m = re.search(r'slug=eq\.([^&]+)', url); return m.group(1) if m else ""
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
def route_pnames(r): J(r, [{"uid":UID, "display_name":DISPLAY_NAME, "email":"op@thrive.test"}])
def route_profiles(r): J(r, [{"uid":UID, "display_name":DISPLAY_NAME, "prefs":{}, "signature_title":TITLE}])
def route_members(r): J(r, [{"id":UID, "role":"member"}])
def route_opps(r):
    req = r.request; url = req.url
    if req.method == "POST":                                  # the New Message create-or-update upsert
        try: rows = json.loads(req.post_data or "[]")
        except Exception: rows = []
        for row in (rows if isinstance(rows, list) else [rows]):
            if not (isinstance(row, dict) and row.get("slug")): continue
            UPSERTS.append(row)
            s = row["slug"]; cur = OPPS.get(s, {"slug":s, "business":"", "data":{}})
            if "business" in row: cur["business"] = row["business"]
            if isinstance(row.get("data"), dict): cur["data"] = row["data"]
            OPPS[s] = cur
        return r.fulfill(status=204, body="")
    if req.method == "PATCH":
        slug = slug_of(url)
        try: body = json.loads(req.post_data or "{}")
        except Exception: body = {}
        o = OPPS.get(slug)
        if o is not None and isinstance(body.get("data"), dict): o["data"] = body["data"]
        return r.fulfill(status=204, body="")
    slug = slug_of(url); o = OPPS.get(slug, {"slug":slug, "data":{}})
    return J(r, [{"slug":o["slug"], "data":o.get("data",{})}])
def route_mail(r):
    req = r.request
    if req.method == "POST":
        try: rows = json.loads(req.post_data or "[]")
        except Exception: rows = []
        for row in (rows if isinstance(rows, list) else [rows]):
            if isinstance(row, dict) and row.get("opp"): MAIL.append(row)
        return r.fulfill(status=204, body="")
    return J(r, [])
def route_relay(r):
    body = r.request.post_data or ""
    slug = slug_of_payload(body)
    f = RELAY_FAULT.get(slug) or RELAY_FAULT.get("*")
    if f == "500": return J(r, {"message":"relay boom"}, status=500)
    try: RELAY_CALLS.append(json.loads(body))
    except Exception: RELAY_CALLS.append({"_raw":body[:200]})
    return J(r, {"ok":True, "id":"resend_"+slug, "relay_version":5, "delivered":True})

def wire(ctx, lang=None):
    init="try{localStorage.setItem('console_sb_session', JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'op@thrive.test',uid:'"+UID+"'}));"
    if lang: init += "localStorage.setItem('thrive_lang','"+lang+"');"
    init += "}catch(e){}"
    ctx.add_init_script(init)
    ctx.route(re.compile(r"script\.google\.com/.*"), route_relay)
    ctx.route("**/rest/v1/console_board**", route_board)
    ctx.route("**/rest/v1/console_inbound**", route_empty)
    ctx.route("**/rest/v1/console_hits**", route_empty)
    ctx.route("**/rest/v1/console_mail**", route_mail)
    ctx.route("**/rest/v1/console_profile_names**", route_pnames)
    ctx.route("**/rest/v1/console_team_roster**", route_empty)
    ctx.route("**/rest/v1/console_profiles**", route_profiles)
    ctx.route("**/rest/v1/console_members**", route_members)
    ctx.route("**/rest/v1/console_admins**", route_empty)
    ctx.route("**/rest/v1/console_opps**", route_opps)

VAL = "(id)=>{ var e=document.getElementById(id); return e? String(e.value||'') : null; }"
NM_HIDDEN = "()=>{ var s=document.getElementById('nmScrim'); return s? !!s.hidden : null; }"
NM_SEND_DISABLED = "()=>{ var b=document.getElementById('nmSend'); return b? !!b.disabled : null; }"
def wait_ident(pg, tries=40):
    for _ in range(tries):
        if pg.evaluate("()=>!!(window.__thriveIdentity && window.__thriveIdentity.loaded)"): return True
        pg.wait_for_timeout(150)
    return False
def open_nm(pg):
    pg.evaluate("()=>{ var b=document.getElementById('newMsgBtn'); if(b) b.click(); }"); pg.wait_for_timeout(500)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(); wire(ctx); pg = ctx.new_page(); perr=[]
    pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(500); wait_ident(pg)

    # ===== 1: the header button opens a STANDALONE overlay (not the card drawer) =====
    ck("1: the header carries a New message button", pg.evaluate("()=>!!document.getElementById('newMsgBtn')"))
    open_nm(pg)
    ck("1: New message opens the overlay (#nmScrim visible)", pg.evaluate(NM_HIDDEN)==False)
    ck("1: the editor renders INSIDE the standalone overlay (#nmPanel), not the card drawer (#drawer)",
       pg.evaluate("()=>!!document.querySelector('#nmPanel #edSubj') && !document.querySelector('#drawer #edSubj')"))
    ck("1: the card drawer is NOT open (this is its own process)", pg.evaluate("()=>{var s=document.getElementById('scrim'); return s? !!s.hidden : true;}"))
    ck("1: __thriveNewMessageOpen reports open", pg.evaluate("()=>window.__thriveNewMessageOpen()")==True)

    # ===== 2: composing creates a lightweight opp and auto-saves subject/body to it =====
    pg.fill("#edSubj", "Hello there")
    pg.fill("#edBody", "First line.\n\nSecond line.")
    pg.wait_for_timeout(1300)      # debounce (700) + upsert
    nmslug = pg.evaluate("()=>window.__thriveNewMessageSlug()")
    ck("2: a standalone draft slug was minted", bool(nmslug) and nmslug.startswith("msg-"), nmslug)
    ups = [u for u in UPSERTS if u.get("slug")==nmslug]
    ck("2: composing created a lightweight console_opps row (upsert)", len(ups)>=1, {"upserts":len(ups)})
    last = OPPS.get(nmslug, {}).get("data", {})
    ck("2: subject + body auto-saved to the lightweight opp",
       last.get("outreach_subject")=="Hello there" and "First line." in str(last.get("outreach_text","")), last)
    ck("2: a green Saved status shows", "ok" in (pg.evaluate("()=>{var e=document.getElementById('nmStatus'); return e?e.className:'';}") or ""))

    # ===== E0: an EMPTY signature yields NO sig block (optional) =====
    art = pg.evaluate("async()=>{ return await window.__thriveComposeArtifact(window.__thriveNewMessageSlug()); }")
    htm0 = art.get("html","")
    ck("E0: an empty signature field yields NO sig block (no #595959 / #888888 sig div)",
       "#595959" not in htm0 and "#888888" not in htm0, htm0[:200])
    ck("E0: the body renders verbatim (no auto-signature fused in)",
       "First line." in htm0 and "Growth Lead" not in htm0, htm0[:200])

    # ===== 3: close + reopen restores the draft (add a recipient first) =====
    pg.fill("#nmRecip", "buyer.new@example.test")
    pg.wait_for_timeout(1200)
    pg.evaluate("()=>{var e=new KeyboardEvent('keydown',{key:'Escape'});document.dispatchEvent(e);}"); pg.wait_for_timeout(200)
    ck("3: Escape closes the overlay", pg.evaluate(NM_HIDDEN)==True and pg.evaluate("()=>window.__thriveNewMessageOpen()")==False)
    open_nm(pg)
    ck("3: reopening restores the same draft slug", pg.evaluate("()=>window.__thriveNewMessageSlug()")==nmslug)
    ck("3: the subject is restored", pg.evaluate(VAL, "edSubj")=="Hello there")
    ck("3: the body is restored (nothing lost on close)", "First line." in (pg.evaluate(VAL, "edBody") or ""))
    ck("3: the recipient is restored", "buyer.new@example.test" in (pg.evaluate(VAL, "nmRecip") or ""))

    # ===== 4: a LINKLESS message sends through the unchanged L5 path and becomes a Sent opp =====
    body_now = pg.evaluate(VAL, "edBody") or ""
    ck("4: the composed body has NO opp link token (linkless)", "{{LINK}}" not in body_now and "/opp/" not in body_now, body_now[:120])
    ck("4: Send is enabled with subject + body + recipient (no link required)", pg.evaluate(NM_SEND_DISABLED)==False, pg.evaluate(NM_SEND_DISABLED))
    pg.evaluate("()=>{ var b=document.getElementById('nmSend'); if(b) b.click(); }"); pg.wait_for_timeout(1400)
    ck("4: the overlay closed after handing off to the send", pg.evaluate(NM_HIDDEN)==True)
    pay = [c for c in RELAY_CALLS if c.get("slug")==nmslug]
    ck("4: the relay was called for the standalone slug", len(pay)==1, {"calls":len(pay)})
    p0 = pay[0] if pay else {}
    ck("4: the payload carries the recipient", p0.get("to")=="buyer.new@example.test", p0.get("to"))
    ck("4: LINKLESS: the payload text carries no opp-page link", "/opp/"+nmslug not in p0.get("text",""), p0.get("text","")[-160:])
    ck("4: exactly one console_mail row was written for the standalone opp (through L5 runSend)", sent_count(nmslug)==1, MAIL)
    ck("4: the draft became a Sent opp on the board (server truth)", "sent" == [rw for rw in board_rows() if rw["slug"]==nmslug][0]["stage"])
    ck("4: the draft pointer was cleared on send", pg.evaluate("()=>{try{return localStorage.getItem('thrive_nm_draft');}catch(e){return 'ERR';}}") in (None, "null", None))

    # ===== 5: forced relay failure -> revert, NO phantom console_mail, the draft opp is not lost =====
    RELAY_FAULT["*"] = "500"
    open_nm(pg)
    failslug = pg.evaluate("()=>window.__thriveNewMessageSlug()")
    ck("5: a fresh draft opens after the previous send (pointer was cleared)", failslug and failslug!=nmslug, {"fail":failslug, "prev":nmslug})
    pg.fill("#edSubj", "Second note")
    pg.fill("#edBody", "Body of the second note.")
    pg.fill("#nmRecip", "buyer.two@example.test")
    pg.wait_for_timeout(1200)
    pg.evaluate("()=>{ var b=document.getElementById('nmSend'); if(b) b.click(); }"); pg.wait_for_timeout(1400)
    ck("5: a forced relay failure writes NO console_mail row (no phantom Sent)", sent_count(failslug)==0, MAIL)
    ck("5: the draft opp is NOT lost (still a console_opps row, not sent)",
       failslug in OPPS and sent_count(failslug)==0, {"in_opps":failslug in OPPS})
    RELAY_FAULT.clear()
    pg.close(); ctx.close()

    # ===== 6: AR RTL =====
    ctx2 = b.new_context(); wire(ctx2, lang="ar"); pg2 = ctx2.new_page()
    pg2.goto(f"{base}/library/board.html", wait_until="load"); pg2.wait_for_timeout(500); wait_ident(pg2)
    open_nm(pg2)
    d = pg2.evaluate("()=>{ var pn=document.getElementById('nmPanel'); return { dir:getComputedStyle(pn).direction, hasEd:!!document.getElementById('edSubj'), open:!document.getElementById('nmScrim').hidden }; }")
    ck("6: AR flips the overlay to RTL", d["dir"]=="rtl", d)
    ck("6: the editor renders in the overlay under AR", d["hasEd"] and d["open"], d)
    pg2.close(); ctx2.close()

    # ===== privacy + no error =====
    blob = json.dumps(RELAY_CALLS) + json.dumps(UPSERTS) + json.dumps(MAIL)
    hosts = [re.split(r'[\s<">,\\]', seg, 1)[0] for seg in re.split(r'@', blob)[1:] if seg.strip()]
    bad = [h for h in hosts if h and not h.startswith("example.test") and not h.startswith("thrive.test") and not h.startswith("thriveiii.com")]
    ck("PRIVACY: every address is a synthetic placeholder", not bad, bad)
    ck("no uncaught page error", not perr, perr)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL BOARD-NEWMSG CHECKS PASS"))
raise SystemExit(1 if fails else 0)
