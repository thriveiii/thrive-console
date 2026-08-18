"""P12 · The message model (R10) and the thread render, rebuilt.

The thread once collapsed a message into a blob: on the live console the مدارس المدار الدولية thread showed
the subject ('من جد وجد') where the body should be, the real body ('مرحبا، إليكم العرض...') was visible only
buried inside the reply's quoted original, and an outbound send carried no body of its own. The cure is a
named message object - { time, from, to, subject, body, direction, quoted } - read ONCE by buildMessage and
rendered by ONE path. This proves, on the real app.js:

  1. the مدارس repro: the outbound send shows sender, recipient, timestamp, the subject on its OWN line, and
     the full compiled body in its OWN block; the inbound reply shows its answer with the quoted original
     collapsed beneath it and expandable; the subject is never rendered as the body;
  2. a single-recipient thread and a campaign-recipient thread render through the SAME renderer with the same
     zones (source: one buildMessage, one renderMessageBody, both cards route through them);
  3. a message with no subject omits the subject zone cleanly - no empty label, no stray gutter;
  4. ten reads of a thread are byte-identical, and the renderer carries no per-thread or per-slug branch;
  5. the model splits body from quoted (the quoted original is `quoted`, never `body`), and rendering never
     rewrites the stored row.

The final glyph order and the panel gutters on WebKit at three widths in both languages are Thyab's gate
(thread_render_shots.py). This is engine-independent logic run in Chromium.
"""
import threading, http.server, socketserver, functools, os, sys, re
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

app = open(f"{ROOT}/library/app.js").read()

# ---- source law: one model, one render path (Evidence 2 + 5, static half) -----------------------------
ck("R10 message model exists as one builder (buildMessage) returning named fields",
   "function buildMessage(" in app and "direction:" in app and "quoted:" in app
   and "function splitReplyBody(" in app)
ck("there is ONE message builder and ONE body renderer (no second model, no second render path)",
   len(re.findall(r"function buildMessage\(", app)) == 1
   and len(re.findall(r"function renderMessageBody\(", app)) == 1)
ck("both the send card and the reply card route through the one model and the one body renderer",
   app.count("buildMessage(e)") >= 1 and app.count("buildMessage(r)") >= 1
   and app.count("renderMessageBody(msg)") >= 2)
# the renderer carries no per-thread / per-slug special case
render_region = app[app.index("function buildMessage("): app.index("function threadRendererTag(")] \
    if "function threadRendererTag(" in app else app[app.index("function buildMessage("):]
ck("the message model + body renderer carry no per-thread or per-slug branch",
   not re.search(r"per-slug|per-thread|specialCase|special_case|slug===[\"']", render_region))

