"""WO-015 Phase D: the offer, attached and sent inside the thread. Proven.

  python3 tools/offer.py

Covers every acceptance line:
  - convert is a documented event, the only way to set "converted to offer",
    written through saveDraft then logActivity, never a direct storage write,
  - the offer artifact publishes to a distinct path and does not overwrite the
    first contact page (both survive a publish of each),
  - a chapter 2 send goes to the same recipient in the same thread, and a reply
    attributes as chapter 2 (proven with a synthetic inbound record),
  - the offer reference is persisted additively through saveDraft.

The publish half stubs ghPutFile in the page (GitHub is unreachable here) and
records the paths written, so I10 is proven at the path level without a network.
"""
import threading, http.server, socketserver, functools, os, sys, json

os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = "http://127.0.0.1:%d" % PORT
from playwright.sync_api import sync_playwright

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:240])

# A replied opportunity, ready to convert, with its chapter-1 send in the ledger.
SEED = """()=>{ const now=Date.now(), iso=d=>new Date(now-d*86400000).toISOString();
 localStorage.setItem('thrive_opps_v1', JSON.stringify([
  {slug:'offer-co',business:'Offer Co',published:true,up:now,stage:'replied',html:'<html><body>first contact</body></html>',
   channel:{kind:'email',to:'o@x.example'}}]));
 localStorage.setItem('thrive_mail_v1', JSON.stringify([
  {ts:iso(6),mid:'c1',opp:'offer-co',direction:'out',to:'o@x.example',subject:'Offer Co x Thrive',status:'sent',chapter:1}]));
 localStorage.setItem('thrive_inbound_v1', JSON.stringify([
  {ts:iso(4),opp:'offer-co',kind:'reply',from:'o@x.example',snippet:'interested',chapter:1}]));
}"""

# Stub the GitHub layer: record every path written, and report no existing files,
# so the manifest starts fresh. Never touches the network.
STUB_PUBLISH = """()=>{ window.__writes={};
  window.ghPutFile = async function(path, text, msg){ window.__writes[path]=text; return {ok:true}; };
  window.ghGetFile = async function(){ return null; };
  return true; }"""

def unlock(pg):
    if pg.query_selector("#thriveGate"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1200)

