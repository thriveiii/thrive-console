"""A view cannot exist without a send: the impossible state is removed.

On the device, cards for prospects never sent to (2 Faces, Cozy Calico) read "no email yet, one view"
(bilingual: «بلا رسالة، مشاهدة واحدة»). A page view is a recipient opening a link WE SENT; a view with
no send is impossible and made the board lie. Cause, from the code: the board card's live-lane meta and
the window overview fact both showed raw page opens (opensForSlug), which is not send-gated, so any
recorded open on a page nobody was emailed read as a "view".

The fix, derivation-only: the card's "view" is the send-gated recipient derivation (outreachOpens), which
is zero until a delivered send exists and already excludes the owner's own opens. So a never-sent card
carries zero recipient views and reads "no email yet", never "no email yet, one view"; a sent card shows
the recipient open after the send. No visit row is deleted; the classification is at read.

The live board (2 Faces, Cozy Calico) is Thyab's device gate; the derivation is proven here on the real
app.js.
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
        if d is not None: print("      " + str(d)[:300])

# Source guards
app = open(f"{ROOT}/library/app.js").read()
ck("the board card's live-lane view is the send-gated recipient derivation (outreachOpens), not raw opens",
   "const rv=outreachOpens(tk.slug);" in app and 'rv>0 ? fmtRelative("tok_views", rv)' in app)
ck("the window overview shows an opens fact only when a send exists",
   "live&&snd.count?" in app and "t(\"col_views\")+\": \"+opensForSlug" not in app)

SENT = "2026-08-01T10:00:00Z"; OPEN = "2026-08-02T10:00:00Z"
OPPS = [{"slug": s, "business": b, "published": True, "up": 1} for s, b in
        [("v1-2faces","2 Faces"), ("v2-sent-open","Sent Open Co"), ("v3-owner-only","Owner Only Co"), ("v4-stray","Stray Beacon Co")]]
# V2 and V3 have a real send; V1 and V4 never sent.
MAIL = [
  {"opp":"v2-sent-open","status":"sent","ts":SENT,"to":"lead@v2.example","subject":"Hi","mid":"m2"},
  {"opp":"v3-owner-only","status":"sent","ts":SENT,"to":"lead@v3.example","subject":"Hi","mid":"m3"},
]
# Opens (page beacons). self:true is the owner's own open (a preview), excluded from recipient views.
HITS = [
  {"type":"open","slug":"v1-2faces","ts":OPEN,"vid":"own1","self":True},      # V1: owner previewed, never sent
  {"type":"open","slug":"v2-sent-open","ts":OPEN,"vid":"rec2","self":False},  # V2: recipient opened after a send
  {"type":"open","slug":"v3-owner-only","ts":OPEN,"vid":"own3","self":True},  # V3: only the owner opened
  {"type":"open","slug":"v4-stray","ts":OPEN,"vid":"str4","self":False},      # V4: a stray beacon, never sent
]

def meta_of(pg, slug):
    return pg.evaluate("""(s)=>{ const el=document.querySelector('.tok[data-slug=\"'+s+'\"]');
        return el ? { lane: el.getAttribute('data-lane'),
                      meta: (el.querySelector('.tok-meta')||{}).textContent||'' } : null; }""", slug)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width":1440,"height":1000})
    ctx.route("https://api.github.com/**", lambda r: r.fulfill(status=404, body="{}"))
    ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))
    pg = ctx.new_page()
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_function("()=>typeof window.thriveBoardRefresh==='function' && typeof window.outreachOpens==='function'", timeout=15000)
    pg.evaluate("()=>{ document.documentElement.classList.remove('gate-locked'); const g=document.getElementById('thriveGate'); if(g) g.remove(); }")
    pg.evaluate("""(a)=>{ localStorage.setItem('thrive_opps_v1', JSON.stringify(a.opps));
        localStorage.setItem('thrive_mail_v1', JSON.stringify(a.mail));
        localStorage.setItem('thrive_hits_v1', JSON.stringify(a.hits)); }""",
        {"opps":OPPS,"mail":MAIL,"hits":HITS})
    hits_before = pg.evaluate("()=>localStorage.getItem('thrive_hits_v1')")
    pg.evaluate("()=>location.hash='board'"); pg.wait_for_timeout(500)
    pg.evaluate("()=>{ if(window.invalidateHits) invalidateHits(); if(window.invalidateSends) invalidateSends(); window.thriveBoardRefresh(); }")
    pg.wait_for_selector(".tok[data-slug]", timeout=8000)

    # The derivation itself (the invariant): recipient views require a delivered send.
    ro = pg.evaluate("""()=>({ v1: outreachOpens('v1-2faces'), v2: outreachOpens('v2-sent-open'),
        v3: outreachOpens('v3-owner-only'), v4: outreachOpens('v4-stray') })""")
    print("   outreachOpens:", ro)
    ck("V1: never sent, owner previewed -> 0 recipient views", ro["v1"] == 0, ro)
    ck("V2: sent, recipient opened -> the view counts", ro["v2"] >= 1, ro)
    ck("V3: sent, only owner opened -> 0 recipient views (owner excluded)", ro["v3"] == 0, ro)
    ck("V4: never sent, a stray beacon -> 0 recipient views (invariant holds)", ro["v4"] == 0, ro)

    noemail = pg.evaluate("()=>window.t('tok_noemail')")
    m1, m2, m3, m4 = (meta_of(pg,"v1-2faces"), meta_of(pg,"v2-sent-open"),
                      meta_of(pg,"v3-owner-only"), meta_of(pg,"v4-stray"))
    print("   cards:", m1, m2, m3, m4)
    # V1 / V4: a never-sent card reads "no email yet", never a view, and carries no digit (no "1 view").
    ck("V1 card reads not-sent with no view (never 'no email yet, one view')",
       m1 and m1["lane"] == "live" and m1["meta"].strip() == noemail.strip() and not any(c.isdigit() for c in m1["meta"]), m1)
    ck("V4 card reads not-sent with no view, even with a stray beacon",
       m4 and m4["lane"] == "live" and m4["meta"].strip() == noemail.strip() and not any(c.isdigit() for c in m4["meta"]), m4)
    # V2: the recipient open shows after the send.
    ck("V2 card shows the recipient open after the send", m2 and m2["lane"] == "opened" and "1" in m2["meta"], m2)
    # V3: an owner-only open never promotes the card off Sent and shows no recipient view.
    ck("V3 card stays sent with no recipient view (owner open excluded)", m3 and m3["lane"] == "sent", m3)

    # No visit row is deleted or rewritten: the classification is derivation-only.
    hits_after = pg.evaluate("()=>localStorage.getItem('thrive_hits_v1')")
    ck("no visit row was deleted or rewritten (classification is at read)", hits_before == hits_after,
       (hits_before, hits_after))
    ck("the visit store still holds all four opens", len(json.loads(hits_after)) == 4, hits_after)

    ctx.close(); b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
