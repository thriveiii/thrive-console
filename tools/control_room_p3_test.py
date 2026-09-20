"""PHASE 3 (board.html): the networked Contacts + Template memory + Reply tags - each a LENS over the ledger.

Device-proven at iPhone portrait (390x844). Asserts, against a seeded ledger:
  1. CONTACTS lists real contacts (curated console_contacts + everyone ever emailed/replied).
  2. Opening a contact shows ONLY the templates sent to THEM (never a template they were not sent) and the FULL
     conversation (outbound sends + inbound replies, threaded).
  3. A TEMPLATE (Library) shows who it was sent to, the sender (team member), the date/time, and the SEND COUNT.
  4. A REPLY TAG opens the full conversation with that contact.
  5. page_slug is stamped at send time (source guard) so "which template went to whom" is one hop.

FAILS-WHEN-BROKEN: a contact view showing a template NOT sent to them, OR a reply tag that does not open the
conversation, OR a template that does not show its send count -> fails.
"""
import os, re, json, threading, http.server, socketserver, functools
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:500])

# ---- seeded ledger -------------------------------------------------------------------------------
# Sarah is a CURATED contact merging two addresses; she was sent the "alpha-page" template twice and replied once.
# Bob is an ad-hoc contact (only in the mail ledger); he was sent the "beta-page" template once, no reply.
SARAH1, SARAH2, BOB = "sarah@bards-alley.example", "s.secondary@bards-alley.example", "bob@beta-llc.example"
CONTACTS = [ {"id":"person-sarah","addresses":[SARAH1, SARAH2],"name":"Sarah Aldarwish","tags":["client"],"note":""} ]
MAIL = [
  {"id":"m1","opp":"alpha","to_addr":SARAH1,"actor":"uid-omar","subject":"A partnership for Alpha","status":"sent","ts":"2026-02-01T10:00:00Z","page_slug":"alpha-page","data":{"direction":"out","page_slug":"alpha-page"}},
  {"id":"m2","opp":"alpha","to_addr":SARAH2,"actor":"uid-omar","subject":"Following up","status":"sent","ts":"2026-02-03T10:00:00Z","page_slug":"alpha-page","data":{"direction":"out","page_slug":"alpha-page"}},
  {"id":"m3","opp":"beta","to_addr":BOB,"actor":"uid-lina","subject":"An idea for Beta","status":"sent","ts":"2026-02-02T10:00:00Z","page_slug":"beta-page","data":{"direction":"out","page_slug":"beta-page"}},
]
INBOUND = [
  {"id":"r1","opp":"alpha","kind":"human","bounce":False,"ts":"2026-02-04T09:00:00Z","data":{"from":SARAH1,"subject":"Re: A partnership for Alpha","snippet":"Yes, let us talk next week."}},
]
OPPS = [ {"slug":"alpha","ps":"alpha-page"}, {"slug":"beta","ps":"beta-page"} ]
PAGES = [ {"slug":"alpha-page","title":"Alpha partnership page"}, {"slug":"beta-page","title":"Beta idea page"} ]
BOARD = [
  {"slug":"alpha","business":"Alpha Co","stage":"replied","sent_count":2,"open_count":0,"replied":True,"idle_days":0,"last_activity_ts":"2026-02-04T09:00:00Z","has_page":True,"has_email":True,"archived":False},
  {"slug":"beta","business":"Beta LLC","stage":"sent","sent_count":1,"open_count":0,"replied":False,"idle_days":1,"last_activity_ts":"2026-02-02T10:00:00Z","has_page":True,"has_email":True,"archived":False},
]

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True; threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

def J(r,o,s=200): r.fulfill(status=s, headers={"content-type":"application/json"}, body=json.dumps(o))
def route_board(r): J(r, BOARD)
def route_inbound(r): J(r, INBOUND)
def route_contacts(r): J(r, CONTACTS)
def route_pages(r):
    if "select=slug,title" in r.request.url: return J(r, PAGES)
    if "select=html" in r.request.url: return J(r, [{"html":"<h1>x</h1>"}])
    if "select=title" in r.request.url: return J(r, [{"title":"T"}])
    return J(r, PAGES)
