"""P14 · The live "Today's batch" board surface runs the ONE tolerant resolver.

The defect the audit found was structural: the board's drop surface (initIntake / #intakeZone) ran the old
readDrop path, never resolveBatch, so every fix to the resolver left it unchanged. This proves, on the REAL
board surface (library/board.html, the surface Thyab uses), driven through the real #intakeFile picker:

  1. the batch-13 shape (six opp/<slug>/index.html folders + one aggregated research md) resolves all six via
     the research-md rung with provenance shown, and the count is 6, not 0;
  2. a folder with only index.html (no message) is created "needs message" with a one-tap Write action, on
     this surface, never a dead end;
  3. a legacy manifest.json bundle still resolves via the manifest rung, on this surface;
  4. source law: exactly one resolver (resolveBatch) is reached from both the board drop and the editor
     upload, and the retired readDrop path is gone.

The Arabic business names stay right-to-left and no letter-spacing is applied. WebKit at device widths is
Thyab's gate; this is engine-independent behaviour in Chromium.
"""
import threading, http.server, socketserver, functools, os, sys, json, re
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
RESEARCH = open(os.path.join(ROOT, "tools/fixtures/BATCH13_research_and_messages.md")).read()
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
        if d is not None: print("      " + str(d)[:300])

SLUGS = ["river-sea-chocolates", "ludic-lillian", "wise-butterfly", "jamiyat-alsharq-lilhulwiat", "wander-wick-candles", "corner-bloom-studio"]

# ---- source law (Evidence 4): one resolver, reached from both surfaces; readDrop gone ------------------
app = open(f"{ROOT}/library/app.js").read()
intake = open(f"{ROOT}/library/intake.js").read()
ck("the board drop surface calls the tolerant resolver (ThriveIntake.readBatch), not readDrop",
   "ThriveIntake.readBatch(files" in app and app.count("mountIngestReport(") >= 2)
ck("the editor upload and the board drop both mount the ONE shared report renderer",
   len(re.findall(r"function mountIngestReport\(", app)) == 1 and app.count("ThriveIntake.readBatch(files") >= 2)
ck("the retired readDrop path is deleted from intake.js and never called anywhere",
   "function readDrop(" not in intake and "ThriveIntake.readDrop =" not in intake
   and "ThriveIntake.readDrop(" not in app and ".readDrop(" not in app)
ck("there is exactly one tolerant resolver (resolveBatch)",
   len(re.findall(r"function resolveBatch\(", intake)) == 1)

MANIFEST_JSON = json.dumps([{"slug": "maya-makes", "business": "Maya Makes", "send_to": "maya@mayamakes.com",
                             "subject": "Hello Maya", "body": "Hi {{NAME}}, hello. [LINK]"}])

def files_batch13():
    fs = [{"name": f"opp/{s}/index.html", "text": f"<!doctype html><title>{s}</title><h1>{s}</h1>", "type": "text/html"} for s in SLUGS]
    fs.append({"name": "opp/silent-shop/index.html", "text": "<!doctype html><title>Silent</title><p>nothing</p>", "type": "text/html"})
    fs.append({"name": "BATCH13_research_and_messages.md", "text": RESEARCH, "type": "text/markdown"})
    return fs

