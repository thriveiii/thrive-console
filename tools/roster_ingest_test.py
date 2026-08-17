"""Roster ingest (P5 / D3). Engine-independent; WebKit is Thyab's device gate.

parseRoster splits / trims / dedupes / validates / extracts names, preserves Arabic names EXACTLY, and flags
malformed / duplicate / typo-domain rows. CSV columns are order-free (the @ field is the email). The editor
commits valid rows to the opp record additively; nothing sends; inline edits persist across a re-read.
"""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

MESSY = "\n".join([
  "Basel <basel@gmail.com>",
  "ليّا نديم <laya@atelier.example>",
  "omar@studio.example",
  "basel@gmail.com",
  "bad@nope",
  "typo@gmial.com",
  "Lina Q,lina@school.com",
  "ceo@oa.example,Organic Allure",
  "email,name",
])

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page(viewport={"width": 1280, "height": 900})
    pg.goto(f"{base}/library/console.html")
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn")
    pg.evaluate("()=>{ var g=document.getElementById('thriveGate'); if(g) g.remove(); document.documentElement.classList.remove('gate-locked'); }")
    pg.wait_for_function("()=>typeof window.parseRoster==='function' && typeof window.thriveModal==='object' && typeof window.getDraft==='function'", timeout=15000)

    rows = pg.evaluate("(s)=>window.parseRoster(s)", MESSY)
    by = { r["addr"]: r for r in rows }

    # ---- the parser: split, extract names, validate, flag; CSV order-free; header yields no row ----
    ck("the mixed list parses to 8 recipients (the bare 'email,name' header yields no row)", len(rows) == 8, [r["addr"] for r in rows])
    ck("Name <email> extracts the name and address", [r for r in rows if r["addr"]=="basel@gmail.com"][0]["name"]=="Basel")
    ck("a CSV row (name,email) extracts both", by.get("lina@school.com",{}).get("name")=="Lina Q", by.get("lina@school.com"))
    ck("a reversed CSV row (email,name) still detects name and email", by.get("ceo@oa.example",{}).get("name")=="Organic Allure", by.get("ceo@oa.example"))
    ck("a malformed address is flagged invalid, not silently dropped",
       any((not r["valid"]) and "invalid" in r["flags"] and r["addr"]=="bad@nope" for r in rows))
    ck("a duplicate is flagged (not merged away)", "dup" in (by.get("basel@gmail.com",{}) and [r for r in rows if r["addr"]=="basel@gmail.com"][1]["flags"]),
       [r for r in rows if r["addr"]=="basel@gmail.com"])
    ck("a typo domain (gmial.com) is flagged", "typo" in by.get("typo@gmial.com",{}).get("flags",[]), by.get("typo@gmial.com"))

    # ---- Arabic names are preserved EXACTLY (no case change, no mangling), lang detected ----
    ar = by.get("laya@atelier.example",{})
    ck("an Arabic name is preserved byte-for-byte and tagged lang ar", ar.get("name")=="ليّا نديم" and ar.get("lang")=="ar", ar)

    # ---- the editor commits valid rows to the opp record additively; nothing sends ----
    pg.evaluate("""()=>{ localStorage.setItem('thrive_opps_v1', JSON.stringify([{slug:'camp1', business:'Campaign One', published:true, up:1}])); }""")
    pg.evaluate("()=>{ location.hash='#board'; }")
    pg.evaluate("()=>window.thriveModal.open('camp1','overview','Campaign One')")
    pg.evaluate("()=>{ var d=document.querySelector('.roster-ed'); if(d) d.open=true; }")
    pg.wait_for_selector(".roster-ed .rst-paste", state="visible", timeout=8000)
    pg.fill(".roster-ed .rst-paste", "Tracy <tracy@shop.example>\nlea@atelier.example")
    pg.click(".roster-ed .rst-parse")
    pg.wait_for_selector(".roster-ed .rst-addvalid", timeout=5000)
    pg.click(".roster-ed .rst-addvalid")
    pg.wait_for_timeout(300)
    recips = pg.evaluate("()=>{ var d=window.getDraft('camp1'); return (d&&d.recipients)||[]; }")
    addrs = sorted([r["addr"] for r in recips])
    ck("Preview and add commits the valid rows to the opp record (additive)", addrs==["lea@atelier.example","tracy@shop.example"], recips)
    ck("nothing was sent from the roster screen (no mail rows)",
       pg.evaluate("()=>window.getMailLog().filter(m=>m&&m.opp==='camp1').length")==0)

    # ---- inline edit persists across a re-read ----
    pg.wait_for_selector('.roster-ed .rst-row .rst-name', timeout=5000)
    pg.evaluate("""()=>{ var inp=document.querySelector('.roster-ed .rst-row .rst-name');
      inp.value='Tracy Bell'; inp.dispatchEvent(new Event('change',{bubbles:true})); }""")
    pg.wait_for_timeout(300)
    edited = pg.evaluate("""()=>{ var d=window.getDraft('camp1'); return (d.recipients||[]).map(r=>r.name).filter(Boolean); }""")
    ck("an inline name edit persists to the opp record", "Tracy Bell" in edited, edited)
    # re-open (a fresh read) and confirm it survived
    pg.evaluate("()=>window.thriveModal.reread && window.thriveModal.reread()")
    pg.wait_for_timeout(200)
    survived = pg.evaluate("""()=>{ var v=document.querySelector('.roster-ed .rst-row .rst-name'); return v?v.value:''; }""")
    ck("the edit survives a re-read (persisted, not just in the DOM)", survived=="Tracy Bell", survived)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL ROSTER INGEST CHECKS PASS"))
raise SystemExit(1 if fails else 0)
