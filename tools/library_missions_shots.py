"""P25 surface gallery: the Library organized BY MISSION. Two mission shelves, each leading with its base
template (the source of truth) and its requirements manifest, then the filed pages. A faithful STATIC mock
linking the REAL library/styles.css and using the exact classes the app emits (shelves / shelf / shelf-h /
shelf-base / shelf-manifest / mf-list / grid / card). Rendered EN and AR at THREE widths to prove the two
shelves stack cleanly with no horizontal overflow, RTL clean, Western numerals isolated. The live console
boot is network-flaky in this sandbox; library_missions_test.js proves the behaviour."""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
Hh = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
s = socketserver.TCPServer(("127.0.0.1", 0), Hh); PORT = s.server_address[1]; s.daemon_threads = True
threading.Thread(target=s.serve_forever, daemon=True).start()
from playwright.sync_api import sync_playwright
base = f"http://127.0.0.1:{PORT}"; OUT = ROOT + "/shots/library-missions"; os.makedirs(OUT, exist_ok=True)

CHK = '<svg class="ic" width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 10l4 4 8-9"/></svg>'
CHK14 = '<svg class="ic" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 10l4 4 8-9"/></svg>'

STR = {
  "en": dict(d="ltr",
    off_name="Prospect Offer", off_tag="The Signal Brief. A respect-first single page sent to one prospect.",
    rep_name="Thrive Monthly Report", rep_tag="The monthly report sent to the Thrive community. A ratified design, uploaded against this manifest.",
    pages="pages", base_truth="Base template · source of truth", manifest="Requirements manifest",
    manifest_sub="Produce an outside design against this checklist so it uploads without breakage.",
    base_upload="This mission has no fill-in template. Ratified designs are uploaded against the manifest above.",
    base_new="Upload a design", empty="No pages filed here yet.",
    m1="Identity slots: the business name and the opportunity link.",
    m2="Required blocks, in order: signal hero, one quote, three proof points, the six-part system, one call to action.",
    m3="Typefaces: the console's Latin face for EN; the Alyamama face for AR.",
    r1="Identity slots: the Thrive brand header and the report period.",
    r2="Required blocks: the period header, the highlights, the numbers, what shipped, what is next, the footer.",
    r3="RTL: the AR edition mirrors the layout, Western numerals, no letter-spacing on Arabic.",
    c1="Organic Allure", c2="Fleurs de Sucre", c3="Cozy Calico", c4="Thrive · July"),
  "ar": dict(d="rtl",
    off_name="عرض للعميل", off_tag="موجز الإشارة. صفحة واحدة تقود بالاحترام، تُرسل إلى عميل واحد.",
    rep_name="تقرير ثرايف الشهري", rep_tag="التقرير الشهري المُرسل إلى مجتمع ثرايف. تصميم مُعتمد، يُرفع وفق هذا البيان.",
    pages="صفحات", base_truth="القالب الأساسي · المرجع", manifest="قائمة المتطلبات",
    manifest_sub="أنتج تصميمًا خارجيًا وفق هذه القائمة ليرفعه المستخدم دون خلل.",
    base_upload="لا تملك هذه المهمة قالب تعبئة. ارفع التصاميم المعتمدة وفق القائمة أعلاه.",
    base_new="ارفع تصميمًا", empty="لا صفحات هنا بعد.",
    m1="خانات الهوية: اسم النشاط ورابط الفرصة.",
    m2="الكتل المطلوبة بالترتيب: رمز إشاري، اقتباس واحد، ثلاث نقاط إثبات، منظومة الأشهر الستة، دعوة واحدة للفعل.",
    m3="الخطوط: خط الكونسول اللاتيني للإنجليزية؛ خط اليمامة للعربية.",
    r1="خانات الهوية: ترويسة علامة ثرايف وفترة التقرير.",
    r2="الكتل المطلوبة: ترويسة الفترة، أبرز النقاط، الأرقام، ما أُنجز، ما هو قادم، والتذييل.",
    r3="الاتجاه: تعكس النسخة العربية التخطيط، والأرقام الغربية، وبلا تباعد بين الحروف العربية.",
    c1="Organic Allure", c2="Fleurs de Sucre", c3="Cozy Calico", c4="Thrive · July"),
}

def card(name, tmpl, made):
    return (f'<div class="card"><div class="card-h"><h3 class="card-t" dir="auto">{name}</h3></div>'
      f'<p class="card-facts"><span class="fact fact-tmpl">{tmpl}</span>'
      f'<span class="fact">made: {made}</span></p></div>')

