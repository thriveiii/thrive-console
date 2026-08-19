"""P23 surface gallery: the composer's attachment strip (attached vs hosted image), the Drive-sharing
reminder chip, the links manager naming a recognized kind, and the always-visible relay capability matrix
(Condition 2). A faithful STATIC mock linking the REAL library/styles.css and using the exact classes the
app emits (eattach / eatt-item / edrivechip / elink-item + tag-kind / relay-caps). The live console boot is
network-flaky in this sandbox (compile_parity and the P22 suites are device-gated the same way); this proves
the CSS + copy, and attach_logic_test.js + relay_attach_test.js prove the behaviour."""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
Hh = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
s = socketserver.TCPServer(("127.0.0.1", 0), Hh); PORT = s.server_address[1]; s.daemon_threads = True
threading.Thread(target=s.serve_forever, daemon=True).start()
from playwright.sync_api import sync_playwright
base = f"http://127.0.0.1:{PORT}"; OUT = ROOT + "/shots/attachments"; os.makedirs(OUT, exist_ok=True)

CHK = '<svg class="ic" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 10l4 4 8-9"/></svg>'
CLK = '<svg class="ic" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="10" cy="10" r="7"/><path d="M10 6v4l3 2"/></svg>'
ALERT = '<svg class="ic" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M10 3l8 14H2z"/><path d="M10 8v4M10 15v.5"/></svg>'
# a tiny inline data-URI thumbnail so the strip renders without a network fetch
THUMB = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='44' height='44'><rect width='44' height='44' fill='%237c6fd6'/></svg>"

STR = {
  "en": dict(d="ltr", att_h="Images in this message", attached="attached", hosted="hosted link", mb="MB",
    remove="Remove", poster="poster.png", banner="event-banner.jpg",
    links_h="Links in this message", tpl="message template", custom="added", edit="Edit", drv="Google Drive",
    link_text="the schedule", drive="Google Drive link: check its sharing is set to anyone with the link before you send, or the recipient hits a request-access wall.",
    caps_live="Relay serving", cap_on="live",
    caps=[("Send email", True, ""), ("Paced campaign queue", True, ""),
          ("Inbound signals (heartbeat, reconcile)", True, ""), ("Image attachments", True, "")],
    h_strip="What lands, shown before it goes", h_caps="The relay version, always visible"),
  "ar": dict(d="rtl", att_h="الصور في هذه الرسالة", attached="مرفقة", hosted="رابط مُستضاف", mb="ميغابايت",
    remove="إزالة", poster="poster.png", banner="event-banner.jpg",
    links_h="روابط هذه الرسالة", tpl="قالب رسالة", custom="مُضاف", edit="تعديل", drv="Google Drive",
    link_text="الجدول", drive="رابط Google Drive: تحقّق من ضبط المشاركة على «أي شخص لديه الرابط» قبل الإرسال، وإلا يواجه المستلم جدار طلب الوصول.",
    caps_live="الوسيط يخدم", cap_on="فعّال",
    caps=[("إرسال البريد", True, ""), ("طابور الحملات المُنظَّم", True, ""),
          ("إشارات الوارد (النبض والمطابقة)", True, ""), ("مرفقات الصور", True, "")],
    h_strip="ما سيصل، ظاهرًا قبل الإرسال", h_caps="إصدار الوسيط، ظاهرًا دائمًا"),
}

def att_item(S, name, landing, mb):
    return (f'<div class="eatt-item"><img class="eatt-thumb" src="{THUMB}" alt="">'
      f'<div class="eatt-info"><span class="eatt-name" dir="auto">{name}</span>'
      f'<span class="eatt-meta"><span class="tag tag-plain">{landing}</span> '
      f'<span class="eatt-size"><bdi class="n">{mb}</bdi> {S["mb"]}</span></span></div>'
      f'<button type="button" class="btn ghost sm danger eatt-rm">{S["remove"]}</button></div>')

def page(lang):
    S = STR[lang]
    strip = (f'<div class="eattach"><div class="eattach-h">{S["att_h"]} <span class="pill"><bdi class="n">2</bdi></span></div>'
      + att_item(S, S["poster"], S["attached"], "1.4")
      + att_item(S, S["banner"], S["hosted"], "8.2") + '</div>')
    drive = f'<div class="edrivechip"><span class="edrive-ic">{ALERT}</span><span class="edrive-msg">{S["drive"]}</span></div>'
    links = (f'<div class="elinks"><div class="elinks-h">{S["links_h"]} <span class="pill">1</span></div>'
      f'<div class="elink-item"><div class="elink-info"><span class="elink-text">{S["link_text"]}</span>'
      f'<span class="tag tag-kind lk-drive">{S["drv"]}</span><span class="tag tag-plain">{S["custom"]}</span>'
      f'<span class="elink-url mono">https://drive.google.com/file/d/1a2b/view</span></div>'
      f'<div class="elink-acts"><button type="button" class="btn ghost sm">{S["edit"]}</button>'
      f'<button type="button" class="btn ghost sm danger">{S["remove"]}</button></div></div></div>')
    caprows = "".join(
      f'<li class="rc-cap {"on" if on else "off"}"><span class="rc-dot">{CHK if on else CLK}</span>'
      f'<span class="rc-name">{name}</span><span class="rc-need">{S["cap_on"] if on else need}</span></li>'
      for (name, on, need) in S["caps"])
    caps = (f'<div class="relay-caps"><div class="rc-head"><span class="rc-ver">{S["caps_live"]} '
      f'<b class="rc-num">v<bdi class="n">8</bdi></b></span></div><ul class="rc-list">{caprows}</ul></div>')
    return f"""<!doctype html><html dir="{S['d']}" lang="{lang}"><head><meta charset="utf-8">
<link rel="stylesheet" href="/library/styles.css"></head>
<body style="background:var(--bg);margin:0;padding:26px">
  <div style="max-width:560px;margin:0 auto;display:grid;gap:26px">
    <div><div class="th-ver" style="font-size:11px;color:var(--ink-4);margin-bottom:10px">{S['h_strip']}</div>{strip}{drive}{links}</div>
    <div><div class="th-ver" style="font-size:11px;color:var(--ink-4);margin-bottom:10px">{S['h_caps']}</div>{caps}</div>
  </div>
</body></html>"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    for lang in ("en", "ar"):
        with open(f"{OUT}/_mock-{lang}.html", "w", encoding="utf-8") as f:
            f.write(page(lang))
        ctx = b.new_context(viewport={"width": 820, "height": 900}, device_scale_factor=2)
        pg = ctx.new_page()
        pg.goto(f"{base}/shots/attachments/_mock-{lang}.html", wait_until="load", timeout=30000); pg.wait_for_timeout(400)
        pg.screenshot(path=f"{OUT}/attachments-{lang}.png", full_page=True)
        print(f"ok {lang}"); ctx.close()
    b.close()
s.shutdown()
print("done -> " + OUT)
