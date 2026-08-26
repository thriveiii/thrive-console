"""STEP 2B · PROFILE SETTINGS (board.html, name edit + title display, ZERO real network).

A member-facing profile surface opened from the header: email (read-only), display name (editable, the FIRST
board.html write to console_profiles, own-row upsert keyed on uid), functional title (display only). No role
shown, no signature_title write, no role write.

Stateful mock of Supabase REST (never a real network call). Assertions:
  1. the settings panel opens from the header and shows the email read-only (not an input);
  2. editing display_name issues ONE write to console_profiles keyed on uid with ONLY display_name in the body
     (no signature_title, no role);
  3. optimistic green on success; a forced failure reverts red with no phantom save (runtime name unchanged);
  4. after a successful save the note meta shows the new name (Step 2A actorName path) without a reload;
  5. signature_title renders read-only and is never written here;
  6. AR RTL; privacy synthetic *.example.test only; no uncaught page error.
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

ME = {"uid":"uid-me-0001", "email":"me@example.test", "old":"Old Name", "new":"Mena"}
TITLE = "Executive Director"     # signature_title, display only

# one opp with a note authored by ME.uid, to prove the note meta updates after a name save
OPPS = {
  "alpha": {"slug":"alpha","business":"Alpha Co","has_email":True,"archived":False,
            "data":{"notes":[{"ts":"2026-01-02T00:00:00Z","text":"A note","by":ME["uid"]}]}},
}
# stateful console_profiles own row (starts with the OLD display_name + a signature_title)
PROFILE_ROW = {"uid":ME["uid"], "display_name":ME["old"], "prefs":{}, "signature_title":TITLE}
PROFILE_WRITES = []          # captured POST bodies to console_profiles
FAIL_WRITE = {"on": False}   # flip to force a 500 on the profile write

def board_rows():
    return [{"slug":o["slug"], "business":o["business"], "stage":"live", "sent_count":0, "open_count":0,
             "replied":False, "idle_days":0, "last_activity_ts":"2026-01-02T00:00:00Z",
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
    return J(r, [{"uid":ME["uid"], "display_name":PROFILE_ROW["display_name"], "email":ME["email"]}])
def route_members(r): J(r, [{"id":ME["uid"], "role":"member"}])
def route_profiles(r):
    req = r.request
    if req.method == "POST":                         # the own-row upsert (name save)
        try: body = json.loads(req.post_data or "{}")
        except Exception: body = {}
        PROFILE_WRITES.append(body)
        if FAIL_WRITE["on"]:
            return r.fulfill(status=500, headers={"content-type":"application/json"}, body=json.dumps({"message":"forced"}))
        if isinstance(body.get("display_name"), str): PROFILE_ROW["display_name"] = body["display_name"]
        # merge-duplicates return=representation: echo the merged row (never inventing signature_title/role)
        return J(r, [dict(PROFILE_ROW)])
    return J(r, [dict(PROFILE_ROW)])                  # GET own row

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

OPENPF   = "()=>{ var b=document.getElementById('profileBtn'); if(b){ b.click(); return true;} return false; }"
PF_VIS   = "()=>{ var s=document.getElementById('pfScrim'); return !!(s && !s.hidden); }"
PF_EMAIL_RO = """()=>{ var p=document.getElementById('pfPanel'); if(!p) return {found:false};
  var email='me@example.test'; var inName=false, inRO=false;
  p.querySelectorAll('input,textarea').forEach(function(i){ if((i.value||'').indexOf(email)>=0) inName=true; });
  p.querySelectorAll('.pf-ro').forEach(function(d){ if(d.textContent.indexOf(email)>=0) inRO=true; });
  return {inName:inName, inRO:inRO, hasNameInput:!!document.getElementById('pfName'),
          hasTitleInput: p.querySelectorAll('input,textarea').length }; }"""
SET_NAME = "(v)=>{ var i=document.getElementById('pfName'); if(i){ i.value=v; return true;} return false; }"
CLICK_SAVE = "()=>{ var b=document.getElementById('pfSave'); if(b){ b.click(); return true;} return false; }"
PF_STATUS = "()=>{ var e=document.getElementById('pfStatus'); return e?{txt:e.textContent,cls:e.className}:{txt:'',cls:''}; }"
PF_TITLE_TXT = """()=>{ var p=document.getElementById('pfPanel'); if(!p) return ''; var out=[];
  p.querySelectorAll('.pf-ro').forEach(function(d){ out.push(d.textContent); }); return out.join(' | '); }"""
OPEN_OPP = """(biz)=>{ var t=null; document.querySelectorAll('.card').forEach(function(c){ if(c.textContent.indexOf(biz)>=0) t=c; }); if(t){ t.click(); return true;} return false; }"""
METAS = "()=>Array.prototype.map.call(document.querySelectorAll('#notesList .nmeta'), function(s){return s.textContent;})"
NAME_RT = "()=>window.__thriveIdentity ? window.__thriveIdentity.name : null"

def wait_ident(pg, tries=40):
    for _ in range(tries):
        if pg.evaluate("()=>!!(window.__thriveIdentity && window.__thriveIdentity.loaded)"): return True
        pg.wait_for_timeout(150)
    return False

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # ===== main flow: open, email read-only, edit + save, note meta updates =====
    ctx = b.new_context(); wire(ctx); pg = ctx.new_page(); perr=[]
    pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(400)
    wait_ident(pg)

    # open an opp drawer first (its note is authored by ME.uid -> shows the OLD name)
    pg.evaluate(OPEN_OPP, "Alpha Co"); pg.wait_for_timeout(600)
    before_meta = " || ".join(pg.evaluate(METAS))
    ck("4: the note meta first shows the old resolved name", ME["old"] in before_meta, before_meta)

    # 1: open the profile panel from the header; email read-only
    pg.evaluate(OPENPF); pg.wait_for_timeout(500)
    ck("1: the profile panel opens from the header", pg.evaluate(PF_VIS))
    ro = pg.evaluate(PF_EMAIL_RO)
    ck("1: email shows read-only (in a .pf-ro, not an input)", ro["inRO"] and not ro["inName"], ro)
    ck("1: there is exactly one editable field (the name input), no title/role input",
       ro["hasNameInput"] and ro["hasTitleInput"]==1, ro)
    ck("5: the functional title renders read-only and shows signature_title", TITLE in pg.evaluate(PF_TITLE_TXT), pg.evaluate(PF_TITLE_TXT))

    # 2: edit + save -> ONE write to console_profiles keyed on uid, ONLY display_name
    w0 = len(PROFILE_WRITES)
    pg.evaluate(SET_NAME, ME["new"]); pg.evaluate(CLICK_SAVE); pg.wait_for_timeout(700)
    ck("2: exactly one write was issued to console_profiles", len(PROFILE_WRITES)==w0+1, len(PROFILE_WRITES)-w0)
    body = PROFILE_WRITES[-1] if PROFILE_WRITES else {}
    ck("2: the write is keyed on uid == session uid", body.get("uid")==ME["uid"], body)
    ck("2: the write sets display_name", body.get("display_name")==ME["new"], body)
    ck("2: the write carries ONLY uid + display_name (no signature_title, no role)",
       set(body.keys())=={"uid","display_name"}, list(body.keys()))
    st = pg.evaluate(PF_STATUS)
    ck("3: a green Saved status shows on success", "ok" in st["cls"], st)

    # 4: the note meta now shows the NEW name without a reload (Step 2A path)
    after_meta = " || ".join(pg.evaluate(METAS))
    ck("4: after save the note meta shows the new name without reload",
       (ME["new"] in after_meta) and (ME["old"] not in after_meta), after_meta)
    ck("4: runtime __thriveIdentity.name updated to the new name", pg.evaluate(NAME_RT)==ME["new"], pg.evaluate(NAME_RT))
    ck("5: signature_title was NEVER written (no write body carried it)",
       all("signature_title" not in w and "role" not in w for w in PROFILE_WRITES), PROFILE_WRITES)
    pg.close(); ctx.close()

    # ===== forced failure: red revert, no phantom save =====
    PROFILE_ROW["display_name"] = ME["old"]; FAIL_WRITE["on"] = True
    ctx2 = b.new_context(); wire(ctx2); pg2 = ctx2.new_page(); perr2=[]
    pg2.on("pageerror", lambda e: perr2.append(str(e)))
    pg2.goto(f"{base}/library/board.html", wait_until="load"); pg2.wait_for_timeout(400)
    wait_ident(pg2)
    pg2.evaluate(OPENPF); pg2.wait_for_timeout(400)
    pg2.evaluate(SET_NAME, "Should Not Stick"); pg2.evaluate(CLICK_SAVE); pg2.wait_for_timeout(700)
    st2 = pg2.evaluate(PF_STATUS)
    ck("3: a forced failure shows a red status", "bad" in st2["cls"], st2)
    ck("3: no phantom save: runtime name stayed the old name", pg2.evaluate(NAME_RT)==ME["old"], pg2.evaluate(NAME_RT))
    FAIL_WRITE["on"] = False
    pg2.close(); ctx2.close()

    # ===== AR RTL =====
    PROFILE_ROW["display_name"] = ME["old"]
    ctx3 = b.new_context(); wire(ctx3, lang="ar"); pg3 = ctx3.new_page()
    pg3.goto(f"{base}/library/board.html", wait_until="load"); pg3.wait_for_timeout(400)
    wait_ident(pg3)
    d = pg3.evaluate("()=>getComputedStyle(document.documentElement).direction")
    pg3.evaluate(OPENPF); pg3.wait_for_timeout(400)
    ck("6: AR flips the document to RTL", d=="rtl", d)
    ck("6: the profile panel opens under AR", pg3.evaluate(PF_VIS))
    pg3.close(); ctx3.close()

    # ===== privacy + no error =====
    blob = json.dumps(PROFILE_WRITES) + json.dumps(PROFILE_ROW) + json.dumps([o["data"] for o in OPPS.values()])
    hosts = [re.split(r'[\s<">,\\]', seg, 1)[0] for seg in re.split(r'@', blob)[1:] if seg.strip()]
    bad = [h for h in hosts if h and not h.startswith("example.test") and not h.startswith("thrive.test")]
    ck("PRIVACY: every address is a synthetic placeholder", not bad, bad)
    ck("no uncaught page error", not perr, perr)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL BOARD-PROFILE CHECKS PASS"))
raise SystemExit(1 if fails else 0)
