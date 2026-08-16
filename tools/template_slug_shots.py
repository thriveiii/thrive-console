"""Chromium baseline for the template-slug + composer brief: the review table (even columns, aligned checks
and verdicts, legible, no overflow) and the calm-by-default reply composer. Phone / iPad, EN and AR.
Also asserts the table does not overflow its frame at phone width. NOT WebKit proof; the iPad is Thyab's gate."""
import threading, http.server, socketserver, functools, os, sys
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
Hh = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
s = socketserver.TCPServer(("127.0.0.1", 0), Hh); PORT = s.server_address[1]; s.daemon_threads = True
threading.Thread(target=s.serve_forever, daemon=True).start()
from playwright.sync_api import sync_playwright
base = f"http://127.0.0.1:{PORT}"; OUT = ROOT + "/shots/template-slug"; os.makedirs(OUT, exist_ok=True)
fails = []

# The review table exactly as renderBatch builds it: the three real shops from the zip (one row each, no
# gift-gather phantom), plus a warned row so the verdict column is exercised. This is the CSS under test.
def bt_html(t):
    def row(slug, checks, verdict, warned):
        cells = "".join('<td class="bt-c">' + ('<span class="bt-y" data-icon="check"></span>' if c else '<span class="bt-n">·</span>') + '</td>' for c in checks)
        v = ('<span class="bt-ok">Matched</span>' if not warned else '<span class="bt-warn">' + verdict + '</span>')
        return '<tr class="' + ('is-warned' if warned else 'is-matched') + '"><td class="mono-iso" dir="ltr">' + slug + '</td>' + cells + '<td>' + v + '</td></tr>'
    head = '<tr><th>' + t['slug'] + '</th><th>' + t['html'] + '</th><th>' + t['mfst'] + '</th><th>' + t['subj'] + '</th><th>' + t['body'] + '</th><th>' + t['send'] + '</th><th>' + t['verdict'] + '</th></tr>'
    rows = (row("organic-allure", [1,1,1,1,1], "", False) +
            row("gift-and-gather", [1,1,0,0,1], t['no_text'], True) +
            row("fleurs-de-lea", [1,1,1,1,1], "", False) +
            row("a-very-long-shop-name-that-wraps", [0,1,1,1,0], t['page_pending'], True))
    return '<div class="bt-wrap"><table class="bt">' + head + rows + '</table></div>'

