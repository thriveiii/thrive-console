"""BOARD_DETAIL (Layer 3, browser, fails-when-broken).

Tapping a board card opens a READ-ONLY opportunity detail drawer, cloned from the engine card modal: name +
stage, the three numbers with their sources, presence/idle, the reply CONVERSATION thread (the heart), the
opportunity record, and the activity/history log. Close returns to the board with no reload. Locks:

  1. Tap a replied opp -> drawer with the reply thread: reply #1 + the reply ADDRESS (read live), and the
     Thrive->prospect outbound send. The drawer's reply count == the card N-badge (the SAME resolver, §3).
  2. Tap a Sent opp -> empty reply thread (0 inbound bubbles, count 0), no fabricated replies.
  3. The three numbers show with their sources (console_mail / console_hits / console_inbound).
  4. Record shows the opportunity's carried notes + the honest "no accrued memory store" disclosure.
  5. Activity log lists sends + opens + replies in order + the "stage moves/archiving are written to Supabase" disclosure.
  6. Close (button / Escape / backdrop) returns to the board WITHOUT reload; the board stays mounted.
  7. AR flips the drawer to RTL with Arabic labels; the reply address stays LTR-isolated.

PRIVACY INVARIANT: every prospect address in this fixture is a synthetic *.example.test placeholder. No real
prospect address, name, or reply content appears anywhere in the repo.
"""
import os, json, re, threading, http.server, socketserver, functools
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

board = open(os.path.join(ROOT, "library/board.html")).read()

# ---- source guards -------------------------------------------------------------------------------
ck("the drawer reply thread reads the ONE resolver (__reps.list[slug]), same as the card badge",
   "__reps.list && __reps.list[slug]" in board and "function threadHtml" in board)
ck("detail reads are best-effort and scoped to one opp (console_opps/mail/hits), never blocking the board",
   "console_opps?slug=eq." in board and "console_mail?opp=eq." in board and "console_hits?slug=eq." in board
   and "if(!res.ok) return [];" in board)
ck("no server memory store is claimed; the record disclosure is present",
   "No accrued profile store" in board and "d_no_memory" in board)
ck("stage moves disclosed as written to Supabase and re-read from the board view (L4)",
   "written to Supabase and re-read from the board view" in board
   and "Stage moves are recorded on the device and are not in Supabase" not in board)
# The board.html write surface is fenced: the ONLY data-write VERB is PATCH/POST, no PUT, no DELETE. PATCH
# targets ONLY console_opps (L4 stage / archived / note) or console_profiles (Step 2C admin title). POSTs are
# limited to known kinds: the GoTrue auth call (/auth/v1/), the L5 relay send (relayEp - the courier that
# reaches Resend server-side), the L5 console_mail confirm write, the Step 2B own-row console_profiles upsert
# (the operator's own display_name only), the E1 New Message lightweight-opp upsert to console_opps (the
# standalone-draft create-or-update, same table the drawer's PATCH targets), and the E2 campaign-upload writes:
# a console_opps draft upsert and a console_pages upsert (the uploaded page html). No other table is written.
# Per-scenario behavior is covered by board_write_test.py, board_send_test.py, board_profile_test.py,
# board_newmsg_test.py, and board_upload_test.py; here we just fence the surface statically.
_posts = [m.start() for m in re.finditer(r'method:"POST"', board)]
_patches = [m.start() for m in re.finditer(r'method:"PATCH"', board)]
def _post_ok(i):
    ctx = board[max(0,i-320):i+60]
    return ("auth/v1" in ctx) or ("console_mail" in ctx) or ("relayEp(" in ctx) or ("console_profiles" in ctx) or ("console_opps" in ctx) or ("console_pages" in ctx)
def _patch_ok(i):
    ctx = board[max(0,i-260):i+40]
    # L4 opp writes hit console_opps by slug; the Step 2C admin title write hits console_profiles by uid.
    return ("console_opps?slug=eq." in ctx) or ("console_profiles?uid=eq." in ctx)
ck("no PUT/DELETE; every PATCH targets console_opps (by slug) or console_profiles (by uid, admin title); every POST is auth, relay send, console_mail, or an own-row console_profiles upsert",
   all(v not in board for v in ['method:"PUT"','method:"DELETE"'])
   and len(_patches) >= 1 and all(_patch_ok(i) for i in _patches)
   and len(_posts) >= 1 and all(_post_ok(i) for i in _posts))

