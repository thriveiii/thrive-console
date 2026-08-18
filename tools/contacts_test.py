"""The Thrive Contact Book (P10): one person, one record, findable.

Proves the four evidence points of the brief, engine-independent (WebKit is Thyab's device gate):
  1. The three Abdullah Thyab variants (one with a typo domain) surface as ONE review item; confirming the
     merge yields ONE person with three addresses, the typo domain flagged, and the ledger rows UNCHANGED.
  2. Search finds a person by Arabic name and by partial address; the default sort is newest-activity first.
  3. A bounced address is marked on the person, and a P5 roster paste containing it WARNS before re-sending.
  4. Ten refreshes are byte-identical; every summary number reconciles with Insights (the ONE derivePeople).

Plus source law: one person derivation shared with Insights, curation writes go through the ONE Stage-4
queue to console_contacts, and NO ledger history is copied into the contacts table.
"""
import threading, http.server, socketserver, functools, os, re, json
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

# ---- 1. source law -------------------------------------------------------------------------------
app = open(os.path.join(ROOT, "library/app.js")).read()
ck("ONE person derivation, shared by Insights and the Book (derivePeople defined once, initHome reuses it)",
   app.count("function derivePeople(") == 1 and "const peopleRows=derivePeople();" in app)
ck("the contacts curation write goes through the ONE Stage-4 queue to console_contacts",
   'supaQueueUpsert("console_contacts"' in app and app.count("function supaMirrorContact(") == 1)
ck("NO ledger history is copied into the contacts row (only curation columns are written)",
   "addresses:(c.addresses" in app and "sent:" not in app.split("function supaContactRow(")[1].split("}")[0]
   and "opens:" not in app.split("function supaContactRow(")[1].split("}")[0])
ck("no second thread renderer (the Book taps the existing one via thriveModal.open ... 'history')",
   app.count("function threadListHtml(") == 1 and re.search(r'thriveModal\.open\([^;]*"history"', app) is not None)

# ---- live harness --------------------------------------------------------------------------------
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

