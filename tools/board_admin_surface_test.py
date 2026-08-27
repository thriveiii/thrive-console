"""STEP 2D · ADMIN EXECUTIVE SURFACE, SEPARATE FROM THE PERSONAL PROFILE (board.html, ZERO real network).

The 2C admin roster (owner assigns functional titles) moved OUT of the 2B personal profile panel into its
own owner-only Admin surface, opened from its own header entry (#adminBtn -> #admPanel). The personal
profile panel keeps ONLY the person's own email / display name / functional title; it never renders the
team roster. Every 2C invariant is preserved: the title write is a PATCH keyed on the TARGET member's uid,
body only { signature_title }; optimistic green on success, red revert with no phantom save on rejection;
the owner/member role is never shown; the 2B own-row name save still writes only display_name. The real
gate stays the live RLS policy + trigger; isOwner() only decides whether the surface opens.

Stateful mock of Supabase REST (never a real network call). Assertions:
  1. an owner sees a SEPARATE Admin header entry; opening it renders the roster in the admin panel, while
     the personal profile panel contains NO roster (the two surfaces are separated);
  2. the roster lists every member with a human label / email / current title; the label preference is
     display_name, then email, then "unnamed", and the raw uuid is NEVER shown (even when a member's
     console_members.name literally holds the uid, the device bug this fixes); all four live members render;
  3. saving a title issues ONE PATCH to console_profiles keyed on the TARGET uid carrying only
     signature_title (never the admin's uid, never display_name / role);
  4. optimistic green on success; a forced (trigger-style 42501) failure reverts red with no phantom save;
  5. the owner/member role is never shown in the admin UI (no role in the roster read, no role tag);
  6. the 2B own-row name save still writes only display_name (no signature_title);
  7. a MEMBER has no Admin entry and cannot open the surface (button hidden, openAdmin a no-op), and the
     personal panel still carries no roster;
  8. AR RTL; privacy synthetic *.example.test only; no uncaught page error.
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

# Four live members: two owners, two members (mirrors the live team). CAROL has NO display_name (blank),
# to prove the roster falls back to her email and never crashes on a null name.
OWNER = {"uid":"uid-owner-0001", "email":"owner@example.test", "name":"Owner One"}
DANA  = {"uid":"uid-dana-0004",  "email":"dana@example.test",  "name":"Dana Two"}    # second owner
ALICE = {"uid":"uid-alice-0002", "email":"alice@example.test", "name":"Alice Member"}
CAROL = {"uid":"uid-carol-0003", "email":"carol@example.test", "name":""}            # member, no display_name
ROSTER = [OWNER, DANA, ALICE, CAROL]

# The human name lives in console_profiles.display_name. OWNER/DANA/ALICE have one; CAROL has none.
PROFILE_NAME = {OWNER["uid"]:"Owner One", DANA["uid"]:"Dana Two", ALICE["uid"]:"Alice Member", CAROL["uid"]:""}
# console_members.name is the DEVICE BUG surface: for the two plain members it literally holds the raw uid
# (that is why the roster showed b3b8534a... instead of a name). OWNER/DANA carry a real name there too, but
# the fix never reads this field for the label, so a uid here must never reach the UI.
MEMBER_NAME  = {OWNER["uid"]:"Owner One", DANA["uid"]:"Dana Two", ALICE["uid"]:ALICE["uid"], CAROL["uid"]:CAROL["uid"]}
# The current-session own-row display_name (loadIdentity / openProfile) reads from console_profiles too.
NAMES  = PROFILE_NAME
TITLES = {OWNER["uid"]:"Director", DANA["uid"]:"Partner", ALICE["uid"]:"Project Manager", CAROL["uid"]:""}
OWNER_UIDS = {OWNER["uid"], DANA["uid"]}   # role decides only whether the surface opens; never shown

TITLE_PATCHES = []   # captured PATCH {target, body}
NAME_POSTS    = []   # captured 2B name POST bodies
FAIL_TITLE    = {"on": False, "code": 500}   # force a title-write rejection

CUR = {"uid": OWNER["uid"], "role": "owner"}   # which session is signed in + its role

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
        return J(r, [{"id":CUR["uid"], "role":CUR["role"]}])
    # roster read: id,name,email ONLY (never role). Owner-scoped in reality; here return the whole roster.
    # name here is console_members.name, which for the two plain members literally IS the uid (device bug).
    ROSTER_READS.append(url)
    return J(r, [{"id":m["uid"], "name":MEMBER_NAME.get(m["uid"],""), "email":m["email"]} for m in ROSTER])
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
    # roster read for the admin surface: uid + display_name + signature_title (the fix reads display_name here)
    return J(r, [{"uid":m["uid"], "display_name":PROFILE_NAME.get(m["uid"],""), "signature_title":TITLES.get(m["uid"],"")} for m in ROSTER])

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

# Header entries
ADMIN_BTN_VISIBLE = "()=>{ var b=document.getElementById('adminBtn'); return !!b && !b.hidden; }"
OPENADM  = "()=>{ var b=document.getElementById('adminBtn'); if(b){ b.click(); return true;} return false; }"
OPENPF   = "()=>{ var b=document.getElementById('profileBtn'); if(b){ b.click(); return true;} return false; }"
# Surface probes: the roster lives in the ADMIN panel, never in the profile panel
ADMIN_PANEL_ROSTER  = "()=>!!document.querySelector('#admPanel .pf-admin')"
PROFILE_PANEL_ROSTER = "()=>!!document.querySelector('#pfPanel .pf-admin')"
ADMIN_OPEN = "()=>{ var s=document.getElementById('admScrim'); return !!s && !s.hidden; }"
ADMIN_ANYWHERE = "()=>!!document.querySelector('.pf-admin')"
ROSTER_DATA = """()=>Array.prototype.map.call(document.querySelectorAll('#admPanel .pf-mem'), function(m){
  var inp=m.querySelector('.pf-title-in'); var save=m.querySelector('.pf-title-save');
  return { uid:m.getAttribute('data-uid'),
           name:(m.querySelector('.pf-mem-name')||{}).textContent||'',
           email:(m.querySelector('.pf-mem-email')||{}).textContent||'',
           title: inp?inp.value:'', i: save?save.getAttribute('data-i'):null }; })"""
IDX_FOR = "(uid)=>{ var b=document.querySelector('.pf-title-save[data-uid=\\\"'+uid+'\\\"]'); return b?b.getAttribute('data-i'):null; }"
SET_T = "(a)=>{ var el=document.getElementById('pfT'+a.i); if(el){ el.value=a.v; return true;} return false; }"
CLICK_T = "(uid)=>{ var b=document.querySelector('.pf-title-save[data-uid=\\\"'+uid+'\\\"]'); if(b){ b.click(); return true;} return false; }"
TS = "(i)=>{ var e=document.getElementById('pfTS'+i); return e?{txt:e.textContent,cls:e.className}:{txt:'',cls:''}; }"
# personal profile fields
PF_HAS_OWN = "()=>{ var p=document.getElementById('pfPanel'); return !!(p && p.querySelector('#pfName') && p.querySelector('#pfSave')); }"
SET_NAME = "(v)=>{ var i=document.getElementById('pfName'); if(i){ i.value=v; return true;} return false; }"
CLICK_NAME = "()=>{ var b=document.getElementById('pfSave'); if(b){ b.click(); return true;} return false; }"

def wait_ident(pg, tries=40):
    for _ in range(tries):
        if pg.evaluate("()=>!!(window.__thriveIdentity && window.__thriveIdentity.loaded)"): return True
        pg.wait_for_timeout(150)
    return False

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # ===== OWNER: separate Admin surface + roster + title write =====
    CUR["uid"] = OWNER["uid"]; CUR["role"] = "owner"
    ctx = b.new_context(); wire(ctx, OWNER["uid"], OWNER["email"]); pg = ctx.new_page(); perr=[]
    pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(400); wait_ident(pg)

    ck("1: an owner sees a separate Admin header entry", pg.evaluate(ADMIN_BTN_VISIBLE))

    # The personal profile panel is PERSONAL only: own fields, and NO roster
    pg.evaluate(OPENPF); pg.wait_for_timeout(500)
    ck("1: the personal profile panel shows the person's own fields", pg.evaluate(PF_HAS_OWN))
    ck("1: the personal profile panel contains NO team roster", not pg.evaluate(PROFILE_PANEL_ROSTER))

    # The Admin surface is a separate overlay with the roster
    pg.evaluate(OPENADM); pg.wait_for_timeout(700)   # open + roster load
    ck("1: opening Admin renders the roster in the admin panel", pg.evaluate(ADMIN_PANEL_ROSTER))
    ck("1: the admin surface is its own open overlay", pg.evaluate(ADMIN_OPEN))

    rows = pg.evaluate(ROSTER_DATA)
    by = { r["uid"]:r for r in rows }
    ck("2: all four live members render in the roster", len(rows)==4 and all(m["uid"] in by for m in ROSTER), rows)
    # FALLBACK LADDER: display_name, then email, then never the raw uuid.
    ck("2a: a member WITH a display_name shows the name (not the email, not the uid)",
       by.get(ALICE["uid"],{}).get("name")=="Alice Member", by.get(ALICE["uid"]))
    ck("2b: a member with NO display_name but an email shows the EMAIL (never the uid)",
       by.get(CAROL["uid"],{}).get("name")==CAROL["email"], by.get(CAROL["uid"]))
    ck("2: each member still shows its email in the id line",
       ALICE["email"] in by.get(ALICE["uid"],{}).get("email","") and CAROL["email"] in by.get(CAROL["uid"],{}).get("email",""), rows)
    # THE CORE GUARD: the raw uuid is NEVER the member label, for any row, even the members whose
    # console_members.name literally holds the uid (the device bug). Check the rendered label text directly.
    uid_shown = [ by.get(m["uid"],{}).get("name","") for m in ROSTER if by.get(m["uid"],{}).get("name","")==m["uid"] ]
    ck("2c: the raw uuid is NEVER rendered as a member label", not uid_shown, uid_shown)
    ck("2: the roster shows each member's current title (blank when none)",
       by.get(ALICE["uid"],{}).get("title")=="Project Manager" and by.get(CAROL["uid"],{}).get("title")=="", rows)

    # 5: role is never SHOWN: the roster read never requests role, and no leaf element renders exactly owner/member
    role_leaf = pg.evaluate("""()=>{ var bad=false; document.querySelectorAll('#admPanel .pf-mem *').forEach(function(el){
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
    ck("3: the title body carries ONLY signature_title (no display_name, no role)",
       set((tp.get("body") or {}).keys())=={"signature_title"} and tp["body"]["signature_title"]=="Executive Director", tp)
    ck("4: a green Saved status shows on success", "ok" in pg.evaluate(TS, idx)["cls"], pg.evaluate(TS, idx))

    # 4: forced rejection (trigger-style 42501) -> red revert, no phantom
    FAIL_TITLE["on"] = True
    before_title = TITLES[CAROL["uid"]]
    idxC = pg.evaluate(IDX_FOR, CAROL["uid"])
    pg.evaluate(SET_T, {"i":idxC, "v":"Should Not Stick"}); pg.evaluate(CLICK_T, CAROL["uid"]); pg.wait_for_timeout(700)
    ck("4: a rejected (trigger-style 42501) title write shows red", "bad" in pg.evaluate(TS, idxC)["cls"], pg.evaluate(TS, idxC))
    ck("4: no phantom save on rejection: the stored title is unchanged", TITLES[CAROL["uid"]]==before_title, TITLES[CAROL["uid"]])
    FAIL_TITLE["on"] = False

    # 6: the 2B own-row name save (personal panel) still writes ONLY display_name
    pg.evaluate(OPENPF); pg.wait_for_timeout(400)
    n0 = len(NAME_POSTS)
    pg.evaluate(SET_NAME, "Owner Renamed"); pg.evaluate(CLICK_NAME); pg.wait_for_timeout(600)
    nb = NAME_POSTS[-1] if len(NAME_POSTS)>n0 else {}
    ck("6: the 2B name save writes only uid + display_name (never signature_title)",
       set(nb.keys())=={"uid","display_name"} and "signature_title" not in nb, nb)
    pg.close(); ctx.close()

    # ===== MEMBER: no Admin entry, cannot open the surface, personal panel has no roster =====
    CUR["uid"] = ALICE["uid"]; CUR["role"] = "member"
    ctx2 = b.new_context(); wire(ctx2, ALICE["uid"], ALICE["email"]); pg2 = ctx2.new_page(); perr2=[]
    pg2.on("pageerror", lambda e: perr2.append(str(e)))
    pg2.goto(f"{base}/library/board.html", wait_until="load"); pg2.wait_for_timeout(400); wait_ident(pg2)
    ck("7: a member has NO visible Admin header entry", not pg2.evaluate(ADMIN_BTN_VISIBLE))
    # even calling the open hook directly is a no-op (isOwner() gate), and adminPanelHtml() renders nothing
    pg2.evaluate("()=>{ try{ if(window.__thriveOpenAdmin) window.__thriveOpenAdmin(); }catch(e){} }"); pg2.wait_for_timeout(300)
    ck("7: a member cannot open the admin surface (openAdmin is a no-op)", not pg2.evaluate(ADMIN_OPEN))
    ck("7: a member sees no title editor anywhere", pg2.evaluate("()=>document.querySelectorAll('.pf-title-in').length")==0)
    pg2.evaluate(OPENPF); pg2.wait_for_timeout(500)
    ck("7: a member's personal panel carries no roster", not pg2.evaluate(PROFILE_PANEL_ROSTER))
    pg2.close(); ctx2.close()

    # ===== AR RTL (owner) =====
    CUR["uid"] = OWNER["uid"]; CUR["role"] = "owner"
    ctx3 = b.new_context(); wire(ctx3, OWNER["uid"], OWNER["email"], lang="ar"); pg3 = ctx3.new_page()
    pg3.goto(f"{base}/library/board.html", wait_until="load"); pg3.wait_for_timeout(400); wait_ident(pg3)
    d = pg3.evaluate("()=>getComputedStyle(document.documentElement).direction")
    pg3.evaluate(OPENADM); pg3.wait_for_timeout(700)
    ck("8: AR flips the document to RTL", d=="rtl", d)
    ck("8: the admin surface renders under AR", pg3.evaluate(ADMIN_PANEL_ROSTER))
    pg3.close(); ctx3.close()

    # ===== privacy + no error =====
    blob = json.dumps(TITLE_PATCHES) + json.dumps(NAME_POSTS) + json.dumps(TITLES) + json.dumps([m["email"] for m in ROSTER])
    hosts = [re.split(r'[\s<">,\\]', seg, 1)[0] for seg in re.split(r'@', blob)[1:] if seg.strip()]
    bad = [h for h in hosts if h and not h.startswith("example.test") and not h.startswith("thrive.test")]
    ck("PRIVACY: every address is a synthetic placeholder", not bad, bad)
    ck("no uncaught page error", not perr and not perr2, (perr, perr2))

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL BOARD-ADMIN-SURFACE CHECKS PASS"))
raise SystemExit(1 if fails else 0)