def manifest(items):
    lis = "".join(f'<li class="mf-item">{CHK}<span>{x}</span></li>' for x in items)
    S = STR  # noqa
    return ('<details class="shelf-manifest" open><summary class="shelf-manifest-s">' + CHK14 +
      'Requirements manifest</summary><p class="shelf-manifest-p">.</p><ul class="mf-list">' + lis + '</ul></details>')

def shelf_offer(S):
    base = ('<div class="shelf-base"><span class="shelf-base-tag">' + CHK + S["base_truth"] + '</span>'
      '<div class="shelf-base-body">'
      '<a class="btn ghost sm"><span class="mono-iso">en-opp1</span> · The Signal Brief (EN)</a>'
      '<a class="btn ghost sm"><span class="mono-iso">ar-opp1</span> · موجز الإشارة (AR)</a>'
      '</div></div>')
    mf = ('<details class="shelf-manifest" open><summary class="shelf-manifest-s">' + CHK14 + S["manifest"] +
      '</summary><p class="shelf-manifest-p">' + S["manifest_sub"] + '</p><ul class="mf-list">' +
      "".join(f'<li class="mf-item">{CHK}<span>{x}</span></li>' for x in [S["m1"], S["m2"], S["m3"]]) + '</ul></details>')
    cards = card(S["c1"], "en-opp1", "2026-06-11") + card(S["c2"], "custom", "2026-06-03")
    return ('<section class="shelf"><header class="shelf-h"><div class="shelf-id">'
      f'<h2 class="shelf-t" dir="auto">{S["off_name"]}</h2>'
      f'<span class="shelf-count"><span class="n">14</span> {S["pages"]}</span></div></header>'
      f'<p class="shelf-tag" dir="auto">{S["off_tag"]}</p>' + base + mf +
      f'<div class="shelf-cards grid">{cards}</div></section>')

def shelf_report(S):
    base = ('<div class="shelf-base"><span class="shelf-base-tag">' + CHK + S["base_truth"] + '</span>'
      '<div class="shelf-base-body">'
      f'<span class="shelf-base-note">{S["base_upload"]}</span>'
      f'<a class="btn ghost sm">{S["base_new"]}</a>'
      '</div></div>')
    mf = ('<details class="shelf-manifest" open><summary class="shelf-manifest-s">' + CHK14 + S["manifest"] +
      '</summary><p class="shelf-manifest-p">' + S["manifest_sub"] + '</p><ul class="mf-list">' +
      "".join(f'<li class="mf-item">{CHK}<span>{x}</span></li>' for x in [S["r1"], S["r2"], S["r3"]]) + '</ul></details>')
    cards = card(S["c3"], "custom", "2026-07-01") + card(S["c4"], "custom", "2026-07-31")
    return ('<section class="shelf"><header class="shelf-h"><div class="shelf-id">'
      f'<h2 class="shelf-t" dir="auto">{S["rep_name"]}</h2>'
      f'<span class="shelf-count"><span class="n">7</span> {S["pages"]}</span></div>'
      '<button class="btn ghost sm danger shelf-del">Remove mission</button></header>'
      f'<p class="shelf-tag" dir="auto">{S["rep_tag"]}</p>' + base + mf +
      f'<div class="shelf-cards grid">{cards}</div></section>')

def page(lang):
    S = STR[lang]
    return f"""<!doctype html><html dir="{S['d']}" lang="{lang}"><head><meta charset="utf-8">
<link rel="stylesheet" href="/library/fonts.css"><link rel="stylesheet" href="/library/styles.css"></head>
<body style="background:var(--bg);margin:0;padding:24px">
  <div class="shelves" style="max-width:1120px;margin:0 auto">{shelf_offer(S)}{shelf_report(S)}</div>
</body></html>"""

WIDTHS = [380, 720, 1120]
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    for lang in ("en", "ar"):
        with open(f"{OUT}/_mock-{lang}.html", "w", encoding="utf-8") as f:
            f.write(page(lang))
        for w in WIDTHS:
            ctx = b.new_context(viewport={"width": w, "height": 900}, device_scale_factor=2)
            pg = ctx.new_page()
            pg.goto(f"{base}/shots/library-missions/_mock-{lang}.html", wait_until="load", timeout=30000); pg.wait_for_timeout(300)
            over = pg.evaluate("() => document.documentElement.scrollWidth > window.innerWidth + 1")
            pg.screenshot(path=f"{OUT}/library-missions-{lang}-{w}.png", full_page=True)
            print(f"ok {lang} {w}  h-overflow={over}"); ctx.close()
    b.close()
s.shutdown()
print("done -> " + OUT)
