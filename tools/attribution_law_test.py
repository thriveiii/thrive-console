"""A reply is attributed to the send it actually answers, never to the address alone (attribution law).

One address legitimately receives sends from several opportunities, so the bare address cannot decide
between them. The law, in strict priority: 1) the header (In-Reply-To/References against a recorded wire
Message-ID) is the absolute winner; 2) the subject root (Re/Fwd and «رد/إعادة توجيه» stripped) selects the
sends whose subject the reply answers, and beats recency; 3) recency (the most recent send to the address)
is the last resort only, flagged ambiguous for a one-tap confirm. There is ONE matcher (matchReply); the
held re-match, the group spawn and the manual attach all resolve through it.

This proves the eight scenarios (S1-S8), the derivation floor (a reply implies at least Opened), analytics
coherence (the header reads the same attribution the board derives, not the mail ledger alone), and
idempotency. The device pass on WebKit (Basel re-points to the madar send, the thrive-july child card
vanishes with no orphan, Replied moves) stays Thyab's gate. No personal address is keyed on anywhere: the
scenarios are built from neutral fixtures, and the shipped client carries no address literal (grep in PR)."""
import threading, http.server, socketserver, functools, os, json
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:500])

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

def boot(b):
    pg = b.new_page()
    pg.goto(f"{base}/library/console.html"); pg.wait_for_timeout(250)
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(350)
    pg.wait_for_function("()=>typeof window.matchReply==='function' && typeof window.rematchHeld==='function'", timeout=15000)
    return pg

