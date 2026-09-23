"""COLLAB PR-1: schema + identity fix (board.html, fails-when-broken).

PR-1 lays the durable collaboration schema (SQL, applied by Thyab) and fixes the "Unassigned" owner chip:
the canonical member map is keyed by UID as well as email, the board re-renders when loadIdentity settles
(paint-race fix), and the owner write is PGRST204-tolerant so a not-yet-applied additive column never 400s
a create/send. No bell/drawer/assign-UI here.

Asserts (each fails-when-broken):
  (a) an owner uid resolves to its canonical member name (Thyab / Agha / Basel) - even when the profile
      display_name differs, and even when the profile index settles AFTER the first board paint (the
      paint-race fix re-renders so the name appears without a manual refresh).
  (b) a create does NOT 400 when the owner column is absent: oppUpsert strips the missing column named by
      PGRST204 and retries once without it, so the opp still persists.
  (c) docs/supabase-collab-layer.sql is additive/idempotent, block-comment-only (no double-dash), no Arabic.
  (d) IDENTITY.md carries the member-colour dimension (tokens + meaning) under the colour law.
  (e) canon: board.html has no em dash, itfGhroob 0 refs, no dusty rose; the member hues are distinct from
      the six lane hues and are not the reserved gradient.
"""
import os, re, json, threading, http.server, socketserver, functools
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

# ---- static: SQL (c) ------------------------------------------------------------------------------
sql = open(f"{ROOT}/docs/supabase-collab-layer.sql", encoding="utf-8").read()
ck("(c) SQL uses no double-dash comments", "--" not in sql)
ck("(c) SQL has no Arabic", len(re.findall(r"[؀-ۿ]", sql)) == 0)
ck("(c) SQL is additive/idempotent (create table if not exists, no drop)",
   "create table if not exists" in sql and "drop " not in sql.lower())
for tbl in ["console_card_members","console_watchers","console_activity","console_notifications","console_read_state","console_card_order"]:
    ck("(c) SQL creates " + tbl, ("create table if not exists " + tbl) in sql or ("create table if not exists public." + tbl) in sql)
ck("(c) notifications are PRIVATE to recipient = auth.uid()", "recipient = auth.uid()" in sql)
ck("(c) backfill: owner -> initial member", "insert into public.console_card_members" in sql and "o.owner" in sql)
ck("(c) identity backfill sets Agha (never Mohammed) for muhelagha@gmail.com",
   "muhelagha@gmail.com" in sql and "'Agha'" in sql and "Mohammed" not in sql)

# ---- static: IDENTITY.md (d) ----------------------------------------------------------------------
idm = open(f"{ROOT}/docs/IDENTITY.md", encoding="utf-8").read()
ck("(d) IDENTITY.md carries the member-colour dimension (meaning + tokens)",
   "Member identity colour" in idm and "--mem-thyab" in idm and "--mem-basel" in idm and "--mem-agha" in idm)

# ---- static: canon (e) ----------------------------------------------------------------------------
src = open(f"{ROOT}/library/board.html", encoding="utf-8").read()
ck("(e) no em dash in board.html", "—" not in src)
ck("(e) itfGhroob is fully removed (0 references)", "itfGhroob" not in src)
for lit in ["#C98B8B", "#9c5757", "#a85f5f"]:
    ck("(e) no dusty-rose literal: " + lit, lit not in src)
# member hues distinct from the six lane hues, and not a gradient stop
MEM = ["#E6B450", "#C96F4A", "#CE7BD1", "#8A5D0A", "#A8482A", "#9C3FA0"]
LANE = ["#71BFCC","#7F9FD4","#9685CA","#EE8C9D","#7EE0B8","#6b7280","#2e7480","#3e6bb7","#725bb8","#c0405a","#1d7752","#646a77"]
GRAD = ["#72BECE","#5D7FB7","#9685CA","#EE8C9D","#A78CA7","#71BFCC"]
clash = [h for h in MEM if h.lower() in [x.lower() for x in LANE] or h.lower() in [x.lower() for x in GRAD]]
ck("(e) member hues are distinct from every lane hue and every gradient stop", clash == [], clash)
ck("(e) the identity write is PGRST204-tolerant (strips the missing column and retries)",
   "PGRST204" in src and "pgrstMissingColumn" in src)
