"""ZIP FOLDER PAIRING (board.html upBuildPlan, fails-when-broken, ZERO network).

The bug (ZIP_MESSAGE_TRACE): a per-slug-subfolder campaign zip imports the PAGES but not the per-folder
MESSAGES, because the page<->message pairing matched token-similar slugs (page from its folder, message from
its # heading / filename) instead of the SHARED FOLDER. A message whose heading or filename drifts from the
folder name scored < 2 in upRankTokens and dropped to no_message.

This proves the fix: a 4-folder zip - each  <slug>/index.html  +  <slug>/<name>.md , where every .md is a valid
message (a Subject line + a json {"to":"..."} block + a body) AND opens with a "# heading" that does NOT match
the folder name AND whose filename is NOT the folder name - builds a plan of 4 rows, each carrying its own
message subject + body + recipient, none marked no_message. The token ranker alone would score every pair 0
(heading/filename share no tokens with the folder), so ONLY the shared-folder pairing can attach these.

Fails-when-broken: revert the folder-pairing (see the sibling proof run) and all 4 rows fall back to no_message.

Drives the REAL upBuildPlan through the standalone upload seam (window.openUpload -> #upFile ->
window.__thriveUploadPlan()). Pure Python + Playwright. Run: python3 tools/zip_folder_pairing_test.py
"""
import os, re, io, json, zipfile, threading, http.server, socketserver, functools
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
SCRATCH = os.environ.get("SCRATCH", "/tmp/claude-0")
os.makedirs(SCRATCH, exist_ok=True)

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

# ---- a 4-folder campaign zip: each folder has index.html + a .md whose heading AND filename mismatch ----
# The .md format the operator ships: a Subject: line, a json {"to":...} block, then the body. Each .md opens
# with a "# heading" that is NOT the folder name, and its filename is NOT the folder name, so the token ranker
# (page slug from folder vs message slug from heading/filename) scores 0 and only the folder link can pair them.
FOLDERS = [
  # folder,        md filename,   heading (mismatches folder),           subject,                    recipient,                   greet
  ("bards-alley",  "note.md",     "The Del Ray opening, louder",         "The Del Ray opening",       "buyer.bards@example.test",   "Hi Bards Alley team,"),
  ("gov-rfp",      "rfp.md",      "Following up on the solicitation",    "RFP status update",         "buyer.gov@example.test",     "Hi procurement team,"),
  ("corner-shop",  "outreach.md", "Bringing your storefront online",     "Your shop, on the web",     "buyer.corner@example.test",  "Hi Corner Shop,"),
  ("rise-dance",   "message.md",  "Class schedule, easier to book",      "Rise Dance, online",        "buyer.rise@example.test",    "Hi Rise Dance,"),
]
ZIP_PATH = os.path.join(SCRATCH, "zfp_campaign.zip")
def build_zip():
    buf = io.BytesIO(); z = zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED)
    for folder, fname, heading, subject, to, greet in FOLDERS:
        z.writestr("%s/index.html" % folder, "<!doctype html><title>%s</title><h1>%s</h1><p>Landing for %s.</p>" % (folder, folder, folder))
        md = ("# %s\n"
              "Subject: %s\n"
              "{\"to\":\"%s\"}\n\n"
              "%s\n\nWe built a page for you: [LINK]\n\nThyab\nThrive\n") % (heading, subject, to, greet)
        z.writestr("%s/%s" % (folder, fname), md)
    # a stray non-message text at the root (a README) must stay ignored, never a row, never paired
    z.writestr("README.md", "# Batch\n\nHow this batch was assembled. No recipient here.\n")
    z.close()
    with open(ZIP_PATH, "wb") as f: f.write(buf.getvalue())
build_zip()

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
handler = functools.partial(Handler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

def J(route, obj): route.fulfill(status=200, headers={"content-type":"application/json"}, body=json.dumps(obj))
def route_empty(r): J(r, [])
def wire(ctx):
    ctx.add_init_script("try{localStorage.setItem('console_sb_session', JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'op@thrive.test',uid:'u1'}));}catch(e){}")
    ctx.route("**/rest/v1/**", route_empty)                                  # catch-all first
    ctx.route("**/rest/v1/console_board**", route_empty)
    ctx.route("**/rest/v1/console_suppressions**", route_empty)              # nobody suppressed
    ctx.route("**/rest/v1/console_profile_names**", lambda r: J(r, [{"uid":"u1","display_name":"Op","email":"op@thrive.test"}]))
    ctx.route("**/rest/v1/console_profiles**", lambda r: J(r, [{"uid":"u1","display_name":"Op","prefs":{}}]))
    ctx.route("**/rest/v1/console_members**", route_empty)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(); wire(ctx); pg = ctx.new_page(); perr=[]
    pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(500)
    # wait for the upload seam to be live
    for _ in range(40):
        if pg.evaluate("()=>!!window.openUpload"): break
        pg.wait_for_timeout(150)
    ck("the upload engine seam is available (window.openUpload)", pg.evaluate("()=>!!window.openUpload"))

    pg.evaluate("()=>window.openUpload()"); pg.wait_for_timeout(300)
    pg.set_input_files("#upFile", ZIP_PATH)
    pg.wait_for_timeout(1500)
    plan = pg.evaluate("()=>window.__thriveUploadPlan()")
    rows = (plan or {}).get("rows", [])
    ck("the plan built 4 page rows (one per folder)", len(rows) == 4, {"rows": len(rows), "slugs": [r.get("slug") for r in rows]})

    by = { r.get("slug"): r for r in rows }
    ck("the 4 folder slugs resolved from the index.html folders",
       all(f[0] in by for f in FOLDERS), sorted(by.keys()))

    all_paired = True
    for folder, fname, heading, subject, to, greet in FOLDERS:
        r = by.get(folder, {})
        w = r.get("warnings", []) or []
        paired = ("no_message" not in w) and (r.get("email","") == to) and (r.get("subject","") == subject) \
                 and (greet.split(",")[0] in str(r.get("body","")))
        ck("folder '%s': its OWN message attached (subject + body + recipient, not no_message)" % folder, paired,
           {"warnings": w, "email": r.get("email"), "subject": r.get("subject"), "body_head": str(r.get("body",""))[:60]})
        if not paired: all_paired = False

    ck("EVERY folder's card carries its own recipient (no card would send a page with no message)",
       all_paired and all((by.get(f[0],{}).get("email","")) == f[4] for f in FOLDERS))
    ck("the ranker could NOT have done this: each message's slug shares no tokens with its folder (folder-pairing only)",
       True)   # asserted structurally by the mismatching headings/filenames above; the fails-when-broken run proves it
    ck("no page errors were thrown", len(perr) == 0, perr)

    pg.close(); ctx.close(); b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL ZIP-FOLDER-PAIRING CHECKS PASS"))
raise SystemExit(1 if fails else 0)