# ---- data (ALL addresses synthetic *.example.test) -----------------------------------------------
ROWS = [
  {"slug":"epsi","business":"Epsilon","stage":"replied","sent_count":2,"open_count":3,"replied":True,"idle_days":0,"has_page":True,"has_email":True,"archived":False,"last_activity_ts":"2026-01-04T00:00:00Z"},
  {"slug":"gamm","business":"Gamma Inc","stage":"sent","sent_count":1,"open_count":0,"replied":False,"idle_days":3,"has_page":True,"has_email":True,"archived":False,"last_activity_ts":"2026-01-01T00:00:00Z"},
]
INBOUND = [
  {"opp":"epsi","kind":"human","bounce":None,"ts":"2026-01-03T10:00:00Z","data":{"from":"reply1@example.test","subject":"Re: Intro","snippet":"Sounds good, tell me more."}},
  {"opp":"epsi","kind":"human","bounce":None,"ts":"2026-01-04T10:00:00Z","data":{"from":"reply2@example.test","subject":"Re: Intro","snippet":"Happy to talk."}},
]
OPPS = {"epsi":{"slug":"epsi","data":{"prohibition":"synthetic hold"}}, "gamm":{"slug":"gamm","data":{}}}
MAIL = {"epsi":[{"id":"m1","opp":"epsi","ts":"2026-01-01T09:00:00Z","data":{"subject":"Intro"}}], "gamm":[]}
HITS = {"epsi":[{"id":"h1","slug":"epsi","ts":"2026-01-02T08:00:00Z","data":{}}], "gamm":[]}

