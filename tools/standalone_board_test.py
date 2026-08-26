"""STANDALONE_BOARD (browser + source, fails-when-broken).

Every path that loads app.js hangs at the board render, so library/board.html is a fresh, INDEPENDENT reader
of console_board that loads none of the heavy chain. This locks it:

  self-contained : no <script src>, no <link>, no app.js/gate.js/stage-model.js/config.js at runtime.
  1. sign-in     : one email+password surface -> the device-proven bare GoTrue grant (apikey header, JSON
                   POST, NO Authorization, cache no-store, arrayBuffer+TextDecoder), token in a local var.
  2. one REST GET: console_board fetched with that token as the Bearer plus the apikey header.
  3. render      : rows grouped into the five lanes as plain cards; missing fields default to empty.
  4. read-only   : display only; any error is visible red text, never a black page.

The GoTrue token endpoint and the console_board REST endpoint are mocked; the request shapes are asserted on
the wire.
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
        if d is not None: print("      " + str(d)[:400])

board = open(os.path.join(ROOT, "library/board.html")).read()

# ---- source guards: truly self-contained ---------------------------------------------------------
ck("no external script is loaded", "<script src" not in board)
ck("no external stylesheet is loaded", "<link" not in board)
ck("no console-app file is referenced (app.js/gate.js/stage-model.js/config.js)",
   all(x not in board for x in ["app.js", "gate.js", "stage-model.js", "config.js"]))
ck("dark #07070b, Lato, no blur", "#07070b" in board and "Lato" in board and "blur(" not in board and "backdrop-filter" not in board)
ck("the exact console_board query is used",
   "select=slug,business,stage,sent_count,open_count,replied,idle_days,last_activity_ts,has_page,has_email,archived" in board
   and "/rest/v1/console_board?" in board)
ck("the bare GoTrue grant shape (grant_type + no-store + arrayBuffer/TextDecoder)",
   'grant_type=" + grant' in board and 'tokenPost("password"' in board
   and 'cache:"no-store"' in board and 'TextDecoder' in board and 'arrayBuffer' in board)

# The token POST must NOT carry Authorization: check the tokenPost block (the one auth POST builder).
tokenpost_block = board.split('function tokenPost(')[1].split('function signIn(')[0]
ck("the token grant carries apikey + JSON only, never Authorization",
   '"apikey": ANON' in tokenpost_block and '"Content-Type":"application/json"' in tokenpost_block
   and 'Authorization' not in tokenpost_block)
rest_block = board.split('function fetchBoard(')[1].split('var VIEW')[0]
ck("the REST GET carries the Bearer token AND the apikey header",
   '"Authorization": "Bearer " + bearer()' in rest_block and '"apikey": ANON' in rest_block and 'method:"GET"' in rest_block)

# ---- browser harness -----------------------------------------------------------------------------
ROWS = [
  {"slug":"acme","business":"Acme Co","stage":"draft","sent_count":0,"open_count":0,"replied":False,"idle_days":None,"has_page":False,"has_email":True,"archived":False},
  {"slug":"beta","business":"Beta LLC","stage":"live","sent_count":0,"open_count":0,"replied":False,"idle_days":None,"has_page":True,"has_email":True,"archived":False},
  {"slug":"gamm","business":"Gamma Inc","stage":"sent","sent_count":2,"open_count":0,"replied":False,"idle_days":3,"has_page":True,"has_email":True,"archived":False},
  {"slug":"delt","business":"Delta Foods","stage":"opened","sent_count":1,"open_count":4,"replied":False,"idle_days":1,"has_page":True,"has_email":True,"archived":False},
  {"slug":"epsi","business":"Epsilon","stage":"replied","sent_count":1,"open_count":2,"replied":True,"idle_days":0,"has_page":True,"has_email":True,"archived":False},
]

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

handler = functools.partial(Handler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

seen = {}
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page()

    def route_token(route):
        req = route.request
        seen["tok_method"] = req.method
        seen["tok_headers"] = {k.lower(): v for k, v in req.headers.items()}
        seen["tok_body"] = req.post_data
        route.fulfill(status=200, headers={"content-type":"application/json"},
                      body=json.dumps({"access_token":"TESTTOKEN","refresh_token":"R","expires_at":9999999999,"user":{"id":"u1"}}))
    def route_board(route):
        req = route.request
        seen["board_method"] = req.method
        seen["board_headers"] = {k.lower(): v for k, v in req.headers.items()}
        seen["board_url"] = req.url
        route.fulfill(status=200, headers={"content-type":"application/json"}, body=json.dumps(ROWS))
    pg.route("**/auth/v1/token**", route_token)
    pg.route("**/rest/v1/console_board**", route_board)

    pg.goto(f"{base}/library/board.html", wait_until="load")
    pg.wait_for_timeout(300)
    ck("the sign-in surface renders", pg.evaluate("()=>!!document.getElementById('go')"))

    pg.fill("#em", "op@thrive.test")
    pg.fill("#pw", "correct horse")
    pg.click("#go")
    pg.wait_for_timeout(600)

    # request shapes on the wire
    th = seen.get("tok_headers", {})
    ck("token grant is a POST with the apikey header", seen.get("tok_method")=="POST" and th.get("apikey","").startswith("eyJ"), th)
    ck("token grant carries NO Authorization header", "authorization" not in th, list(th.keys()))
    ck("token grant body has the credentials", "op@thrive.test" in (seen.get("tok_body") or ""), seen.get("tok_body"))
    bh = seen.get("board_headers", {})
    ck("board GET carries Bearer TESTTOKEN and the apikey", bh.get("authorization")=="Bearer TESTTOKEN" and bh.get("apikey","").startswith("eyJ"), bh)
    ck("board GET uses the exact console_board query",
       "/rest/v1/console_board?" in (seen.get("board_url") or "")
       and "select=slug,business,stage,sent_count,open_count,replied,idle_days,last_activity_ts,has_page,has_email,archived" in (seen.get("board_url") or ""), seen.get("board_url"))

    # render: five lanes, right counts, a card body present
    st = pg.evaluate("""()=>{
      var lanes={}; document.querySelectorAll('.lane h2').forEach(function(h){
        var name=h.childNodes[0].textContent.trim(); var n=h.querySelector('.n').textContent.trim(); lanes[name]=n; });
      return { lanes:lanes, cards:document.querySelectorAll('.card').length,
               hasAcme:/Acme Co/.test(document.body.textContent),
               hasOpens:/4 opens/.test(document.body.textContent),
               err:(document.querySelector('.err')||{}).textContent||'' };
    }""")
    ck("the five lanes render with one card each", st["lanes"].get("Draft")=="1" and st["lanes"].get("Live")=="1"
       and st["lanes"].get("Sent")=="1" and st["lanes"].get("Opened")=="1" and st["lanes"].get("Replied")=="1", st["lanes"])
    ck("all five cards rendered", st["cards"]==5, st)
    ck("a card shows its business name and derived counts", st["hasAcme"] and st["hasOpens"], st)
    ck("no error on the happy path", st["err"]=="", st)
    pg.close()

    # ---- error path: a rejected token surfaces red text, never a black page ----------------------
    pg2 = b.new_page()
    def route_token_bad(route):
        route.fulfill(status=400, headers={"content-type":"application/json"}, body=json.dumps({"error_description":"Invalid login credentials"}))
    pg2.route("**/auth/v1/token**", route_token_bad)
    pg2.goto(f"{base}/library/board.html", wait_until="load")
    pg2.fill("#em", "op@thrive.test"); pg2.fill("#pw", "wrong"); pg2.click("#go")
    pg2.wait_for_timeout(500)
    err2 = pg2.evaluate("()=>{var e=document.querySelector('.err');return e?e.textContent:'';}")
    # The sign-in error is now localized (chrome-language), not the raw GoTrue string: a 400 shows "Could not sign in."
    ck("a sign-in failure prints visible red error text", "Could not sign in" in err2, err2)
    pg2.close()

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL STANDALONE-BOARD CHECKS PASS"))
raise SystemExit(1 if fails else 0)
