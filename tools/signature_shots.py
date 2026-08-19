"""P20 surface gallery: the per-sender signature manager (profile page) and the composer's read-only
signature picker, desktop EN and AR. Rendered as a faithful static mock that links the REAL styles.css and
uses the exact markup/classes renderSignatures + the composer emit, with two seeded signatures so the picker,
the set-default badge, and the live previews all show. (The live console boot is Supabase-timing-flaky in the
sandbox; this mock proves the CSS + copy exactly, and signature_system_test.js proves the behavior.)"""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
Hh = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
s = socketserver.TCPServer(("127.0.0.1", 0), Hh); PORT = s.server_address[1]; s.daemon_threads = True
threading.Thread(target=s.serve_forever, daemon=True).start()
from playwright.sync_api import sync_playwright
base = f"http://127.0.0.1:{PORT}"; OUT = ROOT + "/shots/signature"; os.makedirs(OUT, exist_ok=True)

AGENCY, SITE = "Thrive Digital Solutions", "thriveiii.com"
SIGS = [  # (id, name_en, name_ar)
    ("sig-a", "Abdullah Thyab", "عبدالله ذياب"),
    ("sig-b", "Basel Agha", "باسل آغا"),
]
STR = {
  "en": dict(dir="ltr", sig_h="Signature",
    mgr_sub="Your name above the agency block. Pick one as your default; the composer adds it once.",
    default="Default", make_default="Make default", edit="Edit", remove="Remove", add="Add signature",
    name_en="Your name (English)", name_ar="Your name (Arabic)", pick="Signature", preview="Preview",
    manage="Manage signatures", using="Language:", lang="English"),
  "ar": dict(dir="rtl", sig_h="التوقيع",
    mgr_sub="اسمك فوق كتلة الوكالة. اختر واحدًا افتراضيًا، ويضيفه المحرّر مرة واحدة.",
    default="افتراضي", make_default="اجعله افتراضيًا", edit="تحرير", remove="حذف", add="أضف توقيعًا",
    name_en="اسمك (بالإنجليزية)", name_ar="اسمك (بالعربية)", pick="التوقيع", preview="معاينة",
    manage="أدِر التواقيع", using="اللغة:", lang="العربية"),
}

def render_sig(name):  # renderSignature(sig, loc): name above the fixed agency block
    return (name + "\n" if name else "") + AGENCY + "\n" + SITE

def item_html(sid, name, label, is_def, S):
    badge = f'<span class="sig-item-badge">{S["default"]}</span>' if is_def else ""
    mk = "" if is_def else f'<button type="button" class="btn ghost sm" data-sig-act="default">{S["make_default"]}</button>'
    return (f'<li class="sig-item{" sig-item-def" if is_def else ""}" data-id="{sid}">'
            f'<div class="sig-item-top"><span class="sig-item-label">{label}</span>{badge}</div>'
            f'<pre class="sig-item-prev oc-body">{render_sig(name)}</pre>'
            f'<div class="sig-item-act">{mk}'
            f'<button type="button" class="btn ghost sm" data-sig-act="edit">{S["edit"]}</button>'
            f'<button type="button" class="btn ghost sm danger" data-sig-act="remove">{S["remove"]}</button>'
            f'</div></li>')

def page(lang):
    S = STR[lang]
    name_key = "name_ar" if lang == "ar" else "name_en"
    idx = 2 if lang == "ar" else 1
    items = "".join(item_html(sid, (nar if lang == "ar" else nen), (nar if lang == "ar" else nen), i == 0, S)
                    for i, (sid, nen, nar) in enumerate(SIGS))
    comp_preview = render_sig(SIGS[0][idx])
    picker = "".join(f'<option{" selected" if i==0 else ""}>{(nar if lang=="ar" else nen)}</option>'
                     for i, (sid, nen, nar) in enumerate(SIGS))
    return f"""<!doctype html><html dir="{S['dir']}" lang="{lang}"><head><meta charset="utf-8">
<link rel="stylesheet" href="/library/styles.css"></head>
<body style="background:var(--bg);padding:28px;max-width:900px;margin:0 auto">
  <section class="panel pf-region" style="margin-bottom:22px">
    <div class="pf-sig-mgr">
      <div class="pf-sig-head">
        <h3 class="pf-sig-h">{S['sig_h']}</h3>
        <p class="pf-region-sub">{S['mgr_sub']}</p>
      </div>
      <ul class="sig-list">{items}</ul>
      <div class="sig-add">
        <div class="field"><label class="sig-edit-l">{S['name_en']}</label><input class="input" dir="ltr" placeholder="e.g. Abdullah Thyab"></div>
        <div class="field"><label class="sig-edit-l">{S['name_ar']}</label><input class="input" dir="rtl" placeholder="مثال: عبدالله ذياب"></div>
        <button type="button" class="btn">{S['add']}</button>
      </div>
    </div>
  </section>
  <section class="panel" style="max-width:560px">
    <details class="mw-more" open>
      <summary>{S['sig_h']}</summary>
      <p class="hint">Your saved signature closes the message. The composer adds it once, above the compliance footer.</p>
      <div class="field"><label>{S['pick']}</label><select class="input">{picker}</select></div>
      <div class="field"><label>{S['preview']}</label><textarea class="input oc-body sig-preview" rows="4" readonly>{comp_preview}</textarea></div>
      <div class="bar"><a class="btn ghost sm">{S['manage']}</a></div>
      <span class="sig-loc">{S['using']} {S['lang']}</span>
    </details>
  </section>
</body></html>"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    for lang in ("en", "ar"):
        html = page(lang)
        with open(f"{OUT}/_mock-{lang}.html", "w", encoding="utf-8") as f:
            f.write(html)
        ctx = b.new_context(viewport={"width": 900, "height": 1000}, device_scale_factor=2)
        pg = ctx.new_page()
        pg.goto(f"{base}/shots/signature/_mock-{lang}.html")
        pg.wait_for_timeout(400)
        pg.screenshot(path=f"{OUT}/signature-{lang}.png", full_page=True)
        print(f"ok {lang}")
        ctx.close()
    b.close()
s.shutdown()
print("done -> " + OUT)
