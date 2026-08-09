"""P1 - replies match their opportunities, and threads hold a full conversation.

The relay's matcher missed every human reply that arrived at the From line from a different address than
the one we sent to: the tag was lost (the client replied to From, not the +slug Reply-To), the header tier
was dead (the recorded id was a local id, never the wire Message-ID), and sender matching is fragile. This
proves the console-side fix: a three-tier matcher (header, sender, subject) that records the tier, noise
classified before display, a held reply re-matched to its opportunity so the card flips to Replied, an
unbounded conversation in time order, and idempotent re-matching. The Basel reply is the named test case.

The sandbox is Chromium-only and cannot reach live Supabase or Gmail; the durable header tier needs the
relay redeployed to record the wire Message-ID and store reply headers, which is Thyab's device gate."""
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
    pg.wait_for_function("()=>typeof window.matchReply==='function' && typeof window.rematchHeld==='function'", timeout=15000)

    # The send ledger the console holds: two opportunities, each with one recorded send.
    #  - basel-co: sent to basel.personal@gmail.com (Basel later replies from that same address)
    #  - quiet-co: sent to info@quiet.co (nobody replies)
    pg.evaluate("""()=>{
      localStorage.setItem('thrive_opps_v1', JSON.stringify([
        {slug:'basel-co', business:'Basel Co', published:true, stage:'sent'},
        {slug:'quiet-co', business:'Quiet Co', published:true, stage:'sent'}
      ]));
      localStorage.setItem('thrive_mail_v1', JSON.stringify([
        {mid:'s1', msgid:'<wire-basel-1@resend>', opp:'basel-co', to:'basel.personal@gmail.com', subject:'من جد وجد', status:'sent', direction:'out', ts:'2026-08-01T10:00:00Z', actor:'thyab'},
        {mid:'s2', msgid:'<wire-quiet-1@resend>', opp:'quiet-co', to:'info@quiet.co', subject:'A quick idea', status:'sent', direction:'out', ts:'2026-08-01T10:05:00Z', actor:'thyab'}
      ]));
      localStorage.setItem('thrive_inbound_v1','[]'); localStorage.setItem('thrive_hits_v1','[]');
    }""")

    # ---- tier logic, unit level ----
    # Basel: personal gmail == the recorded recipient, no threading header -> tier sender (the named case).
    basel = pg.evaluate("""()=>window.matchReply({from:'basel.personal@gmail.com', subject:'Re: من جد وجد', ts:'2026-08-03T09:00:00Z'})""")
    ck("Basel reply matches its opportunity by tier sender", basel["opp"]=="basel-co" and basel["tier"]=="sender", basel)
    # A threading header beats sender when the recorded wire Message-ID is referenced.
    hdr = pg.evaluate("""()=>window.matchReply({from:'someone-else@gmail.com', inReplyTo:'<wire-basel-1@resend>', subject:'Re: من جد وجد'})""")
    ck("a reply with In-Reply-To on the wire Message-ID matches by tier header", hdr["opp"]=="basel-co" and hdr["tier"]=="header", hdr)
    # No header, sender not in the ledger, subject alone never attributes.
    none = pg.evaluate("""()=>window.matchReply({from:'stranger@nowhere.com', subject:'Re: من جد وجد'})""")
    ck("subject alone never attributes (no sender match -> no match)", none["opp"]=="" and none["tier"]=="", none)

    # ---- noise classification ----
    noise = pg.evaluate("""()=>({
      dmarc: window.inboundIsNoise({from:'noreply-dmarc@google.com', subject:'Report Domain: thriveiii.com', kind:'reply'}),
      insta: window.inboundIsNoise({from:'no-reply@mail.instagram.com', subject:'New login', kind:'reply'}),
      ocean: window.inboundIsNoise({from:'do-not-reply@digitalocean.com', subject:'Your droplet', kind:'reply'}),
      autob: window.inboundIsNoise({from:'mailer-daemon@googlemail.com', subject:'Delivery Status Notification', kind:'auto'}),
      human: window.inboundIsNoise({from:'basel.personal@gmail.com', subject:'Re: من جد وجد', kind:'reply'})
    })""")
    ck("DMARC / Instagram / DigitalOcean / mailer-daemon are noise", noise["dmarc"] and noise["insta"] and noise["ocean"] and noise["autob"], noise)
    ck("a real person on gmail is never noise", noise["human"] == False, noise)

    # ---- re-match held replies: the 48-held recovery, idempotent ----
    pg.evaluate("""()=>{
      localStorage.setItem('thrive_inbound_v1', JSON.stringify([
        {gid:'g1', opp:'', kind:'reply', from:'basel.personal@gmail.com', name:'Basel', subject:'Re: من جد وجد', snippet:'yes let us talk', ts:'2026-08-03T09:00:00Z'},
        {gid:'g2', opp:'', kind:'reply', from:'noreply-dmarc@google.com', subject:'Report Domain: thriveiii.com', snippet:'xml', ts:'2026-08-03T02:00:00Z'},
        {gid:'g3', opp:'', kind:'reply', from:'stranger@nowhere.com', subject:'Re: something', snippet:'who?', ts:'2026-08-03T03:00:00Z'}
      ]));
    }""")
    r1 = pg.evaluate("()=>window.rematchHeld()")
    ck("re-match attributes exactly the one human reply that matches (Basel)", r1["matched"]==1 and r1["byTier"]["sender"]==1, r1)
    ck("noise is separated, not matched and not counted as held human mail", r1["noise"]>=1 and r1["held"]==1, r1)
    ck("the Basel card flips to Replied by the derivation", pg.evaluate("()=>window.effStage(window.getDraft('basel-co'))")=="replied")
    r2 = pg.evaluate("()=>window.rematchHeld()")
    ck("re-matching is idempotent (a second run matches nothing new)", r2["matched"]==0, r2)
    ck("no duplicate inbound rows are created by re-matching",
       pg.evaluate("()=>JSON.parse(localStorage.getItem('thrive_inbound_v1')).length")==3)

    # ---- manual attach of the genuinely unmatched human reply ----
    ok = pg.evaluate("()=>window.attachReply('g3','quiet-co')")
    ck("a held human reply attaches to an opportunity by hand (tier manual)",
       ok==True and pg.evaluate("()=>window.effStage(window.getDraft('quiet-co'))")=="replied")

    # ---- unbounded, ordered conversation, incl. a later second-operator send ----
    pg.evaluate("""()=>{
      const m=JSON.parse(localStorage.getItem('thrive_mail_v1'));
      m.push({mid:'s3', opp:'basel-co', to:'basel.personal@gmail.com', subject:'Re: من جد وجد', status:'sent', direction:'out', ts:'2026-08-04T08:00:00Z', actor:'mohammed'});
      localStorage.setItem('thrive_mail_v1', JSON.stringify(m));
      const inb=JSON.parse(localStorage.getItem('thrive_inbound_v1'));
      inb.push({gid:'g4', opp:'basel-co', kind:'reply', from:'basel.personal@gmail.com', subject:'Re: من جد وجد', snippet:'sounds good', ts:'2026-08-05T09:00:00Z'});
      localStorage.setItem('thrive_inbound_v1', JSON.stringify(inb));
    }""")
    # The real card conversation renderer, buildThread, orders the whole exchange oldest to newest; a
    # later send into the same thread (a second operator's) falls into sequence between the two replies.
    conv = pg.evaluate("()=>window.buildThread('basel-co').filter(x=>x.kind==='sent'||x.kind==='reply').map(x=>x.kind+'@'+x.ts)")
    ck("the conversation is oldest to newest, a later send in sequence",
       conv == ['sent@2026-08-01T10:00:00Z','reply@2026-08-03T09:00:00Z','sent@2026-08-04T08:00:00Z','reply@2026-08-05T09:00:00Z'], conv)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL REPLY MATCHER CHECKS PASS"))
raise SystemExit(1 if fails else 0)
