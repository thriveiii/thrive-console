"""P16 · The match join, completed, on the LIVE "Today's batch" board surface (library/board.html).

The real batch-13 drop (Aug 18) resolved four and split two: hypergoat-coffee and drip-docx each showed a
"needs message" page card AND a separately-spawned pageless draft (hypergoat-coffee-roasters,
drip-docx-wellness-and-aesthetics), because the join matched only exact slug equality, not token-prefix. This
drives the real board surface and proves:

  1. all SIX opportunities resolve MATCHED with filled send_to / subject / body; hypergoat-coffee and
     drip-docx join via the token-prefix rule (the rule is shown on the row); zero orphan sections; zero
     spawned cards (no *-roasters / *-wellness row); the count line reads pages 6, matched 6.
  2. a pre-existing ghost card (hypergoat-coffee-roasters, same send_to + subject as the page now joined)
     surfaces as "duplicate, merge?" and one tap archives it into its page card - the ledger keeps one truth.

WebKit at device widths is Thyab's gate; this is engine-independent behaviour in Chromium.
"""
import threading, http.server, socketserver, functools, os, sys, json
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
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
        if d is not None: print("      " + str(d)[:400])

# folder slugs (the pages), and the section businesses (two are token-prefix supersets of their folder)
SLUGS = ["hypergoat-coffee", "drip-docx", "river-sea-chocolates", "manna-pottery", "godet-furniture", "clear-spring-acupuncture"]
BIZ = {
    "hypergoat-coffee": "Hypergoat Coffee Roasters",
    "drip-docx": "Drip Docx Wellness and Aesthetics",
    "river-sea-chocolates": "River-Sea Chocolates",
    "manna-pottery": "Manna Pottery",
    "godet-furniture": "Godet Furniture",
    "clear-spring-acupuncture": "Clear Spring Acupuncture",
}
# The subject shares the send-to line, wrapped in bold, split by a middle dot - the real batch-13 shape that
# left the subject column empty for all six. A real greeting name in the body, and a bundle-wide template.
SUBJ = {
    "hypergoat-coffee": "The right roast, found", "drip-docx": "From press to booked chairs",
    "river-sea-chocolates": "The Reston shop, found", "manna-pottery": "The studio, on the map",
    "godet-furniture": "The Del Ray opening, louder", "clear-spring-acupuncture": "The right patients, finding you",
}
NAME = {"hypergoat-coffee": "Rezgar", "drip-docx": "Narges", "river-sea-chocolates": "Chantilly",
        "manna-pottery": "Etsuko", "godet-furniture": "Adam", "clear-spring-acupuncture": "Krissee and Mariano"}
def section(slug):
    return ("## " + BIZ[slug] + "\n- **Send to:** hi@" + slug.replace("-", "") + ".com · **Subject:** "
            + SUBJ[slug] + "\n```\nHi " + NAME[slug] + ", " + BIZ[slug] + " found. [LINK]\n```\n")
RESEARCH = "# Batch 13\nAll pages use template en-opp1.\n\n" + "\n".join(section(s) for s in SLUGS)

def files_join():
    fs = [{"name": f"opp/{s}/index.html", "text": f"<!doctype html><title>{s}</title><h1>{s}</h1>", "type": "text/html"} for s in SLUGS]
    fs.append({"name": "BATCH13_research.md", "text": RESEARCH, "type": "text/markdown"})
    return fs

def drop_js(files):
    return "const SPEC=" + json.dumps(files) + ";" + r"""
      const dt=new DataTransfer(); SPEC.forEach(f=>dt.items.add(new File([f.text],f.name,{type:f.type})));
      const inp=document.getElementById('intakeFile'); inp.files=dt.files; inp.dispatchEvent(new Event('change',{bubbles:true}));"""

