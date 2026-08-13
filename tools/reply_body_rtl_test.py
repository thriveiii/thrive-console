"""A reply body renders unscrambled in Arabic: the thread is STRUCTURED, not raw lines (WO-022, WO-031).

The device showed Basel's thread with the Gmail quote-header line scrambled: an Arabic date, a Latin sender
and address, a URL and angle brackets, all in one line, reordered by the bidi algorithm into an unreadable
run. Per-line direction isolation (the first fix) set a base direction per line but could not ORDER that one
physical line mixing right-to-left and left-to-right runs. The structural fix parses the body into typed
blocks and RECOMPOSES the quote header from its isolated parts, so the raw mixed run is never painted and the
scramble is gone by construction. Rendering only: the stored body is never rewritten and every part still
passes through esc (the #99 XSS guarantee holds); a body that will not parse falls back to per-line isolation.

Engine-independent facts (the final glyph order on WebKit is Thyab's iPad device gate): Basel's reply renders
as its message, a recomposed header whose date/name/address are each isolated (the address a clean LTR chip,
no raw <address> run painted at all), and a collapsed quoted-history section; the body stays escaped (no
script node); a long URL wraps inside the card (no horizontal overflow); and an all-English reply with no
quote falls back to per-line isolation and computes left-to-right."""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:500])

# Basel's actual case: an Arabic acknowledgement, a blank line, the Gmail Arabic quote header (Arabic date +
# Latin sender + <address> + colon), then quoted lines carrying a URL and a hostile <script> (the XSS guard).
BASEL = ("نعم، هذا رائع. شكرًا لكم.\n"
         "\n"
         "في اثنين، ٣ آب ٢٠٢٦ في ٩:٣٧ م، كتب Thrive Digital Solutions <hi@thriveiii.com>:\n"
         "> اطّلعوا على العرض هنا https://console.thriveiii.com/opp/thrive-july\n"
         "> <script>alert(1)</script> نتطلع إلى ردكم.")
LONGURL = "https://console.thriveiii.com/opp/a-very-long-slug-" + ("x"*90) + "/page?ref=email"

