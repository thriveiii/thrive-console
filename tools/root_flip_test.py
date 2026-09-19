"""LANE F, the ROOT FLIP: console.thriveiii.com serves board.html at the root, not the old app.js console.

WHY THIS EXISTS. Every fix we shipped this past week - the campaign-message write, the folder pairing, the
B2 suppression guard, the unified window, Library delete, per-recipient status - lives in the NEW engine,
library/board.html. But the operator was landing on library/console.html, which loads app.js (the OLD engine),
so none of it went live and messages kept dropping. The root is generated: publish/index.html is a session
router (tools/bundle.js emits it) that forwards a live session to the served shell. This test pins the flip:
the router forwards to board.html, and the old app.js shell is no longer the auto path.

FAILS WHEN BROKEN. Revert the flip in tools/bundle.js (toBoard -> toConsole, the entry links back to
console.html) and rebuild: the behavioral half times out waiting for the root to land on board.html, and the
source half fails on the auto-forward target. That is the exact failure the task names: "the root still
serving the old app.js shell as primary -> fails."

DO NOT LOSE A FEATURE. board.html is a single-surface app and does not yet carry Contacts / Insights /
Batches. The flip keeps a labelled "Legacy console" escape on the root so those app.js screens stay reachable
until they are rebuilt in board.html. This test also guards that escape, and that the board.html the root
lands on actually carries the daily flow (campaign upload, Library delete, the unified window).
"""
import threading, http.server, socketserver, functools, os, sys, json, hashlib
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True; threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

# ============================ SOURCE GUARDS (the committed root + the flip target) ============================
idx = open(f"{ROOT}/index.html").read()
board = open(f"{ROOT}/library/board.html").read()

ck("ROOT: the auto-forward target is library/board.html (the router replaces to it)",
   'location.replace("./library/board.html' in idx)
ck("ROOT: the root no longer AUTO-forwards to the app.js console shell",
   'location.replace("./library/console.html' not in idx)
ck("ROOT: the primary entry link (Open the board) points at board.html",
   'id="idxCon" href="./library/board.html' in idx)
ck("ROOT: a labelled LEGACY console escape is kept (Contacts / Insights / Batches not lost)",
   'id="idxSafe" href="./library/console.html' in idx and "Legacy console" in idx)
ck("ROOT: the served-shell probe tests board.html against its published digest",
   './library/board.html?v="+BUILD+"&probe="' in idx and "v.boardBytes" in idx and "v.boardSha256" in idx)

# The board.html the root now lands on must carry the daily flow, or the flip would lose a capability.
ck("FLIP TARGET: campaign zip upload is present in board.html",
   "owCampaignFile" in board and "ow_campaign_upload" in board)
ck("FLIP TARGET: Library delete is present in board.html",
   "lib_del_confirm" in board)
ck("FLIP TARGET: the unified window is present (card tap -> detail, New message -> mode selector)",
   'openOppWindow(slug, "detail")' in board and "openOppWindow(slug, null)" in board)
ck("FLIP TARGET: the send path with the B2 suppression guard is present",
   "ensureSuppress" in board and "runSend" in board)

# ============================ VERSION AUTHORITY (the probe compares against these) ============================
vj = json.load(open(f"{ROOT}/version.json"))
board_bytes = open(f"{ROOT}/library/board.html", "rb").read()
board_sha = hashlib.sha256(board_bytes).hexdigest()
ck("version.json boardBytes matches the shipped board.html byte for byte",
   vj.get("boardBytes") == len(board_bytes), (vj.get("boardBytes"), len(board_bytes)))
ck("version.json boardSha256 matches the shipped board.html",
   vj.get("boardSha256") == board_sha, (vj.get("boardSha256"), board_sha))
ck("version.json still carries consoleBytes/consoleSha256 (the legacy shell + failsafe still validate)",
   "consoleBytes" in vj and "consoleSha256" in vj)

# ============================ BEHAVIORAL (the real router in a browser) ============================
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width":1280,"height":900})
    pg = ctx.new_page()

    # ?stay=1 is the manual launcher: no auto hand-off, so we can seed a live session on this origin first.
    pg.goto(f"{base}/?stay=1")
    pg.wait_for_selector("#idxCon", timeout=8000)

    # The static launcher links, painted at first paint, are the flip made visible.
    launcher = pg.evaluate("""()=>({
        msg: (document.querySelector('#idxMsg a')||{}).getAttribute ? document.querySelector('#idxMsg a').getAttribute('href') : '',
        con: (document.getElementById('idxCon')||{}).getAttribute ? document.getElementById('idxCon').getAttribute('href') : '',
        normal: (document.getElementById('idxNormal')||{}).getAttribute ? document.getElementById('idxNormal').getAttribute('href') : '',
        legacyHref: (document.getElementById('idxSafe')||{}).getAttribute ? document.getElementById('idxSafe').getAttribute('href') : '',
        legacyText: (document.getElementById('idxSafe')||{}).textContent || ''
    })""")
    ck("launcher: the primary links open board.html",
       "library/board.html" in launcher["con"] and "library/board.html" in launcher["normal"]
       and "library/board.html" in launcher["msg"], launcher)
    ck("launcher: the legacy escape opens console.html and is labelled with what it holds",
       "library/console.html" in launcher["legacyHref"]
       and ("Contacts" in launcher["legacyText"] or "Legacy" in launcher["legacyText"]), launcher)

    # Seed a LIVE (non-expired) session, then hit the real root: the router must forward to board.html.
    pg.evaluate("""()=>localStorage.setItem('console_sb_session', JSON.stringify({
        access_token:'jwt', refresh_token:'r',
        expires_at: Math.floor(Date.now()/1000) + 3600, uid:'op', email:'op@x' }))""")
    pg.goto(f"{base}/")
    landed = ""
    try:
        pg.wait_for_url("**/library/board.html**", timeout=8000)
        landed = pg.url
    except Exception:
        landed = pg.url
    ck("BEHAVIORAL: a live session forwards the root to board.html (THE FLIP)",
       "library/board.html" in landed, landed)
    ck("BEHAVIORAL: the root does not forward to the old app.js console shell",
       "console.html" not in landed, landed)

    pg.close(); ctx.close(); b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