# a ghost already in the store: the spawned card from the pre-fix batch, same send_to + subject as hypergoat's page
GHOST = json.dumps([{ "slug": "hypergoat-coffee-roasters", "business": "Hypergoat Coffee Roasters",
    "channel": {"kind": "email", "to": "hi@hypergoatcoffee.com"}, "outreach_subject": SUBJ["hypergoat-coffee"],
    "outreach_text": "Hi {{NAME}}. [LINK]", "published": False, "archived": False }])

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page(viewport={"width": 1280, "height": 1100})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{base}/library/board.html")
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(400)
    pg.evaluate("(s)=>localStorage.setItem('thrive_opps_v1', s)", GHOST)
    pg.wait_for_function("()=>window.ThriveIntake && ThriveIntake.readBatch && document.getElementById('intakeFile')", timeout=15000)
    pg.wait_for_timeout(400)

    pg.evaluate(drop_js(files_join()))
    pg.wait_for_selector("#intakeOut .bt tr.is-matched", timeout=15000)
    pg.wait_for_timeout(400)

    rep = pg.evaluate("""()=>{
      var o=document.getElementById('intakeOut');
      var rows=[].slice.call(o.querySelectorAll('.bt tbody tr, .bt tr')).filter(tr=>tr.querySelector('td'));
      var slugs=rows.map(function(tr){ var s=tr.querySelector('td:first-child .bt-slug'); return (s?s.textContent:'').trim(); });
      var matched=rows.filter(tr=>tr.className.indexOf('is-matched')>=0).length;
      function resolved(tr){ return tr.querySelectorAll('.bt-c .bt-y').length>=4; }
      // P17: the Subject column is the 4th .bt-c cell; a filled subject is a checkmark (.bt-y), not a dot.
      function subjectFilled(tr){ return !!tr.querySelectorAll('.bt-c')[2].querySelector('.bt-y'); }
      return { rowCount: rows.length, slugs: slugs, matched: matched,
               allResolved: rows.every(resolved),
               subjectAll: rows.every(subjectFilled),
               bizAll: rows.every(tr=>!!tr.querySelector('.bt-biz')),
               noStars: (o.querySelector('.bt')||{textContent:''}).textContent.indexOf('*')<0,
               spawnedGhostRow: slugs.some(s=>/roasters|wellness/.test(s)),
               prefixShown: (o.textContent||'').toLowerCase().indexOf('prefix')>=0 || !!o.querySelector('.bt-prov'),
               orphanBlock: !!o.querySelector('.ing-orphan'),
               countText: (o.querySelector('.ing-count')||{}).textContent||'',
               dupBlock: !!o.querySelector('.ing-dup'),
               dupMergeBtn: !!o.querySelector('.ing-merge') }; }""")
    ck("all six opportunities are rows, none split into a second card", rep["rowCount"] == 6 and not rep["spawnedGhostRow"], rep)
    ck("all six resolve MATCHED with page/subject/body/send-to filled", rep["matched"] == 6 and rep["allResolved"] is True, rep)
    ck("P17: the Subject column is filled for ALL SIX (the shared send-to+subject line, the live break)",
       rep["subjectAll"] is True, rep)
    ck("P17: the business display name renders in every row (not just the slug)", rep["bizAll"] is True, rep)
    ck("P17: no markdown bold marker leaks into the rendered report", rep["noStars"] is True, rep)
    ck("no orphan-sections block (every section joined a page)", rep["orphanBlock"] is False, rep)
    ck("the count line is present and reads six pages, six matched",
       ("6" in rep["countText"]) and (rep["countText"].count("6") >= 2), rep["countText"])

    # match_rule on the two token-prefix rows, read from the pure resolver the surface runs
    rules = pg.evaluate("""(a)=>{ var out=window.ThriveIntake.resolveBatch(
        a.slugs.map(s=>({name:'opp/'+s+'/index.html',html:'<h1>'+s+'</h1>'})),
        [{name:'r.md',text:a.research}], []);
        var m={}; out.report.rows.forEach(r=>m[r.slug]=r.match_rule); return m; }""",
      {"slugs": SLUGS, "research": RESEARCH})
    ck("hypergoat-coffee joined by token-prefix (not exact), the live batch-13 break",
       rules.get("hypergoat-coffee") == "token_prefix", rules)
    ck("drip-docx joined by token-prefix", rules.get("drip-docx") == "token_prefix", rules)
    ck("the four exact-slug opportunities joined by the exact rule",
       all(rules.get(s) == "exact" for s in ["river-sea-chocolates", "manna-pottery", "godet-furniture", "clear-spring-acupuncture"]), rules)

    # ---- Evidence 2: the pre-existing ghost surfaces as duplicate, merge? and one tap heals it ----
    ck("the ghost card (same send_to + subject as a joined page) surfaces as duplicate, merge?",
       rep["dupBlock"] is True and rep["dupMergeBtn"] is True, rep)
    pg.eval_on_selector(".ing-merge", "b=>b.click()")
    pg.wait_for_timeout(600)
    healed = pg.evaluate("""()=>{ var s=JSON.parse(localStorage.getItem('thrive_opps_v1')||'[]');
      var g=s.find(o=>o.slug==='hypergoat-coffee-roasters'); return { archived: g? !!g.archived : null,
        count: s.filter(o=>!o.archived).length }; }""")
    ck("one tap archives the ghost (the page card keeps everything; the ledger keeps one truth)",
       healed["archived"] is True, healed)

    ck("no page errors across the whole join session", len(errs) == 0, errs)
    b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
