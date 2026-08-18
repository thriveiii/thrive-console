"""Harden the reply surfaces: one resolved link everywhere, and a clean message render.

Finding 1: the link a reply carries must read the SAME on every surface (the board lane, the card badge,
the History row, the Replies inbox, the count). Before, the History row read the raw relay r.rule and the
inbox read raw inbound.opp, so a subject-linked reply (Basel, whose stored opp is empty) showed attached on
the board and "not matched to an opportunity" in History. resolvedReplyOpp is the one read-time resolver
(stored opp -> parent, else subject the way the view does, noise never resolving); every surface routes
through it, so a reply is linked everywhere or unlinked everywhere.

Finding 2: the reply message reads answer-first with the quoted original separated. A quote header the
parser cannot split no longer collapses the whole body to a flat tangle; it folds into the collapsible
quote, so the answer still reads first and the original stays separated.

FAILS-WHEN-BROKEN: route a surface back to raw r.opp and Basel splits (attached on one, unmatched on
another); restore the parse abort and the unparsable-header body renders flat (no rp-quoted). Device gate
(WebKit, three widths) stays Thyab's.
"""
import threading, http.server, socketserver, functools, os, sys

os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

# ============================ source guards ============================
app = open(f"{ROOT}/library/app.js").read()
ck("Finding 1: the one read-time resolver exists (stored opp -> parent, else subject, noise excluded)",
   "function resolvedReplyOpp(" in app and "if(raw) return replyParentOf(raw);" in app
   and 'if(r.kind==="auto" || inboundIsNoise(r)) return "";' in app and "return subjectLinkOpp(r);" in app)
ck("Finding 1: every reply surface routes through resolvedReplyOpp (no raw inbound.opp read)",
   "resolvedReplyOpp(r)!==slug" in app        # repliesForOpp
   and "resolvedReplyOpp(r)===slug" in app    # hasReply
   and "filter(r=> r && resolvedReplyOpp(r)===slug)" in app       # inboundFor
   and "filter(r=> r && r.kind!==\"auto\" && !resolvedReplyOpp(r))" in app)  # inboundUnmatched
ck("Finding 1: the History reply label is the resolved match, not the raw relay rule",
   "var etier=r.match_tier ||" in app and "rule:etier, tier:etier" in app)
ck("Finding 2: an unparsable quote header no longer aborts the whole render to flat",
   "if(hp){ blocks.push({ type:\"quoteHeader\", parts:hp }); structured=true; i++; }" in app
   and "if(!hp) return null;" not in app.split("function parseReplyBody(")[1].split("function ")[0])
ck("no em dash in the touched source", "—" not in app)