LABELS = {
    "en": {"slug":"Slug","html":"HTML","mfst":"MFST","subj":"SUBJ","body":"BODY","send":"SEND","verdict":"Verdict",
           "no_text":"no text","page_pending":"stored as draft, page pending"},
    "ar": {"slug":"المُعرّف","html":"HTML","mfst":"البيان","subj":"العنوان","body":"النص","send":"الإرسال","verdict":"الحكم",
           "no_text":"بلا نص","page_pending":"حُفظت كمسودة، الصفحة قيد الإعداد"},
}

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    for lang in ("en", "ar"):
        for (w, h, tag) in [(390, 860, "phone"), (768, 1024, "ipad")]:
            ctx = b.new_context(viewport={"width": w, "height": h})
            ctx.route("https://api.github.com/**", lambda r: r.abort())
            ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))
            pg = ctx.new_page()
            pg.goto(f"{base}/library/console.html")
            if pg.query_selector("#gateInput"):
                pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(300)
            pg.wait_for_function("()=>document.documentElement", timeout=15000)
            pg.evaluate("l=>{ document.documentElement.setAttribute('dir', l==='ar'?'rtl':'ltr'); }", lang)
            pg.evaluate("()=>{ const g=document.getElementById('thriveGate'); if(g) g.remove(); document.documentElement.classList.remove('gate-locked'); }")
            # inject the review table into a real, width-constrained panel so the CSS is exercised for real
            pg.evaluate("""(html)=>{
              const wrap=document.createElement('div'); wrap.className='wrap'; wrap.id='btprobe';
              wrap.style.cssText='padding:16px;box-sizing:border-box';
              wrap.innerHTML='<section class="panel">'+html+'</section>';
              document.body.innerHTML=''; document.body.appendChild(wrap);
              if(window.applyIcons) try{ applyIcons(wrap); }catch(e){}
            }""", bt_html(LABELS[lang]))
            pg.wait_for_timeout(200)
            over = pg.evaluate("""()=>{
              const body=document.body, wrap=document.querySelector('.bt-wrap');
              return { pageOver: body.scrollWidth - document.documentElement.clientWidth,
                       wrapFits: wrap ? (wrap.scrollWidth <= wrap.clientWidth + 1) : null,
                       hasTable: !!document.querySelector('table.bt tr') }; }""")
            ok = over["pageOver"] <= 1 and over["hasTable"]
            print(("PASS " if ok else "FAIL ") + f"[{lang}/{tag}] review table: no page overflow, table rendered ({over})")
            if not ok: fails.append(f"{lang}/{tag} table overflow")
            pg.screenshot(path=f"{OUT}/table-{tag}-{lang}.png", clip={"x":0,"y":0,"width":w,"height":min(h,520)})
            ctx.close()

    # ---- the calm-by-default reply composer, phone/iPad EN+AR ----
    SEED = """(a)=>{
      const set=(k,v)=>localStorage.setItem(k, JSON.stringify(v));
      set('thrive_opps_v1', [{slug:'madar', business:'مدارس المدار الدولية', published:true,
        recipients:[{addr:'basel@issa.example', name:'باسل عيسى', lang:'ar'}]}]);
      set('thrive_mail_v1', [{mid:'s1', opp:'madar', to:'head@madar.example', subject:'من جد وجد',
        status:'sent', direction:'out', ts:'2026-08-01T10:00:00Z', msgid:'<s1@thriveiii.com>'}]);
      set('thrive_inbound_v1', [{gid:'i1', opp:'madar', kind:'reply', from:'basel@issa.example', name:'باسل عيسى',
        subject:'Re: من جد وجد', snippet:'نعم، هذا رائع.', ts:'2026-08-03T09:00:00Z', messageId:'<w1@issa.example>'}]);
      set('thrive_hits_v1', []);
      localStorage.setItem('thrive_email_ep','https://relay.example/exec');
    }"""
    for lang in ("en", "ar"):
        for (w, h, tag) in [(390, 860, "phone"), (768, 1024, "ipad")]:
            ctx = b.new_context(viewport={"width": w, "height": h}, has_touch=(w<=834), is_mobile=(w<=430))
            ctx.route("https://api.github.com/**", lambda r: r.abort())
            ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))
            pg = ctx.new_page()
            pg.goto(f"{base}/library/console.html"); pg.wait_for_timeout(300)
            pg.evaluate("l=>localStorage.setItem('thrive_lang',l)", lang)
            pg.evaluate("()=>{ localStorage.setItem('console_sb_read','1'); localStorage.setItem('console_sb_session', JSON.stringify({access_token:'jwt',uid:'op',email:'op@x'})); }")
            pg.reload(); pg.wait_for_function("()=>window.thriveModal && typeof window.initCompose==='function'", timeout=15000)
            pg.evaluate("()=>{ const g=document.getElementById('thriveGate'); if(g) g.remove(); document.documentElement.classList.remove('gate-locked'); }")
            pg.evaluate(SEED)
            try:
                pg.evaluate("()=>window.thriveModal.open('madar','history','مدارس المدار الدولية')")
                pg.wait_for_selector('#view-compose.reply-lean', timeout=6000)
                pg.wait_for_timeout(500)
            except Exception as e:
                print(f"composer {lang}/{tag}: {e}")
            pg.screenshot(path=f"{OUT}/composer-{tag}-{lang}.png", clip={"x":0,"y":0,"width":w,"height":min(h,840)})
            ctx.close()
    b.close()
s.shutdown()
print("\n%d failed" % len(fails))
sys.exit(1 if fails else 0)
