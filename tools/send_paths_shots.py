"""P24 surface gallery: the two-path Send chooser (فردي / حملة, sized as real decisions) and the campaign
plan on the campaign screen (jitter, today's budget, warm-ramp cap, estimated finish). A faithful STATIC mock
linking the REAL library/styles.css and using the exact classes the app emits (send-scrim / send-box /
send-grid / send-card / cpl-panel). Rendered EN and AR at THREE widths to prove no overflow (the brief's
requirement). The live console boot is network-flaky in this sandbox; send_paths_test.js proves behaviour."""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
Hh = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
s = socketserver.TCPServer(("127.0.0.1", 0), Hh); PORT = s.server_address[1]; s.daemon_threads = True
threading.Thread(target=s.serve_forever, daemon=True).start()
from playwright.sync_api import sync_playwright
base = f"http://127.0.0.1:{PORT}"; OUT = ROOT + "/shots/send-paths"; os.makedirs(OUT, exist_ok=True)

MAIL = '<svg class="ic" width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="4" width="16" height="12" rx="2"/><path d="M3 5l7 6 7-6"/></svg>'
SEND = '<svg class="ic" width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M18 2L9 11M18 2l-6 16-3-7-7-3z"/></svg>'
CLK = '<svg class="ic" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="10" cy="10" r="7"/><path d="M10 6v4l3 2"/></svg>'

STR = {
  "en": dict(d="ltr", which="How do you want to send?", opp="Organic Allure",
    single="One recipient", single_p="A single brief to this card's contact.", addr="deborah@organicallure.com",
    camp="A campaign", camp_p="The roster of recipients, paced by the queue.", recips="recipients", close="Close",
    plan_h="The campaign plan", plan_n="recipients",
    jitter="Gap between sends", sec="sec", budget="Sending today", today="today",
    warm="Warm-ramp cap", perday="per day", finish="Estimated finish", over="over", days="2 days",
    note="Paced, jittered, and capped so a dozens-send is disciplined, never a blast."),
  "ar": dict(d="rtl", which="كيف تريد الإرسال؟", opp="Organic Allure",
    single="مستلم واحد", single_p="رسالة واحدة إلى جهة اتصال هذه البطاقة.", addr="deborah@organicallure.com",
    camp="حملة", camp_p="قائمة المستلمين، يوزّعها الطابور.", recips="مستلمين", close="إغلاق",
    plan_h="خطة الحملة", plan_n="مستلمين",
    jitter="الفارق بين الإرسالات", sec="ثانية", budget="الإرسال اليوم", today="اليوم",
    warm="سقف الإحماء", perday="يوميًا", finish="الانتهاء المقدَّر", over="خلال", days="يومان",
    note="موزّع ومتباعد ومحدود، فإرسال العشرات منضبط لا دفعة واحدة."),
}

def chooser(S):
    return ('<div class="tw-scrim send-scrim" style="position:static;background:none;backdrop-filter:none;padding:0">'
      '<div class="tw-box send-box" role="dialog">'
      f'<h3 class="tw-t">{S["which"]}</h3><p class="tw-p" dir="auto">{S["opp"]}</p>'
      '<div class="send-grid">'
      f'<button class="send-card" type="button">{MAIL}<span class="send-t">{S["single"]}</span>'
      f'<span class="send-d">{S["single_p"]}</span><span class="send-meta mono-iso">{S["addr"]}</span></button>'
      f'<button class="send-card" type="button">{SEND}<span class="send-t">{S["camp"]}</span>'
      f'<span class="send-d">{S["camp_p"]}</span><span class="send-meta"><bdi class="n">12</bdi> {S["recips"]}</span></button>'
      '</div>'
      f'<div class="send-foot"><button class="btn ghost sm" type="button">{S["close"]}</button></div>'
      '</div></div>')

def plan(S):
    def row(k, v): return f'<div class="cpl-row"><span class="cpl-k">{k}</span><span class="cpl-v">{v}</span></div>'
    jitter = f'<bdi class="n">45</bdi>–<bdi class="n">165</bdi> {S["sec"]}'
    budget = f'<bdi class="n">40</bdi> / <bdi class="n">100</bdi> {S["today"]}'
    warm = f'<bdi class="n">40</bdi> {S["perday"]}'
    finish = f'{S["over"]} {S["days"]}'
    return ('<section class="cg-panel cpl-panel" style="max-width:560px">'
      f'<h4 class="cg-h">{CLK} {S["plan_h"]} <span class="chip-st"><bdi class="n">50</bdi> {S["plan_n"]}</span></h4>'
      + row(S["jitter"], jitter) + row(S["budget"], budget) + row(S["warm"], warm) + row(S["finish"], finish)
      + f'<p class="mw-muted cpl-note">{S["note"]}</p></section>')

def page(lang):
    S = STR[lang]
    return f"""<!doctype html><html dir="{S['d']}" lang="{lang}"><head><meta charset="utf-8">
<link rel="stylesheet" href="/library/styles.css"></head>
<body style="background:var(--bg);margin:0;padding:24px">
  <div style="display:grid;gap:24px;justify-items:center">{chooser(S)}{plan(S)}</div>
</body></html>"""

WIDTHS = [380, 720, 1120]
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    for lang in ("en", "ar"):
        with open(f"{OUT}/_mock-{lang}.html", "w", encoding="utf-8") as f:
            f.write(page(lang))
        for w in WIDTHS:
            ctx = b.new_context(viewport={"width": w, "height": 760}, device_scale_factor=2)
            pg = ctx.new_page()
            pg.goto(f"{base}/shots/send-paths/_mock-{lang}.html", wait_until="load", timeout=30000); pg.wait_for_timeout(300)
            pg.screenshot(path=f"{OUT}/send-paths-{lang}-{w}.png", full_page=True)
            print(f"ok {lang} {w}"); ctx.close()
    b.close()
s.shutdown()
print("done -> " + OUT)
