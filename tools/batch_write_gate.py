"""The upload batch writes every template it confirms, in the REAL editor, in a real browser.

This drives library/editor.html in Chromium end to end: switch to Upload mode, hand the real attached
batch (READY_TO_SEND_BATCH06.md, three templates, no pages) to the actual file input, read the
confirmation the editor renders, click the real Save button, then read localStorage to see exactly what
the real approveBatch persisted. No mocking of the writer: saveDraft writes to the browser's own
localStorage here, so what this proves is what the device does. The one part it cannot exercise is
publishOpp (hosting a page needs a GitHub token, which is Thyab's device); a text-only batch takes the
no-GitHub path, which is the device's failure shape (confirmed three, wrote one), so this proves the
fix on exactly that path. WebKit is not installable in this sandbox, so iOS Safari is Thyab's gate."""
import threading, http.server, socketserver, functools, os, json
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

def read_store(page):
    return page.evaluate("() => JSON.parse(localStorage.getItem('thrive_opps_v1') || '[]')")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page()
    pg.goto(f"{base}/library/editor.html")
    # Pass the access gate the same way the device does (the passcode is Thyab's, entered here for the
    # sandbox only). WebKit is not installable here, so this is Chromium; the iPad is Thyab's gate.
    pg.wait_for_timeout(600)
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(700)
    pg.wait_for_selector("#mode_upload", state="visible", timeout=15000)
    # The console bundle links intake.js (console.html: <script src="intake.js?v=...">); the lighter
    # standalone editor.html shell does not, so load the real intake.js here to match the console. This
    # is the exact file the console runs, driving the exact approveBatch under test.
    pg.add_script_tag(path=os.path.join(ROOT, "library/intake.js"))
    ck("intake pipeline is present (as in the console)", pg.evaluate("() => typeof window.ThriveIntake === 'object'"))
    pg.evaluate("() => localStorage.removeItem('thrive_opps_v1')")

    # 1. Switch to Upload mode and hand the real three-template batch to the real file input.
    pg.click("#mode_upload")
    pg.wait_for_selector("#uploadBox:not([hidden])", timeout=5000)
    pg.set_input_files("#fileInput", FIX)

    # 2. The editor renders its confirmation. Read the count it promises.
    pg.wait_for_selector("#batchApprove", timeout=8000)
    summary = pg.inner_text(".bt-wrap ~ .hint, #batchPanel .hint")
    rowcount = pg.eval_on_selector_all("#batchPanel table.bt tr.is-warned, #batchPanel table.bt tr.is-matched", "els => els.length")
    approve_disabled = pg.get_attribute("#batchApprove", "disabled")
    print("   confirmation summary: " + summary.strip())
    ck("the report shows three template rows", rowcount == 3, rowcount)
    ck("the confirmation promises 3 (not 1)", "3" in summary, summary)
    ck("Save is enabled for a text-only batch (no page required to store)", approve_disabled is None, approve_disabled)

    # 3. Click the real Save button and let the real approveBatch run.
    pg.click("#batchApprove")
    pg.wait_for_function("() => JSON.parse(localStorage.getItem('thrive_opps_v1')||'[]').length >= 3", timeout=10000)
    store = read_store(pg)
    slugs = sorted([r.get("slug", "") for r in store])
    print("   stored slugs: " + ", ".join(slugs))
    ck("the write persisted 3 templates (confirmed count equals written count)", len(store) == 3, len(store))
    with_text = [r for r in store if (r.get("outreach_text") or "").strip()]
    ck("every stored template kept its body text (none created empty)", len(with_text) == 3,
       [(r.get("slug"), len(r.get("outreach_text") or "")) for r in store])
    with_subj = [r for r in store if (r.get("outreach_subject") or "").strip()]
    ck("every stored template kept its subject", len(with_subj) == 3, [r.get("slug") for r in with_subj])
    ck("every stored template has a business name", all((r.get("business") or "").strip() for r in store))

    # 4. Re-import the same batch: updates in place, no duplication.
    pg.set_input_files("#fileInput", FIX)
    pg.wait_for_selector("#batchApprove", timeout=8000)
    pg.click("#batchApprove")
    pg.wait_for_timeout(1200)
    store2 = read_store(pg)
    slugs2 = sorted([r.get("slug", "") for r in store2])
    print("   after re-import: " + ", ".join(slugs2))
    ck("re-import keeps 3 records, not 6 (idempotent in place)", len(store2) == 3, len(store2))
    ck("re-import adds no numeric-suffixed sibling", not any("-2" in s or "-3" in s for s in slugs2), slugs2)
    ck("text still present after re-import", all((r.get("outreach_text") or "").strip() for r in store2))

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL SANDBOX CHECKS PASS"))
raise SystemExit(1 if fails else 0)
