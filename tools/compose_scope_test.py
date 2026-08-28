"""COMPOSE_SCOPE (browser, fails-when-broken).

Duplicate-id crosstalk (COMPOSE_SURFACE_EVIDENCE A1): the editor markup (#edSubj/#edBody/#edPreview) is
mounted by BOTH the card drawer and the New-message overlay. Before the fix, opening New message over an
open drawer left two of each id; document.getElementById returned the drawer's (first in DOM), so the
overlay bound its reads/writes to the drawer's opp - blank preview, blocked Send, sends to the wrong card.

This locks the two-part fix:
  1. openNewMessage closes the drawer and clears #drawer, so one compose surface exists at a time.
  2. every compose read/write is scoped to the ACTIVE surface root (edRoot/edEl), so a read never resolves
     to a hidden second copy.

Same mocked GoTrue + console_board harness as standalone_board_test. Synthetic rows only.
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

DRAWER_SLUG = "draweropp"
ROWS = [
  {"slug":DRAWER_SLUG,"business":"مرحبا من ثرايف","stage":"live","sent_count":0,"open_count":0,
   "replied":False,"idle_days":None,"last_activity_ts":"2026-08-01T00:00:00Z","has_page":True,"has_email":True,"archived":False},
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

upserts = []   # every slug written to console_opps (must NEVER be the drawer's)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page()

    # Playwright uses the LAST-registered matching route, so register the catch-all FIRST and the specific
    # routes after it, so console_board / console_opps win over the generic empty responder.
    pg.route("**/rest/v1/**", lambda r: r.fulfill(status=200, headers={"content-type":"application/json"}, body="[]"))
    pg.route("**/auth/v1/token**", lambda r: r.fulfill(status=200, headers={"content-type":"application/json"},
             body=json.dumps({"access_token":"T","refresh_token":"R","expires_at":9999999999,"user":{"id":"u1"}})))
    def route_opps(route):
        req = route.request
        if req.method == "POST":
            try:
                for row in json.loads(req.post_data or "[]"):
                    if isinstance(row, dict) and row.get("slug"): upserts.append(row["slug"])
            except Exception: pass
        route.fulfill(status=200, headers={"content-type":"application/json"}, body="[]")
    pg.route("**/rest/v1/console_opps**", route_opps)
    pg.route("**/rest/v1/console_board**", lambda r: r.fulfill(status=200, headers={"content-type":"application/json"}, body=json.dumps(ROWS)))

    pg.goto(f"{base}/library/board.html", wait_until="load")
    pg.wait_for_timeout(200)
    pg.fill("#em", "op@thrive.test"); pg.fill("#pw", "correct horse"); pg.click("#go")
    pg.wait_for_selector(".card[data-slug]", timeout=8000)

    # ---- open the DRAWER for the seeded opp: its editor mounts #edBody ----
    pg.click(f".card[data-slug='{DRAWER_SLUG}']")
    pg.wait_for_selector("#edBody", timeout=6000)
    ck("the drawer mounts its editor (one #edBody)", pg.eval_on_selector_all("#edBody", "e=>e.length")==1)
    ck("the overlay is not open yet", pg.evaluate("()=>window.__thriveNewMessageOpen()")==False)

    # The real repro: closeDrawer hides the scrim but historically left #drawer's editor DOM in place, so its
    # #edSubj/#edBody/#edPreview LINGER as a first-in-DOM duplicate set when the overlay opens next.
    pg.eval_on_selector("#scrim", "s=>s.dispatchEvent(new MouseEvent('click',{bubbles:true}))")  # backdrop tap closes the drawer
    pg.wait_for_timeout(150)
    ck("the drawer scrim is hidden after closing", pg.eval_on_selector("#scrim", "s=>s.hidden")==True)
    ck("after closing, the drawer's #edBody still lingers in the DOM (the duplicate-id precondition)",
       pg.eval_on_selector_all("#edBody", "e=>e.length")==1)

    # ---- open NEW MESSAGE (header button now reachable; the closed drawer's DOM still lingers) ----
    pg.click("#newMsgBtn")
    pg.wait_for_function("()=>window.__thriveNewMessageOpen()===true", timeout=6000)
    pg.wait_for_selector("#nmPanel #edBody", timeout=6000)

    # (a) one compose surface, bound to a fresh opp, empty
    ck("Fix 1: exactly one #edBody exists after opening the overlay (drawer cleared)",
       pg.eval_on_selector_all("#edBody", "e=>e.length")==1, pg.eval_on_selector_all("#edBody","e=>e.length"))
    nm_slug = pg.evaluate("()=>window.__thriveNewMessageSlug()")
    ck("the overlay is bound to a FRESH opp id, not the drawer's slug",
       isinstance(nm_slug, str) and nm_slug.startswith("msg-") and nm_slug != DRAWER_SLUG, nm_slug)
    ck("the composer opens empty (no subject, no body carried from the drawer)",
       pg.evaluate("()=>document.querySelector('#nmPanel #edSubj').value===''")
       and pg.evaluate("()=>document.querySelector('#nmPanel #edBody').value===''"))

    # the single live #edBody must be the overlay's, so scoped reads bind to it (not a drawer copy)
    ck("the live #edBody lives inside the overlay (#nmPanel), so reads bind to it",
       pg.evaluate("()=>{var b=document.querySelectorAll('#edBody'); return b.length===1 && !!b[0].closest('#nmPanel');}"))

    # (c) fill the overlay and prove the preview reflects the OVERLAY body
    BODY = "Eid Mubarak from Thrive. Wishing you a joyful season."
    pg.fill("#nmPanel #edSubj", "Season greeting")
    pg.fill("#nmPanel #edBody", BODY)
    pg.fill("#nmPanel #recIn", "owner@example.test")
    pg.eval_on_selector("#nmPanel #edBody", "e=>e.dispatchEvent(new Event('input',{bubbles:true}))")
    pg.eval_on_selector("#nmPanel #recIn", "e=>e.dispatchEvent(new Event('input',{bubbles:true}))")
    pg.wait_for_timeout(400)

    srcdoc = pg.evaluate("()=>document.querySelector('#nmPanel #edPreview').getAttribute('srcdoc')||''")
    ck("the overlay preview srcdoc is non-empty", len(srcdoc) > 0, srcdoc[:80])
    ck("the overlay preview reflects the OVERLAY body (not the drawer's blank)", BODY.split(".")[0] in srcdoc, srcdoc[:160])

    # (b) Send is enabled, and every write binds to the NEW opp, never the drawer's
    ck("Send is enabled once the overlay has subject + body + recipient",
       pg.evaluate("()=>document.getElementById('nmSend').disabled===false"))
    pg.click("#nmSend")
    pg.wait_for_timeout(700)
    ck("at least one write was captured", len(upserts) > 0, upserts)
    ck("every console_opps write targets the NEW opp, never the drawer's slug",
       all(s == nm_slug for s in upserts) and DRAWER_SLUG not in upserts, upserts)

    pg.close(); b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL COMPOSE-SCOPE CHECKS PASS"))
raise SystemExit(1 if fails else 0)