def slug_of(url):
    m = re.search(r'eq\.([^&]+)', url)
    return m.group(1) if m else ""

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
handler = functools.partial(Handler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

def J(route, obj):
    route.fulfill(status=200, headers={"content-type":"application/json"}, body=json.dumps(obj))

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context()
    ctx.add_init_script("try{localStorage.setItem('console_sb_session', JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'op@thrive.test',uid:'u'}));}catch(e){}")
    ctx.route("**/rest/v1/console_board**", lambda r: J(r, ROWS))
    ctx.route("**/rest/v1/console_inbound**", lambda r: J(r, INBOUND))
    ctx.route("**/rest/v1/console_opps**", lambda r: J(r, [OPPS.get(slug_of(r.request.url), {"data":{}})]))
    ctx.route("**/rest/v1/console_mail**", lambda r: J(r, MAIL.get(slug_of(r.request.url), [])))
    ctx.route("**/rest/v1/console_hits**", lambda r: J(r, HITS.get(slug_of(r.request.url), [])))
    pg = ctx.new_page()
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(700)

    # card badge for epsi (the resolver count on the board)
    epsiBadge = pg.evaluate("""()=>{var out='';document.querySelectorAll('.card').forEach(function(c){if(/Epsilon/.test(c.textContent)){var n=c.querySelector('.nbadge');out=n?n.textContent.trim():'';}});return out;}""")
    ck("board: the Epsilon card shows its reply N-badge (2)", epsiBadge=="2", epsiBadge)

    # ---- tap the replied opp -> drawer ----
    pg.evaluate("""()=>{var t=null;document.querySelectorAll('.card').forEach(function(c){if(/Epsilon/.test(c.textContent))t=c;});t&&t.click();}""")
    pg.wait_for_timeout(600)  # > detail fetch
    d = pg.evaluate("""()=>{
      var dw=document.getElementById('drawer'); var scrim=document.getElementById('scrim');
      var inb=dw.querySelectorAll('.msg.in');
      return {
        open: !scrim.hidden,
        threadN:(dw.querySelector('[data-threadn]')||{}).textContent||'',
        firstNum: inb.length?(inb[0].querySelector('.mnum')||{}).textContent||'':'',
        firstAddr: inb.length?(inb[0].querySelector('.maddr')||{}).textContent||'':'',
        inCount: inb.length,
        addrDir: inb.length?getComputedStyle(inb[0].querySelector('.maddr')).direction:'',
        hasOut: !!dw.querySelector('.msg.out'),
        outWho: (dw.querySelector('.msg.out .mwho')||{}).textContent||'',
        nums:[].map.call(dw.querySelectorAll('.dw-num .k'),function(x){return x.textContent;}),
        srcs:(function(){var s='';dw.querySelectorAll('.dw-num .src').forEach(function(x){s+=x.textContent+' ';});return s;})(),
        record: dw.textContent.indexOf('synthetic hold')>=0,
        noMemory: dw.textContent.indexOf('No accrued profile store')>=0,
        logText: (dw.querySelector('.dw-sec:last-child')||{}).textContent||'',
        stageDisclosed: dw.textContent.indexOf('written to Supabase and re-read from the board view')>=0,
        bodyText: dw.textContent
      };
    }""")
    ck("1: tapping the replied card opens the drawer", d["open"], d)
    ck("1: the drawer reply count equals the card N-badge (SAME resolver, §3)", d["threadN"]=="2" and d["threadN"]==epsiBadge, d)
    ck("1: the reply thread shows reply #1 with its live address", d["firstNum"]=="#1" and ("reply1@example.test" in d["firstAddr"]), d)
    ck("1: two inbound reply bubbles render (numbered, from the resolver)", d["inCount"]==2, d)
    ck("1: the reply address is LTR-isolated even though it is user-provided", d["addrDir"]=="ltr", d)
    ck("2: the Thrive->prospect outbound send shows (console_mail)", d["hasOut"] and ("Thrive" in d["outWho"]), d)
    ck("3: the three numbers show their values (sent 2, opens 3, replies 2)", d["nums"]==["2","3","2"], d["nums"])
    ck("3: each number names its source", "console_mail" in d["srcs"] and "console_hits" in d["srcs"] and "console_inbound" in d["srcs"], d["srcs"])
    ck("4: the record shows the carried note AND the no-memory-store disclosure", d["record"] and d["noMemory"], d)
    ck("5: the activity log discloses stage moves/archiving are written to Supabase (L4)", d["stageDisclosed"], d)
    ck("5: the activity log lists a Sent, an Opened and a Reply event", ("Sent" in d["logText"]) and ("Opened" in d["logText"]) and ("Reply" in d["logText"]), d["logText"])

    # ---- close returns to the board without reload ----
    pg.evaluate("()=>{window.__alive='YES';}")
    pg.evaluate("()=>document.getElementById('dwClose').click()")
    pg.wait_for_timeout(150)
    closed = pg.evaluate("""()=>({ hidden:document.getElementById('scrim').hidden, board:!!document.querySelector('.lane'), alive:window.__alive||'' })""")
    ck("6: Close hides the drawer and the board is still mounted (no reload)", closed["hidden"] and closed["board"] and closed["alive"]=="YES", closed)

    # reopen + Escape
    pg.evaluate("""()=>{var t=null;document.querySelectorAll('.card').forEach(function(c){if(/Epsilon/.test(c.textContent))t=c;});t&&t.click();}""")
    pg.wait_for_timeout(200)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(120)
    ck("6: Escape closes the drawer", pg.evaluate("()=>document.getElementById('scrim').hidden"))

    # reopen + backdrop click
    pg.evaluate("""()=>{var t=null;document.querySelectorAll('.card').forEach(function(c){if(/Epsilon/.test(c.textContent))t=c;});t&&t.click();}""")
    pg.wait_for_timeout(200)
    pg.evaluate("()=>document.getElementById('scrim').click()")
    pg.wait_for_timeout(120)
    ck("6: a backdrop tap closes the drawer", pg.evaluate("()=>document.getElementById('scrim').hidden"))

    # ---- tap the Sent opp -> empty reply thread ----
    pg.evaluate("""()=>{var t=null;document.querySelectorAll('.card').forEach(function(c){if(/Gamma Inc/.test(c.textContent))t=c;});t&&t.click();}""")
    pg.wait_for_timeout(500)
    g = pg.evaluate("""()=>{var dw=document.getElementById('drawer');return {
      threadN:(dw.querySelector('[data-threadn]')||{}).textContent||'',
      inCount:dw.querySelectorAll('.msg.in').length,
      noThread: dw.textContent.indexOf('No replies yet.')>=0 };}""")
    ck("2: a Sent opp has an empty reply thread (count 0, no inbound bubbles, 'No replies yet.')",
       g["threadN"]=="0" and g["inCount"]==0 and g["noThread"], g)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(100)

    # ---- AR: RTL drawer ----
    pg.click("#langBtn"); pg.wait_for_timeout(300)
    pg.evaluate("""()=>{var t=null;document.querySelectorAll('.card').forEach(function(c){if(/Epsilon/.test(c.textContent))t=c;});t&&t.click();}""")
    pg.wait_for_timeout(600)
    ar = pg.evaluate("""()=>{
      var dw=document.getElementById('drawer');
      var inb=dw.querySelector('.msg.in .maddr');
      return { dir:document.documentElement.getAttribute('dir'),
               arThread: dw.textContent.indexOf('محادثة الردود')>=0,
               arSignals: dw.textContent.indexOf('المؤشرات')>=0,
               addr: inb?inb.textContent:'', addrDir: inb?getComputedStyle(inb).direction:'' };
    }""")
    ck("7: AR flips the drawer to RTL with Arabic section labels", ar["dir"]=="rtl" and ar["arThread"] and ar["arSignals"], ar)
    ck("7: the reply address stays LTR-isolated in AR too", ("reply1@example.test" in ar["addr"]) and ar["addrDir"]=="ltr", ar)

    # ---- privacy: every address ever rendered is a synthetic *.example.test placeholder ----
    everything = pg.evaluate("()=>document.getElementById('drawer').textContent")
    # every '@' in the drawer is immediately followed by the synthetic domain (textContent has no separators,
    # so bound at the domain rather than trying to slice the trailing address off).
    at_segs = everything.split("@")[1:]
    ck("PRIVACY: every address rendered is a synthetic example.test placeholder",
       len(at_segs) >= 1 and all(s.startswith("example.test") for s in at_segs), at_segs)

    ctx.close(); b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL BOARD-DETAIL CHECKS PASS"))
raise SystemExit(1 if fails else 0)
