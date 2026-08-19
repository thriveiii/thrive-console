"""P26 surface gallery: the Batches view (each daily drop, whole) and the card Overview's quiet "from batch"
chip. A faithful STATIC mock linking the REAL library/styles.css and using the exact classes the app emits
(batch / batch-h / batch-count / bdoc / doc-h / doc-p / doc-li / bopp-chip / mw-batch-chip). Rendered EN and
AR at THREE widths to prove the batch sections stack with no horizontal overflow, RTL clean, Western numerals
isolated. The live console boot is network-flaky in this sandbox; batch_documents_test.js proves behaviour."""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
Hh = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
s = socketserver.TCPServer(("127.0.0.1", 0), Hh); PORT = s.server_address[1]; s.daemon_threads = True
threading.Thread(target=s.serve_forever, daemon=True).start()
from playwright.sync_api import sync_playwright
base = f"http://127.0.0.1:{PORT}"; OUT = ROOT + "/shots/batch-documents"; os.makedirs(OUT, exist_ok=True)

PAGE = '<svg class="ic" width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="3" width="12" height="14" rx="2"/><path d="M7 7h6M7 10h6M7 13h4"/></svg>'

STR = {
  "en": dict(d="ltr",
    title="Batches", sub="Each daily drop, whole: the documents it arrived with, beside the opportunities it produced. Newest first.",
    n="Batch", date="2026-08-18", docs="documents", opps="opportunities", produced="Opportunities produced",
    d1t="Research and messages", d1n="BATCH13_research_and_messages.md",
    d2t="Market assessment", d2n="market.md", d3t="README", d3n="README.md",
    h="Batch 13 · research and messages", p1="Six makers this batch, none in Arlington, none repeated.",
    li1="River-Sea Chocolates, the Reston shop, found.", li2="Ludic Lillian, handmade ceramics, seen.",
    chipbtn="From batch", ov="Organic Allure",
    opps_list=["River-Sea Chocolates","Ludic Lillian","Wise Butterfly","Wander Wick Candles","Corner Bloom Studio"]),
  "ar": dict(d="rtl",
    title="الدفعات", sub="كل دفعة يومية كاملة: المستندات التي وصلت معها، إلى جانب الفرص التي أنتجتها. الأحدث أولًا.",
    n="دفعة", date="2026-08-18", docs="مستندات", opps="فرص", produced="الفرص الناتجة",
    d1t="بحث ورسائل", d1n="BATCH13_research_and_messages.md",
    d2t="تقييم السوق", d2n="market.md", d3t="اقرأني", d3n="README.md",
    h="الدفعة 13 · بحث ورسائل", p1="ستة صنّاع هذه الدفعة، لا أحد في أرلينغتون، ولا تكرار.",
    li1="متجر ريستون، وُجد.", li2="سيراميك مصنوع يدويًا، لُوحظ.",
    chipbtn="من الدفعة", ov="Organic Allure",
    opps_list=["River-Sea Chocolates","جمعية الشرق للحلويات","Wander Wick Candles","Corner Bloom Studio"]),
}

def doc(S, t, n, openit, body):
    op = " open" if openit else ""
    return (f'<details class="bdoc"{op}><summary class="bdoc-s">'
      f'<span class="bdoc-type">{t}</span><span class="bdoc-name mono-iso" dir="ltr">{n}</span></summary>'
      f'<div class="bdoc-body">{body}</div></details>')

def batch(S):
    body = (f'<p class="doc-h doc-h1" dir="auto">{S["h"]}</p>'
      f'<p class="doc-p" dir="auto">{S["p1"]}</p>'
      f'<p class="doc-li" dir="auto">{S["li1"]}</p>'
      f'<p class="doc-li" dir="auto">{S["li2"]}</p>')
    docs = doc(S, S["d1t"], S["d1n"], True, body) + doc(S, S["d2t"], S["d2n"], False, "") + doc(S, S["d3t"], S["d3n"], False, "")
    chips = "".join(f'<button class="bopp-chip" type="button" dir="auto">{b}</button>' for b in S["opps_list"])
    return ('<section class="batch"><header class="batch-h"><div class="batch-id">'
      f'<h2 class="batch-t">{S["n"]} <span class="n">13</span></h2>'
      f'<span class="batch-date" dir="ltr">{S["date"]}</span></div>'
      '<div class="batch-counts">'
      f'<span class="batch-count"><span class="n">3</span> {S["docs"]}</span>'
      f'<span class="batch-count"><span class="n">6</span> {S["opps"]}</span></div></header>'
      f'<div class="batch-docs">{docs}</div>'
      f'<div class="batch-opps"><span class="batch-opps-h">{S["produced"]}</span><div class="bopp-list">{chips}</div></div>'
      '</section>')

def chiprow(S):
    return ('<dl class="mw-rows" style="max-width:520px;background:var(--panel);border:1px solid var(--hair);border-radius:14px;padding:14px 18px">'
      f'<div class="mw-row"><dt>{S["chipbtn"]}</dt><dd>'
      f'<button type="button" class="mw-batch-chip">{PAGE}<span class="mw-batch-d" dir="ltr">{S["date"]}</span></button>'
      '</dd></div></dl>')

def page(lang):
    S = STR[lang]
    return f"""<!doctype html><html dir="{S['d']}" lang="{lang}"><head><meta charset="utf-8">
<link rel="stylesheet" href="/library/fonts.css"><link rel="stylesheet" href="/library/styles.css"></head>
<body style="background:var(--bg);margin:0;padding:24px">
  <div style="max-width:1120px;margin:0 auto">
    <div class="page-h"><h1 class="title">{S['title']}</h1></div>
    <p class="sub">{S['sub']}</p>
    <div id="batchList">{batch(S)}</div>
    <div style="margin-top:20px">{chiprow(S)}</div>
  </div>
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
            pg.goto(f"{base}/shots/batch-documents/_mock-{lang}.html", wait_until="load", timeout=30000); pg.wait_for_timeout(300)
            over = pg.evaluate("() => document.documentElement.scrollWidth > window.innerWidth + 1")
            pg.screenshot(path=f"{OUT}/batch-documents-{lang}-{w}.png", full_page=True)
            print(f"ok {lang} {w}  h-overflow={over}"); ctx.close()
    b.close()
s.shutdown()
print("done -> " + OUT)
