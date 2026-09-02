"""The window (IDENTITY.md law 3.6 and 3.7), conformance. PR-1 of the three-surfaces program.

The app shell ALREADY carries the centred window (#modal, console.html:1259) with the five canonical tabs and
move-not-copy borrowing into #modalHost (app.js:12808). This gate holds that law in place and fails when broken:

  1. law 3.6, the five canonical tabs in order: overview, text, page, outreach, history, and the sixth
     tab ratified by IDENTITY.md section 13, discussion (the team-internal collaboration surface).
  2. law 3.7, BORROWED not copied: exactly one #eSend in the document after open, and after close.
  3. law 3.6, centred window at 1180 (min(920px, 92vw)); bottom sheet below 720px, anchored to the bottom edge.
  4. law 3.6, only the BODY scrolls: #modalBody is the scroll container, the window itself does not scroll.
  5. the approval gate is visible: the window's action set is gated by role (owner vs member), not shown to all.

Runs against library/console.html with the gate removed, exactly as send_confirmed_test does.
Run: python3 tools/window_conformance_test.py
"""
import os, re, http.server, socketserver, threading, functools, sys

ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:300])

app = open(os.path.join(ROOT, "library/app.js"), encoding="utf-8").read()
shell = open(os.path.join(ROOT, "library/console.html"), encoding="utf-8").read()
css = open(os.path.join(ROOT, "library/styles.css"), encoding="utf-8").read()

# ---- source guards (law 3.7 and the sheet rule live in source) --------------------------------------
ck("law 3.7: the editor and composer are MOVED into #modalHost, never duplicated",
   "modalHost" in app and "rather than duplicating" in app)
ck("law 3.6: the window becomes a bottom sheet below 720px, by logical properties",
   bool(re.search(r"@media\(max-width:720px\)\{\s*\.modal\{", css)) and "inset-inline:" in css and "inset-block:" in css)
i18n = open(os.path.join(ROOT, "library/i18n.js"), encoding="utf-8").read()
ck("the approval gate: the window's Send is gated by ROLE (a member never sends directly)",
   "var maySend = isOwnerMember();" in app and "canSend = maySend &&" in app,
   "the window's Send bar is not owner-gated")
ck("the approval gate: a member reads WHY, never a silent absence",
   'class="mw-muted mw-gate-owner"' in app and "mw_gate_owner_sends" in app,
   "no explanatory line for a member")
ck("law 7: the gate line ships in BOTH languages (English and Gulf MSA)",
   i18n.count("mw_gate_owner_sends") == 2 and "الإرسال خطوة المالك" in i18n,
   "the key is missing from one of the two dictionaries")
# law 3.6: the tabs are nouns, and law 7: a primary interface is never half-translated. Every tab key must
# exist in BOTH dictionaries, so a tab can never render as a raw key or as English wearing Arabic.
missing = [k for k in ("mw_overview", "mw_text", "mw_page", "mw_outreach", "mw_history")
           if i18n.count(k + ":") != 2]
ck("law 7: all five tab keys ship in BOTH languages", not missing, missing)

class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
handler = functools.partial(H, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"

from playwright.sync_api import sync_playwright

UNGATE = """()=>{ document.documentElement.classList.remove('gate-locked');
  const g=document.getElementById('thriveGate'); if(g) g.remove(); }"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # ---- 1. the five canonical tabs, in order -------------------------------------------------------
    pg = b.new_page(viewport={"width": 1180, "height": 900})
    pg.goto(f"{base}/library/console.html", wait_until="load"); pg.wait_for_timeout(700)
    pg.evaluate(UNGATE)
    tabs = pg.evaluate("()=>[].map.call(document.querySelectorAll('#modalTabs .modal-tab'), b=>b.getAttribute('data-tab'))")
    ck("law 3.6: the first five tabs are overview, text, page, outreach, history, in that order",
       tabs[:5] == ["overview", "text", "page", "outreach", "history"], tabs)
    ck("IDENTITY.md section 13: the sixth tab is discussion (the ratified team-internal surface)",
       len(tabs) >= 6 and tabs[5] == "discussion", tabs)

    # ---- 2 to 4. open the window: borrowing, geometry, scrolling ------------------------------------
    opened = pg.evaluate("""async ()=>{
      if(!window.thriveModal) return { no_modal:true };
      const before = document.querySelectorAll('#eSend').length;
      window.thriveModal.open('probe-slug','text','Probe');
      await new Promise(r=>setTimeout(r,400));
      const m = document.getElementById('modal');
      const body = document.getElementById('modalBody');
      const r = m ? m.getBoundingClientRect() : null;
      const out = { before, during: document.querySelectorAll('#eSend').length,
        open: !!(m && !m.hidden), w: r? Math.round(r.width):0,
        bodyOverflow: body? getComputedStyle(body).overflowY : '',
        modalOverflow: m? getComputedStyle(m).overflowY : '' };
      window.thriveModal.close(true);
      await new Promise(r=>setTimeout(r,300));
      out.after = document.querySelectorAll('#eSend').length;
      return out;
    }""")
    ck("the window opens on a named tab (thriveModal.open(slug, tab, name))", opened.get("open") is True, opened)
    ck("law 3.7: exactly ONE #eSend while the window is open (borrowed, never a second copy)",
       opened.get("during") == 1, opened)
    ck("law 3.7: exactly ONE #eSend after close (the node was RETURNED, not destroyed or duplicated)",
       opened.get("after") == 1, opened)
    ck("law 3.6: the window is centred at min(920px, 92vw) on a wide viewport",
       0 < opened.get("w", 0) <= 920, opened.get("w"))
    ck("law 3.6: only the BODY scrolls (the window itself does not)",
       opened.get("bodyOverflow") in ("auto", "scroll") and opened.get("modalOverflow") in ("visible", "hidden", "clip"), opened)

    # ---- 3b. the bottom sheet below 720px -----------------------------------------------------------
    ph = b.new_page(viewport={"width": 390, "height": 800})
    ph.goto(f"{base}/library/console.html", wait_until="load"); ph.wait_for_timeout(700)
    ph.evaluate(UNGATE)
    sheet = ph.evaluate("""async ()=>{
      if(!window.thriveModal) return { no_modal:true };
      window.thriveModal.open('probe-slug','overview','Probe');
      await new Promise(r=>setTimeout(r,400));
      const m=document.getElementById('modal'); const r=m.getBoundingClientRect();
      return { w:Math.round(r.width), vw:innerWidth, bottom:Math.round(r.bottom), vh:innerHeight };
    }""")
    ck("law 3.6: below 720px the window is a bottom sheet (near full width, anchored to the bottom edge)",
       sheet.get("w", 0) >= sheet.get("vw", 9999) * 0.85 and abs(sheet.get("bottom", 0) - sheet.get("vh", 0)) <= 2, sheet)

    b.close()

print("")
if fails:
    print("%d failed" % len(fails)); sys.exit(1)
print("0 failed")