# ============================ live ============================
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True; threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width":1200,"height":900})
    ctx.route("https://api.github.com/**", lambda r: r.fulfill(status=404, body="{}"))
    ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))
    pg = ctx.new_page()
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_function("()=>typeof window.resolvedReplyOpp==='function' && typeof window.hasReply==='function' && typeof window.threadListHtml==='function'", timeout=15000)
    pg.evaluate("()=>{ document.documentElement.classList.remove('gate-locked'); const g=document.getElementById('thriveGate'); if(g) g.remove(); }")

    # madar has a send with subject 'من جد وجد'. Basel's reply has an EMPTY opp and comes from a personal
    # address (never received the send); only the subject links it. A github noise row shares the subject.
    pg.evaluate("""()=>{
      localStorage.setItem('thrive_opps_v1', JSON.stringify([{slug:'madar', business:'مدارس المدار الدولية', published:true, up:1}]));
      localStorage.setItem('thrive_mail_v1', JSON.stringify([
        {mid:'s1', opp:'madar', to:'head@madar.example', subject:'من جد وجد', status:'sent', direction:'out', ts:'2026-08-01T10:00:00Z'}]));
      localStorage.setItem('thrive_inbound_v1', JSON.stringify([
        {gid:'b1', opp:'', kind:'reply', from:'alnajjarjawad97@gmail.com', name:'Basel',
         subject:'Re: من جد وجد', ts:'2026-08-03T09:18:00Z',
         snippet:'نعم، يسعدني ذلك. الرابط: https://console.thriveiii.com/opp/madar\\nفي الأربعاء، كتب فريق ثرايف الفريق the team:\\n> الرسالة الأصلية هنا\\n> سطر آخر'},
        {gid:'gn', opp:'', kind:'reply', from:'notifications@github.com', subject:'Re: من جد وجد', snippet:'noise', ts:'2026-08-03T09:00:00Z'}]));
      localStorage.setItem('thrive_hits_v1','[]');
      window.invalidateSends&&window.invalidateSends();
    }""")

    # Finding 1: the resolved link is madar on every read, and the github noise never resolves.
    s = pg.evaluate("""()=>{
      const basel = window.getInbound().find(r=>r.gid==='b1');
      const gh = window.getInbound().find(r=>r.gid==='gn');
      return {
        baselResolved: window.resolvedReplyOpp(basel),
        ghResolved: window.resolvedReplyOpp(gh),
        has: window.hasReply('madar'),
        count: window.replyCountFor('madar'),
        inThread: window.inboundFor('madar').some(r=>r.gid==='b1'),
        unmatched: window.inboundUnmatched().some(r=>r.gid==='b1'),
        received: window.repliesReceived()
      };
    }""")
    ck("Finding 1: Basel resolves to madar by subject on every surface", s["baselResolved"]=="madar", s)
    ck("Finding 1: the github noise never resolves (subject coincidence is not a link)", s["ghResolved"]=="", s)
    ck("Finding 1: hasReply(madar) true, count 1, Basel is in the madar thread, not in the unmatched list",
       s["has"] is True and s["count"]==1 and s["inThread"] is True and s["unmatched"] is False, s)
    ck("Finding 1: the header count agrees (1 resolved reply, the noise excluded)", s["received"]==1, s)

    # Finding 1: the History reply card reads matched (never "not matched to an opportunity" for Basel).
    hist = pg.evaluate("""()=>{ const d=document.createElement('div'); d.innerHTML=window.threadListHtml('madar');
      const rule=(d.querySelector('.rp-rule')||{}).textContent||'';
      return { rule, hasReplyCard: !!d.querySelector('.th-reply'),
               noneText: d.innerHTML.indexOf('not matched to an opportunity')>=0 }; }""")
    ck("Finding 1: Basel's History row shows a match rule, never 'not matched to an opportunity'",
       hist["hasReplyCard"] is True and hist["noneText"] is False and hist["rule"] != "", hist)

    # Finding 2: the reply body reads answer-first, with the quoted original SEPARATED (a collapsible quote),
    # even though this Gmail header ("في الأربعاء، كتب فريق ثرايف الفريق the team:") does not cleanly parse.
    # P12: the answer is its own block (.rp-snip); the quoted original is a SEPARATE collapsible section
    # (details.rp-quoted), a sibling of the answer. Even an unparsable Gmail header is still detected as the
    # quote boundary, so the answer reads first and the original is separated (never one flat tangle).
    body = pg.evaluate("""()=>{ const d=document.createElement('div'); d.innerHTML=window.threadListHtml('madar');
      const bubble=d.querySelector('.th-reply'); if(!bubble) return {none:true};
      const snip=bubble.querySelector('.rp-snip'), q=bubble.querySelector('details.rp-quoted');
      return { hasMsg: !!snip, hasQuote: !!q,
               ltrIso: !!bubble.querySelector('.rp-ltr'),
               // the answer block precedes the quoted section in DOM order
               answerFirst: (function(){ if(!snip||!q) return false; return !!(snip.compareDocumentPosition(q)&Node.DOCUMENT_POSITION_FOLLOWING); })() }; }""")
    ck("Finding 2: the reply renders the answer in its own block, the quoted original in a separate collapsible quote",
       body.get("hasMsg") is True and body.get("hasQuote") is True and body.get("answerFirst") is True, body)
    ck("Finding 2: the URL inside the Arabic answer is direction-isolated (no RTL/LTR collision)",
       body.get("ltrIso") is True, body)

    ctx.close(); b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