# Three Abdullah variants that CLUSTER (same local + typo domain, and a one-edit local), one carrying an
# Arabic recipient name; plus an unrelated person. One hard bounce names the typo-domain address.
INIT = r"""
(() => {
  const set=(k,v)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} };
  set('thrive_opps_v1', [
    { slug:'acme', business:'Acme', published:true, recipients:[{addr:'x@acme.example',name:'X',lang:'en'}] },
    { slug:'beta', business:'Beta', published:true }
  ]);
  set('thrive_mail_v1', [
    { mid:'snd_a1', opp:'acme', to:'abdullah@gmail.com',  toName:'Abdullah Thyab', status:'sent', direction:'out', ts:'2026-08-10T10:00:00Z' },
    { mid:'snd_a2', opp:'acme', to:'abdullah@gmial.com',  toName:'عبدالله ذياب',   status:'sent', direction:'out', ts:'2026-08-11T10:00:00Z' },
    { mid:'snd_a3', opp:'beta', to:'abdulah@gmail.com',   toName:'Abdullah',       status:'sent', direction:'out', ts:'2026-08-12T10:00:00Z' },
    { mid:'snd_l1', opp:'acme', to:'lina@otherco.com',    toName:'Lina',           status:'sent', direction:'out', ts:'2026-08-01T10:00:00Z' }
  ]);
  set('thrive_hits_v1', [{ type:'open', slug:'acme', r:'snd_a1', ts:'2026-08-10T12:00:00Z' }]);
  set('thrive_inbound_v1', [
    { gid:'b1', opp:'acme', kind:'auto', bounce:'hard', subject:'Delivery failed', snippet:'to abdullah@gmial.com', ts:'2026-08-11T11:00:00Z' }
  ]);
})()
"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page(viewport={"width": 1280, "height": 1100})
    pg.add_init_script(INIT)
    dialogs = []
    pg.on("dialog", lambda d: (dialogs.append(d.message), d.accept()))
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{base}/library/console.html#contacts")
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn")
    pg.evaluate("()=>{ var g=document.getElementById('thriveGate'); if(g) g.remove(); document.documentElement.classList.remove('gate-locked'); }")
    pg.wait_for_selector("#view-contacts", timeout=15000); pg.wait_for_timeout(400)

    # ---- 1. one review item for the three variants -------------------------------------------
    review = pg.evaluate("""()=>{
      var items=window.contactReviewItems();
      var it=items[0]||{members:[]};
      return { n:items.length, size:it.addrs?it.addrs.length:0,
        addrs:(it.addrs||[]).slice().sort(),
        typoFlagged:(it.members||[]).some(function(m){ return m.addr.indexOf('gmial')>=0 && m.typo; }) }; }""")
    ck("the three Abdullah variants surface as ONE review item holding all three addresses",
       review["n"] == 1 and review["size"] == 3, review)
    ck("the typo-domain address (gmial.com) is flagged in the review item",
       review["typoFlagged"] is True, review)

    mailBefore = pg.evaluate("()=>localStorage.getItem('thrive_mail_v1')")

    # confirm the merge through the surface (the owner confirms; the dialog is the confirmation)
    pg.eval_on_selector("#contactsReview .cb-merge", "el=>el.click()")
    pg.wait_for_timeout(250)

    merged = pg.evaluate("""()=>{
      var recs=window.buildContacts(); var m=recs.filter(function(r){ return r.curated; })[0]||{};
      return { curatedCount:recs.filter(function(r){return r.curated;}).length,
        addrs:(m.addrs||[]).length, name:m.name||'', typos:m.typos||0, bounces:m.bounces||0,
        reviewAfter:window.contactReviewItems().length,
        sent:m.sent, opens:m.opens }; }""")
    mailAfter = pg.evaluate("()=>localStorage.getItem('thrive_mail_v1')")
    ck("confirming yields ONE merged person with three addresses", merged["curatedCount"] == 1 and merged["addrs"] == 3, merged)
    ck("a dialog asked the owner to confirm (nothing merged silently)", len(dialogs) >= 1, dialogs)
    ck("the merged person carries the typo-domain flag", merged["typos"] >= 1, merged)
    ck("the ledger rows are UNCHANGED by the merge (curation is a lens, not a copy)", mailBefore == mailAfter)
    ck("the review item is gone once merged (no longer a pending duplicate)", merged["reviewAfter"] == 0, merged)

    # ---- 4. numbers reconcile with Insights (the ONE derivePeople) ---------------------------
    recon = pg.evaluate("""()=>{
      var people=window.derivePeople(); var byAddr={};
      people.forEach(function(r){ byAddr[String(r.to).toLowerCase()]=r; });
      var m=window.buildContacts().filter(function(r){ return r.curated; })[0];
      var sumSent=0, sumOpens=0, sumRep=0;
      m.addrs.forEach(function(a){ var r=byAddr[a.addr]; if(r){ sumSent+=r.sent; sumOpens+=r.opens; sumRep+=r.replies; } });
      return { mSent:m.sent, sumSent:sumSent, mOpens:m.opens, sumOpens:sumOpens, mRep:m.replies, sumRep:sumRep }; }""")
    ck("every merged summary number is the sum of the Insights per-address numbers (reconciles with Insights)",
       recon["mSent"] == recon["sumSent"] and recon["mOpens"] == recon["sumOpens"] and recon["mRep"] == recon["sumRep"], recon)

    # ten refreshes identical
    tens = pg.evaluate("""()=>{ var out=[]; for(var i=0;i<10;i++){ out.push(JSON.stringify(window.buildContacts().map(function(r){
        return [r.id,r.name,r.sent,r.opens,r.replies,r.campaigns,r.bounces,r.lastMs]; }))); }
      return out.every(function(x){ return x===out[0]; }); }""")
    ck("ten builds of the Book are byte-identical (stable, deterministic)", tens is True)

    # ---- 2. search + sort --------------------------------------------------------------------
    pg.fill("#contactsSearch", "عبدالله"); pg.wait_for_timeout(150)
    arHit = pg.eval_on_selector_all("#contactsList .cb-person", "els=>els.length")
    ck("search finds the person by their Arabic name", arHit == 1, arHit)
    pg.fill("#contactsSearch", "abdul"); pg.wait_for_timeout(150)
    partHit = pg.eval_on_selector_all("#contactsList .cb-person .cb-name", "els=>els.map(e=>e.textContent)")
    ck("search finds the person by a partial address", any("Abdullah" in x for x in partHit), partHit)
    pg.fill("#contactsSearch", ""); pg.wait_for_timeout(150)
    firstName = pg.eval_on_selector("#contactsList .cb-person .cb-name", "e=>e.textContent")
    ck("default sort is newest-activity first (Abdullah, active 08-12, sorts above Lina, 08-01)",
       "Abdullah" in firstName, firstName)

    # ---- 3. bounce mark + P5 roster warn -----------------------------------------------------
    ck("the person carries the bounced-address mark (derived from the ledger)", merged["bounces"] >= 1, merged)
    rosterWarn = pg.evaluate("""()=>{
      var host=document.createElement('div'); host.innerHTML=window.rosterEditorHtml({slug:'beta', recipients:[]});
      document.body.appendChild(host);
      window.wireRosterEditor(host, {slug:'beta'});
      var ta=host.querySelector('.rst-paste'); ta.value='Abdullah <abdullah@gmial.com>';
      host.querySelector('.rst-parse').click();
      var warned=!!host.querySelector('.rst-bounced');
      document.body.removeChild(host);
      return warned; }""")
    ck("a P5 roster paste containing the bounced address WARNS before re-sending", rosterWarn is True)

    ck("no page errors across the whole Contact Book session", len(errs) == 0, errs)
    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL CONTACT BOOK CHECKS PASS"))
raise SystemExit(1 if fails else 0)