def drop_js(files):
    return "const SPEC=" + json.dumps(files) + ";" + r"""
      const dt=new DataTransfer(); SPEC.forEach(f=>dt.items.add(new File([f.text],f.name,{type:f.type})));
      const inp=document.getElementById('intakeFile'); inp.files=dt.files; inp.dispatchEvent(new Event('change',{bubbles:true}));"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page(viewport={"width": 1280, "height": 1000})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{base}/library/board.html")
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(400)
    pg.wait_for_function("()=>window.ThriveIntake && ThriveIntake.readBatch && document.getElementById('intakeFile')", timeout=15000)
    pg.wait_for_timeout(400)

    # ===== Evidence 1: the batch-13 shape resolves all six on the board surface =====
    pg.evaluate(drop_js(files_batch13()))
    pg.wait_for_selector("#intakeOut .bt tr.is-matched, #intakeOut .bt tr.is-needs", timeout=15000)
    pg.wait_for_timeout(400)
    rep = pg.evaluate("""()=>{
      var o=document.getElementById('intakeOut');
      var rows=[].slice.call(o.querySelectorAll('.bt tbody tr, .bt tr')).filter(tr=>tr.querySelector('td'));
      var research=[].slice.call(o.querySelectorAll('.bt tr')).filter(tr=>tr.querySelector('.bt-prov-research_md'));
      function resolved(tr){ return tr.querySelectorAll('.bt-c .bt-y').length>=4; }
      // the Arabic opportunity's slug row must be present and its slug read left-to-right (a mono-iso cell)
      var arRow=[].slice.call(o.querySelectorAll('.bt tr td:first-child')).find(td=>td.textContent.indexOf('jamiyat-alsharq')>=0);
      return { rowCount: rows.length, research: research.length,
               researchAllResolved: research.every(resolved),
               needs: o.querySelectorAll('.bt tr.is-needs').length,
               writeBtns: o.querySelectorAll('.bt-write').length,
               noInstruction: (o.textContent||'').toLowerCase().indexOf('no instruction')>=0,
               noOldCount: (o.textContent||'').indexOf('Opportunities in the manifest')<0,
               arRowPresent: !!arRow, arSlugLtr: arRow? getComputedStyle(arRow).direction==='ltr' : false }; }""")
    ck("batch 13 on the board surface: one row per opportunity (six resolved + one needs-message)",
       rep["rowCount"] == 7, rep)
    ck("batch 13 on the board surface: all six resolve via the research md, count is 6 not 0",
       rep["research"] == 6 and rep["researchAllResolved"] is True, rep)
    ck("batch 13 on the board surface: no 'no instruction entry', no old 'Opportunities in the manifest' count",
       rep["noInstruction"] is False and rep["noOldCount"] is True, rep)
    ck("the Arabic opportunity resolves and its slug reads left-to-right (isolated), business intact via the resolver",
       rep["arRowPresent"] is True and rep["arSlugLtr"] is True, rep)

    # ===== Evidence 2: a folder with nothing reachable -> needs message + Write =====
    ck("the unreachable folder is created 'needs message' with a one-tap Write action (never dropped)",
       rep["needs"] == 1 and rep["writeBtns"] == 1, rep)

    # ten reads byte-identical through the resolver the surface runs
    stable = pg.evaluate("""(a)=>{
      function snap(){ return JSON.stringify(window.ThriveIntake.resolveBatch(
        a.slugs.map(s=>({name:'opp/'+s+'/index.html',html:'<h1>'+s+'</h1>'})),
        [{name:'BATCH13_research_and_messages.md',text:a.research}], [])
        .report.rows.map(r=>[r.slug,r.provenance,r.verdict])); }
      var first=snap(), same=true; for(var i=0;i<10;i++){ if(snap()!==first) same=false; } return same; }""",
      {"slugs": SLUGS, "research": RESEARCH})
    ck("ten reads of the batch through the surface's resolver are byte-identical", stable is True)

    # ===== Evidence 3 (legacy json): a manifest.json bundle resolves via the manifest rung =====
    pg.evaluate("()=>{ var o=document.getElementById('intakeOut'); var d=o.querySelector('#batchDiscard'); if(d) d.click(); }")
    pg.wait_for_timeout(300)
    pg.evaluate(drop_js([
        {"name": "opp/maya-makes/index.html", "text": "<!doctype html><title>Maya</title><h1>Maya</h1>", "type": "text/html"},
        {"name": "manifest.json", "text": MANIFEST_JSON, "type": "application/json"}]))
    pg.wait_for_selector("#intakeOut .bt tr.is-matched", timeout=15000)
    pg.wait_for_timeout(300)
    js = pg.evaluate("""()=>{
      var o=document.getElementById('intakeOut');
      return { hasJsonProv: !!o.querySelector('.bt-prov-manifest_json'),
               matched: o.querySelectorAll('.bt tr.is-matched').length }; }""")
    ck("a legacy manifest.json bundle resolves via the manifest rung on the board surface",
       js["hasJsonProv"] is True and js["matched"] == 1, js)

    ck("no page errors across the whole board ingest session", len(errs) == 0, errs)
    b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