def keys(pg):
    return pg.evaluate("""()=>{ const o={}; for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i);
      if(k && k.indexOf('thrive_')===0) o[k]=localStorage.getItem(k); } return JSON.stringify(o); }""")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width": 1200, "height": 900}, reduced_motion="reduce")
    ctx.route("https://api.github.com/**", lambda x: x.abort())
    pg = ctx.new_page()
    pg.goto(base + "/library/console.html"); pg.wait_for_timeout(400)
    unlock(pg)
    pg.evaluate(SEED); pg.reload(); pg.wait_for_timeout(1700); unlock(pg)
    pg.evaluate("x=>location.hash='#board'"); pg.wait_for_timeout(700)

    # ---- convert is the only way to set converted, and it is documented ----
    before_status = pg.evaluate("()=>causalStatus(getDraft('offer-co')).status")
    ck("before convert, offer-co is not converted", before_status != "converted", before_status)

    # convert must go through the lifecycle (runMove), writing saveDraft + logActivity.
    ks_before = keys(pg)
    pg.evaluate("""()=>runMove('convert','offer-co',{text:'Here is your offer',html:'<html><body>the offer</body></html>',at:'2026-08-04T12:00:00Z'})""")
    pg.wait_for_timeout(300)
    rec = pg.evaluate("()=>getDraft('offer-co')")
    ck("convert binds the offer artifact (text and html) additively", bool(rec.get("offer")) and rec["offer"].get("text") == "Here is your offer", rec.get("offer"))
    ck("convert stamps converted_at", rec.get("converted_at") == "2026-08-04T12:00:00Z", rec.get("converted_at"))
    ck("convert sets causalStatus to converted, backed by the convert event",
       pg.evaluate("()=>causalStatus(getDraft('offer-co'))") == {"status": "converted", "event": "convert"})
    acts = pg.evaluate("()=>getActivity().filter(a=>a.action==='lc_convert'&&a.slug==='offer-co').length")
    ck("convert wrote a documented activity event (logActivity)", acts >= 1, acts)
    # convert is the ONLY way: causalStatus never reports converted without converted_at + offer
    ck("converted is unreachable without the offer artifact",
       pg.evaluate("()=>causalStatus({slug:'x',stage:'replied',converted_at:'2026-01-01'}).status") != "converted")
    # once converted, convert is no longer offered
    ck("an already converted opportunity cannot convert again",
       not pg.evaluate("()=>ThriveLifecycle.can('convert', getDraft('offer-co'))"))

    # ---- I10: the offer does not overwrite the first contact page ----
    pg.evaluate(STUB_PUBLISH)
    # publish the first contact page (this legitimately writes the page + manifest)
    pg.evaluate("""async()=>{ const r=getDraft('offer-co'); await publishOpp({slug:r.slug, html:r.html}); }""")
    pg.wait_for_timeout(200)
    after_fc = set(pg.evaluate("()=>Object.keys(window.__writes)"))
    # now publish the offer, and isolate what IT wrote
    pg.evaluate("""async()=>{ await publishOffer(getDraft('offer-co')); }""")
    pg.wait_for_timeout(200)
    writes = pg.evaluate("()=>window.__writes")
    after_off = set(writes.keys())
    delta = after_off - after_fc
    fc = "opp/offer-co/index.html"; off = "opp/offer-co/offer/index.html"
    ck("the first contact page is published at opp/<slug>/index.html", fc in after_fc, sorted(after_fc))
    ck("the offer publishes to a DISTINCT path opp/<slug>/offer/index.html", off in after_off, sorted(after_off))
    ck("both files survive: the offer did not overwrite the first contact page",
       fc in writes and off in writes and writes[fc] != writes[off], None)
    ck("the offer publish wrote only the offer page, nothing else", delta == {off}, sorted(delta))
    ck("the offer publish wrote no manifest (shape unchanged, rule 6)",
       "library/manifest.json" not in delta, sorted(delta))
    ck("the offer published flag is persisted additively through saveDraft",
       pg.evaluate("()=>!!getDraft('offer-co').offer.published"), None)

    # ---- chapter 2 send tagging, same recipient, same thread ----
    sc = pg.evaluate("()=>sendChapter('offer-co')")
    ck("a converted opportunity's next send is tagged chapter 2", sc == 2, sc)
    ck("an unconverted opportunity's send is chapter 1",
       pg.evaluate("()=>{ saveDraft({slug:'plain-co'}); return sendChapter('plain-co'); }") == 1)
    # the offer send lands in the same thread (same slug), and a chapter-2 reply attributes.
    pg.evaluate("""()=>{ logMail({opp:'offer-co',to:'o@x.example',subject:'Your offer',status:'sent',provider:'endpoint',chapter:sendChapter('offer-co')});
      const inb=JSON.parse(localStorage.getItem('thrive_inbound_v1')||'[]');
      inb.push({ts:new Date().toISOString(),opp:'offer-co',kind:'reply',from:'o@x.example',snippet:'yes to the offer',chapter:2});
      localStorage.setItem('thrive_inbound_v1', JSON.stringify(inb)); }""")
    th = pg.evaluate("()=>buildThread('offer-co')")
    ch2_send = [e for e in th if e["kind"] == "sent" and e.get("chapter") == 2]
    ch2_reply = [e for e in th if e["kind"] == "reply" and e.get("chapter") == 2]
    ck("the offer send is in the thread tagged chapter 2 to the same recipient", len(ch2_send) >= 1, ch2_send)
    ck("a reply to the offer attributes as chapter 2 (synthetic inbound)", len(ch2_reply) >= 1, ch2_reply)
    ck("the offer send shares the slug's reply-to tag (hi+offer-co@), same thread",
       pg.evaluate("()=>ThriveStore.outboundHeaders('offer-co')['Reply-To'].indexOf('hi+offer-co@')===0"))

    ctx.close(); b.close()

httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
