"""CARD RECIPIENT EMAIL + OWNER TAG on every board card (board.html, fails-when-broken).

Each opportunity card shows, from the OUTSIDE, its recipient email and a neutral owner chip (Thyab / Agha /
Basel, or a clean unassigned state). Owner lives in console_opps.data.owner (stamped at creation), with a
client-derived fallback from the earliest console_mail.actor for older cards; names resolve through the existing
console_profile_names / resolveActor map, with the two known emails pinned to canonical short names.

Asserts (each fails-when-broken):
  (a) EVERY card in EVERY lane renders its recipient email on the face, LTR-isolated (unicode-bidi:isolate),
      truncating, without breaking the card geometry (never wider than its lane).
  (b) EVERY card shows an owner chip resolving to Thyab / Basel / Agha, or a clean "Unassigned" - never a wrong
      owner (a canonical email pins the two known members; a third resolves via its profile display_name; an
      unknown/absent owner is unassigned, and a derived earliest-sender fills an older card).
  (c) a newly created opp stamps data.owner = the current signed-in member (observed in the console_opps write).
  (d) the owner chip is NEUTRAL - no gradient (the gradient stays reserved for the one primary action); the lane
      color is still the semantic carrier (the lane keeps its data-lane hue).
  (e) Arabic is mirrored (dir=rtl) and joined (Alyamama, letter-spacing:normal); the email stays LTR-isolated.
  (f) canon: no em dash, itfGhroob 0 refs, no dusty rose.
  (g) the send path still wires unifiedSend -> runSend.
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

# ---- static guards --------------------------------------------------------------------------------
src = open(f"{ROOT}/library/board.html", encoding="utf-8").read()
ck("(g) the send path still wires unifiedSend -> runSend", bool(re.search(r"function unifiedSend\(slug\)\{.*?runSend\(", src, re.S)))
ck("(a) the recipient email is LTR-isolated on the card face (.card-to unicode-bidi:isolate)",
   re.search(r"\.card-to\{[^}]*unicode-bidi:isolate", src) is not None)
ck("(d) the owner chip is token-neutral, NOT the gradient", re.search(r"\.owner\{[^}]*background:var\(--surface-sunken\)", src) is not None
   and re.search(r"\.owner\{[^}]*(gradient|--grad)", src) is None)
ck("(f) no em dash anywhere", "—" not in src)
ck("(f) itfGhroob is fully removed (0 references)", "itfGhroob" not in src)
for lit in ["#C98B8B", "#9c5757", "#a85f5f"]:
    ck("(f) no dusty-rose literal: " + lit, lit not in src)

# ---- browser harness ------------------------------------------------------------------------------
U_THYAB="u_thyab"; U_BASEL="u_basel"; U_AGHA="u_agha"
PROFILES=[
  {"uid":U_THYAB,"display_name":"Abdu Thyab","email":"abdu.thyab@gmail.com"},
  {"uid":U_BASEL,"display_name":"Basel Najjar","email":"alnajjarjawad97@gmail.com"},
  {"uid":U_AGHA, "display_name":"Muhel Agha","email":"muhelagha@gmail.com"},   # canonical map pins this email -> "Agha"
]
# board cards across every lane
BOARD=[
 {"slug":"c-draft","business":"Draft Co","stage":"draft","sent_count":0,"open_count":0,"replied":False,"idle_days":0,"last_activity_ts":"2026-02-05T00:00:00Z","has_page":False,"has_email":True,"archived":False,"cycle":None},
 {"slug":"c-live","business":"Live Co","stage":"live","sent_count":0,"open_count":0,"replied":False,"idle_days":0,"last_activity_ts":"2026-02-04T00:00:00Z","has_page":True,"has_email":True,"archived":False,"cycle":None},
 {"slug":"c-sent","business":"Sent Co","stage":"sent","sent_count":1,"open_count":0,"replied":False,"idle_days":2,"last_activity_ts":"2026-02-03T00:00:00Z","has_page":False,"has_email":True,"archived":False,"cycle":None},
 {"slug":"c-opened","business":"Opened Co","stage":"opened","sent_count":1,"open_count":1,"replied":False,"idle_days":0,"last_activity_ts":"2026-02-02T00:00:00Z","has_page":False,"has_email":True,"archived":False,"cycle":None},
 {"slug":"c-repl","business":"Replied Co","stage":"replied","sent_count":1,"open_count":1,"replied":True,"idle_days":0,"last_activity_ts":"2026-02-01T00:00:00Z","has_page":False,"has_email":True,"archived":False,"cycle":None},
]
# console_opps meta (owner COLUMN + first recipient email). c-opened has NO owner (derived from mail);
# c-repl has neither owner nor mail -> unassigned.
META={
 "c-draft":{"ow":U_THYAB,"to":"draftbuyer@shop.example"},
 "c-live": {"ow":U_BASEL,"to":"livebuyer@shop.example"},
 "c-sent": {"ow":U_AGHA, "to":"sentbuyer@a-very-long-domain-name-that-should-truncate.example"},
 "c-opened":{"ow":"",     "to":"openedbuyer@shop.example"},
 "c-repl": {"ow":"",      "to":"repliedbuyer@shop.example"},
}
MAIL=[{"opp":"c-opened","actor":U_BASEL,"ts":"2026-01-10T00:00:00Z"}]   # derived owner for c-opened
EXPECT_OWNER={"c-draft":"Thyab","c-live":"Basel","c-sent":"Agha","c-opened":"Basel","c-repl":"Unassigned"}

OPP_POSTS=[]
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True; threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright
def J(r,o): r.fulfill(status=200, headers={"content-type":"application/json"}, body=json.dumps(o))
def slug_of(u):
    m=re.search(r'slug=eq\.([^&]+)', u); return m.group(1) if m else ""

def make_wire(cur_uid, cur_email, ar=False):
    def route_opps(r):
        u=r.request.url
        if r.request.method in ("POST","PATCH"):
            try: body=json.loads(r.request.post_data or "[]")
            except Exception: body=[]
            for row in (body if isinstance(body,list) else [body]):
                if isinstance(row,dict): OPP_POSTS.append({"method":r.request.method,"owner":row.get("owner"),"data":row.get("data")})
            return r.fulfill(status=204, body="")
        # the OWNER column select (select=slug,owner)
        if ("select=slug,owner" in u or "select=slug%2Cowner" in u):
            return J(r, [{"slug":k,"owner":v["ow"]} for k,v in META.items()])
        # the recipient-email select (data->recipients->0->>addr)
        if "select=" in u and "recipients" in u:
            return J(r, [{"slug":k,"to":v["to"]} for k,v in META.items()])
        # oppReadData(slug): the opp's data jsonb (owner is a column now, not in data)
        s=slug_of(u)
        if s:
            v=META.get(s,{})
            return J(r, [{"slug":s,"data":{"recipients":[{"addr":v.get("to","")}]},"archived_at":None}])
        return J(r, [])
    def route_mail(r):
        u=r.request.url
        if r.request.method=="POST": return r.fulfill(status=204, body="")
        if "select=opp,actor" in u or "select=opp%2Cactor" in u: return J(r, MAIL)
        return J(r, [])
    def wire(ctx):
        js="try{localStorage.setItem('console_sb_session',JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'"+cur_email+"',uid:'"+cur_uid+"'}));"
        if ar: js+="localStorage.setItem('thrive_lang','ar');"
        js+="}catch(e){}"
        ctx.add_init_script(js)
        ctx.route(re.compile(r"script\.google\.com/.*"), lambda r: J(r, {"ok":True,"id":"x","relay_version":9,"delivered":True}))
        ctx.route("**/rest/v1/console_board**", lambda r: J(r, BOARD))
        ctx.route("**/rest/v1/console_opps**", route_opps)
        ctx.route("**/rest/v1/console_mail**", route_mail)
        ctx.route("**/rest/v1/console_profile_names**", lambda r: J(r, PROFILES))
        ctx.route("**/rest/v1/console_pages**", lambda r: J(r, []))
        ctx.route("**/rest/v1/console_suppressions**", lambda r: J(r, []))
        for tn in ["console_hits","console_inbound","console_profiles","console_members","console_team_roster","console_admins","console_contacts"]:
            ctx.route(f"**/rest/v1/{tn}**", lambda r: J(r, []))
    return wire

def read_cards(pg):
    return pg.evaluate("""()=>{
      var out={}; var lanes={};
      document.querySelectorAll('.card[data-slug]').forEach(function(c){
        var slug=c.getAttribute('data-slug');
        var to=c.querySelector('.card-to');
        var own=c.querySelector('.owner');
        var cs=own?getComputedStyle(own):null;
        var lane=c.closest('.lane'); var laneW=lane?lane.getBoundingClientRect().width:0;
        var cr=c.getBoundingClientRect();
        out[slug]={
          email: to?to.textContent:null,
          emailBidi: to?getComputedStyle(to).unicodeBidi:'',
          emailDir: to?(to.getAttribute('dir')||''):'',
          owner: own?(own.querySelector('.owner-nm')?own.querySelector('.owner-nm').textContent:own.textContent.trim()):null,
          ownerBg: cs?(cs.backgroundImage+' | '+cs.backgroundColor):'',
          ownerNone: own?own.classList.contains('owner-none'):false,
          overflow: cr.width - laneW - 1,   // >0 means the card is wider than its lane (broken geometry)
        };
      });
      return out; }""")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # ============ EN, desktop ============
    ctx=b.new_context(viewport={"width":1440,"height":900}); make_wire(U_THYAB,"abdu.thyab@gmail.com")(ctx)
    pg=ctx.new_page(); perr=[]; pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_selector(".lane", timeout=8000); pg.wait_for_timeout(700)
    cards=read_cards(pg)
    ck("(a) every lane's card is present (5 cards across the lanes)", len(cards)==5, list(cards.keys()))
    # (a) email on every card face, LTR-isolated, geometry intact
    miss_email=[s for s,c in cards.items() if not (c["email"] and META[s]["to"] in c["email"])]
    ck("(a) every card shows its recipient email on the face, all lanes", miss_email==[], {s:cards[s]["email"] for s in miss_email})
    bad_iso=[s for s,c in cards.items() if "isolate" not in (c["emailBidi"] or "") or c["emailDir"]!="ltr"]
    ck("(a) the email is LTR-isolated on every card (dir=ltr + unicode-bidi:isolate)", bad_iso==[], {s:cards[s] for s in bad_iso})
    over=[s for s,c in cards.items() if c["overflow"]>0]
    ck("(a) no card is wider than its lane (geometry intact, even a long email)", over==[], {s:cards[s]["overflow"] for s in over})
    # (b) owner chip resolves correctly, never wrong
    wrong={s:(cards[s]["owner"]) for s in cards if (cards[s]["owner"] or "").strip()!=EXPECT_OWNER[s]}
    ck("(b) every card's owner chip resolves to Thyab/Basel/Agha or a clean Unassigned (never wrong)", wrong=={}, {"got":{s:cards[s]["owner"] for s in cards},"want":EXPECT_OWNER})
    ck("(b) the unassigned card carries the owner-none state (not a fabricated owner)", cards["c-repl"]["ownerNone"] is True, cards["c-repl"])
    # (d) owner chip neutral (no gradient); lane color still semantic
    grad=[s for s,c in cards.items() if "gradient" in (c["ownerBg"] or "").lower()]
    ck("(d) the owner chip is neutral - no gradient on any chip", grad==[], {s:cards[s]["ownerBg"] for s in grad})
    lanehue=pg.evaluate("""()=>{var l=document.querySelector('.lane[data-lane=\\"replied\\"]');return l?getComputedStyle(l).getPropertyValue('--lane').trim()||!!l:false;}""")
    ck("(d) the lane still carries its semantic identity (data-lane present)", bool(lanehue), lanehue)
    ck("(g) no uncaught error (EN)", perr==[], perr)

    # (c) a newly created opp stamps data.owner = current member
    OPP_POSTS.clear()
    pg.evaluate("()=>window.owNewMessage()"); pg.wait_for_selector("#owPickText", timeout=6000)
    pg.click("#owPickText"); pg.wait_for_selector("#owModeA #edSubj", timeout=6000)
    pg.fill("#edSubj","A new partnership"); pg.fill("#edBody","Hello, we would love to work with you.")
    pg.fill("#recIn","newbuyer@shop.example"); pg.wait_for_timeout(200)
    pg.evaluate("()=>{var b=document.getElementById('recSave'); if(b) b.click();}"); pg.wait_for_timeout(300)
    pg.evaluate("()=>{var b=document.getElementById('nmSend'); if(b) b.click();}"); pg.wait_for_timeout(1200)
    # the owner stamp lives on the CREATE (oppUpsert POST) as the top-level owner COLUMN; saveRecipients is a
    # PATCH that only merges recipients, so the assertion checks the POST writes' owner column.
    owners=[ row.get("owner") for row in OPP_POSTS if row.get("method")=="POST" ]
    ck("(c) a newly created opp is stamped with the current member as the owner column (owner = current uid)",
       len(owners)>=1 and all(o==U_THYAB for o in owners) and U_THYAB in owners, {"owners":owners,"posts":len(OPP_POSTS)})
    pg.close(); ctx.close()

    # ============ AR, mirrored ============
    actx=b.new_context(viewport={"width":1440,"height":900}); make_wire(U_THYAB,"abdu.thyab@gmail.com", ar=True)(actx)
    apg=actx.new_page(); aperr=[]; apg.on("pageerror", lambda e: aperr.append(str(e)))
    apg.goto(f"{base}/library/board.html", wait_until="load"); apg.wait_for_selector(".lane", timeout=8000); apg.wait_for_timeout(700)
    ar=apg.evaluate("""()=>{
      var to=document.querySelector('.card-to'); var own=document.querySelector('.owner-nm');
      return { dir:document.documentElement.getAttribute('dir'),
               emailBidi: to?getComputedStyle(to).unicodeBidi:'', emailDir: to?(to.getAttribute('dir')||''):'',
               ownerLS: own?getComputedStyle(own).letterSpacing:'', ownerTT: own?getComputedStyle(own).textTransform:'',
               font: getComputedStyle(document.body).fontFamily }; }""")
    ck("(e) Arabic is mirrored (dir=rtl)", ar["dir"]=="rtl", ar)
    ck("(e) the email stays LTR-isolated in AR", "isolate" in (ar["emailBidi"] or "") and ar["emailDir"]=="ltr", ar)
    ck("(e) the owner name carries letter-spacing:normal and no uppercase in AR", ar["ownerLS"] in ("normal","0px") and ar["ownerTT"]=="none", ar)
    ck("(e) the Alyamama family is bound in AR", "Alyamama" in (ar["font"] or ""), ar)
    acards=read_cards(apg)
    # the resolved member names (Thyab/Basel/Agha) are Latin and language-invariant; only the unassigned label
    # localizes, so check the named cards against the Latin names and the unassigned card via its owner-none state.
    named={"c-draft":"Thyab","c-live":"Basel","c-sent":"Agha","c-opened":"Basel"}
    awrong={s:acards[s]["owner"] for s in named if (acards[s]["owner"] or "").strip()!=named[s]}
    ck("(e/b) owner chips resolve to the same Latin names under AR (never wrong)", awrong=={}, awrong)
    ck("(e/b) the unassigned card stays a clean owner-none state under AR", acards["c-repl"]["ownerNone"] is True, acards["c-repl"])
    ck("(g) no uncaught error (AR)", aperr==[], aperr)
    apg.close(); actx.close()

    b.close()

print()
if fails:
    print("FAILED: " + str(len(fails)) + " check(s)")
    for f in fails: print("  - " + f)
    raise SystemExit(1)
print("ALL CARD-EMAIL + OWNER CHECKS PASS")
