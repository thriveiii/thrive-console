"""STEP 2A · RESOLVE UID TO DISPLAY NAME IN THE NOTE META (board.html, display-only, ZERO real network).

Step 1 writes a note's author as a uid (by:currentUid()). Step 2A resolves that uid to a display name at the
one render point (noteItemHtml) via resolveActor over the console_profile_names index that loadIdentity
already loads. Display only: no write, no settings UI, no role/title shown.

Stateful mock of Supabase REST (never a real network call). Assertions:
  1. a note whose by is a uid present in the profile index renders the display_name, not the uid;
  2. a uid absent from the index falls back to the raw uid (never blank);
  3. a legacy email actor resolves to the name if the email is in the index, else shows the email as-is;
  4. the meta UPDATES after the index settles: opened before console_profile_names resolves, the note first
     shows the raw uid, then re-renders to the display name once the index lands (no reload);
  5. AR RTL; privacy synthetic *.example.test only; no uncaught page error.
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

# ---- synthetic identities (uids opaque, emails *.example.test) -----------------------------------
ME   = {"uid":"uid-me-0001",   "email":"me@example.test",    "name":"Operator Mena"}
NOUR = {"uid":"uid-nour-0002", "email":"nour@example.test",  "name":"Teammate Nour"}
GHOST_UID   = "uid-ghost-9999"            # a uid NOT in the index -> falls back to raw uid
LEGACY_MAIL = "legacy.op@example.test"    # a legacy email actor NOT in the index -> shows the email as-is

# one opp with three server notes, authored by: a known uid, an unknown uid, a legacy email
OPPS = {
  "alpha": {"slug":"alpha","business":"Alpha Co","has_email":True,"archived":False,
            "data":{"notes":[
                {"ts":"2026-01-02T00:00:00Z","text":"Known author note",  "by":ME["uid"]},
                {"ts":"2026-01-03T00:00:00Z","text":"Unknown author note","by":GHOST_UID},
                {"ts":"2026-01-04T00:00:00Z","text":"Legacy author note", "by":LEGACY_MAIL}
            ]}},
}
PROFILE_NAMES = [ {"uid":ME["uid"],"display_name":ME["name"],"email":ME["email"]},
                  {"uid":NOUR["uid"],"display_name":NOUR["name"],"email":NOUR["email"]} ]
PN_DELAY = {"secs": 0.0}   # console_profile_names response delay (raised for the settle test)

def board_rows():
    return [{"slug":o["slug"], "business":o["business"], "stage":"live", "sent_count":0, "open_count":0,
             "replied":False, "idle_days":0, "last_activity_ts":"2026-01-04T00:00:00Z",
             "has_page":False, "has_email":bool(o.get("has_email")), "archived":bool(o.get("archived"))}
            for o in OPPS.values()]

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
    o = OPPS.get(slug_of(r.request.url), {"slug":"","data":{}})
    return J(r, [{"slug":o["slug"], "data":o.get("data",{})}])
def route_pnames(r):
    d = PN_DELAY["secs"]
    if d <= 0:
        return J(r, PROFILE_NAMES)
    # Non-blocking delay: return from the handler now (route stays pending) and fulfill later on a timer, so
    # the profile-names index lands AFTER the drawer's own enrich, without serializing other route handlers.
    # (fulfilling from a Timer thread prints a benign one-line greenlet notice to stderr on some Playwright
    #  builds; it does not affect the assertions or the exit code, which stay deterministic.)
    def later():
        try: r.fulfill(status=200, headers={"content-type":"application/json"}, body=json.dumps(PROFILE_NAMES))
        except Exception: pass
    threading.Timer(d, later).start()
def route_profiles(r): J(r, [{"uid":ME["uid"],"display_name":ME["name"],"prefs":{}}])
def route_members(r):  J(r, [{"id":ME["uid"],"role":"member"}])

def wire(ctx, lang=None):
    sess = json.dumps({"access_token":"T","refresh_token":"R","expires_at":9999999999,"email":ME["email"],"uid":ME["uid"]})
    init = "try{localStorage.setItem('console_sb_session', '"+sess+"');"
    if lang: init += "localStorage.setItem('thrive_lang','"+lang+"');"
    init += "}catch(e){}"
    ctx.add_init_script(init)
    ctx.route("**/rest/v1/console_board**", route_board)
    ctx.route("**/rest/v1/console_inbound**", route_empty)
    ctx.route("**/rest/v1/console_opps**", route_opps)
    ctx.route("**/rest/v1/console_mail**", route_empty)
    ctx.route("**/rest/v1/console_hits**", route_empty)
    ctx.route("**/rest/v1/console_profile_names**", route_pnames)
    ctx.route("**/rest/v1/console_profiles**", route_profiles)
    ctx.route("**/rest/v1/console_members**", route_members)
    ctx.route("**/rest/v1/console_admins**", route_empty)

OPEN = """(biz)=>{ var t=null; document.querySelectorAll('.card').forEach(function(c){ if(c.textContent.indexOf(biz)>=0) t=c; }); if(t){ t.click(); return true; } return false; }"""
# the notes list text, joined; note meta lives in .nmeta spans
NOTES_TXT = """()=>{ var h=document.getElementById('notesList'); return h?h.innerText:''; }"""
METAS = """()=>{ return Array.prototype.map.call(document.querySelectorAll('#notesList .nmeta'), function(s){return s.textContent;}); }"""
IDENT_LOADED = "()=>!!(window.__thriveIdentity && window.__thriveIdentity.loaded)"

def wait_ident(pg, tries=50):
    for _ in range(tries):
        if pg.evaluate(IDENT_LOADED): return True
        pg.wait_for_timeout(150)
    return False

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # ===== 1-3: resolution at rest (index already settled fast) =====
    PN_DELAY["secs"] = 0.0
    ctx = b.new_context(); wire(ctx); pg = ctx.new_page(); perr=[]
    pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(400)
    wait_ident(pg)
    pg.evaluate(OPEN, "Alpha Co"); pg.wait_for_timeout(600)   # open + enrich fetch
    metas = pg.evaluate(METAS)
    joined = " || ".join(metas)
    ck("1: a known uid renders the display_name, not the uid",
       (ME["name"] in joined) and (ME["uid"] not in joined), {"metas":metas})
    ck("2: an unknown uid falls back to the raw uid (never blank)",
       (GHOST_UID in joined), {"metas":metas})
    ck("3: a legacy email actor shows the email as-is when not in the index",
       (LEGACY_MAIL in joined), {"metas":metas})
    # never blank: every note has a non-empty meta with an author
    ck("meta present on every note (never blank author)",
       len(metas)==3 and all(("by" in m or "بواسطة" in m) and len(m.strip())>3 for m in metas), metas)
    pg.close(); ctx.close()

    # ===== 3b: a legacy email that IS in the index resolves to the name =====
    PN_DELAY["secs"] = 0.0
    OPPS["alpha"]["data"]["notes"][2]["by"] = NOUR["email"]   # nour@example.test is in PROFILE_NAMES
    ctx2 = b.new_context(); wire(ctx2); pg2 = ctx2.new_page()
    pg2.goto(f"{base}/library/board.html", wait_until="load"); pg2.wait_for_timeout(400)
    wait_ident(pg2)
    pg2.evaluate(OPEN, "Alpha Co"); pg2.wait_for_timeout(600)
    joined2 = " || ".join(pg2.evaluate(METAS))
    ck("3: a legacy email present in the index resolves to the display_name",
       (NOUR["name"] in joined2) and (NOUR["email"] not in joined2), joined2)
    pg2.close(); ctx2.close()
    OPPS["alpha"]["data"]["notes"][2]["by"] = LEGACY_MAIL     # restore

    # ===== 4: the meta UPDATES after the index settles (opened before it lands) =====
    PN_DELAY["secs"] = 1.2                                    # index arrives well after the drawer opens
    ctx3 = b.new_context(); wire(ctx3); pg3 = ctx3.new_page(); perr3=[]
    pg3.on("pageerror", lambda e: perr3.append(str(e)))
    pg3.goto(f"{base}/library/board.html", wait_until="load"); pg3.wait_for_timeout(250)
    pg3.evaluate(OPEN, "Alpha Co"); pg3.wait_for_timeout(500)  # open + enrich (index still pending)
    before = " || ".join(pg3.evaluate(METAS))
    ck("4: before the index settles, the known author shows the raw uid",
       (ME["uid"] in before) and (ME["name"] not in before), before)
    wait_ident(pg3)                                           # let console_profile_names land + finishIdentity
    pg3.wait_for_timeout(400)
    after = " || ".join(pg3.evaluate(METAS))
    ck("4: after the index settles, the note re-renders to the display_name (no reload)",
       (ME["name"] in after) and (ME["uid"] not in after), after)
    ck("4: no uncaught page error during the settle re-render", not perr3, perr3)
    pg3.close(); ctx3.close()

    # ===== 5: AR RTL still resolves the name =====
    PN_DELAY["secs"] = 0.0
    ctx4 = b.new_context(); wire(ctx4, lang="ar"); pg4 = ctx4.new_page()
    pg4.goto(f"{base}/library/board.html", wait_until="load"); pg4.wait_for_timeout(400)
    wait_ident(pg4)
    d = pg4.evaluate("()=>getComputedStyle(document.documentElement).direction")
    pg4.evaluate(OPEN, "Alpha Co"); pg4.wait_for_timeout(600)
    joined4 = " || ".join(pg4.evaluate(METAS))
    ck("5: AR flips the document to RTL", d=="rtl", d)
    ck("5: the display_name resolves under AR too", ME["name"] in joined4, joined4)
    pg4.close(); ctx4.close()

    # ===== privacy + no error =====
    blob = json.dumps([o["data"] for o in OPPS.values()]) + json.dumps(PROFILE_NAMES)
    hosts = [re.split(r'[\s<">,\\]', seg, 1)[0] for seg in re.split(r'@', blob)[1:] if seg.strip()]
    bad = [h for h in hosts if h and not h.startswith("example.test") and not h.startswith("thrive.test")]
    ck("PRIVACY: every address is a synthetic placeholder", not bad, bad)
    ck("no uncaught page error at rest", not perr, perr)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL BOARD-NAME-DISPLAY CHECKS PASS"))
raise SystemExit(1 if fails else 0)
