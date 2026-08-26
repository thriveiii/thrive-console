"""STEP 1 · IDENTITY UNIFICATION + PROFILE LINK (board.html, fails-when-broken, ZERO real network).

Step 1 unifies the actor identity board.html stamps and links the board to the EXISTING profile tables.
Stateful mock of Supabase REST + the relay (never a real send). Assertions:
  1. NEW writes carry the uid as actor: a note (console_opps.data.notes[].by) and a mail row
     (console_mail.actor) both stamp session().uid, not the email.
  2. The ONE resolver maps a legacy EMAIL actor and a UID actor to the SAME person (same uid), via the
     cross-readable console_profile_names index.
  3. Profile (display_name, signature, signature_title) and role load from console_profiles / console_members
     via the uid, held in board runtime (window.__thriveIdentity).
  4. A missing profile falls back safely (no name, member role), board still renders (no black screen).
  5. Role is read from the DB layer, not hardcoded: owner from console_members, owner from the console_admins
     fallback, member when neither says owner.
  6. AR RTL; privacy synthetic *.example.test only; no uncaught page error.

No new profile table is created: the mock serves console_profiles / console_members / console_admins /
console_profile_names, the tables that already exist.
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

# ---- synthetic identities (ALL emails *.example.test, uids are opaque non-email strings) ----------
ME  = {"uid":"uid-me-0001",  "email":"me@example.test", "name":"Operator Mena", "title":"Managing Partner", "sig":"-- Operator Mena"}
TM  = {"uid":"uid-tm-0002",  "email":"nour@example.test", "name":"Teammate Nour"}

# swappable per-context identity-table responses (set before each context loads)
STATE = {
  "profile_names": [],   # console_profile_names rows {uid,display_name,email}
  "profile_own":   [],   # console_profiles own row(s)
  "members":       [],   # console_members own row(s) {id,role}
  "admins":        [],   # console_admins own row(s) {uid}
}
OPPS = {
  "mena": {"slug":"mena","business":"Mena Co","has_email":True,"archived":False,
           "data":{"recipients":[{"addr":"buyer.mena@example.test","name":"","lang":""}],
                   "channels":[{"type":"email","value":"buyer.mena@example.test","primary":True}],
                   "outreach_subject":"{}", "outreach_text":"hi {}"}},
}
PATCH_CALLS = []; MAIL_CALLS = []; RELAY_CALLS = []

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
    if r.request.method == "POST":
        try: MAIL_CALLS.append(json.loads(r.request.post_data or "{}"))
        except Exception: MAIL_CALLS.append({"_raw":(r.request.post_data or "")[:120]})
        return r.fulfill(status=204, body="")
    return J(r, [])
def route_relay(r):
    body = r.request.post_data or ""
    try: RELAY_CALLS.append(json.loads(body))
    except Exception: RELAY_CALLS.append({"_raw":body[:120]})
    return J(r, {"ok":True, "id":"resend_x", "relay_version":5})
def route_pnames(r):  J(r, STATE["profile_names"])
def route_profiles(r):J(r, STATE["profile_own"])
def route_members(r): J(r, STATE["members"])
def route_admins(r):  J(r, STATE["admins"])

def wire(ctx, uid, email, lang=None):
    sess = json.dumps({"access_token":"T","refresh_token":"R","expires_at":9999999999,"email":email,"uid":uid})
    init = "try{localStorage.setItem('console_sb_session', '"+sess+"');"
    if lang: init += "localStorage.setItem('thrive_lang','"+lang+"');"
    init += "}catch(e){}"
    ctx.add_init_script(init)
    ctx.route(re.compile(r"script\.google\.com/.*"), route_relay)
    ctx.route("**/rest/v1/console_board**", route_board)
    ctx.route("**/rest/v1/console_inbound**", route_empty)
    ctx.route("**/rest/v1/console_opps**", route_opps)
    ctx.route("**/rest/v1/console_mail**", route_mail)
    ctx.route("**/rest/v1/console_hits**", route_empty)
    ctx.route("**/rest/v1/console_profile_names**", route_pnames)
    ctx.route("**/rest/v1/console_profiles**", route_profiles)
    ctx.route("**/rest/v1/console_members**", route_members)
    ctx.route("**/rest/v1/console_admins**", route_admins)

OPEN = """(biz)=>{ var t=null; document.querySelectorAll('.card').forEach(function(c){ if(c.textContent.indexOf(biz)>=0) t=c; }); if(t){ t.click(); return true; } return false; }"""
IDENT = "()=>window.__thriveIdentity||null"
RESOLVE = "(v)=>window.__thriveResolveActor?window.__thriveResolveActor(v):null"

def wait_ident(pg, tries=40):
    for _ in range(tries):
        v = pg.evaluate(IDENT)
        if v and v.get("loaded"): return v
        pg.wait_for_timeout(150)
    return pg.evaluate(IDENT)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # ===== Context 1: full profile + owner role (console_members) =====
    STATE["profile_names"] = [ {"uid":ME["uid"],"display_name":ME["name"],"email":ME["email"]},
                               {"uid":TM["uid"],"display_name":TM["name"],"email":TM["email"]} ]
    STATE["profile_own"]   = [ {"uid":ME["uid"],"display_name":ME["name"],
                                "prefs":{"sig_en":ME["sig"]}, "signature_title":ME["title"]} ]
    STATE["members"]       = [ {"id":ME["uid"],"role":"owner"} ]
    STATE["admins"]        = []
    ctx = b.new_context(); wire(ctx, ME["uid"], ME["email"]); pg = ctx.new_page(); perr=[]
    pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(500)
    idv = wait_ident(pg)

    # 3. profile + role loaded from the existing tables via uid
    ck("3: identity loaded (window.__thriveIdentity.loaded)", bool(idv and idv.get("loaded")), idv)
    ck("3: uid is the session uid", idv.get("uid")==ME["uid"], idv.get("uid"))
    ck("3: display_name loaded from console_profile_names/console_profiles", idv.get("name")==ME["name"], idv.get("name"))
    ck("3: signature_title loaded from console_profiles", idv.get("title")==ME["title"], idv.get("title"))
    ck("3: signature loaded from console_profiles.prefs (hasSignature)", bool(idv.get("hasSignature")), idv.get("hasSignature"))
    # 5. role read from the DB (console_members owner), not hardcoded
    ck("5: role loaded as owner from console_members (DB, not hardcoded)", idv.get("role")=="owner", idv.get("role"))

    # 2. the ONE resolver maps a legacy email actor AND a uid actor to the SAME person
    r_email = pg.evaluate(RESOLVE, ME["email"])
    r_uid   = pg.evaluate(RESOLVE, ME["uid"])
    ck("2: resolver maps a legacy EMAIL actor to the person's uid", r_email and r_email.get("uid")==ME["uid"], r_email)
    ck("2: resolver maps a UID actor to the same person", r_uid and r_uid.get("uid")==ME["uid"], r_uid)
    ck("2: email actor and uid actor resolve to the SAME person",
       r_email and r_uid and r_email.get("uid")==r_uid.get("uid")==ME["uid"], {"email":r_email,"uid":r_uid})
    ck("2: the resolved person carries the display name", r_email and r_email.get("name")==ME["name"], r_email)

    # 1. a NEW note write stamps the uid as author (not the email)
    pg.evaluate(OPEN, "Mena Co"); pg.wait_for_timeout(500)
    pg.evaluate("""()=>{ var i=document.getElementById('noteIn'); if(i) i.value='Synthetic identity note'; }""")
    pg.evaluate("""()=>{ var b=document.getElementById('noteAdd'); if(b) b.click(); }""")
    pg.wait_for_timeout(900)
    notes = OPPS["mena"]["data"].get("notes", [])
    ck("1: a new note stamps the OPERATOR uid as author (by == session uid)",
       len(notes)>0 and notes[-1].get("by")==ME["uid"], notes[-1] if notes else None)

    # 1. a NEW mail write stamps the uid as actor (send -> console_mail.actor)
    mail_before = len(MAIL_CALLS)
    pg.evaluate("""(act)=>{ var el=document.querySelector('#drawer .act[data-act='+JSON.stringify(act)+']'); if(el) el.click(); }""", "send")
    for _ in range(20):
        if len(MAIL_CALLS) > mail_before: break
        pg.wait_for_timeout(150)
    # confirmMail POSTs an array [row] (PostgREST bulk insert), so flatten list bodies into rows
    new_rows = []
    for m in MAIL_CALLS[mail_before:]:
        new_rows.extend(m if isinstance(m, list) else [m])
    actor_ok = any((isinstance(m, dict) and m.get("actor")==ME["uid"]) for m in new_rows)
    ck("1: a new mail row stamps the OPERATOR uid as actor (console_mail.actor == session uid)",
       actor_ok, new_rows[-1] if new_rows else None)
    ck("1: the mail actor is NOT the email (uid unification)",
       all((not (isinstance(m, dict) and m.get("actor")==ME["email"])) for m in new_rows), new_rows[-1] if new_rows else None)
    pg.close(); ctx.close()

    # ===== Context 2: missing profile -> safe default (no name, member role), board still renders =====
    STATE["profile_names"] = []; STATE["profile_own"] = []; STATE["members"] = []; STATE["admins"] = []
    ctx2 = b.new_context(); wire(ctx2, ME["uid"], ME["email"]); pg2 = ctx2.new_page(); perr2=[]
    pg2.on("pageerror", lambda e: perr2.append(str(e)))
    pg2.goto(f"{base}/library/board.html", wait_until="load"); pg2.wait_for_timeout(500)
    idv2 = wait_ident(pg2)
    ck("4: a missing profile still settles identity (loaded, no hang)", bool(idv2 and idv2.get("loaded")), idv2)
    ck("4: a missing profile falls back to no name", (idv2.get("name") or "")=="", idv2.get("name"))
    ck("4: a missing role falls back to member (safe default)", idv2.get("role")=="member", idv2.get("role"))
    body_len = pg2.evaluate("()=>document.body.innerText.trim().length")
    ck("4: the board still renders (no black screen) with no profile", body_len>0 and len(perr2)==0, {"len":body_len,"perr":perr2})
    pg2.close(); ctx2.close()

    # ===== Context 3: no members row but a console_admins row -> owner via the fallback =====
    STATE["profile_names"] = [ {"uid":ME["uid"],"display_name":ME["name"],"email":ME["email"]} ]
    STATE["profile_own"]   = [ {"uid":ME["uid"],"display_name":ME["name"],"prefs":{}} ]
    STATE["members"]       = []                       # no members row
    STATE["admins"]        = [ {"uid":ME["uid"]} ]    # but an admin allow-list row
    ctx3 = b.new_context(); wire(ctx3, ME["uid"], ME["email"]); pg3 = ctx3.new_page()
    pg3.goto(f"{base}/library/board.html", wait_until="load"); pg3.wait_for_timeout(500)
    idv3 = wait_ident(pg3)
    ck("5: role resolves to owner via the console_admins fallback (app.js parity)", idv3.get("role")=="owner", idv3.get("role"))
    pg3.close(); ctx3.close()

    # ===== Context 4: AR RTL, identity still loads =====
    STATE["profile_names"] = [ {"uid":ME["uid"],"display_name":ME["name"],"email":ME["email"]} ]
    STATE["profile_own"]   = [ {"uid":ME["uid"],"display_name":ME["name"],"prefs":{"sig_ar":ME["sig"]},"signature_title":ME["title"]} ]
    STATE["members"]       = [ {"id":ME["uid"],"role":"member"} ]
    STATE["admins"]        = []
    ctx4 = b.new_context(); wire(ctx4, ME["uid"], ME["email"], lang="ar"); pg4 = ctx4.new_page()
    pg4.goto(f"{base}/library/board.html", wait_until="load"); pg4.wait_for_timeout(500)
    idv4 = wait_ident(pg4)
    d = pg4.evaluate("()=>getComputedStyle(document.documentElement).direction")
    ck("6: AR flips the document to RTL", d=="rtl", d)
    ck("6: identity loads under AR too", bool(idv4 and idv4.get("loaded") and idv4.get("uid")==ME["uid"]), idv4)
    pg4.close(); ctx4.close()

    # ===== privacy + no uncaught error =====
    blob = json.dumps([o["data"] for o in OPPS.values()]) + json.dumps(MAIL_CALLS) + json.dumps(RELAY_CALLS) + json.dumps(PATCH_CALLS)
    hosts = [re.split(r'[\s<">,\\]', seg, 1)[0] for seg in re.split(r'@', blob)[1:] if seg.strip()]
    bad = [h for h in hosts if h and not h.startswith("example.test") and not h.startswith("thrive.test") and not h.startswith("thriveiii.com")]
    ck("PRIVACY: every address stored/sent is a synthetic placeholder", not bad, bad)
    ck("no uncaught page error during identity load / writes", not perr, perr)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL BOARD-IDENTITY CHECKS PASS"))
raise SystemExit(1 if fails else 0)
