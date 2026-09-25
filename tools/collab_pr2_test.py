"""COLLAB PR-2: card members - assign/unassign UI + member colours + member chips on the card face
(board.html, fails-when-broken).

PR-2 reads/writes the live console_card_members (+ console_watchers) tables: a compact Members control in the
opp detail assigns/unassigns any of the three members; each member carries an identity colour (IDENTITY 4.6,
an accent DIMENSION, never the gradient, distinct from the lane hues); the card FACE shows the assignee set as
coloured member chips, falling back to the owner chip (or a clean unassigned state) when a card has no members.
No notification / activity write here (that is PR-3/PR-4) - PR-2 writes only the membership + watcher rows.

Asserts (each fails-when-broken):
  (a) adding a member POSTs console_card_members (added_by = currentUid) AND console_watchers (member=watcher);
      removing DELETEs both rows.
  (b) a card renders its member chip in the correct member colour (Basel -> terracotta --mem-basel), name Basel.
  (c) multiple members render without breaking card geometry (no horizontal overflow of the card face).
  (d) the member colour is a NEW dimension: member hues are distinct from every lane hue and every gradient
      stop, the member CSS uses --mem (not --grad), and the lane tokens are unchanged.
  (e) the unassigned state is clean (owner-none / "Unassigned") when a card has no members and no derivable owner.
  (f) Arabic: the interface mirrors (dir=rtl) and the member name / email stay LTR-isolated with joined spacing.
  (g) the send path is untouched: unifiedSend -> runSend still present and linked.
  (h) canon hygiene: no em dash, itfGhroob 0 refs, no dusty rose.
"""
import os, re, json, threading, http.server, socketserver, functools, urllib.parse
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

src = open(f"{ROOT}/library/board.html", encoding="utf-8").read()

# ---- static: canon hygiene (h) --------------------------------------------------------------------
ck("(h) no em dash in board.html", "—" not in src)
ck("(h) itfGhroob is fully removed (0 references)", "itfGhroob" not in src)
for lit in ["#C98B8B", "#9c5757", "#a85f5f"]:
    ck("(h) no dusty-rose literal: " + lit, lit not in src)

# ---- static: member colour is a distinct dimension, not the gradient, lanes unchanged (d) ---------
MEM = ["#E6B450", "#C96F4A", "#CE7BD1", "#8A5D0A", "#A8482A", "#9C3FA0"]
LANE = ["#71BFCC","#7F9FD4","#9685CA","#EE8C9D","#7EE0B8","#6b7280","#2e7480","#3e6bb7","#725bb8","#c0405a","#1d7752","#646a77"]
GRAD = ["#72BECE","#5D7FB7","#9685CA","#EE8C9D","#A78CA7","#71BFCC"]
clash = [h for h in MEM if h.lower() in [x.lower() for x in LANE] or h.lower() in [x.lower() for x in GRAD]]
ck("(d) member hues distinct from every lane hue and every gradient stop", clash == [], clash)
ck("(d) member colour tokens are declared", all(tok in src for tok in ["--mem-thyab","--mem-basel","--mem-agha"]))
ck("(d) the member chip uses the --mem accent, never the gradient (--grad)",
   re.search(r"\.member\b[^}]*--mem", src) is not None and re.search(r"\.member\b[^}]*--grad", src) is None)
ck("(d) the lane tokens are unchanged", "--lane-draft: #71BFCC" in src and "--lane-sent: #9685CA" in src)

# ---- static: the write layer + send path (a-scaffold, g) ------------------------------------------
ck("(a) memberAdd writes console_card_members with added_by=currentUid AND console_watchers",
   "console_card_members" in src and "console_watchers" in src and "added_by:currentUid()" in src)
ck("(a) memberRemove deletes both the membership and the watcher row",
   re.search(r"memberRemove[\s\S]{0,260}console_card_members[\s\S]{0,200}console_watchers", src) is not None)
ck("(g) the send path is untouched: unifiedSend -> runSend still present and linked",
   "function unifiedSend" in src and "runSend(slug)" in src and re.search(r"function unifiedSend[\s\S]{0,2400}runSend\(slug\)", src) is not None)
