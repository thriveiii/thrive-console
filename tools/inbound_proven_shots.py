"""P22 surface gallery: the join basis on a reply (deterministic inline vs heuristic tap-open) and the board
inbound-health badges (quiet delayed, loud backlog). A faithful static mock linking the REAL styles.css and
using the exact classes the app emits (replyBasisHtml / inboundHealthBadge). The live console boot is
Supabase-timing-flaky in the sandbox; this proves the CSS + copy, and inbound_health_test.py proves behaviour."""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
Hh = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
s = socketserver.TCPServer(("127.0.0.1", 0), Hh); PORT = s.server_address[1]; s.daemon_threads = True
threading.Thread(target=s.serve_forever, daemon=True).start()
from playwright.sync_api import sync_playwright
base = f"http://127.0.0.1:{PORT}"; OUT = ROOT + "/shots/inbound-proven"; os.makedirs(OUT, exist_ok=True)

CHK = '<svg class="ic" width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 10l4 4 8-9"/></svg>'
ALERT = '<svg class="ic" width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M10 3l8 14H2z"/><path d="M10 8v4M10 15v.5"/></svg>'
CLK = '<svg class="ic" width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="10" cy="10" r="7"/><path d="M10 6v4l3 2"/></svg>'

STR = {
  "en": dict(d="ltr", sub="A short page for Organic Allure", body="Hi Deborah,\n\nThank you, this looks right. Let's talk Sunday.",
    det="reply-to address", heur="sender address",
    why="A best guess, not certain. It joins by the sender or the subject, which a different message could share.",
    delay="inbound delayed", gap="2 replies not filed", certain="Certain", guess="Best guess",
    h_basis="How each reply was joined", h_board="Silence, made visible on the board"),
  "ar": dict(d="rtl", sub="صفحة قصيرة لـ Organic Allure", body="مرحبًا ديبورا،\n\nشكرًا لك، هذا يبدو صحيحًا. لنتحدث الأحد.",
    det="عنوان الرد", heur="عنوان المرسِل",
    why="تخمين مرجَّح، وليس مؤكَّدًا. يربط بالمرسِل أو الموضوع، وقد تشترك رسالة أخرى في أيّهما.",
    delay="الوارد متأخّر", gap="2 ردّ لم يُدرَج", certain="مؤكَّد", guess="تخمين",
    h_basis="كيف رُبط كل ردّ", h_board="الصمت، ظاهرًا على اللوحة"),
}

def bubble(S, basis_html):
    body = S["body"].replace("\n", "<br>")
    return ('<li class="th-sent" data-bubble="msgBubble"><div class="msg-out">'
      '<div class="rp-head"><div class="rp-top"><span class="rp-who" dir="auto">Deborah → Thrive</span>'
      '<span class="rp-when">just now</span></div></div>'
      f'<div class="rp-body"><div class="rp-subj" dir="auto">{S["sub"]}</div>'
      f'<div class="rp-snip"><div class="rp-msg" dir="auto">{body}</div></div>'
      f'<div class="rp-foot">{basis_html}</div></div></div></li>')

def page(lang):
    S = STR[lang]
    det = f'<span class="rp-basis is-det" title="{S["certain"]}">{CHK}<span>{S["det"]}</span></span>'
    heur = (f'<details class="rp-basis is-heur" open><summary>{ALERT}<span>{S["heur"]}</span></summary>'
            f'<span class="rp-basis-why" dir="auto">{S["why"]}</span></details>')
    thread = f'<ol class="th-list">{bubble(S, det)}{bubble(S, heur)}</ol>'
    board = ('<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'
      '<span class="pill ok">synced just now</span>'
      f'<span class="pill inbound-delay">{CLK} {S["delay"]}</span>'
      f'<span class="pill inbound-gap">{ALERT} {S["gap"]}</span></div>')
    return f"""<!doctype html><html dir="{S['d']}" lang="{lang}"><head><meta charset="utf-8">
<link rel="stylesheet" href="/library/styles.css"></head>
<body style="background:var(--bg);margin:0;padding:26px">
  <div style="max-width:520px;margin:0 auto;display:grid;gap:22px">
    <div><div class="th-ver" style="font-size:11px;color:var(--ink-4);margin-bottom:8px">{S['h_basis']}</div>{thread}</div>
    <div><div class="th-ver" style="font-size:11px;color:var(--ink-4);margin-bottom:8px">{S['h_board']}</div>{board}</div>
  </div>
</body></html>"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    for lang in ("en", "ar"):
        with open(f"{OUT}/_mock-{lang}.html", "w", encoding="utf-8") as f:
            f.write(page(lang))
        ctx = b.new_context(viewport={"width": 780, "height": 720}, device_scale_factor=2)
        pg = ctx.new_page()
        pg.goto(f"{base}/shots/inbound-proven/_mock-{lang}.html"); pg.wait_for_timeout(500)
        pg.screenshot(path=f"{OUT}/inbound-proven-{lang}.png", full_page=True)
        print(f"ok {lang}"); ctx.close()
    b.close()
s.shutdown()
print("done -> " + OUT)
