"""P1.5 PR B - the living-card surfaces.

The recipients panel and aggregate read the one campaignStats/recipientState derivation, so the card and
Insights cannot disagree. The reply attribution surface (held list, attach picker, noise) moves to the
board; Settings keeps relay diagnostics only. A quiet badge counts new activity since a card was last
opened, cleared on open, local only. The group send has a pre-send review that blocks a nameless
recipient. The Basel case runs through the board re-match, unattended: his reply moves on its own, a child
card appears in Replied, thrive-july stays in Opened with his row Replied.

Three-width layout and Arabic joined-letter rendering are Thyab's device gate; this proves the wiring."""
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

# ---- source: one shared derivation at BOTH call sites; attribution UI is not in the Settings panel ----
app = open(os.path.join(ROOT, "library/app.js")).read()
card_site = "function campaignAggHtml" in app and "campaignStats(slug)" in app
ins_site = "byOpp[k].sent=cs.sent" in app and "const cs=campaignStats(k)" in app
ck("the card header and Insights both read campaignStats (one derivation, two call sites)", card_site and ins_site)
# the Settings replies panel no longer renders the attach picker or the held list
settings_fn = app[app.index("function renderRepliesPanel("):app.index("function renderInboxInto(") if "function renderInboxInto(" in app else len(app)]
_ib0 = app.index("function renderInboxInto(")
_ib1 = app.find("\nfunction ", _ib0 + 10)
inbox_fn = app[_ib0:(_ib1 if _ib1 > 0 else _ib0 + 4000)]
# renderInboxInto holds the attribution UI; renderRepliesPanel (Settings) does not
ck("the reply attribution UI lives in the board inbox, not in the Settings panel",
   ("rp-attach-sel" in inbox_fn) and ("rp-attach-sel" not in settings_fn) and ("rp-held" not in settings_fn))

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page()
    pg.goto(f"{base}/library/console.html"); pg.wait_for_timeout(500)
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(700)
    pg.wait_for_function("()=>typeof window.renderInboxInto==='function' && typeof window.recipientsPanelHtml==='function'", timeout=15000)

    # thrive-july campaign (three recipients incl. Basel), a held Basel reply, and a normal opp.
    pg.evaluate("""()=>{
      localStorage.setItem('thrive_opps_v1', JSON.stringify([
        {slug:'thrive-july', business:'July', published:true,
         recipients:[{addr:'basel.personal@gmail.com',name:'Basel',lang:'ar'},
                     {addr:'lina@school.com',name:'Lina',lang:'en'},
                     {addr:'omar@co.com',name:'Omar',lang:'ar'}]}]));
      localStorage.setItem('thrive_mail_v1', JSON.stringify([
        {mid:'j1',opp:'thrive-july',to:'basel.personal@gmail.com',toName:'Basel',subject:'من جد وجد',status:'sent',direction:'out',ts:'2026-08-01T10:00:00Z'},
        {mid:'j2',opp:'thrive-july',to:'lina@school.com',toName:'Lina',subject:'A page',status:'sent',direction:'out',ts:'2026-08-01T10:01:00Z'},
        {mid:'j3',opp:'thrive-july',to:'omar@co.com',toName:'Omar',subject:'A page',status:'sent',direction:'out',ts:'2026-08-01T10:02:00Z'}]));
      localStorage.setItem('thrive_inbound_v1', JSON.stringify([
        // Basel's reply subject was stripped, so it matches NO send subject: the subject link (resolvedReplyOpp)
        // cannot attach it, and it stays genuinely held until the sender re-match (below) attaches it. This is
        // the case the held/attach flow exists for; a subject that DID match a send auto-resolves (reply_link_test).
        {gid:'g1',opp:'',kind:'reply',from:'basel.personal@gmail.com',name:'Basel',subject:'Following up',snippet:'yes',ts:'2026-08-03T09:00:00Z'},
        {gid:'gn',opp:'',kind:'reply',from:'noreply@dmarc.google.com',subject:'Report Domain',snippet:'xml',ts:'2026-08-03T02:00:00Z'}]));
      // P3: a token-bearing open (r = a send id) is a real person opening; only that lights the badge.
      localStorage.setItem('thrive_hits_v1', JSON.stringify([{type:'open',slug:'thrive-july',ts:'2026-08-02T10:00:00Z',vid:'v1',r:'j1'}]));
      localStorage.removeItem('thrive_card_seen_v1');
      window.invalidateSends&&window.invalidateSends(); window.invalidateHits&&window.invalidateHits();
    }""")

    # ---- board inbox renders the held human reply + attach picker; noise is collapsed ----
    inbox = pg.evaluate("""()=>{ const d=document.createElement('div'); window.renderInboxInto(d);
      return { held: d.querySelectorAll('.rp-held-row').length, picker: !!d.querySelector('.rp-attach-sel'),
               noise: !!d.querySelector('.rp-noise') }; }""")
    ck("the board inbox shows the held human reply with an attach picker, noise collapsed",
       inbox["held"]==1 and inbox["picker"] and inbox["noise"], inbox)

    # ---- the board header badge counts the unmatched human replies ----
    badge = pg.evaluate("()=>window.inboundUnmatched().filter(r=>!window.inboundIsNoise(r)).length")
    ck("the unmatched-human count (the header badge) is 1, DMARC excluded", badge==1, badge)

    # ---- Basel through the board re-match, unattended (no manual attach first) ----
    r = pg.evaluate("()=>window.rematchHeld()")
    ck("re-match moves Basel on its own and spawns his child", r["matched"]==1 and r["spawned"]==1, r)
    childSlug = pg.evaluate("()=>window.childSlugFor('thrive-july','basel.personal@gmail.com')")
    ck("Basel's child card is in Replied", pg.evaluate("(s)=>window.effStage(window.getDraft(s))", childSlug)=="replied")
    ck("thrive-july stays in Opened (never Replied)", pg.evaluate("()=>window.effStage(window.getDraft('thrive-july'))")=="opened")
    ck("Basel's recipient row reads Replied and links to the child",
       pg.evaluate("()=>{ const s=window.recipientState('thrive-july','basel.personal@gmail.com'); return s.chip==='replied' && s.child===window.childSlugFor('thrive-july','basel.personal@gmail.com'); }"))

    # ---- recipients panel renders name, email, chip, last; header shows campaignStats aggregate ----
    panel = pg.evaluate("""()=>{ const html=window.recipientsPanelHtml(window.getDraft('thrive-july'));
      const d=document.createElement('div'); d.innerHTML=html;
      return { rows:d.querySelectorAll('.rc-row').length, chips:d.querySelectorAll('.chip-st').length,
               agg:!!d.querySelector('.cg-agg'), replied:!!d.querySelector('.chip-st.is-replied'),
               addr:!!d.querySelector('.rc-addr'), openChild:!!d.querySelector('.rc-open') }; }""")
    ck("recipients panel renders a row per recipient with chip, email, and the aggregate",
       panel["rows"]==3 and panel["chips"]==3 and panel["agg"] and panel["addr"], panel)
    ck("the replied recipient shows the Replied chip and a link to open the child",
       panel["replied"] and panel["openChild"], panel)

    # the card aggregate equals campaignStats (the same numbers Insights uses)
    agg = pg.evaluate("()=>window.campaignStats('thrive-july')")
    ck("campaignStats reports 3 sent, 1 open, 1 reply for the card and Insights alike",
       agg["sent"]==3 and agg["opens"]==1 and agg["replies"]==1, agg)

    # ---- the quiet badge (P3): a token-bearing (person) open since last view lights it; opening the card
    #      advances last_viewed_at (server-held on the record + local mirror), which clears it by definition ----
    seen = pg.evaluate("""()=>{ const before=window.cardNewActivity('thrive-july');
      window.markCardSeen('thrive-july'); const after=window.cardNewActivity('thrive-july');
      return { before, after, local: localStorage.getItem('thrive_card_seen_v1')!=null }; }""")
    ck("a person open lights the badge, and opening the card (mark seen) clears it",
       seen["before"]>0 and seen["after"]==0 and seen["local"], seen)

    # ---- group send pre-send review: every recipient, blocked only where a name is missing ----
    review = pg.evaluate("""()=>{ const d=document.createElement('div');
      window.renderGroupReviewInto(d, [
        {addr:'lina@school.com',name:'Lina',lang:'en'},
        {addr:'omar@co.com',name:'عمر',lang:'ar'},
        {addr:'x@y.com',name:'',lang:'en'}], {subject:'For {{NAME}}', html:'Hi {{NAME}}'});
      return { rows:d.querySelectorAll('.gr-row').length, blocked:d.querySelectorAll('.gr-blocked').length,
               ar: !!d.querySelector('.gr-row[dir=rtl]'), greetsLina: d.innerHTML.indexOf('Lina')>=0 }; }""")
    ck("the pre-send review lists every recipient, blocks only the nameless one, renders each greeting",
       review["rows"]==3 and review["blocked"]==1 and review["ar"] and review["greetsLina"], review)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL REPLY SURFACES CHECKS PASS"))
raise SystemExit(1 if fails else 0)
