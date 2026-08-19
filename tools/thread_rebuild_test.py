"""The internal conversation view, rebuilt: one bubble component, distinct sides, isolation that never
collides, a quote that is never dumped, and a one-tap optimistic reply (WO thread-rebuild).

The History thread carried the named device breaks after the reply-card polish: our send and their reply
looked identical (same panel surface, differing only by a hairline accent), a long sender name and the
timestamp crowded one line, a bare domain inside an Arabic line collided with the script around it, and a
quoted original that carried none of the ">" markers (an Outlook From:/Sent: block, a separator rule) was
dumped flat under the answer with no working "show quoted text". This rebuilds the thread as ONE bubble
component used for every message and proves, engine-independently (the final glyph order on WebKit at three
widths is Thyab's device gate):

  - one component: our send (.th-sent .msg-out) and their reply (.th-reply .rp-card) share the header/body
    skeleton (rp-head ABOVE rp-body) and are told apart by TWO signals - opposite alignment AND a distinct
    surface tint (their backgrounds differ), each bounded (border + radius + padding);
  - the header never collides: at phone width, with a long Arabic sender, the name box and the timestamp box
    do not intersect;
  - isolation on every mixed span: a bare domain (no scheme) inside an Arabic line is wrapped in a bdi.rp-ltr,
    so it cannot reorder against the Arabic around it;
  - the quote is never dumped: an Outlook field block and a separator rule each parse so the answer is the
    only new text and the quoted original lands in a collapsed details.rp-quoted, never flat under the answer;
  - one-tap optimistic reply: threadOptimisticReply appends our reply to the thread immediately as a dimmed
    outgoing bubble, and a genuinely failed send leaves NO phantom (buildThread excludes an unsent row);
  - the phone holds: the whole thread renders at 390/AR with no horizontal overflow and every bubble inside
    its box.

Fails-when-broken: reverting the retint makes the two surfaces equal (surface check reds); reverting the
bare-domain token makes the domain a bare run (isolation check reds); reverting quoteStartIndex dumps the
Outlook/separator original into the message (quote checks red).
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

# ---- Source guards: the rebuild is one component + broadened isolation/quote + optimistic reply ----
app = open(f"{ROOT}/library/app.js").read()
ck("one bubble component builds every message (msgBubble), used by both sent and reply",
   "function msgBubble(" in app and "sentCard" in app and "replyCard" in app
   and app.count("function msgBubble(") == 1)
ck("the bare-domain run is isolated too (RE_REPLY_TOKEN carries a host+TLD alternative)",
   "[a-zA-Z0-9][a-zA-Z0-9\\-]*(?:\\.[a-zA-Z0-9\\-]+)*\\.[a-zA-Z]{2,}" in app)
ck("a broadened quote-boundary detector exists (Outlook block + separators), so the original is never dumped",
   "function quoteStartIndex(" in app and "original message" in app.lower())
ck("the optimistic reply and scroll-to-newest helpers exist",
   "function threadOptimisticReply(" in app and "function scrollThreadToNewest(" in app)
# Step 1/2: there is ONE card-History renderer and it self-identifies with a version marker.
ck("exactly one card-History renderer (threadListHtml) and one mount (renderHistory), no second path",
   app.count("function threadListHtml(")==1 and app.count("function renderHistory(")==1)
ck("the thread renderer carries a self-identifying version marker (threadRendererTag / THREAD_RENDERER_VERSION)",
   "THREAD_RENDERER_VERSION" in app and "function threadRendererTag(" in app and 'class="th-ver"' in app)
# Runtime instrumentation: every History writer stamps itself, and a probe names the mounted renderer.
ck("every History writer self-identifies at runtime (data-renderer on the list, data-bubble on each message)",
   'data-renderer="threadListHtml"' in app and 'data-bubble="msgBubble"' in app and 'data-history-renderer' in app)
ck("a runtime probe (threadRendererReport) walks the open History DOM to name the mounted renderer",
   "function threadRendererReport(" in app and "window.threadRendererReport" in app)

# A long Arabic sender name, so the header row is stressed at phone width. A bare-domain (no scheme) inside
# the Arabic answer, so the isolation is exercised on the exact collision case.
LONGNAME = "عبد الرحمن بن محمد بن عبد الله الطويل جدًا لاختبار التفاف الاسم"
REPLY_BODY = "شكرًا لكم، راجعنا console.thriveiii.com/opp/madar-2026 وسنعود إليكم قريبًا."
OUTLOOK = ("نعم، هذا رائع. شكرًا لكم.\n\n"
           "From: Thrive Digital Solutions <hi@thriveiii.com>\n"
           "Sent: Monday, August 3, 2026 9:37 PM\n"
           "To: Basel Issa <basel@issa.example>\n"
           "Subject: عرض المدرسة\n\n"
           "UNIQUEQUOTEDMARKER اطّلعوا على العرض هنا.")
SEP = ("Sounds great, thank you.\n\n"
       "-----Original Message-----\n"
       "SEPUNIQUEMARKER the original body text here.")

def seed(pg):
    pg.evaluate("""(a)=>{
      const set=(k,v)=>localStorage.setItem(k, JSON.stringify(v));
      set('thrive_opps_v1', [{slug:'co', business:'Co', published:true,
        recipients:[{addr:'omar@company.example', name:a.longname, lang:'ar'}]}]);
      set('thrive_mail_v1', [{mid:'s1', opp:'co', to:'omar@company.example', toName:a.longname,
        subject:'عرض من ثرايف', status:'sent', direction:'out', ts:'2026-08-01T10:00:00Z'}]);
      set('thrive_inbound_v1', [{gid:'g1', opp:'co', kind:'reply', from:'omar@company.example', name:a.longname,
        subject:'Re: عرض من ثرايف', snippet:a.body, ts:'2026-08-03T09:00:00Z'}]);
      set('thrive_hits_v1', []);
    }""", {"longname": LONGNAME, "body": REPLY_BODY})

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width": 390, "height": 900})
    ctx.route("https://api.github.com/**", lambda r: r.fulfill(status=404, body="{}"))
    ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))
    pg = ctx.new_page()
    pg.goto(f"{base}/library/console.html")
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(300)
    pg.wait_for_function("()=>typeof window.threadListHtml==='function' && typeof window.renderReplyBody==='function' && typeof window.parseReplyBody==='function'", timeout=15000)
    seed(pg)

    # Render the whole thread into a phone-width container so surfaces, geometry and overflow are real.
    pg.evaluate("""()=>{
      const w=document.createElement('div'); w.id='probe';
      w.style.cssText='width:360px;max-width:360px;box-sizing:border-box';
      w.innerHTML=window.threadListHtml('co'); document.body.appendChild(w);
    }""")

    # ---- one component, two distinct sides: opposite surfaces, both bounded, header above body ----
    sides = pg.evaluate("""()=>{
      const out=document.querySelector('#probe .th-sent .msg-out');
      const rep=document.querySelector('#probe .th-reply .rp-card');
      const cs=el=>getComputedStyle(el);
      const bounded=el=>{ const s=cs(el); return s.borderTopWidth!=='0px' && s.borderTopLeftRadius!=='0px' && parseFloat(s.paddingLeft)>0; };
      const head=el=>el.querySelector('.rp-head'), body=el=>el.querySelector('.rp-body');
      const above=el=>{ const h=head(el), bd=body(el); return !!(h&&bd) && !!(h.compareDocumentPosition(bd)&Node.DOCUMENT_POSITION_FOLLOWING); };
      return { haveBoth: !!out && !!rep,
               outBg: out?cs(out).backgroundColor:'', repBg: rep?cs(rep).backgroundColor:'',
               outBounded: out?bounded(out):false, repBounded: rep?bounded(rep):false,
               outHeadAbove: out?above(out):false, repHeadAbove: rep?above(rep):false }; }""")
    ck("the thread shows both sides as one bubble component (our send + their reply)", sides["haveBoth"] is True, sides)
    ck("our send and their reply have DISTINCT surface tints (not the same background)",
       sides["outBg"] and sides["repBg"] and sides["outBg"] != sides["repBg"], sides)
    ck("each bubble is bounded (border + radius + padding), and the header sits above the body",
       sides["outBounded"] and sides["repBounded"] and sides["outHeadAbove"] and sides["repHeadAbove"], sides)

    # ---- the header never collides: the long name box and the timestamp box do not intersect ----
    hdr = pg.evaluate("""()=>{
      const rep=document.querySelector('#probe .th-reply .rp-card');
      const who=rep.querySelector('.rp-who'), when=rep.querySelector('.rp-when');
      const a=who.getBoundingClientRect(), z=when.getBoundingClientRect();
      const intersect = a.left < z.right && z.left < a.right && a.top < z.bottom && z.top < a.bottom;
      return { intersect, who:{l:a.left,r:a.right,t:a.top,b:a.bottom}, when:{l:z.left,r:z.right,t:z.top,b:z.bottom} }; }""")
    ck("the sender name and the timestamp never collide (their boxes do not intersect), long Arabic name",
       hdr["intersect"] is False, hdr)

    # ---- isolation: a bare domain inside an Arabic line is a bdi.rp-ltr run, never a bare collision ----
    iso = pg.evaluate("""()=>{
      const html = window.renderReplyBody('راجعوا console.thriveiii.com/opp/x الآن');
      return { hasBdi: html.indexOf('<bdi class=\"rp-ltr\">console.thriveiii.com/opp/x</bdi>')>=0, html }; }""")
    ck("a bare domain (no scheme) in an Arabic line is wrapped in an isolated bdi.rp-ltr (no collision)",
       iso["hasBdi"] is True, iso["html"][:200])
    # and in the rendered thread, the reply's domain is inside a bdi (grep-zero bare domain)
    domiso = pg.evaluate("""()=>{
      const snip=document.querySelector('#probe .th-reply .rp-snip');
      const b=[...snip.querySelectorAll('bdi.rp-ltr')].find(x=>x.textContent.indexOf('console.thriveiii.com/opp/madar-2026')>=0);
      return { inBdi: !!b, dir: b?getComputedStyle(b).direction:'' }; }""")
    ck("the reply's bare domain renders inside an isolated left-to-right bdi in the thread",
       domiso["inBdi"] is True and domiso["dir"]=="ltr", domiso)

    # ---- the quote is NEVER dumped: an Outlook field block parses; the answer is the only new text, the
    #      original lands in a collapsed details, not flat under the answer ----
    outlook = pg.evaluate("""(body)=>{
      const blocks = window.parseReplyBody(body) || [];
      const kinds = blocks.map(b=>b.type);
      const msg = (blocks.find(b=>b.type==='message')||{}).text||'';
      const html = window.renderReplyBodyStructured(body);
      const d=document.createElement('div'); d.className='rp-snip'; d.innerHTML=html; document.body.appendChild(d);
      const det=d.querySelector('details.rp-quoted'); const rpmsg=d.querySelector('.rp-msg');
      const r={ kinds, msgHasQuoted: msg.indexOf('UNIQUEQUOTEDMARKER')>=0,
                hasDetails: !!det, collapsed: det?!det.open:false,
                quotedInDetails: det?det.textContent.indexOf('UNIQUEQUOTEDMARKER')>=0:false,
                quotedNotInMsg: rpmsg?rpmsg.textContent.indexOf('UNIQUEQUOTEDMARKER')<0:true };
      d.remove(); return r; }""", OUTLOOK)
    ck("an Outlook field block is detected: the answer is the only new message (the quoted original is not in it)",
       outlook["msgHasQuoted"] is False and outlook["quotedNotInMsg"] is True, outlook)
    ck("the Outlook original lands in a collapsed details.rp-quoted (a working show-quoted-text), never dumped",
       outlook["hasDetails"] and outlook["collapsed"] and outlook["quotedInDetails"], outlook)

    sep = pg.evaluate("""(body)=>{
      const html = window.renderReplyBodyStructured(body);
      const d=document.createElement('div'); d.innerHTML=html; document.body.appendChild(d);
      const det=d.querySelector('details.rp-quoted'), rpmsg=d.querySelector('.rp-msg');
      const r={ hasDetails:!!det, quotedInDetails: det?det.textContent.indexOf('SEPUNIQUEMARKER')>=0:false,
                quotedNotInMsg: rpmsg?rpmsg.textContent.indexOf('SEPUNIQUEMARKER')<0:true };
      d.remove(); return r; }""", SEP)
    ck("a separator rule (-----Original Message-----) also collapses the original, never dumps it",
       sep["hasDetails"] and sep["quotedInDetails"] and sep["quotedNotInMsg"], sep)

    # ---- a plain reply with no quote still renders flat (never worse than today) ----
    plain = pg.evaluate("""()=>{
      const blocks = window.parseReplyBody('Yes, that works. Thank you.');
      return { isNull: blocks===null }; }""")
    ck("a plain reply with no quote falls back to per-line rendering (parseReplyBody returns null)",
       plain["isNull"] is True, plain)

    # ---- one-tap optimistic reply: it appears in the thread immediately as a dimmed outgoing bubble ----
    opti = pg.evaluate("""()=>{
      // the real modal history surface (a .th-list, as an open History tab has)
      const host=document.getElementById('modalHistory');
      const prev=host.innerHTML;
      host.innerHTML='<ol class="th-list"></ol>';
      const before=host.querySelectorAll('.th-list > li').length;
      const li=window.threadOptimisticReply('مرحبًا عمر، شكرًا لردك.');
      const after=host.querySelectorAll('.th-list > li').length;
      const dimmed = li ? getComputedStyle(li).opacity : '1';
      const r={ appended: after===before+1, isSent: !!(li&&li.classList.contains('th-sent')),
                isOpti: !!(li&&li.classList.contains('th-opti')), dimmed: parseFloat(dimmed)<1,
                text: li?li.textContent:'' };
      host.innerHTML=prev; return r; }""")
    ck("the reply appears in the thread immediately as an outgoing bubble the instant Send is pressed (optimistic)",
       opti["appended"] and opti["isSent"] and opti["text"].find("شكرًا لردك")>=0, opti)
    ck("the optimistic bubble is dimmed until the confirmed-write reconciles it (no chrome, just opacity)",
       opti["isOpti"] and opti["dimmed"], opti)

    # ---- a genuinely failed reply leaves NO phantom sent bubble (buildThread excludes an unsent row) ----
    phantom = pg.evaluate("""()=>{
      const set=(k,v)=>localStorage.setItem(k, JSON.stringify(v));
      set('thrive_mail_v1', [
        {mid:'s1', opp:'co', to:'omar@company.example', subject:'عرض', status:'sent', direction:'out', ts:'2026-08-01T10:00:00Z'},
        {mid:'u1', opp:'co', to:'omar@company.example', subject:'Re: عرض', status:'unsent', idem:'k1', direction:'out', ts:'2026-08-04T10:00:00Z'}
      ]);
      const th = window.buildThread('co');
      const sentReplies = th.filter(e=>e.kind==='sent' && String(e.subject||'').indexOf('Re:')>=0);
      return { sentReplies: sentReplies.length }; }""")
    ck("a failed reply is never a phantom sent bubble (the unsent row is excluded from the thread)",
       phantom["sentReplies"] == 0, phantom)

    # ---- the phone holds: no horizontal overflow at 390, EN and AR, with the long name + the domain ----
    for lang in ("en", "ar"):
        over = pg.evaluate("""(lang)=>{
          document.documentElement.setAttribute('dir', lang==='ar'?'rtl':'ltr');
          const w=document.createElement('div'); w.className='ovprobe';
          w.style.cssText='width:360px;max-width:360px;box-sizing:border-box';
          w.innerHTML=window.threadListHtml('co'); document.body.appendChild(w);
          const bubbles=[...w.querySelectorAll('.msg-out, .rp-card')];
          const bubOver = bubbles.some(b=>b.scrollWidth-b.clientWidth>1);
          const r={ over: w.scrollWidth-w.clientWidth, bubOver };
          w.remove(); return r; }""", lang)
        ck(f"[{lang}] the thread holds the phone: no horizontal overflow, every bubble inside its box",
           over["over"] <= 1 and over["bubOver"] is False, over)
    pg.evaluate("()=>document.documentElement.setAttribute('dir','ltr')")

    # ---- Step 2: the rendered thread self-identifies with a VISIBLE version marker, so it is unmistakable
    #      on device which renderer is mounted (the fix for fixing an unrendered copy) ----
    marker = pg.evaluate("""()=>{
      window.thriveModal.open('co','history','Co');
      return new Promise(res=>setTimeout(()=>{
        const box=document.getElementById('modalHistory');
        const m=box && box.querySelector('.th-ver');
        const cs=m?getComputedStyle(m):null;
        res({ present:!!m, text:m?m.textContent.trim():'',
              visible:!!(m && m.offsetParent!==null && cs.display!=='none' && parseFloat(cs.opacity)>0),
              report: (typeof window.threadRendererReport==='function') ? window.threadRendererReport() : null });
      }, 500));
    }""")
    ck("Step 2: the History thread renders a VISIBLE marker naming the mounted renderer (self-identifies on device)",
       marker["present"] and marker["text"].startswith("thread v2") and "renderHistory" in marker["text"] and marker["visible"], marker)
    rep = marker.get("report") or {}
    # P21: the History tab is now the activity trail (activityTrailHtml). A message expands IN PLACE to its
    # full bubble through the one P12 path (thSentBubble/thReplyBubble). The runtime probe proves the trail is
    # mounted and a message bubble (data-bubble=msgBubble) is present in it - one renderer, one bubble builder.
    ck("runtime probe: the History renderer is the activity trail, and the message bubble is the one P12 path",
       rep.get("mounted") is True and rep.get("replyTextOwner")=="activityTrailHtml"
       and rep.get("bubbles",0) >= 1 and "activityTrailHtml" in (rep.get("listRenderer") or ""), rep)

    ctx.close(); b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