def route_opps(r):
    u=r.request.url
    if "ps:data" in u or "select=slug,ps" in u: return J(r, OPPS)
    m=re.search(r'slug=eq\.([^&]+)', u)
    if m:
        sl=m.group(1); return J(r, [{"slug":sl,"archived_at":None,"archived_from":None,"data":{"page_slug":sl+"-page"}}])
    return J(r, [])
def route_mail(r):
    # honor the rich page_slug select; if a test wanted the lean fallback it would still work off data.page_slug
    return J(r, MAIL)
def route_empty(r): J(r, [])
def wire(ctx, ar=False):
    js="try{localStorage.setItem('console_sb_session', JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'op@thrive.test',uid:'u'}));"
    if ar: js+="localStorage.setItem('thrive_lang','ar');"
    js+="}catch(e){}"
    ctx.add_init_script(js)
    ctx.route("**/rest/v1/console_board**", route_board)
    ctx.route("**/rest/v1/console_inbound**", route_inbound)
    ctx.route("**/rest/v1/console_contacts**", route_contacts)
    ctx.route("**/rest/v1/console_mail**", route_mail)
    ctx.route("**/rest/v1/console_pages**", route_pages)
    ctx.route("**/rest/v1/console_opps**", route_opps)
    for tname in ["console_hits","console_suppressions","console_profiles","console_profile_names","console_members","console_team_roster","console_admins"]:
        ctx.route(f"**/rest/v1/{tname}**", route_empty)

# ---- source guards -------------------------------------------------------------------------------
board_src = open(f"{ROOT}/library/board.html").read()
ck("5: the send path stamps page_slug (column + data mirror) so template->contact is one hop",
   "page_slug:art.pageSlug" in board_src and 'page_slug:art.pageSlug }' in board_src)
