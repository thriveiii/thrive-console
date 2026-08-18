"""P11 · The drop surface (device gated): the tolerant reader shows resolved state + provenance, and the
needs-message row is never a dead end. Drops the batch-13 shape (six opp/<slug>/index.html folders + one
research md) plus one folder that resolves to nothing, through the REAL editor upload path (#fileInput ->
runBatch -> renderBatch). Proves: six resolve via the research md with provenance shown and zero "no
instruction entry"; the needs-message row offers a one-tap Write action that opens the composer.
Engine-independent; WebKit is Thyab's device gate."""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:300])

RESEARCH = open(os.path.join(ROOT, "tools/fixtures/BATCH13_research_and_messages.md")).read()

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

SLUGS = ["river-sea-chocolates", "ludic-lillian", "wise-butterfly", "jamiyat-alsharq-lilhulwiat", "wander-wick-candles", "corner-bloom-studio"]

# Build the drop as File objects with folder paths (the batch-13 shape), plus one folder that resolves to
# nothing, then set them on the real #fileInput and fire change. No zip needed: readFiles reads loose files.
def drop_js():
    files = []
    for s in SLUGS:
        files.append({"name": f"opp/{s}/index.html", "text": f"<!doctype html><title>{s}</title><h1>{s}</h1>", "type": "text/html"})
    files.append({"name": "opp/silent-shop/index.html", "text": "<!doctype html><title>Silent Shop</title><p>nothing to reach here</p>", "type": "text/html"})
    files.append({"name": "BATCH13_research_and_messages.md", "text": RESEARCH, "type": "text/markdown"})
    import json
    return "const SPEC=" + json.dumps(files) + ";" + r"""
      const dt = new DataTransfer();
      SPEC.forEach(f => dt.items.add(new File([f.text], f.name, {type:f.type})));
      const inp = document.getElementById('fileInput');
      inp.files = dt.files;
      inp.dispatchEvent(new Event('change', {bubbles:true}));
    """

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page(viewport={"width": 1280, "height": 1100})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{base}/library/console.html#editor")
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn")
    pg.evaluate("()=>{ var g=document.getElementById('thriveGate'); if(g) g.remove(); document.documentElement.classList.remove('gate-locked'); }")
    pg.wait_for_selector("#mode_upload", timeout=15000)
    pg.click("#mode_upload"); pg.wait_for_selector("#fileInput", state="attached", timeout=8000)

    pg.evaluate(drop_js())
    pg.wait_for_selector("#batchPanel .bt tr.is-matched, #batchPanel .bt tr.is-needs", timeout=15000)
    pg.wait_for_timeout(400)

    rep = pg.evaluate("""()=>{
      var rows=[].slice.call(document.querySelectorAll('#batchPanel .bt tbody tr, #batchPanel .bt tr')).filter(function(tr){ return tr.querySelector('td'); });
      var panel=document.getElementById('batchPanel');
      // a research-resolved row: its provenance cell reads research md AND page/subject/body/send are all
      // marked present (the check glyph). The batch-13 defect was these rows showing "no instruction entry".
      var researchRows=rows.filter(function(tr){ return tr.querySelector('.bt-prov-research_md'); });
      function resolved(tr){ var ys=tr.querySelectorAll('.bt-c .bt-y').length; return ys>=4; }
      return {
        rowCount: rows.length,
        provResearch: researchRows.length,
        researchAllResolved: researchRows.every(resolved),
        needs: document.querySelectorAll('#batchPanel .bt tr.is-needs').length,
        writeBtns: document.querySelectorAll('#batchPanel .bt-write').length,
        noInstruction: (panel.textContent||'').toLowerCase().indexOf('no instruction')>=0,
        panelText: (panel.textContent||'').slice(0,80)
      }; }""")
    ck("the drop surface renders one row per opportunity (six resolved + one needs-message)",
       rep["rowCount"] == 7, rep)
    ck("all six batch-13 opportunities resolve via the research md (page, subject, body and send-to all present)",
       rep["provResearch"] == 6 and rep["researchAllResolved"] is True, rep)
    ck("there is NO 'no instruction entry' anywhere on the surface (the batch-13 defect is gone)",
       rep["noInstruction"] is False, rep["panelText"])
    ck("the unresolved opportunity is created 'needs message', never dropped, with a one-tap Write action",
       rep["needs"] == 1 and rep["writeBtns"] == 1, rep)

    # the Write action opens the composer to write by hand (never a dead end)
    pg.on("dialog", lambda d: d.accept())
    pg.click("#batchPanel .bt-write")
    pg.wait_for_timeout(1500)
    hash_now = pg.evaluate("()=>location.hash||''")
    ck("tapping Write opens the composer (the road is never blocked)", "compose" in hash_now, hash_now)

    ck("no page errors across the whole ingest surface session", len(errs) == 0, errs)
    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL INGEST SURFACE CHECKS PASS"))
raise SystemExit(1 if fails else 0)
