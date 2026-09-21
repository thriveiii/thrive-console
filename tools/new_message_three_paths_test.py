"""NEW MESSAGE opens on THREE clear options (Thyab's long-standing request), not a two-option mode selector, and
with NO nested "with/without campaign" step before the three paths.

Tapping "New message" (window.owNewMessage) must show THREE first-screen options:
  1. Text message only          -> the lean compose (Mode A: editor + Send).
  2. Upload a page or campaign   -> ONE upload control that accepts a single page OR a multi-page zip.
  3. Pick from the Library       -> browse/search existing templates, then compose.
Each leads straight into its editor with a working send/commit control. Driven via the exposed
window.owNewMessage + window.owSelectMode seams.

FAILS-WHEN-BROKEN: tapping "New message" shows two options (owPickA/owPickB), OR requires a with-campaign step
before the three paths (the upload/pick paths are not reachable directly from the first screen) -> fails.
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

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True; threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

def J(r,o,s=200): r.fulfill(status=s, headers={"content-type":"application/json"}, body=json.dumps(o))
def wire(ctx, lang="en"):
    ctx.add_init_script("try{localStorage.setItem('console_sb_session', JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'op@thrive.test',uid:'u'}));localStorage.setItem('thrive_lang','"+lang+"');}catch(e){}")
    for t in ["console_board","console_opps","console_mail","console_hits","console_inbound","console_suppressions","console_pages","console_profiles","console_profile_names","console_members","console_team_roster","console_admins"]:
        ctx.route(f"**/rest/v1/{t}**", lambda r: J(r, []))

def open_new(pg):
    pg.evaluate("()=>window.owNewMessage()")
    pg.wait_for_selector("#owBody .ow-modes", timeout=6000); pg.wait_for_timeout(150)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(); wire(ctx)
    pg = ctx.new_page(); perr=[]; pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(700)
    pg.wait_for_function("()=>typeof window.owNewMessage==='function'", timeout=8000)

    # ===== the first screen shows THREE options, not two =====
    open_new(pg)
    st = pg.evaluate("""()=>({
      text: !!document.getElementById('owPickText'),
      upload: !!document.getElementById('owPickUpload'),
      lib: !!document.getElementById('owPickLib'),
      oldA: !!document.getElementById('owPickA'),
      oldB: !!document.getElementById('owPickB'),
      count: document.querySelectorAll('#owBody .ow-modes .ow-mode-btn').length
    })""")
    ck("New message shows the THREE options (text / upload / pick)",
       st["text"] and st["upload"] and st["lib"], st)
    ck("New message does NOT show the old two-option mode selector (owPickA/owPickB)",
       not st["oldA"] and not st["oldB"], st)
    ck("exactly three option cards on the first screen", st["count"]==3, st)

    # ===== option 2: Upload a page or campaign -> straight to ONE upload control (no with-campaign step) =====
    pg.click("#owPickUpload")
    pg.wait_for_function("()=>{var b=document.getElementById('owBodyUpload');return b && !b.hidden && !!document.getElementById('owUploadFile');}", timeout=6000); pg.wait_for_timeout(150)
    up = pg.evaluate("""()=>{
      var body=document.getElementById('owBodyUpload'), f=document.getElementById('owUploadFile');
      return { bodyVisible: !!body && !body.hidden, hasFile: !!f, accept: f?f.getAttribute('accept'):'',
               commit: !!document.getElementById('owCommit'),
               noOldSelector: !document.getElementById('owPickA') && !document.getElementById('owPickB') && !document.getElementById('owPickUpload') };
    }""")
    ck("Upload option lands directly on the upload control (no nested with-campaign step)",
       up["bodyVisible"] and up["hasFile"], up)
    ck("the upload control is ONE input that accepts a single page OR a multi-page zip",
       (".zip" in (up["accept"] or "")) and (".html" in (up["accept"] or "")), up["accept"])
    ck("the upload surface has a working commit control (#owCommit)", up["commit"], up)

    # ===== option 3: Pick from the Library -> straight to the Library picker =====
    open_new(pg)
    pg.click("#owPickLib")
    # DIRECT flow: the pick surface renders the search + list straight away (no owBodyPick wrapper, no Mode B shell).
    pg.wait_for_function("()=>!!document.getElementById('owPickList') && !!document.getElementById('owPickSearch')", timeout=6000); pg.wait_for_timeout(150)
    pk = pg.evaluate("""()=>{
      var pick=document.getElementById('owPick');
      return { pickVisible: !!pick, hasList: !!document.getElementById('owPickList'),
               hasSearch: !!document.getElementById('owPickSearch'), commit: !!document.getElementById('owCommit'),
               noTabShell: document.querySelectorAll('#owTabs .ow-tab').length===0 && !document.getElementById('owPathPick') };
    }""")
    ck("Pick option lands directly on the Library picker (search + list)",
       pk["pickVisible"] and pk["hasList"] and pk["hasSearch"], pk)
    ck("Pick lands with NO Mode B tab shell and NO duplicate path buttons", pk["noTabShell"], pk)
    ck("the pick surface has a working commit control (#owCommit)", pk["commit"], pk)

    # ===== option 1: Text message only -> the lean compose with a working Send button =====
    open_new(pg)
    pg.click("#owPickText")
    pg.wait_for_selector("#owModeA #edSubj", timeout=6000); pg.wait_for_timeout(150)
    tx = pg.evaluate("""()=>({
      editor: !!document.querySelector('#owModeA #edSubj') && !!document.querySelector('#owModeA #edBody'),
      send: !!document.querySelector('#owModeA #nmSend'),
      noPage: !document.getElementById('owPagePanel')   // text-only: the lean surface, no page tab
    })""")
    ck("Text message only lands on the lean compose editor", tx["editor"], tx)
    ck("Text message only has a working Send button (#nmSend)", tx["send"], tx)

    ck("no uncaught page error fired", len(perr)==0, perr)
    pg.close(); b.close()
httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL NEW-MESSAGE-THREE-PATHS CHECKS PASS"))
import sys; sys.exit(1 if fails else 0)