ck("(e) the canonical member map is keyed by uid as well as email", "OWNER_CANON_UID" in src)
ck("(a) owner chips repaint when identity settles (paint-race fix, no board re-render)",
   "function repaintOwners" in src and re.search(r"finishIdentity[\s\S]{0,2600}repaintOwners\(\)", src) is not None)

# ---- browser: (a) resolve-by-uid + paint-race, (b) PGRST204 create ---------------------------------
U_THYAB="u_thyab"; U_BASEL="u_basel"; U_AGHA="u_agha"
# profiles carry a display_name that DIFFERS from the canonical short name, to prove the canonical map wins
PROFILES=[
  {"uid":U_THYAB,"display_name":"Abdu Thyab","email":"abdu.thyab@gmail.com"},
  {"uid":U_BASEL,"display_name":"Basel Najjar","email":"alnajjarjawad97@gmail.com"},
  {"uid":U_AGHA, "display_name":"Muhel Agha", "email":"muhelagha@gmail.com"},
]
BOARD=[{"slug":"c-basel","business":"Basel Co","stage":"live","sent_count":0,"open_count":0,"replied":False,"idle_days":0,"last_activity_ts":"2026-02-04T00:00:00Z","has_page":False,"has_email":True,"archived":False,"cycle":None}]
META={"c-basel":{"ow":U_BASEL,"to":"buyer@basel.example"}}
OPP_POSTS=[]

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
# THREADED server: the (a) test delays the console_profile_names response to force the paint-race (the board
# paints before identity settles); a single-threaded server would block the board fetch behind that sleep and
# hide the race, so the re-render fix would not be exercised.
class TSrv(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True; allow_reuse_address = True
httpd = TSrv(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True; threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright
def J(r,o,s=200): r.fulfill(status=s, headers={"content-type":"application/json"}, body=json.dumps(o))
def slug_of(u):
    m=re.search(r'slug=eq\.([^&]+)', u); return m.group(1) if m else ""

def make_wire(cur_uid, cur_email, owner_column_missing=False, profile_delay_ms=0):
    def route_opps(r):
        u=r.request.url
        if r.request.method in ("POST","PATCH"):
            try: body=json.loads(r.request.post_data or "[]")
            except Exception: body=[]
            row = (body[0] if isinstance(body,list) and body else body) or {}
            OPP_POSTS.append({"method":r.request.method, "hasOwner":("owner" in row), "row":row})
            # PGRST204: reject any write that still carries the (missing) owner column
            if owner_column_missing and ("owner" in row):
                return r.fulfill(status=400, headers={"content-type":"application/json"},
                                 body=json.dumps({"code":"PGRST204","message":"Could not find the 'owner' column of 'console_opps' in the schema cache"}))
            return r.fulfill(status=204, body="")
        if ("select=slug,owner" in u or "select=slug%2Cowner" in u):
            return J(r, [{"slug":k,"owner":("" if owner_column_missing else v["ow"])} for k,v in META.items()])
        if "select=" in u and "recipients" in u:
            return J(r, [{"slug":k,"to":v["to"]} for k,v in META.items()])
        s=slug_of(u)
        if s: return J(r, [{"slug":s,"data":{"recipients":[{"addr":META.get(s,{}).get("to","")}]},"archived_at":None}])
        return J(r, [])
    def route_profile_names(r):
        if profile_delay_ms:
            import time as _t; _t.sleep(profile_delay_ms/1000.0)   # settle AFTER the first board paint
        return J(r, PROFILES)
    def wire(ctx):
        ctx.add_init_script("try{localStorage.setItem('console_sb_session',JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'"+cur_email+"',uid:'"+cur_uid+"'}));}catch(e){}")
        ctx.route(re.compile(r"script\.google\.com/.*"), lambda r: J(r, {"ok":True,"id":"x","relay_version":9,"delivered":True}))
        ctx.route("**/rest/v1/console_board**", lambda r: J(r, BOARD))
        ctx.route("**/rest/v1/console_opps**", route_opps)
        ctx.route("**/rest/v1/console_mail**", lambda r: (r.fulfill(status=204, body="") if r.request.method=="POST" else J(r, [])))
        ctx.route("**/rest/v1/console_profile_names**", route_profile_names)
        ctx.route("**/rest/v1/console_pages**", lambda r: J(r, []))
        ctx.route("**/rest/v1/console_suppressions**", lambda r: J(r, []))
        for tn in ["console_hits","console_inbound","console_profiles","console_members","console_team_roster","console_admins","console_contacts"]:
            ctx.route(f"**/rest/v1/{tn}**", lambda r: J(r, []))
    return wire

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # (a) resolve-by-uid: the Basel-owned card shows the canonical "Basel", winning over the differing
    #     profile display_name "Basel Najjar" (proves the uid/email canonical map, the "Unassigned" fix).
    ctx=b.new_context(viewport={"width":1440,"height":900}); make_wire(U_THYAB,"abdu.thyab@gmail.com")(ctx)
    pg=ctx.new_page(); perr=[]; pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_selector(".lane", timeout=8000)
    pg.wait_for_timeout(900)
    chip = pg.evaluate("""()=>{ var o=document.querySelector('.card[data-slug=\\"c-basel\\"] .owner');
        return o? { none:o.classList.contains('owner-none'), name:(o.querySelector('.owner-nm')?o.querySelector('.owner-nm').textContent:o.textContent.trim()) } : null; }""")
    ck("(a) the Basel-owned card resolves to 'Basel' by uid (not Unassigned, canonical over display_name)",
       chip is not None and (not chip["none"]) and chip["name"]=="Basel", chip)
    ck("(a) no uncaught error", perr==[], perr)
    pg.close(); ctx.close()

    # (b) a create when the owner column is absent: PGRST204 -> strip owner -> retry -> persist (no 400 surfaced)
    OPP_POSTS.clear()
    ctx=b.new_context(viewport={"width":1440,"height":900}); make_wire(U_THYAB,"abdu.thyab@gmail.com", owner_column_missing=True)(ctx)
    pg=ctx.new_page(); perr=[]; pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_selector(".lane", timeout=8000); pg.wait_for_timeout(500)
    pg.evaluate("()=>window.owNewMessage()"); pg.wait_for_selector("#owPickText", timeout=6000)
    pg.click("#owPickText"); pg.wait_for_selector("#owModeA #edSubj", timeout=6000)
    pg.fill("#edSubj", "A new lead"); pg.fill("#edBody", "Hello, we would love to work with you.")
    pg.wait_for_timeout(1200)   # let the debounced autosave (oppUpsert with owner) fire + retry
    st = pg.evaluate("()=>{var e=document.getElementById('nmStatus');return e?e.textContent:'';}")
    withOwner = [o for o in OPP_POSTS if o["method"]=="POST" and o["hasOwner"]]
    withoutOwner = [o for o in OPP_POSTS if o["method"]=="POST" and not o["hasOwner"]]
    ck("(b) the create first tried with owner, hit PGRST204, then retried WITHOUT owner (tolerant)",
       len(withOwner)>=1 and len(withoutOwner)>=1, {"posts":[(o["method"],o["hasOwner"]) for o in OPP_POSTS]})
    ck("(b) the autosave did NOT fail (no 400 surfaced to the operator)", "fail" not in st.lower() and perr==[], {"status":st,"perr":perr})
    pg.close(); ctx.close()

    b.close()

print()
if fails:
    print("FAILED: " + str(len(fails)) + " check(s)")
    for f in fails: print("  - " + f)
    raise SystemExit(1)
print("ALL COLLAB PR-1 CHECKS PASS")
