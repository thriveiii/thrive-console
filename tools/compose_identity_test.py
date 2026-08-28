"""COMPOSE_IDENTITY (browser, fails-when-broken).

Root cause (NEWMSG_AUDIT, reproduced): openNewMessage resumed nmStoredSlug(); the pointer thrive_nm_draft
cleared only on a successful send. So while a send was blocked the draft never graduated, the pointer
stayed set, and every "New message" reopened the SAME opp pre-filled with the prior subject/body. The
board counts sent_count per slug (docs/supabase-board-view.sql:50-57), so two messages collapsed onto one
card ("2 إرسال").

This locks the identity fix:
  (a) with thrive_nm_draft set to an existing slug, clicking New message opens an EMPTY compose bound to a
      NEW slug (never the stored one);
  (b) two separate composes with the SAME subject produce TWO distinct slugs (two cards, not one);
  (c) closing an empty compose clears thrive_nm_draft (no sticky pointer).

Same mocked GoTrue + console_board + console_opps harness as standalone_board_test. Synthetic rows only.
"""
import os, json, threading, http.server, socketserver, functools
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

STORED = "msg-old111-aaaaaa"       # a stale pointer/draft from a prior (blocked) compose
OPP = {"slug": STORED, "data": {"outreach_subject": "مرحبا من ثرايف", "outreach_text": "Old body.", "recipients": []}}
ROWS = [{"slug": STORED, "business": "مرحبا من ثرايف", "stage": "draft", "sent_count": 0, "open_count": 0,
         "replied": False, "idle_days": None, "last_activity_ts": "2026-08-01T00:00:00Z",
         "has_page": False, "has_email": True, "archived": False}]

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
handler = functools.partial(Handler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

def read_pointer(pg):
    return pg.evaluate("()=>{try{return localStorage.getItem('thrive_nm_draft');}catch(e){return 'ERR';}}")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page()
    pg.route("**/rest/v1/**", lambda r: r.fulfill(status=200, headers={"content-type":"application/json"}, body="[]"))
    pg.route("**/auth/v1/token**", lambda r: r.fulfill(status=200, headers={"content-type":"application/json"},
             body=json.dumps({"access_token":"T","refresh_token":"R","expires_at":9999999999,"user":{"id":"u1"}})))
    pg.route("**/rest/v1/console_opps**", lambda r: r.fulfill(status=200, headers={"content-type":"application/json"},
             body=json.dumps([OPP] if r.request.method=="GET" else [])))
    pg.route("**/rest/v1/console_board**", lambda r: r.fulfill(status=200, headers={"content-type":"application/json"}, body=json.dumps(ROWS)))

    pg.goto(f"{base}/library/board.html", wait_until="load")
    pg.wait_for_timeout(200)
    pg.fill("#em", "op@thrive.test"); pg.fill("#pw", "correct horse"); pg.click("#go")
    pg.wait_for_selector(".card[data-slug]", timeout=8000)

    # (a) a stale pointer must NOT be resumed onto the New-message button ------------------------------
    pg.evaluate("s=>localStorage.setItem('thrive_nm_draft', s)", STORED)
    pg.click("#newMsgBtn")
    pg.wait_for_function("()=>window.__thriveNewMessageOpen()===true", timeout=6000)
    pg.wait_for_timeout(700)   # allow any (now removed) async resume re-render a chance to fire
    slug_a = pg.evaluate("()=>window.__thriveNewMessageSlug()")
    ck("(a) New message opens a NEW slug, never the stored draft slug",
       isinstance(slug_a, str) and slug_a.startswith("msg-") and slug_a != STORED, {"opened": slug_a, "stored": STORED})
    ck("(a) the composer is EMPTY (no subject/body/recipient from the stored draft)",
       pg.evaluate("()=>document.querySelector('#nmPanel #edSubj').value")=="" and
       pg.evaluate("()=>document.querySelector('#nmPanel #edBody').value")=="" and
       pg.evaluate("()=>document.querySelector('#nmPanel #recIn').value")=="")

    # (b) two composes with the SAME subject -> two distinct slugs ------------------------------------
    pg.fill("#nmPanel #edSubj", "مرحبا من ثرايف")
    pg.fill("#nmPanel #edBody", "First compose body.")
    pg.wait_for_timeout(300)
    # close this one (non-empty: it persists as its own draft), then open a second New message
    pg.evaluate("()=>{ var b=document.getElementById('nmClose'); if(b) b.click(); }")
    pg.wait_for_timeout(400)
    pg.click("#newMsgBtn")
    pg.wait_for_function("()=>window.__thriveNewMessageOpen()===true", timeout=6000)
    pg.wait_for_timeout(300)
    slug_b = pg.evaluate("()=>window.__thriveNewMessageSlug()")
    ck("(b) a second New message with the same subject is a DISTINCT slug (two cards, not one)",
       isinstance(slug_b, str) and slug_b.startswith("msg-") and slug_b != slug_a and slug_b != STORED,
       {"first": slug_a, "second": slug_b})
    pg.fill("#nmPanel #edSubj", "مرحبا من ثرايف")   # same subject again
    ck("(b) the second compose is empty until typed (identity is by slug, not subject)",
       pg.evaluate("()=>document.querySelector('#nmPanel #edBody').value")=="")

    # (c) closing an EMPTY compose clears the pointer -------------------------------------------------
    # open a fresh compose, type nothing, close: the pointer must not be left sticky.
    pg.evaluate("()=>{ var b=document.getElementById('nmClose'); if(b) b.click(); }")
    pg.wait_for_timeout(300)
    pg.evaluate("s=>localStorage.setItem('thrive_nm_draft', s)", STORED)   # simulate a stale pointer present
    pg.click("#newMsgBtn")
    pg.wait_for_function("()=>window.__thriveNewMessageOpen()===true", timeout=6000)
    pg.wait_for_timeout(200)
    # type nothing; close immediately
    pg.evaluate("()=>{ var b=document.getElementById('nmClose'); if(b) b.click(); }")
    pg.wait_for_timeout(300)
    ck("(c) closing an EMPTY compose clears thrive_nm_draft (no sticky pointer)",
       read_pointer(pg) in (None, "null"), {"pointer": read_pointer(pg)})

    pg.close(); b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL COMPOSE-IDENTITY CHECKS PASS"))
raise SystemExit(1 if fails else 0)
