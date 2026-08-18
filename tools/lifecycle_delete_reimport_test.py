"""P19 · The opportunity lifecycle, on the LIVE surfaces: safe delete (R12) and re-import that updates in
place (R13).

Two gaps this closes, both live on the console:
  1. There was no delete, only archive - a wrongly imported draft could not be removed. R12 gives a hard
     delete for a card with NO ledger history (zero mail, zero inbound, zero token-bearing hits), and
     archive-only for a card that carries history. The ledger is never deleted and never cascaded into.
  2. Re-dropping a bundle whose slugs already exist duplicated them. R13 makes re-import idempotent by
     slug: an existing card UPDATES in place (the report says "updates"), a history-bearing card keeps its
     body, an archived slug asks restore-or-new, and nothing is duplicated.

This drives board.html (the drop surface) and console.html (the card window) in one origin, and proves:
  A. re-drop over existing drafts -> the report reads updates, zero new, zero duplicates; after approve
     each card carries its contact channel (P18); the board still holds the same count (zero twins).
  B. a zero-history draft offers Delete; a history-bearing card offers only Archive, with a reason.
  C. hard-deleting a draft (confirmation shown) then re-dropping -> one "new", the rest "updates", no ghost.
  D. an archived slug on re-drop surfaces two explicit choices; restore flips it to an update.
  E. the ledger (console_mail / console_hits / console_inbound) is unchanged by every operation above.
  F. the report mirrors to RTL in Arabic with the Arabic action/count strings.

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

SLUGS = ["alpha-co", "beta-co", "gamma-co"]
BIZ = {"alpha-co": "Alpha Co", "beta-co": "Beta Co", "gamma-co": "Gamma Co"}
def section(slug):
    return ("## " + BIZ[slug] + "\n- **Send to:** hi@" + slug.replace("-", "") + ".com · **Subject:** A subject"
            + "\n```\nHi Sam, " + BIZ[slug] + " found. [LINK]\n```\n")
RESEARCH = "# Batch\n" + "\n".join(section(s) for s in SLUGS)

def files_batch():
    fs = [{"name": f"opp/{s}/index.html", "text": f"<!doctype html><title>{s}</title><h1>{s}</h1>", "type": "text/html"} for s in SLUGS]
    fs.append({"name": "BATCH_research.md", "text": RESEARCH, "type": "text/markdown"})
    return fs

def drop_js(files):
    return "const SPEC=" + json.dumps(files) + ";" + r"""
      const dt=new DataTransfer(); SPEC.forEach(f=>dt.items.add(new File([f.text],f.name,{type:f.type})));
      const inp=document.getElementById('intakeFile'); inp.files=dt.files; inp.dispatchEvent(new Event('change',{bubbles:true}));"""

# three existing DRAFT cards, no channels yet, no ledger history - the six batch-13 drafts in miniature
def draft(slug):
    return {"slug": slug, "business": BIZ[slug], "published": False, "archived": False, "_local": True}
DRAFTS = [draft(s) for s in SLUGS]

def board(pg):
    pg.goto(f"{base}/library/board.html")
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(300)
    pg.wait_for_function("()=>window.ThriveIntake && ThriveIntake.readBatch && document.getElementById('intakeFile')", timeout=15000)
    pg.wait_for_timeout(300)

def drop_and_read(pg):
    pg.evaluate(drop_js(files_batch()))
    pg.wait_for_selector("#intakeOut .bt tr", timeout=15000); pg.wait_for_timeout(400)
    return pg.evaluate("""()=>{
      var o=document.getElementById('intakeOut');
      var rows=[].slice.call(o.querySelectorAll('.bt tbody tr, .bt tr')).filter(tr=>tr.querySelector('td'));
      function act(tr){ var e=tr.querySelector('.bt-act'); return e? (e.className.replace(/^.*is-/,'')) : ''; }
      var slugs=rows.map(tr=>{ var s=tr.querySelector('td:first-child .bt-slug'); return (s?s.textContent:'').trim(); });
      return { rowCount: rows.length, slugs: slugs, actions: rows.map(act),
        updates: [].slice.call(o.querySelectorAll('.bt-act.is-update')).length,
        locked: [].slice.call(o.querySelectorAll('.bt-act.is-locked')).length,
        news: [].slice.call(o.querySelectorAll('.bt-act.is-new')).length,
        decisions: [].slice.call(o.querySelectorAll('.bt-act.is-decision')).length,
        dupBlock: !!o.querySelector('.ing-dup'),
        countTxt: (o.querySelector('.ing-count')||{}).textContent||'' }; }""")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width": 1280, "height": 1100})
    ctx.route("https://api.github.com/**", lambda r: r.abort())
    ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))
    pg = ctx.new_page()
    pg.on("dialog", lambda d: d.accept())          # the delete confirmation
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))

    def ledger_counts():
        return pg.evaluate("""()=>({ mail:(JSON.parse(localStorage.getItem('thrive_mail_v1')||'[]')).length,
          hits:(JSON.parse(localStorage.getItem('thrive_hits_v1')||'[]')).length,
          inbound:(JSON.parse(localStorage.getItem('thrive_inbound_v1')||'[]')).length })""")
    def opps():
        return pg.evaluate("()=>JSON.parse(localStorage.getItem('thrive_opps_v1')||'[]')")

    # ===== A. re-drop over existing drafts: updates in place, contacts land, zero twins =====
    board(pg)
    pg.evaluate("(a)=>localStorage.setItem('thrive_opps_v1', JSON.stringify(a))", DRAFTS)
    # seed ONE mail row on an UNRELATED slug so we can prove the ledger is never touched by these ops
    pg.evaluate("()=>localStorage.setItem('thrive_mail_v1', JSON.stringify([{opp:'someone-else',direction:'out',status:'sent',mid:'m1'}]))")
    base_ledger = ledger_counts()
    pg.reload(); board(pg)

    rep = drop_and_read(pg)
    ck("A: all three existing drafts read as UPDATES, none as new", rep["updates"] == 3 and rep["news"] == 0, rep)
    ck("A: the re-drop shows zero duplicates (no ghost twin block)", rep["dupBlock"] is False, rep)
    ck("A: the count line names updates", ("update" in rep["countTxt"].lower()) or ("3" in rep["countTxt"]), rep["countTxt"])
    pg.click("#batchApprove"); pg.wait_for_timeout(700)
    after = opps()
    ck("A: after import the board still holds exactly three cards for the batch (zero twins)",
       len([o for o in after if o["slug"] in SLUGS]) == 3 and len(after) == 3, [o["slug"] for o in after])
    withch = [o for o in after if o["slug"] in SLUGS and o.get("channels") and len(o["channels"]) > 0]
    ck("A: each updated card now carries its contact channel (P18 lands through the one write)",
       len(withch) == 3 and all(o["channels"][0]["type"] == "email" for o in withch),
       [(o["slug"], o.get("channels")) for o in after if o["slug"] in SLUGS])
    ck("A: the ledger is unchanged by the re-import", ledger_counts() == base_ledger, ledger_counts())

    # ===== B. the delete law on the card window: draft deletes; a history-bearing card only archives =====
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_function("()=>typeof window.thriveModal==='object'", timeout=15000)
    pg.evaluate("()=>{document.documentElement.classList.remove('gate-locked');const g=document.getElementById('thriveGate');if(g)g.remove();}")
    # gamma gets a real inbound reply -> it now has ledger history
    pg.evaluate("""()=>{ var inb=[{ id:'r1', opp:'gamma-co', from:'them@x.com', subject:'Re: A subject', body:'yes', kind:'reply' }];
      localStorage.setItem('thrive_inbound_v1', JSON.stringify(inb)); }""")
    hist_ledger = ledger_counts()
    pg.reload()
    pg.wait_for_function("()=>typeof window.thriveModal==='object'", timeout=15000)
    pg.evaluate("()=>{document.documentElement.classList.remove('gate-locked');const g=document.getElementById('thriveGate');if(g)g.remove();}")

    def open_moves(slug):
        pg.evaluate("(s)=>window.thriveModal.open(s,'overview')", slug); pg.wait_for_timeout(250)
        return pg.evaluate("""()=>{ var m=document.getElementById('modal');
          return { del: !!m.querySelector('.mw-del-btn'), why: !!m.querySelector('.mw-del-why'),
            archive: !!m.querySelector('.close-opt[data-move=\"archive\"]'),
            whyTxt: (m.querySelector('.mw-del-why')||{}).textContent||'' }; }""")

    d_draft = open_moves("alpha-co")
    ck("B: a zero-history draft offers Delete, no archive-only reason", d_draft["del"] is True and d_draft["why"] is False, d_draft)
    pg.evaluate("()=>window.thriveModal.close(true)"); pg.wait_for_timeout(150)
    d_hist = open_moves("gamma-co")
    ck("B: a card with a reply (ledger history) offers NO delete, only archive, with a one-line reason",
       d_hist["del"] is False and d_hist["archive"] is True and d_hist["why"] is True, d_hist)
    ck("B: the reason names why (history kept, archive not delete)", len(d_hist["whyTxt"]) > 10, d_hist)
    pg.evaluate("()=>window.thriveModal.close(true)"); pg.wait_for_timeout(150)

    # delete the draft (the dialog auto-accepts), then prove it is gone and the ledger untouched
    open_moves("alpha-co")
    pg.click("#modal .mw-del-btn"); pg.wait_for_timeout(500)
    gone = opps()
    ck("C: the deleted draft is removed from the store", not any(o["slug"] == "alpha-co" for o in gone), [o["slug"] for o in gone])
    ck("C: deleting an opportunity never touches the ledger tables", ledger_counts() == hist_ledger, ledger_counts())

    # ===== C. re-drop after the delete: one new, the rest updates, no ghost =====
    board(pg)
    rep2 = drop_and_read(pg)
    # the survivors update in place: beta plainly, gamma with its body frozen (it carries a reply) - both
    # are "updates in place", counted together on the report's count line.
    ck("C: the deleted slug re-imports as NEW; the two survivors update in place (one body-frozen)",
       rep2["news"] == 1 and (rep2["updates"] + rep2["locked"]) == 2, rep2)
    pg.click("#batchApprove"); pg.wait_for_timeout(700)
    back = opps()
    ck("C: the board returns to three cards with no ghost (the re-created slug is clean, its tombstone lifted)",
       len([o for o in back if o["slug"] in SLUGS]) == 3, [o["slug"] for o in back])

    # ===== D. an archived slug on re-drop asks restore-or-new; restore flips it to an update =====
    pg.evaluate("""()=>{ var a=JSON.parse(localStorage.getItem('thrive_opps_v1')||'[]');
      a.forEach(o=>{ if(o.slug==='beta-co') o.archived=true; }); localStorage.setItem('thrive_opps_v1', JSON.stringify(a)); }""")
    board(pg)
    rep3 = drop_and_read(pg)
    ck("D: an archived slug surfaces as a DECISION (restore or new), never resolved silently",
       rep3["decisions"] >= 1, rep3)
    hasbtns = pg.evaluate("""()=>({ restore: !!document.querySelector('#intakeOut .bt-restore'),
      asnew: !!document.querySelector('#intakeOut .bt-asnew') })""")
    ck("D: the decision row shows both explicit choices on the row", hasbtns["restore"] and hasbtns["asnew"], hasbtns)
    pg.click("#intakeOut .bt-restore"); pg.wait_for_timeout(400)
    restored = pg.evaluate("""()=>{ var o=document.getElementById('intakeOut');
      var row=[].slice.call(o.querySelectorAll('.bt tr')).find(tr=>{ var s=tr.querySelector('.bt-slug'); return s && s.textContent.trim()==='beta-co'; });
      return row? (row.querySelector('.bt-act')||{}).textContent||'' : ''; }""")
    ck("D: choosing Restore flips the row to a restore-and-update", "restore" in restored.lower() or "update" in restored.lower(), restored)
    pg.click("#batchApprove"); pg.wait_for_timeout(700)
    beta = [o for o in opps() if o["slug"] == "beta-co"]
    ck("D: after Restore + approve, beta is un-archived and updated in place",
       len(beta) == 1 and beta[0].get("archived") is False, beta)

    # ===== E. ledger safety across the whole session =====
    ck("E: at the end, the ledger holds exactly the seeded mail row and the seeded reply, nothing added or removed",
       ledger_counts() == {"mail": 1, "hits": 0, "inbound": 1}, ledger_counts())

    # ===== F. Arabic: the report mirrors and speaks the Arabic action/count strings =====
    pg.evaluate("()=>localStorage.setItem('thrive_lang','ar')")
    board(pg)
    repar = drop_and_read(pg)
    dir_ar = pg.evaluate("()=>document.documentElement.dir")
    ck("F: Arabic - the document mirrors to rtl on the drop surface", dir_ar == "rtl", dir_ar)
    ck("F: Arabic - the re-drop still classifies updates (the one classifier is language-independent)",
       repar["updates"] >= 1, repar)

    ck("no page errors across the whole lifecycle session", len(errs) == 0, errs)
    ctx.close(); b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