INIT = (r"""
(() => {
  const set=(k,v)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} };
  set('thrive_opps_v1', [
    { slug:'thrive-july', business:'July', published:true, recipients:[{addr:'basel@x.example', name:'Basel', lang:'ar'}] },
    { slug:'en-co', business:'EnCo', published:true, recipients:[{addr:'sam@en.example', name:'Sam', lang:'en'}] }
  ]);
  set('thrive_mail_v1', [
    { mid:'j1', opp:'thrive-july', to:'basel@x.example', subject:'عرض', status:'sent', direction:'out', ts:'2026-08-01T10:00:00Z' },
    { mid:'e1', opp:'en-co', to:'sam@en.example', subject:'Offer', status:'sent', direction:'out', ts:'2026-08-01T10:00:00Z' }
  ]);
  set('thrive_inbound_v1', [
    { gid:'g1', opp:'thrive-july', kind:'reply', from:'basel@x.example', name:'Basel', subject:'Re: عرض',
      snippet:%s, ts:'2026-08-03T09:00:00Z' },
    { gid:'g2', opp:'thrive-july', kind:'reply', from:'basel@x.example', name:'Basel', subject:'Re: link',
      snippet:%s, ts:'2026-08-04T09:00:00Z' },
    { gid:'e-r', opp:'en-co', kind:'reply', from:'sam@en.example', subject:'Re: Offer',
      snippet:'Yes, sounds great. Thanks.', ts:'2026-08-03T09:00:00Z' }
  ]);
})()
""" % (
  __import__("json").dumps(BASEL),
  __import__("json").dumps("here: " + LONGURL),
))

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page(viewport={"width": 380, "height": 900})   # a narrow card, so overflow would show
    pg.add_init_script(INIT)
    pg.goto(f"{base}/library/console.html")
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(300)
    pg.wait_for_function("()=>typeof window.threadListHtml==='function' && typeof window.renderReplyBody==='function'", timeout=15000)

    # Render Basel's thread into a real, width-constrained card so computed direction and overflow are real.
    pg.evaluate("""()=>{
      const wrap=document.createElement('div'); wrap.id='probe';
      wrap.style.cssText='width:360px;max-width:360px'; wrap.innerHTML=window.threadListHtml('thrive-july');
      document.body.appendChild(wrap);
    }""")

    # ---- STRUCTURAL: the body parses into typed blocks (message, recomposed header, quoted history) ----
    # Per-line isolation was not enough: it could not ORDER the one physical quote-header line. The body now
    # renders as structure: the new message, a recomposed header built from isolated parts (so the raw mixed
    # run is never painted), and the quoted history in its own collapsible section.
    struct = pg.evaluate("""()=>{
      const card=document.querySelector('#probe .th-reply .rp-snip');
      return { hasMsg: !!card.querySelector('.rp-msg'),
               hasHeader: !!card.querySelector('.rp-qhead'),
               hasQuoted: !!card.querySelector('details.rp-quoted'),
               msgText: (card.querySelector('.rp-msg')||{}).textContent||'',
               // the message keeps per-line direction isolation inside its block
               msgLinesIsolate: [...card.querySelectorAll('.rp-msg .rp-line')].every(l=>getComputedStyle(l).unicodeBidi.indexOf('isolate')>=0) }; }""")
    ck("the body renders as typed blocks: the message, a recomposed header, and a collapsible quoted history",
       struct["hasMsg"] and struct["hasHeader"] and struct["hasQuoted"], struct)
    ck("the new message is the human's words, still per-line direction-isolated",
       "نعم، هذا رائع" in struct["msgText"] and struct["msgLinesIsolate"], struct)

    # ---- the header is recomposed from ISOLATED parts; the address is a clean LTR chip, no raw run ----
    addr = pg.evaluate("""()=>{
      const hdr=document.querySelector('#probe .th-reply .rp-snip .rp-qhead');
      const date=hdr.querySelector('.rp-qh-date'), name=hdr.querySelector('.rp-qh-name'), a=hdr.querySelector('.rp-qh-addr');
      const iso=el=>el && getComputedStyle(el).unicodeBidi.indexOf('isolate')>=0;
      return { headerDir: getComputedStyle(hdr).direction,
               dateText:(date||{}).textContent||'', nameText:(name||{}).textContent||'',
               addrText:(a||{}).textContent||'', addrDir: a? getComputedStyle(a).direction:'',
               partsIsolated: iso(date)&&iso(name)&&iso(a),
               // the raw "<address>" mixed run is never rendered: the chip is clean, no angle brackets
               noRawRun: hdr.textContent.indexOf('<hi@thriveiii.com>')<0 }; }""")
    ck("the recomposed header reads right-to-left (its own Arabic base direction)", addr["headerDir"]=="rtl", addr)
    ck("the header parts (date, name, address) are each isolated, so none reorders against another",
       addr["partsIsolated"] is True, addr)
    ck("the Arabic date and the Latin name survive intact in their own parts",
       "آب ٢٠٢٦" in addr["dateText"] and addr["nameText"]=="Thrive Digital Solutions", addr)
    ck("the email address is a clean isolated LTR chip (no raw <address> run is painted at all)",
       addr["addrText"]=="hi@thriveiii.com" and addr["addrDir"]=="ltr" and addr["noRawRun"] is True, addr)

    # ---- the quoted history is the quieter, collapsible section with a logical inline-start rule ----
    quote = pg.evaluate("""()=>{
      const det=document.querySelector('#probe .th-reply .rp-snip details.rp-quoted');
      const body=det.querySelector('.rp-quoted-body');
      return { hasSummary: !!det.querySelector('summary.rp-quoted-sum'),
               collapsedByDefault: !det.open,
               hasBorder: getComputedStyle(det).borderInlineStartWidth!=='0px',
               quotedLines: body.querySelectorAll('.rp-line').length,
               carriesUrl: body.textContent.indexOf('console.thriveiii.com/opp/thrive-july')>=0 }; }""")
    ck("the quoted history is a collapsed, bordered section with the referenced lines inside",
       quote["hasSummary"] and quote["collapsedByDefault"] and quote["hasBorder"]
       and quote["quotedLines"]>=2 and quote["carriesUrl"], quote)

    # ---- the URL is isolated and the body stays escaped: no script node, the text is inert ----
    safe = pg.evaluate("""()=>{
      const card=document.querySelector('#probe .th-reply .rp-snip');
      const urlBdi=[...card.querySelectorAll('bdi.rp-ltr')].find(x=>x.textContent.indexOf('console.thriveiii.com/opp/thrive-july')>=0);
      return { scripts: card.querySelectorAll('script').length,
               inertText: card.textContent.indexOf('<script>alert(1)</script>')>=0,
               urlIsolated: !!urlBdi && getComputedStyle(urlBdi).direction==='ltr' }; }""")
    ck("the reply body stays escaped: the hostile <script> is inert text, no script node is created (XSS holds)",
       safe["scripts"]==0 and safe["inertText"] is True, safe)
    ck("the URL is an isolated left-to-right run inside the quoted line",
       safe["urlIsolated"] is True, safe)

    # ---- a long URL wraps inside the card: no horizontal overflow ----
    overflow = pg.evaluate("""()=>{
      const cards=[...document.querySelectorAll('#probe .th-reply .rp-snip')];
      const card=cards.find(c=>c.textContent.indexOf('a-very-long-slug')>=0) || cards[cards.length-1];
      return { over: card.scrollWidth - card.clientWidth, clientW: card.clientWidth }; }""")
    ck("a long URL wraps inside the card, no horizontal overflow (scrollWidth within clientWidth)",
       overflow["over"] <= 1, overflow)

    # ---- an all-English reply in the same thread computes left-to-right ----
    en = pg.evaluate("""()=>{
      const wrap=document.createElement('div'); wrap.id='probeEn'; wrap.style.cssText='width:360px';
      wrap.innerHTML=window.threadListHtml('en-co'); document.body.appendChild(wrap);
      const line=wrap.querySelector('.th-reply .rp-snip .rp-line');
      return { dir: line? getComputedStyle(line).direction : '' }; }""")
    ck("an all-English reply line in the same thread computes left-to-right (each line owns its direction)",
       en["dir"]=="ltr", en)

    # ---- pure-function structure check: mixed line keeps the address in a bdi, everything escaped ----
    fn = pg.evaluate(r"""()=>{
      const html=window.renderReplyBody('اكتب to me at a@b.example & see <x>');
      return { hasBdi: html.indexOf('<bdi class="rp-ltr">a@b.example</bdi>')>=0,
               ampEscaped: html.indexOf('&amp;')>=0, ltEscaped: html.indexOf('&lt;x&gt;')>=0,
               lineWrapped: html.indexOf('class="rp-line"')>=0 }; }""")
    ck("renderReplyBody isolates the address in a <bdi> and escapes the rest (&, angle brackets) as before",
       fn["hasBdi"] and fn["ampEscaped"] and fn["ltEscaped"] and fn["lineWrapped"], fn)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL REPLY-BODY RTL CHECKS PASS"))
raise SystemExit(1 if fails else 0)