ck("(f-static) member name stays LTR with joined spacing in RTL",
   re.search(r'html\[dir="rtl"\][^{]*\.mem-nm[^}]*letter-spacing:normal', src) is not None)

# ---- browser harness ------------------------------------------------------------------------------
U_THYAB="u_thyab"; U_BASEL="u_basel"; U_AGHA="u_agha"
PROFILES=[
  {"uid":U_THYAB,"display_name":"Abdu Thyab","email":"abdu.thyab@gmail.com"},
  {"uid":U_BASEL,"display_name":"Basel Najjar","email":"alnajjarjawad97@gmail.com"},
  {"uid":U_AGHA, "display_name":"Muhel Agha", "email":"muhelagha@gmail.com"},
]
BOARD=[
  {"slug":"c-basel","business":"Basel Co","stage":"live","sent_count":0,"open_count":0,"replied":False,"idle_days":0,"last_activity_ts":"2026-02-04T00:00:00Z","has_page":False,"has_email":True,"archived":False,"cycle":None},
  {"slug":"c-multi","business":"Multi Co","stage":"live","sent_count":0,"open_count":0,"replied":False,"idle_days":0,"last_activity_ts":"2026-02-03T00:00:00Z","has_page":False,"has_email":True,"archived":False,"cycle":None},
  {"slug":"c-none","business":"None Co","stage":"live","sent_count":0,"open_count":0,"replied":False,"idle_days":0,"last_activity_ts":"2026-02-02T00:00:00Z","has_page":False,"has_email":True,"archived":False,"cycle":None},
]
EMAILS={"c-basel":"buyer@basel.example","c-multi":"team@multi.example","c-none":"lead@none.example"}
OWNERS={"c-basel":"","c-multi":"","c-none":""}          # no owner column value; members are the carrier here

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
class TSrv(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True; allow_reuse_address = True
httpd = TSrv(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True; threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright
def J(r,o,s=200): r.fulfill(status=s, headers={"content-type":"application/json"}, body=json.dumps(o))
def qparam(u, key):
    q=urllib.parse.urlparse(u).query; v=urllib.parse.parse_qs(q).get(key,[""])[0]
    return v[3:] if v.startswith("eq.") else v

def run_scenario(lang="en"):
    MEMBERS={"c-basel":[U_BASEL], "c-multi":[U_THYAB,U_BASEL,U_AGHA], "c-none":[]}
    WATCH={"c-basel":[U_BASEL], "c-multi":[U_THYAB,U_BASEL,U_AGHA], "c-none":[]}
    rec={"mpost":[],"mdel":[],"wpost":[],"wdel":[]}
    def route_opps(r):
        u=r.request.url
        if "select=slug,owner" in u or "select=slug%2Cowner" in u:
            return J(r, [{"slug":k,"owner":OWNERS[k]} for k in OWNERS])
        if "recipients" in u:
            return J(r, [{"slug":k,"to":EMAILS[k]} for k in EMAILS])
        m=re.search(r'slug=eq\.([^&]+)', u); s=m.group(1) if m else ""
        if s: return J(r, [{"slug":s,"data":{"recipients":[{"addr":EMAILS.get(s,"")}]},"archived_at":None}])
        return J(r, [])
    def route_members(r):
        u=r.request.url; meth=r.request.method
        if meth=="POST":
            body=json.loads(r.request.post_data or "[]"); row=(body[0] if isinstance(body,list) and body else body) or {}
            rec["mpost"].append(row)
            MEMBERS.setdefault(row.get("opp"),[])
            if row.get("member") not in MEMBERS[row["opp"]]: MEMBERS[row["opp"]].append(row.get("member"))
            return r.fulfill(status=204, body="")
        if meth=="DELETE":
            opp=qparam(u,"opp"); mem=qparam(u,"member"); rec["mdel"].append({"opp":opp,"member":mem})
            if opp in MEMBERS and mem in MEMBERS[opp]: MEMBERS[opp].remove(mem)
            return r.fulfill(status=204, body="")
        opp=qparam(u,"opp")
        if opp: return J(r, [{"member":x} for x in MEMBERS.get(opp,[])])
        out=[]
        for o,arr in MEMBERS.items():
            for x in arr: out.append({"opp":o,"member":x})
        return J(r, out)
    def route_watch(r):
        u=r.request.url; meth=r.request.method
        if meth=="POST":
            body=json.loads(r.request.post_data or "[]"); row=(body[0] if isinstance(body,list) and body else body) or {}
            rec["wpost"].append(row); return r.fulfill(status=204, body="")
        if meth=="DELETE":
            rec["wdel"].append({"opp":qparam(u,"opp"),"watcher":qparam(u,"watcher")}); return r.fulfill(status=204, body="")
        return J(r, [])
    def wire(ctx):
        ctx.add_init_script("try{localStorage.setItem('console_sb_session',JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'abdu.thyab@gmail.com',uid:'"+U_THYAB+"'}));localStorage.setItem('thrive_lang','"+lang+"');}catch(e){}")
        ctx.route(re.compile(r"script\.google\.com/.*"), lambda r: J(r, {"ok":True,"id":"x","relay_version":9,"delivered":True}))
        ctx.route("**/rest/v1/console_board**", lambda r: J(r, BOARD))
        ctx.route("**/rest/v1/console_opps**", route_opps)
        ctx.route("**/rest/v1/console_card_members**", route_members)
        ctx.route("**/rest/v1/console_watchers**", route_watch)
        ctx.route("**/rest/v1/console_mail**", lambda r: (r.fulfill(status=204, body="") if r.request.method=="POST" else J(r, [])))
        ctx.route("**/rest/v1/console_profile_names**", lambda r: J(r, PROFILES))
        ctx.route("**/rest/v1/console_pages**", lambda r: J(r, []))
        ctx.route("**/rest/v1/console_suppressions**", lambda r: J(r, []))
        for tn in ["console_hits","console_inbound","console_profiles","console_members","console_team_roster","console_admins","console_contacts"]:
            ctx.route(f"**/rest/v1/{tn}**", lambda r: J(r, []))
    return MEMBERS, WATCH, rec, wire

def open_detail(pg, slug):
    pg.click(f'.card[data-slug="{slug}"]'); pg.wait_for_selector("#owTabs", timeout=6000)
    pg.click('#owTabs [data-cr-gate="activity"]'); pg.wait_for_selector("#owDetail .mem-sec", timeout=6000)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # ---- (b),(c),(e): the card FACE, English --------------------------------------------------------
    MEMBERS,WATCH,rec,wire = run_scenario("en")
    ctx=b.new_context(viewport={"width":1440,"height":900}); wire(ctx)
    pg=ctx.new_page(); perr=[]; pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_selector(".lane", timeout=8000); pg.wait_for_timeout(900)

    basel = pg.evaluate("""()=>{ var c=document.querySelector('.card[data-slug=\\"c-basel\\"] .member.mem-basel');
        if(!c) return null; var dot=c.querySelector('.mem-dot'); var nm=c.querySelector('.mem-nm');
        return { name:nm?nm.textContent:'', dir:nm?nm.getAttribute('dir'):'', dotbg:dot?getComputedStyle(dot).backgroundColor:'' }; }""")
    ck("(b) the Basel-owned card shows a terracotta member chip named Basel",
       basel is not None and basel["name"]=="Basel" and basel["dir"]=="ltr", basel)
    ck("(b) the member dot carries the --mem-basel colour (#C96F4A = rgb(201,111,74))",
       basel is not None and basel["dotbg"].replace(" ","")=="rgb(201,111,74)", basel)

    multi = pg.evaluate("""()=>{ var card=document.querySelector('.card[data-slug=\\"c-multi\\"]');
        if(!card) return null; var chips=card.querySelectorAll('.members .member');
        var foot=card.querySelector('.card-foot');
        return { n:chips.length, overflow:(card.scrollWidth - card.clientWidth), footOverflow:(foot.scrollWidth - foot.clientWidth) }; }""")
    ck("(c) a card with three members renders three member chips", multi is not None and multi["n"]==3, multi)
    ck("(c) multiple members do not break card geometry (no horizontal overflow)",
       multi is not None and multi["overflow"]<=1 and multi["footOverflow"]<=1, multi)

    none = pg.evaluate("""()=>{ var c=document.querySelector('.card[data-slug=\\"c-none\\"]');
        if(!c) return null; var mem=c.querySelector('.members .member'); var none=c.querySelector('.owner.owner-none');
        return { hasMember:!!mem, unassigned:!!none, txt:none?none.textContent.trim():'' }; }""")
    ck("(e) a card with no members and no owner shows a clean unassigned state (owner-none)",
       none is not None and (not none["hasMember"]) and none["unassigned"], none)
    ck("(b/c/e) no uncaught error on the board", perr==[], perr)

    # ---- (a): add then remove a member, asserting BOTH tables written -------------------------------
    open_detail(pg, "c-none")
    pg.wait_for_timeout(300)
    pg.click('#owDetail [data-mem-add="%s"]' % U_AGHA)
    pg.wait_for_selector('#owDetail .member[data-mem-uid="%s"] [data-mem-rm="%s"]' % (U_AGHA, U_AGHA), timeout=6000)
    mp=[x for x in rec["mpost"] if x.get("member")==U_AGHA and x.get("opp")=="c-none"]
    wp=[x for x in rec["wpost"] if x.get("watcher")==U_AGHA and x.get("opp")=="c-none"]
    ck("(a) adding Agha POSTs console_card_members with added_by = currentUid (Thyab)",
       len(mp)>=1 and mp[0].get("added_by")==U_THYAB, {"mpost":rec["mpost"]})
    ck("(a) adding Agha also POSTs console_watchers (member = watcher)", len(wp)>=1, {"wpost":rec["wpost"]})
    pg.click('#owDetail .member[data-mem-uid="%s"] [data-mem-rm="%s"]' % (U_AGHA, U_AGHA))
    pg.wait_for_timeout(700)
    md=[x for x in rec["mdel"] if x.get("member")==U_AGHA and x.get("opp")=="c-none"]
    wd=[x for x in rec["wdel"] if x.get("watcher")==U_AGHA and x.get("opp")=="c-none"]
    ck("(a) removing Agha DELETEs console_card_members AND console_watchers",
       len(md)>=1 and len(wd)>=1, {"mdel":rec["mdel"],"wdel":rec["wdel"]})
    ck("(a) no uncaught error across add/remove", perr==[], perr)
    pg.close(); ctx.close()

    # ---- (f): Arabic - mirrored, member name + email LTR-isolated ----------------------------------
    MEMBERS,WATCH,rec,wire = run_scenario("ar")
    ctx=b.new_context(viewport={"width":390,"height":800}); wire(ctx)
    pg=ctx.new_page(); perr=[]; pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_selector(".lane", timeout=8000); pg.wait_for_timeout(900)
    ar = pg.evaluate("""()=>{ var dir=document.documentElement.getAttribute('dir');
        var c=document.querySelector('.card[data-slug=\\"c-basel\\"]');
        var nm=c?c.querySelector('.members .member .mem-nm'):null;
        var to=c?c.querySelector('.card-to'):null;
        return { dir:dir, nm:nm?nm.textContent:'', nmdir:nm?nm.getAttribute('dir'):'', ls:nm?getComputedStyle(nm).letterSpacing:'', todir:to?to.getAttribute('dir'):'' }; }""")
    ck("(f) the interface mirrors to RTL in Arabic", ar is not None and ar["dir"]=="rtl", ar)
    ck("(f) the member name stays LTR-isolated with joined (normal) spacing",
       ar is not None and ar["nmdir"]=="ltr" and ar["ls"] in ("normal","0px"), ar)
    ck("(f) the recipient email stays LTR-isolated", ar is not None and ar["todir"]=="ltr", ar)
    open_detail(pg, "c-basel")
    memh = pg.evaluate("""()=>{ var h=document.querySelector('#owDetail .mem-sec h3'); return h?h.textContent:''; }""")
    ck("(f) the Members control is localized in Arabic", memh=="الأعضاء", repr(memh))
    ck("(f) no uncaught error in Arabic", perr==[], perr)
    pg.close(); ctx.close()

    b.close()

print()
if fails:
    print("FAILED: " + str(len(fails)) + " check(s)")
    for f in fails: print("  - " + f)
    raise SystemExit(1)
print("ALL COLLAB PR-2 CHECKS PASS")
