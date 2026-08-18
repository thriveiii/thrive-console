"""P14 · The board's "Today's batch" drop, in a browser, against the real manifest, through the ONE resolver.

The board surface used to run readDrop + a second review renderer; it now runs the same tolerant resolver
(ThriveIntake.readBatch -> resolveBatch) and the same shared report (mountIngestReport) as the editor upload.
This drops the REAL producer format (READY_TO_SEND_BATCH06.md, deflated in a zip the browser's own inflater
reads) on the live board surface and proves: the resolver report is shown before anything is written, three
opportunities resolve, and Approve lands all three in Draft with their channel, owner, standing prohibition,
subject, tier, page and batch note intact. A page on its own becomes one "needs message" card, never dropped.

Run it: python3 tools/import.py
"""
import threading, http.server, socketserver, functools, os, sys, json, zipfile, tempfile

os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
MANIFEST = open(os.path.join(ROOT, "tools", "fixtures", "READY_TO_SEND_BATCH06.md"), encoding="utf-8").read()

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"

# The real batch, zipped the way a real one arrives. Deflated on purpose: stored entries would
# never exercise the browser's own inflater.
TMP = tempfile.mkdtemp()
ZIP = os.path.join(TMP, "batch06.zip")
with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("READY_TO_SEND_BATCH06.md", MANIFEST)
    z.writestr("ludic.html", "<h1>Ludic Lillian</h1>" + ("<p>x</p>" * 30))
    z.writestr("wisebutterfly.html", "<h1>Wise Butterfly</h1>" + ("<p>x</p>" * 30))
    z.writestr("2faces.html", "<h1>2 Faces</h1>" + ("<p>x</p>" * 30))
    z.writestr("__MACOSX/._ludic.html", "junk")
# a page on its own: the resolver never drops it, it becomes a "needs message" card
ONE = os.path.join(TMP, "solo.html")
open(ONE, "w").write("<h1>Solo Shop</h1>")

