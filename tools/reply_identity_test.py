"""P1 addendum - the channel decides identity, not the address.

An address can be both an operator account and a prospect contact. Identity is decided by the channel and
by evidence of a prior send, never by who owns the address: the matcher knows nothing of operator or Auth
accounts. This proves the seven scenarios, that the noise classifier runs AFTER the tiers, and that every
matched row records the tier, the identifier it matched on, and whether it was automatic or manual.

The sandbox is Chromium-only; the live cases are Thyab's device gate."""
import threading, http.server, socketserver, functools, os, json
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

    def m(reply, sends):
        return pg.evaluate("(a)=>window.matchReply(a[0], a[1])", [reply, sends])

    OP = "op@ex.com"   # an operator address that is also, in scenario 1, a prospect contact

    # Scenario 1: an operator address replies to a real send addressed to that same address. It is a
    # prospect reply; operator status is irrelevant (the matcher never consults it).
    s1 = m({"from": OP, "subject": "Re: Hi"},
           [{"opp": "acme", "to": OP, "msgid": "<w1@r>", "subject": "Hi", "ts": "2026-08-01"}])
    ck("1. operator address answering a real send is a prospect reply (tier sender)",
       s1["opp"] == "acme" and s1["tier"] == "sender" and s1["id"] == OP, s1)

    # Scenario 2: the same operator address sends fresh mail that answers no send. Not a prospect reply,
    # never auto-attached because a shared address appears somewhere.
    s2 = m({"from": OP, "subject": "Just saying hello"},
           [{"opp": "acme", "to": "someone@else.com", "msgid": "<w2@r>", "subject": "Hi", "ts": "2026-08-01"}])
    ck("2. operator address with no matching send does not auto-attach", s2["opp"] == "" and s2["tier"] == "", s2)

    # Scenario 3: a self-test send to the operator's own address. Its reply threads to the test opp only,
    # never to a real client sent to a different address.
    sends3 = [{"opp": "self-test", "to": OP, "msgid": "<wself@r>", "subject": "test", "ts": "2026-08-02"},
              {"opp": "client-co", "to": "client@co.com", "msgid": "<wc@r>", "subject": "Proposal", "ts": "2026-08-01"}]
    s3 = m({"from": OP, "subject": "Re: test"}, sends3)
    ck("3. a self-test reply threads to the test opp only, never a client", s3["opp"] == "self-test", s3)

    # Scenario 4: two opportunities sent to the same address.
    sends4 = [{"opp": "oppA", "to": "x@co.com", "msgid": "<wa@r>", "subject": "About A", "ts": "2026-08-01"},
              {"opp": "oppB", "to": "x@co.com", "msgid": "<wb@r>", "subject": "About B", "ts": "2026-08-02"}]
    s4h = m({"from": "x@co.com", "inReplyTo": "<wb@r>", "subject": "Re: About B"}, sends4)
    ck("4a. a Message-ID resolves two-to-one address to the right opp (tier header)",
       s4h["opp"] == "oppB" and s4h["tier"] == "header" and s4h["ambiguous"] == False, s4h)
    s4a = m({"from": "x@co.com", "subject": "Re: unrelated"}, sends4)
    ck("4b. no Message-ID, no subject match: newest wins but is flagged ambiguous, not certain",
       s4a["opp"] == "oppB" and s4a["tier"] == "sender" and s4a["ambiguous"] == True, s4a)
    s4s = m({"from": "x@co.com", "subject": "Re: About A"}, sends4)
    ck("4c. a subject match disambiguates the collision to one opp (tier subject)",
       s4s["opp"] == "oppA" and s4s["tier"] == "subject" and s4s["ambiguous"] == False, s4s)

    # Scenario 5: the person replies from a different address than the one we sent to.
    sends5 = [{"opp": "acme", "to": "sent@co.com", "msgid": "<w5@r>", "subject": "Hi", "ts": "2026-08-01"}]
    ck("5a. a reply from a different address is not a tier-2 match",
       m({"from": "personal@gmail.com", "subject": "Re: Hi"}, sends5)["opp"] == "", None)
    ck("5b. but a threading header still matches from any address (tier header)",
       m({"from": "personal@gmail.com", "inReplyTo": "<w5@r>"}, sends5)["opp"] == "acme", None)

    # Scenario 6: the noise classifier runs AFTER the tiers, so a genuine reply from a no-reply-looking
    # address that answers a send is not discarded; noise that matches nothing goes to the noise list.
    isnoise = pg.evaluate("()=>window.inboundIsNoise({from:'noreply@prospect.com', subject:'Re: your page', kind:'reply'})")
    ck("6a. a no-reply-looking address is flagged noise by the classifier", isnoise == True)
    pg.evaluate("""()=>{
      localStorage.setItem('thrive_opps_v1', JSON.stringify([{slug:'pros', business:'Prospect', published:true, stage:'sent'}]));
      localStorage.setItem('thrive_mail_v1', JSON.stringify([
        {mid:'sp', opp:'pros', to:'noreply@prospect.com', subject:'your page', status:'sent', direction:'out', ts:'2026-08-01T10:00:00Z'}]));
      localStorage.setItem('thrive_inbound_v1', JSON.stringify([
        {gid:'gp', opp:'', kind:'reply', from:'noreply@prospect.com', subject:'Re: your page', snippet:'yes', ts:'2026-08-03T09:00:00Z'},
        {gid:'gn', opp:'', kind:'reply', from:'noreply@newsletter.com', subject:'Weekly digest', snippet:'ad', ts:'2026-08-03T02:00:00Z'}]));
      localStorage.setItem('thrive_hits_v1','[]');
    }""")
    r6 = pg.evaluate("()=>window.rematchHeld()")
    ck("6b. a no-reply address that answers a send still matches (tiers before noise)",
       r6["matched"] == 1 and pg.evaluate("()=>window.effStage(window.getDraft('pros'))") == "replied", r6)
    ck("6c. no-reply mail that answers nothing stays in the noise list", r6["noise"] >= 1, r6)

    # Every matched row records the reason: the tier, the identifier, and auto vs manual.
    gp = pg.evaluate("()=>JSON.parse(localStorage.getItem('thrive_inbound_v1')).find(r=>r.gid==='gp')")
    ck("every matched row records tier, identifier, and mode",
       gp.get("match_tier") == "sender" and gp.get("match_id") == "noreply@prospect.com" and gp.get("match_mode") == "auto", gp)

    # Scenario 7: an operator copied on a prospect send; the reply threads by Message-ID, and the operator's
    # own later reply in the same thread appears in sequence in the conversation.
    pg.evaluate("""()=>{
      localStorage.setItem('thrive_opps_v1', JSON.stringify([{slug:'proj', business:'Project', published:true, stage:'sent'}]));
      localStorage.setItem('thrive_mail_v1', JSON.stringify([
        {mid:'s7', opp:'proj', to:'p@co.com', msgid:'<w7@r>', subject:'Project', status:'sent', direction:'out', ts:'2026-08-01T10:00:00Z'}]));
      localStorage.setItem('thrive_inbound_v1', JSON.stringify([
        {gid:'gr1', opp:'', kind:'reply', from:'p@co.com', inReplyTo:'<w7@r>', subject:'Re: Project', snippet:'interested', ts:'2026-08-03T09:00:00Z'},
        {gid:'gr2', opp:'', kind:'reply', from:'op@ex.com', inReplyTo:'<w7@r>', subject:'Re: Project', snippet:'me too', ts:'2026-08-04T09:00:00Z'}]));
      localStorage.setItem('thrive_hits_v1','[]');
    }""")
    r7 = pg.evaluate("()=>window.rematchHeld()")
    ck("7a. both replies thread to the opportunity by Message-ID (tier header)",
       r7["matched"] == 2 and r7["byTier"]["header"] == 2, r7)
    conv7 = pg.evaluate("()=>window.buildThread('proj').filter(x=>x.kind==='sent'||x.kind==='reply').map(x=>x.kind+'@'+x.ts)")
    ck("7b. the send and both later replies appear in sequence, oldest to newest",
       conv7 == ['sent@2026-08-01T10:00:00Z','reply@2026-08-03T09:00:00Z','reply@2026-08-04T09:00:00Z'], conv7)

    # Manual attach records mode manual, distinct from an automatic match.
    pg.evaluate("""()=>{ localStorage.setItem('thrive_inbound_v1', JSON.stringify([
        {gid:'gm', opp:'', kind:'reply', from:'stranger@nowhere.com', subject:'Re: hmm', snippet:'?', ts:'2026-08-03T09:00:00Z'}])); }""")
    pg.evaluate("()=>window.attachReply('gm','proj')")
    gm = pg.evaluate("()=>JSON.parse(localStorage.getItem('thrive_inbound_v1')).find(r=>r.gid==='gm')")
    ck("a manual attach records mode manual (not auto)",
       gm.get("match_mode") == "manual" and gm.get("match_tier") == "manual", gm)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL REPLY IDENTITY CHECKS PASS"))
raise SystemExit(1 if fails else 0)
