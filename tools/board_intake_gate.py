"""The board intake lands what it says it imported, in the real board, in a real browser.

Drives library/board.html in Chromium against a three-item package (two new, one already in the library),
through the real intake handler and its real write (writeImport, the one writer the editor batch also
uses), and reads localStorage to see exactly what landed. It proves the two new appear in Draft with their
text, the duplicate is handled by its Skip or Replace choice, a replaced archived duplicate is un-archived
and surfaces in Draft (not left silently archived), and the toast counts only what landed, naming new,
updated and skipped distinctly, never three when two landed.

The package is READY_TO_SEND_BATCH06.md (ludic, wisebutterfly, 2faces); a pre-seeded archived record for
the first slug makes it the duplicate. The sandbox is Chromium; WebKit and the live relay are Thyab's
device. saveDraft writes to the browser's own localStorage here, so what this proves is what the board
does on the device, minus the page hosting that needs a GitHub token."""
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
    pg.goto(f"{base}/library/board.html"); pg.wait_for_timeout(400)
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(600)
    pg.evaluate("(s)=>localStorage.setItem('thrive_opps_v1', s)", seed)
    pg.wait_for_selector("#intakeFile", state="attached", timeout=15000)

def store(pg):
    return pg.evaluate("()=>JSON.parse(localStorage.getItem('thrive_opps_v1')||'[]')")

def toast(pg):
    n = pg.query_selector("#toast .toast-text")
    return n.text_content() if n else "(no toast)"

# One archived record already in the library for the first package slug (ludic): the duplicate.
SEED = '[{"slug":"ludic","business":"Ludic Lillian","archived":true,"published":false,"up":1}]'

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # Scenario A: the duplicate is left on Skip (unchecked). Two new land in Draft with text; the
    # duplicate is not imported and stays as it was; the toast counts two, never three.
    pg = b.new_page()
    open_board(pg, SEED)
    pg.set_input_files("#intakeFile", FIX)
    pg.wait_for_selector("#intakeAdd", timeout=8000)
    ck("the duplicate card is unchecked by default (Skip)", pg.eval_on_selector_all(".in-pick", "els=>els.filter(e=>e.checked).length") == 2)
    pg.click("#intakeAdd")
    pg.wait_for_timeout(600)
    sA = store(pg)
    drafts = [o for o in sA if not o.get("archived")]
    ck("A: the two new landed in Draft (not archived)", len([o for o in drafts if o.get("slug") in ("wisebutterfly", "2faces")]) == 2, [o.get("slug") for o in drafts])
    ck("A: each new draft carries its body text", all((o.get("outreach_text") or "").strip() for o in drafts if o.get("slug") in ("wisebutterfly", "2faces")))
    ck("A: the skipped duplicate was not imported (still archived)", any(o.get("slug") == "ludic" and o.get("archived") for o in sA))
    tA = toast(pg)
    print("   A toast:", tA)
    ck("A: the toast counts two, never three", "2" in tA and "3" not in tA, tA)
    ck("A: the toast names skipped", "skip" in tA.lower(), tA)
    pg.close()

    # Scenario B: the duplicate is set to Replace. It un-archives and surfaces in Draft; the toast
    # names it as updated, distinct from the two new imported.
    pg = b.new_page()
    open_board(pg, SEED)
    pg.set_input_files("#intakeFile", FIX)
    pg.wait_for_selector("#intakeAdd", timeout=8000)
    pg.click('[data-dupe="replace"]')
    pg.wait_for_timeout(150)
    pg.click("#intakeAdd")
    pg.wait_for_timeout(600)
    sB = store(pg)
    ck("B: nothing is left archived after a Replace import", sum(1 for o in sB if o.get("archived")) == 0, [(o.get("slug"), o.get("archived")) for o in sB])
    ck("B: the replaced duplicate is now a visible Draft with its text",
        any(o.get("slug") == "ludic" and not o.get("archived") and (o.get("outreach_text") or "").strip() for o in sB))
    ck("B: all three landed on the active board", len([o for o in sB if not o.get("archived")]) == 3, len(sB))
    tB = toast(pg)
    print("   B toast:", tB)
    ck("B: the toast counts two imported and one updated, not three imported", "2" in tB and "updated" in tB.lower(), tB)
    pg.close()

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL BOARD INTAKE CHECKS PASS"))
raise SystemExit(1 if fails else 0)
