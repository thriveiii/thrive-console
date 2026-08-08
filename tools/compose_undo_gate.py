"""Undo and redo on the outreach message text, in the real composer, in a real browser.

Drives library/compose.html in Chromium: it proves the undo and redo history is scoped to the outreach
message text fields (the contenteditable message body #ebody, the closing block #sigBox, the plain-text
alternative #plainBox), that it survives the auto-save (a real persistCompose write to localStorage) and
a node rebuild that clears the native undo stack, that the keyboard shortcut and the composer control each
perform undo and redo, and that the controls disable on an empty stack. It also confirms the page editor
was left untouched: no undo wiring and no undo control remain in initEditor or its markup.

The sandbox is Chromium; the real Cmd+Z on the iPad keyboard and WebKit are Thyab's device gate. On Linux
Chromium the platform accelerator is Control, which the composer accepts (it reads metaKey OR ctrlKey), so
the same handler that runs Cmd+Z on the iPad is what runs here under Control."""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
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

def bodytext(pg):
    return pg.eval_on_selector("#ebody", "e => e.textContent")

# Static source guards: the page editor keeps no undo, and the composer owns it.
app_src = open(f"{ROOT}/library/app.js").read()
console_src = open(f"{ROOT}/library/console.html").read()
ck("initEditor no longer wires ThriveEditHistory (undo left the page editor)",
   "Undo and redo do not live on this page editor" in app_src and "HIST_FIELDS=[\"f_biz\"" not in app_src)
ck("no editor undo control remains in the built console", "edUndo" not in console_src and "edRedo" not in console_src)
ck("the composer wires exactly the message text fields",
   'HIST_FIELDS=["ebody","sigBox","plainBox"]' in app_src)
ck("the composer control is present in the built console", "cmpUndo" in console_src and "cmpRedo" in console_src)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page()
    # A slug gives the composer a record to auto-save into (persistCompose holds nothing without one).
    # The body still loads empty, so the typing and undo assertions below start from a clean base.
    pg.goto(f"{base}/library/compose.html?slug=undo-save-test")
    pg.wait_for_timeout(500)
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(700)
    pg.wait_for_selector("#ebody", timeout=15000)
    pg.wait_for_selector("#cmpUndo", timeout=5000)

    # 1. Empty stack: both controls greyed and inert.
    ck("undo control is disabled on an empty stack", pg.get_attribute("#cmpUndo", "disabled") is not None)
    ck("redo control is disabled on an empty stack", pg.get_attribute("#cmpRedo", "disabled") is not None)

    # 2. Type two bursts (separated past the coalesce window) so there are two undo steps.
    pg.click("#ebody")
    pg.keyboard.type("Hello")
    pg.wait_for_timeout(750)
    pg.keyboard.type(" world")
    pg.wait_for_timeout(200)
    ck("body holds the typed text", bodytext(pg) == "Hello world", bodytext(pg))
    ck("undo control enables once there is something to undo", pg.get_attribute("#cmpUndo", "disabled") is None)

    # 3. The real auto-save runs (persistCompose is debounced ~600ms), then a node rebuild clears the
    #    native undo stack. The app-level history must still step the text back.
    pg.wait_for_timeout(800)
    saved = pg.evaluate("() => Object.keys(localStorage).some(k => k==='thrive_opps_v1')")
    ck("the auto-save wrote to localStorage (unchanged behavior)", saved)
    pg.eval_on_selector("#ebody", "e => { e.innerHTML = e.innerHTML; }")   # rebuild children: native undo is now gone
    ck("text intact right after the rebuild", bodytext(pg) == "Hello world", bodytext(pg))

    # 4. Keyboard undo (Control on Linux Chromium; Cmd on the iPad) steps back through both bursts.
    pg.click("#ebody")
    pg.keyboard.press("Control+z")
    pg.wait_for_timeout(150)
    ck("Ctrl+Z steps back the second burst (survives auto-save and rebuild)", bodytext(pg) == "Hello", bodytext(pg))
    pg.keyboard.press("Control+z")
    pg.wait_for_timeout(150)
    ck("Ctrl+Z again steps back to empty", bodytext(pg) == "", bodytext(pg))
    ck("undo control disables again at the base of the stack", pg.get_attribute("#cmpUndo", "disabled") is not None)

    # 5. Keyboard redo, both accelerators.
    pg.keyboard.press("Control+Shift+z")
    pg.wait_for_timeout(150)
    ck("Ctrl+Shift+Z redoes the first burst", bodytext(pg) == "Hello", bodytext(pg))
    pg.keyboard.press("Control+y")
    pg.wait_for_timeout(150)
    ck("Ctrl+Y redoes the second burst", bodytext(pg) == "Hello world", bodytext(pg))

    # 6. The composer control does the same as the shortcut.
    pg.click("#cmpUndo")
    pg.wait_for_timeout(150)
    ck("the undo control steps the text back", bodytext(pg) == "Hello", bodytext(pg))
    pg.click("#cmpRedo")
    pg.wait_for_timeout(150)
    ck("the redo control steps the text forward", bodytext(pg) == "Hello world", bodytext(pg))

    # 7. The closing block textarea has its own scoped history (the value-based path).
    pg.click("#sigWrap > summary")
    pg.wait_for_timeout(150)
    pg.fill("#sigBox", "")
    pg.click("#sigBox")
    pg.keyboard.type("Warm regards")
    pg.wait_for_timeout(200)
    pg.keyboard.press("Control+z")
    pg.wait_for_timeout(150)
    sig = pg.eval_on_selector("#sigBox", "e => e.value")
    ck("undo works on the closing block, and is scoped to it (body unchanged)",
       sig != "Warm regards" and bodytext(pg) == "Hello world", "sig=" + repr(sig) + " body=" + repr(bodytext(pg)))

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL COMPOSER UNDO CHECKS PASS"))
raise SystemExit(1 if fails else 0)
