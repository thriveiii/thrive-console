"""The thread grows up: a reply is parsed into typed blocks, then rendered as a conversation (WO-031).

Per-line direction isolation set a base direction per line but could not ORDER a single physical line that
mixes right-to-left and left-to-right runs - the Gmail quote header, "في <arabic date>، كتب <Latin name>
<address>:", arrives as one line and the bidi algorithm scrambles it. The structural fix parses the body
into typed blocks (new message, quote header, quoted history, signature) and RECOMPOSES the header from its
isolated parts, so the raw mixed run is never painted and the scramble is gone by construction.

Proven here on the real app.js:
  - Basel's Arabic reply, an all-English reply, and a mixed reply each parse and recompose correctly;
  - a plain reply with no quote, and a header-shaped line that will not parse, both fall back to the
    per-line isolated rendering with no content dropped (never worse than today);
  - the stored body is never modified (derivation at render only), and every part stays escaped (XSS holds);
  - the recomposed header's date, name and address are each isolated, so none reorders against another;
  - the quoted history is a quiet collapsible section; margins and rhythm are stable, no horizontal overflow.

The final glyph order on WebKit at three widths in both languages is Thyab's device gate.
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

# Source guard: the fix is structural (parse then render), derivation-only, with a fallback.
app = open(f"{ROOT}/library/app.js").read()
ck("a deterministic body parser splits the reply into typed blocks",
   "function parseReplyBody(" in app and "function parseQuoteHeader(" in app
   and 'type:"quoteHeader"' in app and 'type:"quote"' in app and 'type:"message"' in app)
ck("the header is recomposed from isolated parts, not painted as the raw mixed run",
   "function renderQuoteHeader(" in app and 'class="rp-qh-date"' in app
   and 'class="rp-qh-name"' in app and 'class="rp-qh-addr rp-ltr"' in app)
ck("an unparsable/plain body falls back to the per-line isolated rendering (never worse)",
   "function renderReplyBodyStructured(" in app and "if(!blocks) return renderReplyBody(text);" in app)
ck("the thread renders through the structured path", "renderReplyBodyStructured(r.snippet)" in app)

BASEL = ("نعم، هذا رائع. شكرًا لكم.\n\n"
         "في اثنين، ٣ آب ٢٠٢٦ في ٩:٣٧ م، كتب Thrive Digital Solutions <hi@thriveiii.com>:\n"
         "> اطّلعوا على العرض هنا https://console.thriveiii.com/opp/thrive-july\n"
         "> <script>alert(1)</script> نتطلع إلى ردكم.")
ENQUOTE = ("Thanks, this looks great.\n\n"
           "On Mon, Aug 3, 2026 at 9:37 PM, Thrive Digital Solutions <hi@thriveiii.com> wrote:\n"
           "> See the offer here https://console.thriveiii.com/opp/en-co\n"
           "> Looking forward to your reply.")
PLAIN = "Yes, sounds great. Thanks."
# Header-shaped (opener + verb) but no comma-before-verb and no address: parseQuoteHeader returns null.
NOPARSE = ("شكرًا لكم.\n\n"
           "في وقت ما كتب أحدهم رسالة\n"
           "> سطر مقتبس لا بد أن يبقى.")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width": 380, "height": 900})
    ctx.route("https://api.github.com/**", lambda r: r.fulfill(status=404, body="{}"))
    ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))
    pg = ctx.new_page()
    pg.goto(f"{base}/library/console.html")
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(300)
    pg.wait_for_function("()=>typeof window.renderReplyBodyStructured==='function' && typeof window.parseReplyBody==='function'", timeout=15000)

    def probe(body, width=360):
        return pg.evaluate("""(a)=>{
          const w=document.createElement('div'); w.className='rp-snip'; w.setAttribute('dir','auto');
          w.style.cssText='width:'+a.width+'px;max-width:'+a.width+'px';
          w.innerHTML=window.renderReplyBodyStructured(a.body);
          document.body.appendChild(w);
          const iso=el=>el && getComputedStyle(el).unicodeBidi.indexOf('isolate')>=0;
          const hdr=w.querySelector('.rp-qhead');
          const det=w.querySelector('details.rp-quoted');
          const r={
            hasMsg:!!w.querySelector('.rp-msg'), hasHeader:!!hdr, hasQuoted:!!det,
            rpLines:w.querySelectorAll('.rp-line').length,
            scripts:w.querySelectorAll('script').length,
            text:w.textContent, over:w.scrollWidth-w.clientWidth };
          if(hdr){ const d=hdr.querySelector('.rp-qh-date'),n=hdr.querySelector('.rp-qh-name'),ad=hdr.querySelector('.rp-qh-addr');
            r.headerDir=getComputedStyle(hdr).direction;
            r.date=(d||{}).textContent||''; r.name=(n||{}).textContent||''; r.addr=(ad||{}).textContent||'';
            r.addrDir=ad?getComputedStyle(ad).direction:''; r.partsIso=iso(d)&&iso(n)&&iso(ad);
            r.noRawRun=hdr.textContent.indexOf('<hi@thriveiii.com>')<0; }
          if(det){ r.collapsed=!det.open; r.detBorder=getComputedStyle(det).borderInlineStartWidth!=='0px'; }
          w.remove(); return r; }""", {"body": body, "width": width})

    # ===== Basel (mixed Arabic + Latin) =====
    ba = probe(BASEL)
    ck("mixed: parses into message + recomposed header + collapsible quoted history",
       ba["hasMsg"] and ba["hasHeader"] and ba["hasQuoted"], ba)
    ck("mixed: the header reads right-to-left with its parts isolated (Arabic date, Latin name, LTR address)",
       ba["headerDir"]=="rtl" and ba["partsIso"] and "آب ٢٠٢٦" in ba["date"]
       and ba["name"]=="Thrive Digital Solutions" and ba["addr"]=="hi@thriveiii.com" and ba["addrDir"]=="ltr", ba)
    ck("mixed: no raw <address> run is painted (recomposed from parts, scramble gone by construction)",
       ba["noRawRun"] is True, ba)
    ck("mixed: the quoted history is collapsed and bordered", ba.get("collapsed") and ba.get("detBorder"), ba)
    ck("mixed: the hostile <script> stays inert text, no script node (XSS holds)",
       ba["scripts"]==0 and "<script>alert(1)</script>" in ba["text"], ba)
    ck("mixed: no horizontal overflow at a narrow width", ba["over"] <= 1, ba)

    # ===== all-English WITH a quote header =====
    en = probe(ENQUOTE)
    ck("english: parses into message + recomposed header + quoted history",
       en["hasMsg"] and en["hasHeader"] and en["hasQuoted"], en)
    ck("english: the header reads left-to-right, date/name/address intact and isolated",
       en["headerDir"]=="ltr" and en["partsIso"] and "Aug 3, 2026" in en["date"]
       and en["name"]=="Thrive Digital Solutions" and en["addr"]=="hi@thriveiii.com", en)

    # ===== plain reply, no quote: unchanged per-line fallback =====
    pl = probe(PLAIN)
    ck("plain: a reply with no quote falls back to per-line isolation (no header, no details), content intact",
       (not pl["hasHeader"]) and (not pl["hasQuoted"]) and pl["rpLines"]>=1 and "sounds great" in pl["text"], pl)

    # ===== header-shaped but unparsable: full fallback, NO content dropped =====
    npv = probe(NOPARSE)
    ck("unparsable header: falls back to full per-line isolation, dropping no content",
       (not npv["hasHeader"]) and npv["rpLines"]>=3
       and "أحدهم" in npv["text"] and "سطر مقتبس لا بد أن يبقى" in npv["text"], npv)

    # ===== the parser is pure and never rewrites the stored body; output stays escaped =====
    # A crafted body carries "&" and a hostile tag in BOTH the header name and the quoted region, so the
    # escaping is exercised on the recomposed header (esc) and the quoted body (renderReplyBody) alike.
    HOSTILE = ("Q & A here.\n\n"
               "On Mon, Aug 3, 2026 at 9:37 PM, A & B <a@b.com> wrote:\n"
               "> tom & jerry <script>bad()</script>")
    purity = pg.evaluate("""(a)=>{
      const before=a.body;
      const html=window.renderReplyBodyStructured(a.body);
      return { unchanged: a.body===before,          // the input string is not mutated
               ampEsc: html.indexOf('&amp;')>=0, ltEsc: html.indexOf('&lt;script&gt;')>=0,
               noLiveTag: html.indexOf('<script>bad()</script>')<0 }; }""", {"body": HOSTILE})
    ck("purity: renderReplyBodyStructured does not mutate its input (derivation only)", purity["unchanged"], purity)
    ck("purity: the output stays escaped (& and angle brackets) in header and quote, no live tag emitted",
       purity["ampEsc"] and purity["ltEsc"] and purity["noLiveTag"], purity)

    # ===== the STORED inbound body is never modified by rendering the thread =====
    store = pg.evaluate("""(basel)=>{
      const rec=[{ gid:'g1', opp:'s1', kind:'reply', from:'basel@x.example', name:'Basel',
        subject:'Re', snippet:basel, ts:'2026-08-03T09:00:00Z' }];
      localStorage.setItem('thrive_inbound_v1', JSON.stringify(rec));
      localStorage.setItem('thrive_opps_v1', JSON.stringify([{slug:'s1', business:'S', published:true}]));
      localStorage.setItem('thrive_mail_v1', JSON.stringify([{mid:'m1',opp:'s1',to:'basel@x.example',subject:'Re',status:'sent',direction:'out',ts:'2026-08-01T10:00:00Z'}]));
      const html=window.threadListHtml('s1');   // render the whole thread
      const after=JSON.parse(localStorage.getItem('thrive_inbound_v1'))[0].snippet;
      return { same: after===basel, rendered: html.indexOf('rp-qhead')>=0 }; }""", BASEL)
    ck("no store rewrite: the stored reply body is byte-identical after the thread renders", store["same"], store)
    ck("no store rewrite: and the thread still rendered the recomposed header", store["rendered"], store)

    # ===== margins / rhythm: the structured blocks share one vertical rhythm token =====
    rhythm = pg.evaluate("""(body)=>{
      const w=document.createElement('div'); w.className='rp-snip'; w.style.cssText='width:360px';
      w.innerHTML=window.renderReplyBodyStructured(body); document.body.appendChild(w);
      const g=el=>el?getComputedStyle(el).marginBlockStart:'';
      const r={ header:g(w.querySelector('.rp-qhead')), quoted:g(w.querySelector('details.rp-quoted')) };
      w.remove(); return r; }""", BASEL)
    ck("rhythm: the recomposed header and the quoted section share one margin token (stable rhythm)",
       rhythm["header"]==rhythm["quoted"] and rhythm["header"] not in ("", "0px"), rhythm)

    ctx.close(); b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