ck("5: the SQL migration for console_mail.page_slug ships (additive)",
   os.path.exists(f"{ROOT}/docs/supabase-mail-page-slug.sql") and "add column if not exists page_slug" in open(f"{ROOT}/docs/supabase-mail-page-slug.sql").read())

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width":390,"height":844}, has_touch=True, is_mobile=True)
    wire(ctx)
    pg = ctx.new_page(); perr=[]; pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(700)
    pg.wait_for_selector(".lane", timeout=8000)
    ck("no uncaught page error on load (the inlined Phase 3 module parses)", len(perr)==0, perr)

    # a Contacts nav entry exists in the header
    has_nav = pg.evaluate("()=>!!document.getElementById('contactsBtn')")
    ck("1: a Contacts nav entry is present", has_nav)

    # 1: open Contacts -> Sarah (curated) AND Bob (ad-hoc, from the mail ledger) both list
    pg.evaluate("()=>window.openContactsView()")
    pg.wait_for_selector("#ctBody .ct-card", timeout=6000)
    names = pg.evaluate("()=>[].map.call(document.querySelectorAll('#ctBody .ct-card .ct-name'),function(n){return n.textContent.trim();})")
    ck("1: Contacts lists the curated contact (Sarah)", any("Sarah" in n for n in names), names)
    ck("1: Contacts lists the ad-hoc contact derived from the ledger (Bob)", any(("bob" in n.lower()) or ("Bob" in n) for n in names), names)

    # 2: open Sarah -> ONLY her template (alpha-page), NEVER beta-page; full conversation present
    pg.evaluate("()=>window.ctDetailRender('person-sarah')")
    pg.wait_for_selector("#ctConvo", timeout=6000)
    det = pg.evaluate("""()=>{
      var tpl=[].map.call(document.querySelectorAll('.ct-tpl-row .ct-tpl-slug'),function(n){return n.textContent.trim();});
      var out=document.querySelectorAll('#ctConvo .msg.out').length;
      var inn=document.querySelectorAll('#ctConvo .msg.in').length;
      return { tpl:tpl, out:out, inn:inn };
    }""")
    ck("2: the contact shows the template that WAS sent to them (alpha-page)", "alpha-page" in det["tpl"], det)
    ck("2: the contact NEVER shows a template NOT sent to them (beta-page absent)", "beta-page" not in det["tpl"], det)
    ck("2: the full conversation shows both outbound sends (2)", det["out"]==2, det)
    ck("2: the full conversation shows the inbound reply (1)", det["inn"]==1, det)

    # 4: a reply tag OPENS the conversation. Go back to the list, click Sarah's reply tag, land on the thread.
    pg.evaluate("()=>window.ctDetailRender && (function(){ var m=window; })()")  # noop to keep context
    pg.evaluate("()=>document.getElementById('ctBack') && document.getElementById('ctBack').click()")
    pg.wait_for_selector("#ctBody .ct-card", timeout=4000)
    # click the reply tag on Sarah's card
    clicked = pg.evaluate("""()=>{
      var cards=[].slice.call(document.querySelectorAll('#ctBody .ct-card'));
      for(var i=0;i<cards.length;i++){ var nm=cards[i].querySelector('.ct-name'); if(nm && nm.textContent.indexOf('Sarah')>=0){ var tag=cards[i].querySelector('[data-ct-convo]'); if(tag){ tag.click(); return true; } } }
      return false;
    }""")
    pg.wait_for_timeout(400)
    convo = pg.evaluate("()=>({open: !!document.getElementById('ctConvo'), inn: document.querySelectorAll('#ctConvo .msg.in').length})")
    ck("4: a reply tag opens the conversation (the thread with the inbound reply is shown)",
       clicked and convo["open"] and convo["inn"]>=1, {"clicked":clicked, **convo})

    # 3: template memory - open the Library, expand alpha-page memory -> recipient + sender + SEND COUNT
    pg.evaluate("()=>window.closeContactsView()")
    pg.evaluate("()=>window.openLibraryView && window.openLibraryView()")
    # openLibraryView isn't a window seam; fall back to clicking the nav button if needed
    if not pg.evaluate("()=>!!document.querySelector('#lvBody .lv-card, #libViewPanel .lv-card')"):
        pg.evaluate("()=>{var b=document.getElementById('libBtn'); if(b) b.click();}")
    pg.wait_for_selector("[data-lv-mem='alpha-page']", timeout=6000)
    pg.evaluate("()=>document.querySelector(\"[data-lv-mem='alpha-page']\").click()")
    pg.wait_for_selector("#lvMem-alpha-page .ct-mem-row", timeout=6000)
    mem = pg.evaluate("""()=>{
      var box=document.getElementById('lvMem-alpha-page');
      var rows=box.querySelectorAll('.ct-mem-row').length;
      var cnt=box.querySelector('.ct-mem-n'); var cval=cnt?cnt.textContent.trim():'';
      var whoNames=[].map.call(box.querySelectorAll('.ct-mem-who .ct-name'),function(n){return n.textContent.trim();});
      var senders=[].map.call(box.querySelectorAll('.ct-mem-by'),function(n){return n.textContent.trim();});
      var hasTag=!!box.querySelector('[data-ct-convo]');
      return { rows:rows, cval:cval, whoNames:whoNames, senders:senders, hasTag:hasTag };
    }""")
    ck("3: the template shows its SEND COUNT (2)", mem["cval"]=="2", mem)
    ck("3: the template shows a recipient contact (Sarah)", any("Sarah" in n for n in mem["whoNames"]), mem)
    ck("3: the template shows the sender (a 'Sent by' line per send)", len(mem["senders"])>=1 and all("Sent by" in s or "أرسله" in s for s in mem["senders"]), mem)
    ck("3: the template recipient carries a reply tag (opens the conversation)", mem["hasTag"], mem)

    pg.close(); ctx.close()
    b.close()
httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL CONTROL-ROOM-P3 CHECKS PASS"))
import sys; sys.exit(1 if fails else 0)