from playwright.sync_api import sync_playwright
fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width": 1280, "height": 900})
    ctx.route("https://api.github.com/**", lambda r: r.abort())
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    # The standalone board page is the "Today's batch" surface Thyab uses; no view-routing wrapper to hide it.
    pg.goto(f"{base}/library/board.html"); pg.wait_for_timeout(400)
    if pg.query_selector("#thriveGate"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1500)
    pg.wait_for_selector("#intakeFile", state="attached", timeout=15000)
    pg.wait_for_timeout(600)

    ck("the parser passes its own test against the real manifest",
       pg.evaluate("(md)=>ThriveIntake.selfTest(md).pass", MANIFEST),
       pg.evaluate("(md)=>ThriveIntake.selfTest(md)", MANIFEST))

    # ---- the surface is now the ONE resolver, not the retired readDrop path -------------------------
    ck("the board surface no longer exposes the retired readDrop path",
       pg.evaluate("()=>typeof ThriveIntake.readDrop==='undefined'"))

    ck("the board offers somewhere to put the batch", pg.eval_on_selector("#intakeZone", "e=>!e.hidden"))

    # ---- the whole zip, through the picker, resolved by ThriveIntake.readBatch -----------------------
    pg.set_input_files("#intakeFile", ZIP)
    pg.wait_for_selector("#intakeOut .bt tr", state="attached", timeout=8000)
    pg.wait_for_timeout(400)
    slugs = pg.eval_on_selector_all("#intakeOut .bt tbody tr td:first-child, #intakeOut .bt tr td:first-child",
                                    "e=>e.map(x=>x.textContent.trim()).filter(Boolean)")
    print("resolved from the zip:", slugs)
    ck("the resolver report is shown on the board surface (the shared .bt report)",
       pg.eval_on_selector("#intakeOut .bt", "e=>!!e") and pg.eval_on_selector("#intakeOut #batchApprove", "e=>!!e"))
    ck("exactly three opportunities resolve", len(slugs) == 3, slugs)
    ck("and they are the three in the manifest, matched by their page files",
       sorted(slugs) == sorted(["ludic", "wisebutterfly", "2faces"]), slugs)
    ck("every row resolved (matched), none warned or needs-message",
       pg.eval_on_selector_all("#intakeOut .bt tr.is-matched", "e=>e.length") == 3
       and pg.eval_on_selector_all("#intakeOut .bt tr.is-needs", "e=>e.length") == 0)
    ck("nothing has been written yet (report before write)",
       pg.evaluate("()=>getDrafts().filter(d=>d.slug==='ludic').length") == 0)

    pg.click("#intakeOut #batchApprove"); pg.wait_for_timeout(2600)
    recs = pg.evaluate("""async ()=>{const o=await mergedOpps();
        const pick=s=>o.find(x=>x.slug===s)||null;
        const l=pick('ludic'), w=pick('wisebutterfly'), f=pick('2faces');
        return {l:l&&{stage:effStage(l), ch:l.channel, body:l.outreach_text, owner:l.owner,
                      pro:l.prohibition, note:(l.batch_note||'').slice(0,20), html:(l.html||'').length,
                      tier:l.contact_tier, sub:l.outreach_subject},
                w:w&&{ch:w.channel, pro:w.prohibition},
                f:f&&{ch:f.channel, alt:f.channel_alternates}};}""")
    print("imported ludic:", json.dumps(recs["l"])[:320])
    ck("three opportunities were imported through the one writer", all(recs[k] for k in ("l", "w", "f")), recs)
    if recs["l"]:
        ck("they start in Draft", recs["l"]["stage"] == "draft", recs["l"]["stage"])
        ck("with the channel the manifest named", recs["l"]["ch"]["kind"] == "email", recs["l"]["ch"])
        ck("the words, byte for byte, link slot intact", "[LINK]" in recs["l"]["body"])
        ck("the owner", recs["l"]["owner"] == "Deborah Dillard", recs["l"]["owner"])
        ck("the standing prohibition", "maker" in recs["l"]["pro"], recs["l"]["pro"])
        ck("the subject", recs["l"]["sub"] == "Handmade in Fairfax", recs["l"]["sub"])
        ck("the contact tier", recs["l"]["tier"] == "A", recs["l"]["tier"])
        ck("the page that came in the zip", recs["l"]["html"] > 0)
        ck("and the batch note is carried onto the record", len(recs["l"]["note"]) > 0)
    if recs["f"]:
        ck("2 Faces keeps instagram as an alternate",
           any(a["channel"] == "instagram" for a in recs["f"]["alt"]), recs["f"]["alt"])
    if recs["w"]:
        ck("Wise Butterfly has no prohibition, because the manifest says so", not recs["w"]["pro"], recs["w"]["pro"])

    lanes = pg.evaluate("""()=>{const o={};document.querySelectorAll('[data-body]').forEach(e=>
        o[e.getAttribute('data-body')]=[...e.querySelectorAll('.tok')].map(t=>t.getAttribute('data-slug')));return o}""")
    print("lanes:", lanes)
    for s in ("ludic", "wisebutterfly", "2faces"):
        ck(f"{s} is in the first lane", s in lanes.get("draft", []), lanes)

    ck("the import wrote one entry naming the counts",
       pg.evaluate("()=>getActivity().filter(a=>a.action==='in_batch').length") == 1)

    # ---- [LINK] substitution keeps the original -------------------------------
    subbed = pg.evaluate("""()=>{const t='Read this [LINK] please';
        return {out:ThriveIntake.substituteLink(t,'https://x/opp/ludic'), orig:t};}""")
    ck("substitution replaces the slot", "[LINK]" not in subbed["out"] and "/opp/ludic" in subbed["out"])
    ck("and leaves the original untouched", "[LINK]" in subbed["orig"])

    # ---- a page on its own: never dropped, becomes a "needs message" card ------
    pg.set_input_files("#intakeFile", ONE)
    pg.wait_for_selector("#intakeOut .bt tr", state="attached", timeout=8000)
    pg.wait_for_timeout(400)
    solo = pg.eval_on_selector_all("#intakeOut .bt tbody tr td:first-child, #intakeOut .bt tr td:first-child",
                                   "e=>e.map(x=>x.textContent.trim()).filter(Boolean)")
    ck("a page on its own becomes one opportunity, never dropped", solo == ["solo"], solo)
    ck("and it is a 'needs message' card with a one-tap Write action (never a dead end)",
       pg.eval_on_selector_all("#intakeOut .bt tr.is-needs", "e=>e.length") == 1
       and pg.eval_on_selector_all("#intakeOut .bt-write", "e=>e.length") == 1)
    pg.click("#intakeOut #batchDiscard"); pg.wait_for_timeout(500)

    ck("nothing threw", not errs, errs[:3])
    b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
