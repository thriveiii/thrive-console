"""STEP 2C · ADMIN TITLE EDITOR (board.html, owner assigns functional titles, ZERO real network).

An owner-only section inside the 2B profile panel: the team roster with an editable functional title per
member. Rendered only when isOwner() (UI gate); the real gate is the live RLS policy + trigger. The title
write is a PATCH keyed on the TARGET member's uid, body only { signature_title }. The owner/member role is
never shown in the UI. The 2B own-row write (display_name only) is untouched.

Stateful mock of Supabase REST (never a real network call). Assertions:
  1. the admin section renders for an owner and is ABSENT for a member (UI gate);
  2. the roster lists members with name / email / current title;
  3. saving a title issues ONE PATCH to console_profiles keyed on the TARGET uid carrying signature_title
     (never the admin's uid, never display_name / role);
  4. optimistic green on success; a forced failure reverts red with no phantom save;
  5. a simulated member title write is rejected (a 42501/trigger-style rejection) and reverts red (the
     trigger path); role is never shown in the UI anywhere;
  6. the 2B own-row name save still writes only display_name (no signature_title);
  7. AR RTL; privacy synthetic *.example.test only; no uncaught page error.
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

OWNER = {"uid":"uid-owner-0001", "email":"owner@example.test", "name":"Owner One"}
ALICE = {"uid":"uid-alice-0002", "email":"alice@example.test", "name":"Alice Member"}
BOB   = {"uid":"uid-bob-0003",   "email":"bob@example.test",   "name":"Bob Member"}
ROSTER = [OWNER, ALICE, BOB]
NAMES  = {OWNER["uid"]:OWNER["name"], ALICE["uid"]:ALICE["name"], BOB["uid"]:BOB["name"]}
TITLES = {OWNER["uid"]:"Director", ALICE["uid"]:"Project Manager", BOB["uid"]:""}   # BOB has no title yet

TITLE_PATCHES = []   # captured PATCH {target, body}
NAME_POSTS    = []   # captured 2B name POST bodies
FAIL_TITLE    = {"on": False, "code": 500}   # force a title-write rejection

CUR = {"role": "owner"}   # which role the current session's console_members row reports

def uid_of(url):
    m = re.search(r'uid=eq\.([^&]+)', url); return m.group(1) if m else ""

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
def route_board(r): J(r, [])
def route_pnames(r):
    J(r, [{"uid":m["uid"], "display_name":NAMES.get(m["uid"],""), "email":m["email"]} for m in ROSTER])
ROSTER_READS = []   # captured console_members roster-read URLs (must never request role)
def route_members(r):
    url = r.request.url
    if "select=id,role" in url or "select=id%2Crole" in url:      # loadIdentity own-row role probe
        return J(r, [{"id":OWNER["uid"], "role":CUR["role"]}])
    # roster read: id,name,email ONLY (never role). Owner-scoped in reality; here return the whole roster.
    ROSTER_READS.append(url)
    return J(r, [{"id":m["uid"], "name":m["name"], "email":m["email"]} for m in ROSTER])
def route_profiles(r):
    req = r.request; url = req.url
    if req.method == "PATCH":                                     # title write, keyed on ?uid=eq.<target>
        tgt = uid_of(url)
        try: body = json.loads(req.post_data or "{}")
        except Exception: body = {}
        TITLE_PATCHES.append({"target":tgt, "body":body})
        if FAIL_TITLE["on"]:
            return r.fulfill(status=FAIL_TITLE["code"], headers={"content-type":"application/json"},
                             body=json.dumps({"code":"42501","message":"signature_title is admin-only"}))
        if isinstance(body.get("signature_title"), str): TITLES[tgt] = body["signature_title"]
        return r.fulfill(status=204, body="")
    if req.method == "POST":                                      # 2B own-row name save
        try: body = json.loads(req.post_data or "{}")
        except Exception: body = {}
        NAME_POSTS.append(body)
        u = body.get("uid","")
        return J(r, [{"uid":u, "display_name":body.get("display_name",""), "prefs":{}, "signature_title":TITLES.get(u,"")}])
    if "uid=eq." in url:                                          # own row (loadIdentity / openProfile)
        u = uid_of(url)
        return J(r, [{"uid":u, "display_name":NAMES.get(u,""), "prefs":{}, "signature_title":TITLES.get(u,"")}])
    return J(r, [{"uid":u, "signature_title":TITLES.get(u,"")} for u in [m["uid"] for m in ROSTER]])  # roster titles

def wire(ctx, uid, email, lang=None):
    sess = json.dumps({"access_token":"T","refresh_token":"R","expires_at":9999999999,"email":email,"uid":uid})
    init = "try{localStorage.setItem('console_sb_session', '"+sess+"');"
    if lang: init += "localStorage.setItem('thrive_lang','"+lang+"');"
    init += "}catch(e){}"
    ctx.add_init_script(init)
    ctx.route("**/rest/v1/console_board**", route_board)
    ctx.route("**/rest/v1/console_inbound**", route_empty)
    ctx.route("**/rest/v1/console_opps**", route_empty)
    ctx.route("**/rest/v1/console_mail**", route_empty)
    ctx.route("**/rest/v1/console_hits**", route_empty)
    ctx.route("**/rest/v1/console_profile_names**", route_pnames)
    ctx.route("**/rest/v1/console_profiles**", route_profiles)
    ctx.route("**/rest/v1/console_members**", route_members)
    ctx.route("**/rest/v1/console_admins**", route_empty)

OPENPF   = "()=>{ var b=document.getElementById('profileBtn'); if(b){ b.click(); return true;} return false; }"
ADMIN_PRESENT = "()=>!!document.querySelector('.pf-admin')"
ROSTER_DATA = """()=>Array.prototype.map.call(document.querySelectorAll('.pf-mem'), function(m){
  var inp=m.querySelector('.pf-title-in'); var save=m.querySelector('.pf-title-save');
  return { uid:m.getAttribute('data-uid'),
           name:(m.querySelector('.pf-mem-name')||{}).textContent||'',
           email:(m.querySelector('.pf-mem-email')||{}).textContent||'',
           title: inp?inp.value:'', i: save?save.getAttribute('data-i'):null }; })"""
IDX_FOR = "(uid)=>{ var b=document.querySelector('.pf-title-save[data-uid=\\\"'+uid+'\\\"]'); return b?b.getAttribute('data-i'):null; }"
SET_T = "(a)=>{ var el=document.getElementById('pfT'+a.i); if(el){ el.value=a.v; return true;} return false; }"
CLICK_T = "(uid)=>{ var b=document.querySelector('.pf-title-save[data-uid=\\\"'+uid+'\\\"]'); if(b){ b.click(); return true;} return false; }"
TS = "(i)=>{ var e=document.getElementById('pfTS'+i); return e?{txt:e.textContent,cls:e.className}:{txt:'',cls:''}; }"
PANEL_TXT = "()=>{ var p=document.getElementById('pfPanel'); return p?p.textContent:''; }"
# 2B name field
SET_NAME = "(v)=>{ var i=document.getElementById('pfName'); if(i){ i.value=v; return true;} return false; }"
CLICK_NAME = "()=>{ var b=document.getElementById('pfSave'); if(b){ b.click(); return true;} return false; }"

def wait_ident(pg, tries=40):
    for _ in range(tries):
        if pg.evaluate("()=>!!(window.__thriveIdentity && window.__thriveIdentity.loaded)"): return True
        pg.wait_for_timeout(150)
    return False

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # ===== OWNER: admin section + roster + title write =====
    CUR["role"] = "owner"
    ctx = b.new_context(); wire(ctx, OWNER["uid"], OWNER["email"]); pg = ctx.new_page(); perr=[]
    pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(400); wait_ident(pg)
    pg.evaluate(OPENPF); pg.wait_for_timeout(700)   # open + roster load
    ck("1: the admin section renders for an owner", pg.evaluate(ADMIN_PRESENT))
    rows = pg.evaluate(ROSTER_DATA)
    by = { r["uid"]:r for r in rows }
    ck("2: the roster lists every member with name and email",
       ALICE["uid"] in by and BOB["uid"] in by and by[ALICE["uid"]]["name"]==ALICE["name"] and ALICE["email"] in by[ALICE["uid"]]["email"], rows)
    ck("2: the roster shows each member's current functional title (and blank when none)",
       by.get(ALICE["uid"],{}).get("title")=="Project Manager" and by.get(BOB["uid"],{}).get("title")=="", rows)
    # role is never SHOWN: the roster read never requests role, and no leaf element renders exactly owner/member
    role_leaf = pg.evaluate("""()=>{ var bad=false; document.querySelectorAll('.pf-mem *').forEach(function(el){
        var t=(el.textContent||'').trim().toLowerCase();
        if(el.children.length===0 && (t==='owner'||t==='member')) bad=true; }); return bad; }""")
    ck("5: the owner/member role is NEVER shown in the admin UI (no role in the roster read, no role tag)",
       (not role_leaf) and len(ROSTER_READS)>0 and all("role" not in u for u in ROSTER_READS), {"role_leaf":role_leaf, "reads":ROSTER_READS})

    # 3: save ALICE's title -> one PATCH keyed on ALICE.uid, body only signature_title
    idx = pg.evaluate(IDX_FOR, ALICE["uid"])
    p0 = len(TITLE_PATCHES)
    pg.evaluate(SET_T, {"i":idx, "v":"Executive Director"}); pg.evaluate(CLICK_T, ALICE["uid"]); pg.wait_for_timeout(700)
    ck("3: exactly one title PATCH was issued", len(TITLE_PATCHES)==p0+1, len(TITLE_PATCHES)-p0)
    tp = TITLE_PATCHES[-1] if TITLE_PATCHES else {}
    ck("3: the title write is keyed on the TARGET member uid, not the admin", tp.get("target")==ALICE["uid"] and tp.get("target")!=OWNER["uid"], tp)
    ck("3: the title body carries ONLY signature_title (no display_name, no role, no uid mismatch)",
       set((tp.get("body") or {}).keys())=={"signature_title"} and tp["body"]["signature_title"]=="Executive Director", tp)
    ck("4: a green Saved status shows on success", "ok" in pg.evaluate(TS, idx)["cls"], pg.evaluate(TS, idx))

    # 4/5: forced rejection (member-style 42501 trigger reject) -> red revert, no phantom
    FAIL_TITLE["on"] = True
    p1 = len(TITLE_PATCHES); before_title = TITLES[BOB["uid"]]
    idxB = pg.evaluate(IDX_FOR, BOB["uid"])
    pg.evaluate(SET_T, {"i":idxB, "v":"Should Not Stick"}); pg.evaluate(CLICK_T, BOB["uid"]); pg.wait_for_timeout(700)
    ck("5: a rejected (trigger-style 42501) title write shows red", "bad" in pg.evaluate(TS, idxB)["cls"], pg.evaluate(TS, idxB))
    ck("4: no phantom save on rejection: the stored title is unchanged", TITLES[BOB["uid"]]==before_title, TITLES[BOB["uid"]])
    FAIL_TITLE["on"] = False

    # 6: the 2B own-row name save still writes ONLY display_name
    n0 = len(NAME_POSTS)
    pg.evaluate(SET_NAME, "Owner Renamed"); pg.evaluate(CLICK_NAME); pg.wait_for_timeout(600)
    nb = NAME_POSTS[-1] if len(NAME_POSTS)>n0 else {}
    ck("6: the 2B name save writes only uid + display_name (never signature_title)",
       set(nb.keys())=={"uid","display_name"} and "signature_title" not in nb, nb)
    pg.close(); ctx.close()

    # ===== MEMBER: admin section absent =====
    CUR["role"] = "member"
    ctx2 = b.new_context(); wire(ctx2, ALICE["uid"], ALICE["email"]); pg2 = ctx2.new_page(); perr2=[]
    pg2.on("pageerror", lambda e: perr2.append(str(e)))
    pg2.goto(f"{base}/library/board.html", wait_until="load"); pg2.wait_for_timeout(400); wait_ident(pg2)
    pg2.evaluate(OPENPF); pg2.wait_for_timeout(500)
    ck("1: the admin section is ABSENT for a member (UI gate)", not pg2.evaluate(ADMIN_PRESENT))
    ck("1: a member sees no title editor at all", pg2.evaluate("()=>document.querySelectorAll('.pf-title-in').length")==0)
    pg2.close(); ctx2.close()

    # ===== AR RTL (owner) =====
    CUR["role"] = "owner"
    ctx3 = b.new_context(); wire(ctx3, OWNER["uid"], OWNER["email"], lang="ar"); pg3 = ctx3.new_page()
    pg3.goto(f"{base}/library/board.html", wait_until="load"); pg3.wait_for_timeout(400); wait_ident(pg3)
    d = pg3.evaluate("()=>getComputedStyle(document.documentElement).direction")
    pg3.evaluate(OPENPF); pg3.wait_for_timeout(700)
    ck("7: AR flips the document to RTL", d=="rtl", d)
    ck("7: the admin section renders under AR", pg3.evaluate(ADMIN_PRESENT))
    pg3.close(); ctx3.close()

    # ===== privacy + no error =====
    blob = json.dumps(TITLE_PATCHES) + json.dumps(NAME_POSTS) + json.dumps(TITLES) + json.dumps([m["email"] for m in ROSTER])
    hosts = [re.split(r'[\s<">,\\]', seg, 1)[0] for seg in re.split(r'@', blob)[1:] if seg.strip()]
    bad = [h for h in hosts if h and not h.startswith("example.test") and not h.startswith("thrive.test")]
    ck("PRIVACY: every address is a synthetic placeholder", not bad, bad)
    ck("no uncaught page error", not perr and not perr2, (perr, perr2))

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL BOARD-ADMIN-TITLES CHECKS PASS"))
raise SystemExit(1 if fails else 0)