BASEL = ("نعم، هذا رائع. شكرًا لكم.\n\n"
         "في اثنين، ٣ آب ٢٠٢٦ في ٩:٣٧ م، كتب Thrive Digital Solutions <hi@thriveiii.com>:\n"
         "> اطّلعوا على العرض هنا https://console.thriveiii.com/opp/madar\n"
         "> <script>alert(1)</script> نتطلع إلى ردكم.")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width": 1280, "height": 1000})
    ctx.route("https://api.github.com/**", lambda r: r.fulfill(status=404, body="{}"))
    ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))
    pg = ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{base}/library/console.html")
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(300)
    pg.wait_for_function("()=>typeof window.buildMessage==='function' && typeof window.threadListHtml==='function'", timeout=15000)

    # ===== Evidence 1: the مدارس repro through the live renderer =====
    rep = pg.evaluate("""(basel)=>{
      localStorage.setItem('thrive_opps_v1',JSON.stringify([{slug:'madar',business:'مدارس المدار الدولية',published:true}]));
      localStorage.setItem('thrive_mail_v1',JSON.stringify([{mid:'m1',opp:'madar',to:'info@madar.jo',toName:'مدارس المدار الدولية',subject:'من جد وجد',preview:'مرحبا، إليكم العرض الذي أعددناه لكم. [LINK]',status:'sent',direction:'out',ts:'2026-08-16T10:00:00Z'}]));
      localStorage.setItem('thrive_inbound_v1',JSON.stringify([{gid:'g1',opp:'madar',kind:'reply',from:'info@madar.jo',name:'مدارس المدار الدولية',subject:'رد: من جد وجد',snippet:basel,ts:'2026-08-16T12:00:00Z'}]));
      var d=document.createElement('div'); d.id='modalHistory';
      d.innerHTML=window.threadListHtml('madar'); document.body.appendChild(d);
      var sent=d.querySelector('.th-sent'), reply=d.querySelector('.th-reply');
      var ssubj=sent&&sent.querySelector('.rp-subj'), ssnip=sent&&sent.querySelector('.rp-snip');
      var sfrom=sent&&sent.querySelector('.msg-from'), sto=sent&&sent.querySelector('.msg-to'), swhen=sent&&sent.querySelector('.rp-when');
      var rsnip=reply&&reply.querySelector('.rp-snip'), rquo=reply&&reply.querySelector('details.rp-quoted');
      var out={
        sentZones:{ from:!!sfrom, to:!!sto, when:!!(swhen&&swhen.textContent.trim()), subj:!!ssubj, body:!!ssnip },
        sentSubj:(ssubj&&ssubj.textContent)||'', sentBody:(ssnip&&ssnip.textContent)||'',
        subjIsOwnLine: !!ssubj && !!ssnip && ssubj.textContent.indexOf('من جد وجد')>=0 && ssnip.textContent.indexOf('إليكم العرض')>=0 && ssubj!==ssnip,
        replyHasBody: !!rsnip && rsnip.textContent.indexOf('رائع')>=0,
        replyBodyNotSubject: !!rsnip && rsnip.textContent.indexOf('رد:')<0,
        replyQuotedCollapsed: !!rquo && !rquo.open,
        quotedHasOriginal: !!rquo && rquo.textContent.indexOf('اطّلعوا على العرض')>=0,
        bodyNotInAnswer: !!rsnip && rsnip.textContent.indexOf('اطّلعوا على العرض')<0,
        scripts: d.querySelectorAll('script').length
      };
      window.__d=d; return out;
    }""", BASEL)
    ck("the outbound send shows every zone: sender, recipient, timestamp, subject and body",
       all(rep["sentZones"].values()), rep["sentZones"])
    ck("the subject is on its OWN line and the compiled body is its OWN block (subject is not the body)",
       rep["subjIsOwnLine"] and "من جد وجد" in rep["sentSubj"] and "إليكم العرض" in rep["sentBody"], rep)
    ck("the inbound reply shows its own answer, not its subject, as the body",
       rep["replyHasBody"] and rep["replyBodyNotSubject"], rep)
    ck("the quoted original is collapsed beneath the reply and holds the original (body not buried in it)",
       rep["replyQuotedCollapsed"] and rep["quotedHasOriginal"] and rep["bodyNotInAnswer"], rep)
    ck("the hostile <script> in the quoted original stays inert text (XSS holds)", rep["scripts"] == 0, rep)

    # the quoted section is expandable (a real <details> toggles open)
    opened = pg.evaluate("""()=>{ var det=window.__d.querySelector('details.rp-quoted'); if(!det) return false; det.open=true; return det.open===true; }""")
    ck("the quoted original is expandable on tap (a real details control)", opened is True)

    # ===== Evidence 3: a message with no subject omits the subject zone cleanly =====
    nos = pg.evaluate("""()=>{
      localStorage.setItem('thrive_mail_v1',JSON.stringify([{mid:'m2',opp:'madar',to:'info@madar.jo',toName:'مدارس',subject:'',preview:'رسالة بلا موضوع.',status:'sent',direction:'out',ts:'2026-08-16T10:00:00Z'}]));
      localStorage.setItem('thrive_inbound_v1',JSON.stringify([]));
      var d=document.createElement('div'); d.innerHTML=window.threadListHtml('madar');
      var sent=d.querySelector('.th-sent');
      return { hasSubjZone:!!(sent&&sent.querySelector('.rp-subj')), hasBody:!!(sent&&sent.querySelector('.rp-snip')) };
    }""")
    ck("a message with no subject omits the subject zone cleanly (no empty label), body still shown",
       nos["hasSubjZone"] is False and nos["hasBody"] is True, nos)

    # ===== Evidence 2 (runtime): single-recipient and campaign threads use the SAME zones =====
    same = pg.evaluate("""()=>{
      function zones(html){ var d=document.createElement('div'); d.innerHTML=html;
        var s=d.querySelector('.th-sent');
        return s? { head:!!s.querySelector('.rp-head'), who:!!s.querySelector('.rp-who'), body:!!s.querySelector('.rp-body') } : null; }
      // single recipient
      localStorage.setItem('thrive_opps_v1',JSON.stringify([{slug:'single',business:'Single Co',published:true},{slug:'camp',business:'Camp Co',published:true}]));
      localStorage.setItem('thrive_inbound_v1',JSON.stringify([]));
      localStorage.setItem('thrive_mail_v1',JSON.stringify([
        {mid:'a',opp:'single',to:'a@x.com',toName:'A',subject:'Hi A',preview:'Body to A.',status:'sent',direction:'out',ts:'2026-08-10T10:00:00Z'},
        {mid:'b',opp:'camp',to:'b@x.com',toName:'B',subject:'Hi B',preview:'Body to B.',status:'sent',direction:'out',ts:'2026-08-11T10:00:00Z',campaign:'c1'}
      ]));
      return { single:zones(window.threadListHtml('single')), camp:zones(window.threadListHtml('camp')) };
    }""")
    ck("a single-recipient thread and a campaign thread render the same zones through one renderer",
       same["single"] == same["camp"] and same["single"] == {"head": True, "who": True, "body": True}, same)

    # ===== Evidence 4 (runtime): ten reads byte-identical =====
    stable = pg.evaluate("""(basel)=>{
      localStorage.setItem('thrive_opps_v1',JSON.stringify([{slug:'madar',business:'مدارس المدار الدولية',published:true}]));
      localStorage.setItem('thrive_mail_v1',JSON.stringify([{mid:'m1',opp:'madar',to:'info@madar.jo',toName:'مدارس المدار الدولية',subject:'من جد وجد',preview:'مرحبا، إليكم العرض. [LINK]',status:'sent',direction:'out',ts:'2026-08-16T10:00:00Z'}]));
      localStorage.setItem('thrive_inbound_v1',JSON.stringify([{gid:'g1',opp:'madar',kind:'reply',from:'info@madar.jo',name:'مدارس',subject:'رد',snippet:basel,ts:'2026-08-16T12:00:00Z'}]));
      var first=window.threadListHtml('madar'), same=true;
      for(var i=0;i<10;i++){ if(window.threadListHtml('madar')!==first) same=false; }
      var after=JSON.parse(localStorage.getItem('thrive_inbound_v1'))[0].snippet;
      return { same:same, storeUnchanged: after===basel };
    }""", BASEL)
    ck("ten reads of the thread are byte-identical (deterministic render)", stable["same"] is True, stable)
    ck("rendering the thread never rewrites the stored reply body (derivation only)", stable["storeUnchanged"] is True, stable)

    # ===== the model itself: body split from quoted =====
    model = pg.evaluate("""(basel)=>{
      var m=window.buildMessage({kind:'reply',ts:'t',from:'مدارس',fromAddr:'info@madar.jo',subject:'رد',snippet:basel});
      return { dir:m.direction, hasBody:m.body.indexOf('رائع')>=0, bodyNoQuote:m.body.indexOf('اطّلعوا')<0,
               quotedHasOriginal:m.quoted.indexOf('اطّلعوا')>=0, fields:Object.keys(m).sort().join(',') };
    }""", BASEL)
    ck("buildMessage splits the answer (body) from the quoted original (quoted), with named fields",
       model["dir"]=="in" and model["hasBody"] and model["bodyNoQuote"] and model["quotedHasOriginal"]
       and "body" in model["fields"] and "quoted" in model["fields"] and "subject" in model["fields"], model)

    ck("no page errors across the whole thread-render session", len(errs) == 0, errs)
    ctx.close(); b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