P = "p@x.example"
# Two sends to the same address: an older campaign (july) and a newer one (madar) with distinct subjects.
JULY = {"opp":"july", "to":P, "subject":"Autumn intake", "ts":"2026-08-01T10:00:00Z", "msgid":"july-wire@mail", "direction":"out", "status":"sent"}
MADAR = {"opp":"madar", "to":P, "subject":"International school offer", "ts":"2026-08-03T18:37:00Z", "msgid":"madar-wire@mail", "direction":"out", "status":"sent"}
SENDS = [JULY, MADAR]

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # ============================ pure matchReply: S1-S4, S6, single-opp ============================
    pg = boot(b)
    def mr(reply, sends=SENDS):
        return pg.evaluate("(a)=>window.matchReply(a.r, a.s)", {"r": reply, "s": sends})

    # S1: subject matches the NEWER send -> madar, by subject, not ambiguous.
    r1 = mr({"from":P, "subject":"Re: International school offer", "ts":"2026-08-03T18:55:00Z"})
    ck("S1 subject matches the newer send -> that opportunity, tier subject, not ambiguous",
       r1["opp"]=="madar" and r1["tier"]=="subject" and r1["ambiguous"] is False, r1)

    # S2: subject matches the OLDER send -> older wins; recency must NOT override a subject match.
    r2 = mr({"from":P, "subject":"Re: Autumn intake", "ts":"2026-08-04T09:00:00Z"})
    ck("S2 subject matches the older send -> older wins, recency does not override",
       r2["opp"]=="july" and r2["tier"]=="subject" and r2["ambiguous"] is False, r2)

    # S3: In-Reply-To names the older send even though the subject was edited to the newer one -> header wins.
    r3 = mr({"from":P, "subject":"Re: International school offer", "inReplyTo":"<july-wire@mail>", "ts":"2026-08-05T09:00:00Z"})
    ck("S3 header (In-Reply-To) wins over an edited subject",
       r3["opp"]=="july" and r3["tier"]=="header" and r3["ambiguous"] is False, r3)

    # S4: subject matches neither send and there is no header -> recency, flagged ambiguous (one-tap confirm).
    r4 = mr({"from":P, "subject":"quick question", "ts":"2026-08-06T09:00:00Z"})
    ck("S4 stripped/edited subject, no header -> recency (newest), flagged ambiguous",
       r4["opp"]=="madar" and r4["tier"]=="sender" and r4["ambiguous"] is True, r4)

    # S6: a forward from a THIRD address (never written to) is never auto-attributed.
    r6 = mr({"from":"stranger@z.example", "subject":"Fwd: International school offer"})
    ck("S6 a forward from a third address is never auto-attributed (opp empty)",
       r6["opp"]=="" and r6["tier"]=="", r6)

    # bare address never outranks subject: same subject to BOTH opps -> ambiguous, most recent, tier subject
    same = [dict(JULY, subject="Shared subject"), dict(MADAR, subject="Shared subject")]
    rS = mr({"from":P, "subject":"Re: Shared subject"}, same)
    ck("the bare address never outranks subject: one subject to two opps -> tier subject, ambiguous, newest",
       rS["opp"]=="madar" and rS["tier"]=="subject" and rS["ambiguous"] is True, rS)

    # single opportunity ever wrote to the address -> the address is unambiguous, tier sender, not ambiguous
    rOne = mr({"from":P, "subject":"whatever"}, [dict(JULY, opp="solo")])
    ck("a single opportunity to the address -> unambiguous, tier sender",
       rOne["opp"]=="solo" and rOne["tier"]=="sender" and rOne["ambiguous"] is False, rOne)
    pg.close()

    # ============================ store: Basel data repair (stale sender -> madar) + S8 idempotency ==========
    def seed(pg, opps, mail, inbound):
        pg.evaluate("""(a)=>{ localStorage.setItem('thrive_opps_v1', JSON.stringify(a.opps));
          localStorage.setItem('thrive_mail_v1', JSON.stringify(a.mail));
          localStorage.setItem('thrive_inbound_v1', JSON.stringify(a.inbound)); }""",
          {"opps":opps, "mail":mail, "inbound":inbound})

    pg = boot(pg_b := b)
    # the store as the flush race left it: the reply is auto-attributed to a thrive-july CHILD slug (tier
    # sender, matched before the madar send existed), while the correct answer is the madar single opp.
    child_july = pg.evaluate("()=>window.childSlugFor('thrive-july','%s')" % P)
    OPPS = [
      {"slug":"thrive-july","business":"July","published":True,"stage":"sent",
       "recipients":[{"addr":P,"name":"Pat"},{"addr":"b@x.example","name":"Bee"},{"addr":"c@x.example","name":"Cee"}]},
      {"slug":"madar","business":"Madar","published":True,"stage":"sent","recipients":[{"addr":P,"name":"Pat"}]},
    ]
    MAIL = [
      {"mid":"m-july","opp":"thrive-july","to":P,"subject":"Autumn intake","status":"sent","direction":"out","ts":"2026-08-01T10:00:00Z","msgid":"july-wire@mail"},
      {"mid":"m-madar","opp":"madar","to":P,"subject":"International school offer","status":"sent","direction":"out","ts":"2026-08-03T18:37:00Z","msgid":"madar-wire@mail"},
    ]
    INB = [
      {"gid":"g1","opp":child_july,"kind":"reply","from":P,"subject":"Re: International school offer",
       "snippet":"yes please","ts":"2026-08-03T18:55:00Z","match_tier":"sender","match_mode":"auto"},
    ]
    seed(pg, OPPS, MAIL, INB)

    before = pg.evaluate("()=>{ const rows=window.getInbound(); return { opp:rows[0].opp, tier:rows[0].match_tier }; }")
    ck("baseline: the reply is stale-attributed to the thrive-july child (bare-address era)",
       before["opp"]==child_july and before["tier"]=="sender", before)

    res1 = pg.evaluate("()=>window.rematchHeld()")
    after = pg.evaluate("""()=>{ const rows=window.getInbound();
      return { n:rows.length, opp:rows[0].opp, tier:rows[0].match_tier, amb:!!rows[0].match_ambiguous,
               madarStage:window.effStage(window.getDraft('madar')),
               julyStage:window.effStage(window.getDraft('thrive-july')),
               childGone:!window.getDrafts().some(o=>o.slug===%r),
               madarReplied:window.hasReply('madar'), julyReplied:window.hasReply('thrive-july') }; }""" % child_july)
    ck("the repair pass re-points the reply from the child to the madar send, by subject, through the one law",
       after["opp"]=="madar" and after["tier"]=="subject" and after["amb"] is False, {"res":res1, "after":after})
    ck("repair is reported (repaired count > 0), not a fresh match",
       res1.get("repaired",0) >= 1 and res1.get("matched",0)==0, res1)
    ck("madar now reads Replied; thrive-july no longer carries the reply",
       after["madarStage"]=="replied" and after["madarReplied"] is True and after["julyReplied"] is False, after)
    ck("the reconstructed thrive-july child vanishes when its inbound re-points (no orphan, no duplicate row)",
       after["childGone"] is True and after["n"]==1, after)
    ck("thrive-july (a group) stays in its own lane, never Replied",
       after["julyStage"] in ("opened","sent"), after["julyStage"])

    # S8: re-running is idempotent -> stable attribution, no repair, no duplicate rows.
    res2 = pg.evaluate("()=>window.rematchHeld()")
    stable = pg.evaluate("()=>{ const rows=window.getInbound(); return { n:rows.length, opp:rows[0].opp, tier:rows[0].match_tier }; }")
    ck("S8 re-match is idempotent: second run repairs nothing and leaves the attribution stable",
       res2.get("repaired",0)==0 and res2.get("matched",0)==0 and stable["opp"]=="madar" and stable["tier"]=="subject" and stable["n"]==1, {"res2":res2, "stable":stable})

    # A header match and a manual attach are immutable: the repair pass never touches them, even though the
    # subject would re-point them to july. Both are pinned to the single opp madar (so no group spawn moves
    # them either), and the subject "Re: Autumn intake" would resolve to july by subject if they were open to it.
    pg.evaluate("""()=>{ const rows=window.getInbound();
      rows.push({gid:'g-h',opp:'madar',kind:'reply',from:'%s',subject:'Re: Autumn intake',ts:'2026-08-07T00:00:00Z',match_tier:'header',match_mode:'auto',match_id:'madar-wire@mail'});
      rows.push({gid:'g-m',opp:'madar',kind:'reply',from:'%s',subject:'Re: Autumn intake',ts:'2026-08-08T00:00:00Z',match_tier:'manual',match_mode:'manual'});
      localStorage.setItem('thrive_inbound_v1', JSON.stringify(rows)); }""" % (P, P))
    pg.evaluate("()=>window.rematchHeld()")
    imm = pg.evaluate("""()=>{ const rows=window.getInbound();
      const h=rows.find(r=>r.gid==='g-h'), m=rows.find(r=>r.gid==='g-m');
      return { header:h&&h.opp, manual:m&&m.opp }; }""")
    ck("a header attribution and a manual attach are immutable (repair never re-points them, even when subject would)",
       imm["header"]=="madar" and imm["manual"]=="madar", imm)
    pg.close()

    # ============================ store: S7 group + single, reply matches single -> single wins ==============
    pg = boot(b)
    OPPS7 = [
      {"slug":"grp","business":"Group","published":True,"stage":"sent",
       "recipients":[{"addr":P,"name":"Pat"},{"addr":"d@x.example","name":"Dee"}]},
      {"slug":"single","business":"Single","published":True,"stage":"sent","recipients":[{"addr":P,"name":"Pat"}]},
    ]
    MAIL7 = [
      {"mid":"g-blast","opp":"grp","to":P,"subject":"Group blast","status":"sent","direction":"out","ts":"2026-08-01T10:00:00Z"},
      {"mid":"s-off","opp":"single","to":P,"subject":"Personal offer","status":"sent","direction":"out","ts":"2026-08-02T10:00:00Z"},
    ]
    INB7 = [ {"gid":"g7","kind":"reply","from":P,"subject":"Re: Personal offer","snippet":"interested","ts":"2026-08-03T10:00:00Z"} ]
    seed(pg, OPPS7, MAIL7, INB7)
    pg.evaluate("()=>window.rematchHeld()")
    s7 = pg.evaluate("""()=>{ const rows=window.getInbound();
      return { opp:rows[0].opp, tier:rows[0].match_tier,
               grpChild: window.getDrafts().some(o=>o.slug && o.slug.indexOf('grp--r-')===0),
               singleStage: window.effStage(window.getDraft('single')),
               grpStage: window.effStage(window.getDraft('grp')) }; }""")
    ck("S7 group + single to one address, reply matches the single -> single wins by subject",
       s7["opp"]=="single" and s7["tier"]=="subject", s7)
    ck("S7 no group child is spawned (the reply never belonged to the group)",
       s7["grpChild"] is False, s7)
    ck("S7 single reads Replied; the group stays Sent (no phantom reply under it)",
       s7["singleStage"]=="replied" and s7["grpStage"]=="sent", s7)
    pg.close()

    # ============================ store: S5 second reply in a group thread -> one child, no duplicate ========
    pg = boot(b)
    OPPS5 = [ {"slug":"gc","business":"Camp","published":True,"stage":"sent",
       "recipients":[{"addr":P,"name":"Pat"},{"addr":"e@x.example","name":"Eee"}]} ]
    MAIL5 = [ {"mid":"gc-s","opp":"gc","to":P,"subject":"Camp blast","status":"sent","direction":"out","ts":"2026-08-01T10:00:00Z"} ]
    INB5 = [
      {"gid":"r-a","kind":"reply","from":P,"subject":"Re: Camp blast","snippet":"one","ts":"2026-08-02T10:00:00Z"},
      {"gid":"r-b","kind":"reply","from":P,"subject":"Re: Camp blast","snippet":"two","ts":"2026-08-03T10:00:00Z"},
    ]
    seed(pg, OPPS5, MAIL5, INB5)
    pg.evaluate("()=>window.rematchHeld()")
    pg.evaluate("()=>window.rematchHeld()")   # twice: still one child
    s5 = pg.evaluate("""()=>{ const kids=window.getDrafts().filter(o=>o.slug && o.slug.indexOf('gc--r-')===0);
      const rows=window.getInbound();
      const opps=new Set(rows.map(r=>r.opp));
      return { childCount:kids.length, childSlug:kids[0]&&kids[0].slug, rowOpps:[...opps],
               childStage: kids[0]? window.effStage(kids[0]) : "", rows:rows.length }; }""")
    ck("S5 two replies in one group thread spawn exactly one child (no duplicate)",
       s5["childCount"]==1 and s5["rows"]==2, s5)
    ck("S5 both replies attribute to the same child, which reads Replied",
       len(s5["rowOpps"])==1 and s5["rowOpps"][0]==s5["childSlug"] and s5["childStage"]=="replied", s5)
    pg.close()

    # ============================ derivation floor: a reply implies at least Opened ==========================
    pg = boot(b)
    OPPSF = [ {"slug":"grpf","business":"Floor","published":True,"stage":"sent",
       "recipients":[{"addr":P,"name":"Pat"},{"addr":"f@x.example","name":"Eff"}]} ]
    MAILF = [ {"mid":"gf-s","opp":"grpf","to":P,"subject":"Floor blast","status":"sent","direction":"out","ts":"2026-08-01T10:00:00Z"} ]
    # a reply attributed to the group (not yet spawned), and ZERO page opens recorded.
    INBF = [ {"gid":"rf","opp":"grpf","kind":"reply","from":P,"subject":"Re: Floor blast","ts":"2026-08-02T10:00:00Z","match_tier":"sender","match_mode":"auto"} ]
    seed(pg, OPPSF, MAILF, INBF)
    floor = pg.evaluate("""()=>{ const g=window.getDraft('grpf');
      return { opens: window.outreachOpens(g), stage: window.effStage(g) }; }""")
    ck("the floor: a group with a reply but zero recorded opens reads Opened, never Sent",
       floor["opens"]==0 and floor["stage"]=="opened", floor)
    # after spawn, the child carries Replied and the group is still at least Opened.
    pg.evaluate("()=>window.rematchHeld()")
    floor2 = pg.evaluate("""()=>{ const g=window.getDraft('grpf');
      const kid=window.getDrafts().find(o=>o.slug && o.slug.indexOf('grpf--r-')===0);
      return { grp: window.effStage(g), child: kid? window.effStage(kid): "" }; }""")
    ck("after spawn the child reads Replied and the group holds at Opened (reply implies opened, permanently)",
       floor2["grp"]=="opened" and floor2["child"]=="replied", floor2)
    pg.close()

    # ============================ analytics coherence: the header reads the board's attribution ==============
    pg = boot(b)
    # a reply that lives ONLY in console_inbound (never a ledger row), attributed to madar.
    OPPSC = [ {"slug":"madar","business":"Madar","published":True,"stage":"sent","recipients":[{"addr":P,"name":"Pat"}]} ]
    MAILC = [ {"mid":"c-s","opp":"madar","to":P,"subject":"Offer","status":"sent","direction":"out","ts":"2026-08-01T10:00:00Z"} ]
    INBC = [ {"gid":"c-r","opp":"madar","kind":"reply","from":P,"subject":"Re: Offer","ts":"2026-08-02T10:00:00Z","match_tier":"sender","match_mode":"auto"} ]
    seed(pg, OPPSC, MAILC, INBC)
    coh = pg.evaluate("""()=>{
      const mail=window.getMailLog();
      const ledgerOnly = mail.filter(m=>m.direction==='in'||m.status==='replied').length;   // the OLD header formula
      const header = window.repliesReceived();                                              // the shared derivation
      const board = window.getDrafts().filter(o=>!o.archived && window.effStage(o)==='replied').length;
      return { ledgerOnly, header, board }; }""")
    ck("the divergence existed: the mail-ledger-only count sees 0 for an inbound-only reply",
       coh["ledgerOnly"]==0, coh)
    ck("coherence: the header (repliesReceived) reads the same 1 the board derives (tiles no longer say 0 while tables say 1)",
       coh["header"]==1 and coh["board"]==1, coh)
    pg.close()

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL ATTRIBUTION-LAW CHECKS PASS"))
raise SystemExit(1 if fails else 0)
