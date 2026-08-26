"""The board intake lands what it says it imported, in the real board, through the ONE resolver.

Drives library/board.view.html in Chromium: the "Today's batch" drop now reads through ThriveIntake.readBatch
(resolveBatch) and renders the shared report (mountIngestReport), the same path the editor upload uses. It
drops a three-item package (two new, one already in the library, archived) and reads localStorage to see
exactly what landed. The unified surface has no per-item Skip/Replace; the resolver is idempotent by slug, so
Approve imports the two new AND updates the existing one in place, un-archiving it (never left silently
archived), and the toast counts what landed - two imported and one updated, never three imported.

The package is READY_TO_SEND_BATCH06.md (ludic, wisebutterfly, 2faces); a pre-seeded archived record for the
first slug makes it the duplicate. The sandbox is Chromium; WebKit and the live relay are Thyab's device.
saveDraft writes to the browser's own localStorage here, so what this proves is what the board does on the
device, minus the page hosting that needs a GitHub token."""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
FIX = os.path.join(ROOT, "tools/fixtures/READY_TO_SEND_BATCH06.md")
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None:
            print("      " + str(d)[:300])

def open_board(pg, seed):
    pg.goto(f"{base}/library/board.view.html"); pg.wait_for_timeout(400)
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(600)
    pg.evaluate("(s)=>localStorage.setItem('thrive_opps_v1', s)", seed)
    pg.wait_for_selector("#intakeFile", state="attached", timeout=15000)

def store(pg):
    return pg.evaluate("()=>JSON.parse(localStorage.getItem('thrive_opps_v1')||'[]')")

def outcome(pg):
    # The unified surface reports through runAction's action-status line (the same as the editor), not a toast.
    n = pg.query_selector("#actionStatus .act-msg")
    return n.text_content() if n else "(no outcome)"

# One archived record already in the library for the first package slug (ludic): the duplicate.
SEED = '[{"slug":"ludic","business":"Ludic Lillian","archived":true,"published":false,"up":1}]'

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # The unified surface: drop, read the resolver report, Approve. The two new land in Draft with text; the
    # existing slug is updated in place and un-archived (idempotent by slug); the toast counts 2 + 1, not 3.
    pg = b.new_page()
    open_board(pg, SEED)
    pg.set_input_files("#intakeFile", FIX)
    pg.wait_for_selector("#intakeOut .bt tr", state="attached", timeout=8000)
    pg.wait_for_timeout(300)
    ck("the resolver report is shown before anything is written (the shared .bt report + Approve gate)",
       pg.eval_on_selector("#intakeOut .bt", "e=>!!e") and pg.eval_on_selector("#intakeOut #batchApprove", "e=>!!e"))
    ck("three opportunities resolve from the package",
       pg.eval_on_selector_all("#intakeOut .bt tbody tr td:first-child .bt-slug, #intakeOut .bt tr td:first-child .bt-slug",
                               "e=>e.map(x=>x.textContent.trim()).filter(Boolean).length") == 3)
    ck("nothing is written yet", not any(o.get("outreach_text") for o in store(pg)))

    pg.click("#intakeOut #batchApprove")
    pg.wait_for_timeout(800)
    s = store(pg)
    drafts = [o for o in s if not o.get("archived")]
    ck("the two new landed in Draft (not archived)",
       len([o for o in drafts if o.get("slug") in ("wisebutterfly", "2faces")]) == 2, [o.get("slug") for o in drafts])
    ck("each new draft carries its body text",
       all((o.get("outreach_text") or "").strip() for o in drafts if o.get("slug") in ("wisebutterfly", "2faces")))
    ck("the existing duplicate is updated in place and un-archived (never left silently archived)",
       any(o.get("slug") == "ludic" and not o.get("archived") and (o.get("outreach_text") or "").strip() for o in s),
       [(o.get("slug"), o.get("archived")) for o in s])
    ck("nothing is left archived after the import", sum(1 for o in s if o.get("archived")) == 0,
       [(o.get("slug"), o.get("archived")) for o in s])
    ck("all three landed on the active board", len([o for o in s if not o.get("archived")]) == 3, len(s))
    tt = outcome(pg)
    print("   outcome:", tt)
    ck("the confirmed outcome counts two imported and one updated, not three imported",
       "2" in tt and "updated" in tt.lower(), tt)
    pg.close()

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL BOARD INTAKE CHECKS PASS"))
raise SystemExit(1 if fails else 0)
