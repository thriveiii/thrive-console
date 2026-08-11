"""A reply body renders unscrambled in Arabic: every line is direction-isolated (WO-022).

The device showed Basel's thread with the Gmail quote-header line scrambled: an Arabic date, a Latin sender
and address, a URL and angle brackets, all in one line, reordered by the bidi algorithm into an unreadable
run. #99 isolated each MESSAGE's direction; it did not isolate the mixed-direction LINES inside a body. This
renders each line as its own dir="auto" block (unicode-bidi:isolate), wraps embedded URLs and addresses in
<bdi> so they stay left-to-right and wrap, and keeps a bracket outside the isolated run so it sits on the
correct side. Rendering only: every piece still passes through esc (the #99 XSS guarantee holds).

Engine-independent facts (the final glyph order on WebKit is Thyab's iPad device gate): Basel's actual
quote-header line renders as separate isolated lines; the address and URL are isolated LTR runs; the angle
brackets are outside those runs; the body stays escaped (no script node); a long URL wraps inside the card
(no horizontal overflow); and an all-Arabic, an all-English and a mixed line each compute the right base
direction in the same thread."""
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

    # ---- the quote header is split into its own isolated lines (not one scrambled block) ----
    struct = pg.evaluate("""()=>{
      const card=document.querySelector('#probe .th-reply .rp-snip');
      const lines=[...card.querySelectorAll('.rp-line')];
      return { lineCount:lines.length,
               allAuto: lines.every(l=>l.getAttribute('dir')==='auto'),
               allBlock: lines.every(l=>getComputedStyle(l).display==='block'),
               allIsolate: lines.every(l=>getComputedStyle(l).unicodeBidi.indexOf('isolate')>=0) }; }""")
    ck("the reply body is split into per-line blocks, each dir=auto and unicode-bidi:isolate (not one flow)",
       struct["lineCount"] >= 4 and struct["allAuto"] and struct["allBlock"] and struct["allIsolate"], struct)

    # ---- the address is an isolated LTR run; the angle brackets are OUTSIDE it (correct side) ----
    addr = pg.evaluate("""()=>{
      const card=document.querySelector('#probe .th-reply .rp-snip');
      const hdr=[...card.querySelectorAll('.rp-line')].find(l=>l.textContent.indexOf('كتب')>=0);
      const bdi=hdr && hdr.querySelector('bdi.rp-ltr');
      return { headerDir: hdr? getComputedStyle(hdr).direction : '',
               bdiText: bdi? bdi.textContent : '',
               bdiDir: bdi? getComputedStyle(bdi).direction : '',
               bracketsOutside: !!hdr && hdr.textContent.indexOf('<hi@thriveiii.com>')>=0 && (bdi.textContent.indexOf('<')<0 && bdi.textContent.indexOf('>')<0) }; }""")
    ck("the quote-header line reads right-to-left (Arabic base direction), not flipped to LTR by the address",
       addr["headerDir"]=="rtl", addr)
    ck("the email address is an isolated left-to-right run (a <bdi> computing ltr), so it never drags the line",
       addr["bdiText"]=="hi@thriveiii.com" and addr["bdiDir"]=="ltr", addr)
    ck("the angle brackets sit OUTSIDE the isolated address run, on the correct side (not inside the LTR bdi)",
       addr["bracketsOutside"] is True, addr)

    # ---- the quoted lines (leading > and the wrote: header) render as the quieter quoted section ----
    quote = pg.evaluate("""()=>{
      const card=document.querySelector('#probe .th-reply .rp-snip');
      const lines=[...card.querySelectorAll('.rp-line')];
      const header=lines.find(l=>l.textContent.indexOf('كتب')>=0);
      const quoted=lines.filter(l=>l.classList.contains('rp-quote'));
      return { headerQuoted: !!header && header.classList.contains('rp-quote'), quotedCount:quoted.length,
               hasBorder: quoted.length>0 && getComputedStyle(quoted[0]).borderInlineStartWidth!=='0px' }; }""")
    ck("the wrote: header and the > quoted lines render as a quieter quoted section (a border, muted)",
       quote["headerQuoted"] and quote["quotedCount"]>=2 and quote["hasBorder"], quote)

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
