"""WO-012 phase 3: the batch import, in a browser, against the real manifest.

The parser has a self test. This is the rest: a real deflated zip read by the browser's own
inflater, the report shown before anything is written, unmatched items named, a duplicate slug
asked about per item, and three opportunities landing in Draft with their channels, their
prohibitions and their words intact.

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
# a second zip that is deliberately incomplete, because the failure path is the point
ZIP2 = os.path.join(TMP, "partial.zip")
with zipfile.ZipFile(ZIP2, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("READY_TO_SEND_BATCH06.md", MANIFEST)
    z.writestr("ludic.html", "<h1>Ludic</h1>")
    z.writestr("stranger.html", "<h1>Nobody asked for this</h1>")
# a page on its own, and a page with its own text file
ONE = os.path.join(TMP, "solo.html")
open(ONE, "w").write("<h1>Solo Shop</h1>")
PAIR_H = os.path.join(TMP, "paired.html"); open(PAIR_H, "w").write("<h1>Paired Co</h1>")

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
    pg.goto(f"{base}/library/console.html"); pg.wait_for_timeout(400)
    if pg.query_selector("#thriveGate"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1500)
    pg.reload(); pg.wait_for_timeout(2800)

    ck("the parser passes its own test against the real manifest",
       pg.evaluate("(md)=>ThriveIntake.selfTest(md).pass", MANIFEST),
       pg.evaluate("(md)=>ThriveIntake.selfTest(md)", MANIFEST))

    pg.evaluate("()=>location.hash='#board'"); pg.wait_for_timeout(1800)
    ck("the board offers somewhere to put the batch", pg.eval_on_selector("#intakeZone", "e=>!e.hidden"))

    # ---- the whole zip, through the picker rather than drag and drop ----------
    pg.set_input_files("#intakeFile", ZIP)
    pg.wait_for_timeout(2500)
    names = pg.eval_on_selector_all(".in-card .in-name", "e=>e.map(x=>x.textContent.trim())")
    print("read from the zip:", names)
    ck("the file picker works, not only drag and drop", len(names) > 0)
    ck("exactly three opportunities", len(names) == 3, names)
    ck("and they are the three in the manifest",
       names == ["Ludic Lillian", "Wise Butterfly Shop", "2 Faces Clothing Co."], names)

    counts = pg.eval_on_selector_all(".in-count", "e=>e.map(x=>x.textContent.trim())")
    print("report:", counts)
    ck("the report is shown before anything is written",
       pg.eval_on_selector("#intakeOut .in-report", "e=>!!e"))
    ck("and nothing has been written yet",
       pg.evaluate("()=>getDrafts().filter(d=>d.slug==='ludic').length") == 0)

    tags = pg.eval_on_selector_all(".in-tag", "e=>e.map(x=>x.textContent.trim())")
    ck("Ludic is email, tier A", any("LudicLillian.com" in x for x in tags) and any("A" == x.split()[-1] for x in tags), tags)
    ck("Wise Butterfly is a web form with its address",
       any("wisebutterflyshop.com" in x for x in tags), tags)
    ck("2 Faces is a web form with its address", any("2faceonline.us" in x for x in tags), tags)
    ck("and 2 Faces additionally offers instagram", any("nstagram" in x for x in tags), tags)
    ck("both standing prohibitions are flagged on their cards",
       pg.eval_on_selector_all(".in-card .in-warn",
         "e=>e.filter(x=>/prohibition|محظور/i.test(x.textContent)).length") == 2)
    ck("the batch notes are carried, not dropped",
       pg.eval_on_selector("#intakeOut details", "e=>e.textContent.indexOf('2,500')>=0"))

    pg.click("#intakeAdd"); pg.wait_for_timeout(2600)
    recs = pg.evaluate("""async ()=>{const o=await mergedOpps();
        const pick=s=>o.find(x=>x.slug===s)||null;
        const l=pick('ludic'), w=pick('wisebutterfly'), f=pick('2faces');
        return {l:l&&{stage:effStage(l), ch:l.channel, body:l.outreach_text, owner:l.owner,
                      pro:l.prohibition, note:(l.batch_note||'').slice(0,20), html:(l.html||'').length,
                      tier:l.contact_tier, sub:l.outreach_subject},
                w:w&&{ch:w.channel, pro:w.prohibition},
                f:f&&{ch:f.channel, alt:f.channel_alternates}};}""")
    print("imported ludic:", json.dumps(recs["l"])[:320])
    ck("three opportunities were imported", all(recs[k] for k in ("l", "w", "f")), recs)
    if recs["l"]:
        ck("they start in Draft", recs["l"]["stage"] == "draft", recs["l"]["stage"])
        ck("with the channel the manifest named", recs["l"]["ch"]["kind"] == "email", recs["l"]["ch"])
        ck("the words, byte for byte, link slot intact", "[LINK]" in recs["l"]["body"])
        ck("the owner", recs["l"]["owner"] == "Deborah Dillard", recs["l"]["owner"])
        ck("the standing prohibition", "maker" in recs["l"]["pro"], recs["l"]["pro"])
        ck("the subject", recs["l"]["sub"] == "Handmade in Fairfax", recs["l"]["sub"])
        ck("the contact tier", recs["l"]["tier"] == "A", recs["l"]["tier"])
        ck("the page that came in the zip", recs["l"]["html"] > 0)
        ck("and the batch note", len(recs["l"]["note"]) > 0)
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

    # ---- the failure path, which is the point of the feature -------------------
    pg.set_input_files("#intakeFile", ZIP2)
    pg.wait_for_timeout(2500)
    named = pg.eval_on_selector_all(".in-named li", "e=>e.map(x=>x.textContent.trim())")
    print("named as unmatched:", named)
    ck("an unmatched page is named", "stranger.html" in named, named)
    ck("unmatched manifest entries are named by business",
       any("Wise Butterfly" in x for x in named), named)
    dupes = pg.eval_on_selector_all(".in-card.is-dupe", "e=>e.length")
    ck("a duplicate slug is flagged per item", dupes >= 1, dupes)
    ck("and a duplicate is not selected by default",
       pg.eval_on_selector_all(".in-card.is-dupe .in-pick", "e=>e.every(x=>!x.checked)"))
    ck("skip and replace are both offered per item",
       pg.eval_on_selector_all(".in-card.is-dupe [data-dupe]", "e=>e.length") >= 2)
    pg.click("#intakeCancel"); pg.wait_for_timeout(600)

    # ---- one page alone, and a page with its own text -------------------------
    pg.set_input_files("#intakeFile", ONE)
    pg.wait_for_timeout(1800)
    solo = pg.eval_on_selector_all(".in-card .in-name", "e=>e.map(x=>x.textContent.trim())")
    ck("a page on its own becomes one opportunity", solo == ["solo"], solo)
    pg.click("#intakeCancel"); pg.wait_for_timeout(500)

    ck("nothing threw", not errs, errs[:3])
    b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
