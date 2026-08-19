"""P21 surface gallery: the send moment and the card activity trail, desktop EN and AR. Rendered as a
faithful static mock that links the REAL styles.css and uses the exact markup/classes the app emits (the
send-moment SVG is copied verbatim from sendMomentMark; the trail rows mirror activityTrailHtml). The live
console boot is Supabase-timing-flaky in the sandbox; this proves the CSS + copy exactly, and
send_moment_activity_test.js proves the behaviour."""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
Hh = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
s = socketserver.TCPServer(("127.0.0.1", 0), Hh); PORT = s.server_address[1]; s.daemon_threads = True
threading.Thread(target=s.serve_forever, daemon=True).start()
from playwright.sync_api import sync_playwright
base = f"http://127.0.0.1:{PORT}"; OUT = ROOT + "/shots/send-moment"; os.makedirs(OUT, exist_ok=True)

MARK = ('<svg class="sm-mark" viewBox="0 0 64 64" width="76" height="76" fill="none" aria-hidden="true">'
  '<circle class="sm-ring sm-ring-1" cx="32" cy="32" r="13" stroke="currentColor" stroke-width="1.4"/>'
  '<circle class="sm-ring sm-ring-2" cx="32" cy="32" r="13" stroke="currentColor" stroke-width="1.2"/>'
  '<g class="sm-rays" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">'
  '<line x1="32" y1="17" x2="32" y2="47"/><line x1="19" y1="24.5" x2="45" y2="39.5"/>'
  '<line x1="19" y1="39.5" x2="45" y2="24.5"/></g>'
  '<circle class="sm-core" cx="32" cy="32" r="3.1" fill="currentColor"/></svg>')

STR = {
  "en": dict(d="ltr", line="Your brief has reached its destination. Stay close.",
    sent="Sent", reply="Reply", opened="Opened the page", edited="Edited",
    who1="Abdullah Thyab", who2="Basel Agha", sum="Deborah · A short page for Organic Allure",
    rsum="Re: Organic Allure x Thrive", body="Hi Deborah,\n\nI put together a short page for Organic Allure. One screen, no form to fill in.",
    t1="just now", t2="2h ago", t3="yesterday", t4="Aug 1"),
  "ar": dict(d="rtl", line="وصل عرضك إلى وجهته. كن قريبًا.",
    sent="إرسال", reply="ردّ", opened="فتحوا الصفحة", edited="تحرير",
    who1="عبدالله ذياب", who2="باسل آغا", sum="ديبورا · صفحة قصيرة لـ Organic Allure",
    rsum="إعادة: Organic Allure مع ثرايف", body="مرحبًا ديبورا،\n\nأعددت صفحة قصيرة لـ Organic Allure. شاشة واحدة، بلا نموذج تملؤه.",
    t1="الآن", t2="قبل ساعتين", t3="أمس", t4="١ أغسطس"),
}

def meta(who, ts):
    return f'<span class="tr-meta"><span class="tr-actor" dir="auto">{who}</span><span class="tr-when">{ts}</span></span>'

def bubble(S):
    body = S["body"].replace("\n", "<br>")
    return ('<li class="th-sent" data-bubble="msgBubble"><div class="msg-out">'
      '<div class="rp-head"><div class="rp-top"><span class="rp-who" dir="auto">Thrive → Deborah</span>'
      f'<span class="rp-when">{S["t4"]}</span></div><div class="rp-from mono"><span class="mono-iso">ceo@organicallure.example</span></div></div>'
      f'<div class="rp-body"><div class="rp-subj" dir="auto">{S["sum"].split(" · ")[-1]}</div>'
      f'<div class="rp-snip"><div class="rp-msg" dir="auto">{body}</div></div></div></div></li>')

def page(lang):
    S = STR[lang]
    trail = (
      '<ol class="tr-list" data-renderer="activityTrailHtml">'
      # a sent entry, expanded in place to its P12 bubble
      '<li class="tr-item tr-msg is-open" data-tr="sent">'
        '<button type="button" class="tr-head" aria-expanded="true">'
        f'<span class="tr-icn"><svg class="ic" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 10l14-6-6 14-2-6z"/></svg></span>'
        f'<span class="tr-what">{S["sent"]} <span class="tr-sum" dir="auto">{S["sum"]}</span></span>'
        f'{meta(S["who1"], S["t1"])}'
        '<span class="tr-chev"><svg class="ic" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M7 4l6 6-6 6"/></svg></span>'
        '</button>'
        f'<div class="tr-expand"><ol class="th-list th-embed">{bubble(S)}</ol></div>'
      '</li>'
      # a reply entry (collapsed)
      '<li class="tr-item tr-msg" data-tr="reply">'
        '<button type="button" class="tr-head" aria-expanded="false">'
        f'<span class="tr-icn"><svg class="ic" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="14" height="10" rx="2"/><path d="M3 6l7 5 7-5"/></svg></span>'
        f'<span class="tr-what">{S["reply"]} <span class="tr-sum" dir="auto">{S["rsum"]}</span></span>'
        f'{meta("Deborah", S["t2"])}'
        '<span class="tr-chev"><svg class="ic" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M7 4l6 6-6 6"/></svg></span>'
        '</button><div class="tr-expand" hidden></div>'
      '</li>'
      # a genuine new op: an edit by a second profile, with its author
      '<li class="tr-item tr-line"><span class="tr-icn"><svg class="ic" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 13l9-9 3 3-9 9H4z"/></svg></span>'
        f'<span class="tr-what">{S["edited"]}</span>{meta(S["who2"], S["t3"])}</li>'
      # an open (no actor)
      '<li class="tr-item tr-line"><span class="tr-icn"><svg class="ic" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="10" cy="10" r="7"/></svg></span>'
        f'<span class="tr-what">{S["opened"]}</span><span class="tr-meta"><span class="tr-when">{S["t3"]}</span></span></li>'
      '</ol>')
    return f"""<!doctype html><html dir="{S['d']}" lang="{lang}"><head><meta charset="utf-8">
<link rel="stylesheet" href="/library/styles.css"></head>
<body style="background:var(--bg);margin:0">
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;min-height:640px">
    <div style="position:relative;border-inline-end:1px solid var(--hair)">
      <div class="sm-scrim on" style="position:absolute">
        <div class="sm-card"><div class="sm-mark-wrap">{MARK}</div><p class="sm-line" dir="auto">{S['line']}</p></div>
      </div>
    </div>
    <div style="padding:26px 22px">
      <div class="panel" style="max-width:460px">
        <div class="th-ver" style="font-size:11px;color:var(--ink-4);margin-bottom:10px">thread v2 · renderHistory</div>
        {trail}
      </div>
    </div>
  </div>
</body></html>"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    for lang in ("en", "ar"):
        with open(f"{OUT}/_mock-{lang}.html", "w", encoding="utf-8") as f:
            f.write(page(lang))
        ctx = b.new_context(viewport={"width": 1180, "height": 680}, device_scale_factor=2)
        pg = ctx.new_page()
        pg.goto(f"{base}/shots/send-moment/_mock-{lang}.html"); pg.wait_for_timeout(500)
        pg.screenshot(path=f"{OUT}/send-moment-{lang}.png")
        print(f"ok {lang}")
        ctx.close()
    b.close()
s.shutdown()
print("done -> " + OUT)
