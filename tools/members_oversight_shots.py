"""P27 surface gallery: the owner's oversight room (per-member windowed numbers with metric-dictionary
definitions, a sparkline trend, the operations trail, and the roster). A faithful STATIC mock on the REAL
library/styles.css using the exact classes initOversight emits (ov-member / ov-wins / ov-win / ov-cells /
ov-cell / ov-trend / ov-roster). EN and AR at THREE widths to prove no horizontal overflow, RTL clean,
Western numerals isolated in the ov-cv values. The live console boot is network-flaky in this sandbox;
members_oversight_test.js proves behaviour."""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
Hh = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
s = socketserver.TCPServer(("127.0.0.1", 0), Hh); PORT = s.server_address[1]; s.daemon_threads = True
threading.Thread(target=s.serve_forever, daemon=True).start()
from playwright.sync_api import sync_playwright
base = f"http://127.0.0.1:{PORT}"; OUT = ROOT + "/shots/members-oversight"; os.makedirs(OUT, exist_ok=True)

def spark(series):
    n = len(series); w, h, pad = 132, 30, 2; mx = max(series + [1]); dx = (w - pad * 2) / (n - 1)
    pts = " ".join(f"{round(pad + i * dx, 1)},{round(h - pad - (v / mx) * (h - pad * 2), 1)}" for i, v in enumerate(series))
    lx = pad + (n - 1) * dx; ly = h - pad - (series[-1] / mx) * (h - pad * 2)
    return (f'<svg class="spark" width="{w}" height="{h}" viewBox="0 0 {w} {h}" aria-hidden="true" preserveAspectRatio="none">'
        f'<polyline points="{pts}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>'
        f'<circle cx="{round(lx,1)}" cy="{round(ly,1)}" r="2" fill="currentColor"/></svg>')

TREND = [1, 3, 2, 3, 0, 2, 4, 3, 1, 3, 2, 3, 3, 2]

STR = {
  "en": dict(d="ltr", title="Oversight",
    sub="Per member, the operations trail and the send and communication rates, daily, weekly, monthly. Every number carries its definition from the one metric dictionary.",
    owner="Owner", member="Member", trail="Operations trail", roster="Members",
    roster_note="Roles are set in the Supabase project, never granted from a session, so this lists the roster rather than editing it.",
    daily="Today", weekly="This week", monthly="This month",
    m=["Sends", "Replies", "Reply rate", "Opens", "Pages", "Edits"],
    people=[("Thyab", "owner"), ("Agha", "member"), ("Basel", "member")],
    hist="Console history", histl="Recorded before per-member stamping began, attributed to the owner"),
  "ar": dict(d="rtl", title="الإشراف",
    sub="لكل عضو، سجل العمليات ومعدلات الإرسال والتواصل يوميًا وأسبوعيًا وشهريًا. كل رقم يحمل تعريفه من قاموس المقاييس الواحد.",
    owner="مالك", member="عضو", trail="سجل العمليات", roster="الأعضاء",
    roster_note="يحدّد المالك الأدوار في مشروع Supabase، لا من جلسة، فهذه تعرض القائمة ولا تحرّرها.",
    daily="اليوم", weekly="هذا الأسبوع", monthly="هذا الشهر",
    m=["إرسالات", "ردود", "معدل الرد", "فتحات", "صفحات", "تعديلات"],
    people=[("ثياب", "owner"), ("آغا", "member"), ("باسل", "member")],
    hist="سجل الكونسول", histl="مسجّل قبل بدء الوسم لكل عضو، منسوب إلى المالك"),
}

# per-window numeric values for the three windows (daily/weekly/monthly), per person
VALS = {
  "owner": [[3, 1, 33, 5, 1, 2], [14, 4, 28, 22, 3, 9], [51, 13, 25, 88, 11, 30]],
  "member": [[2, 0, 0, 1, 0, 1], [9, 2, 22, 12, 1, 4], [30, 6, 20, 41, 4, 12]],
}

def cell(label, v, pct=False):
    return (f'<div class="ov-cell"><span class="ov-cv"><span class="n">{v}</span>{"%" if pct else ""}</span>'
        f'<span class="ov-ck">{label}<button type="button" class="info">i</button></span></div>')

def window(S, wlab, vals):
    cells = "".join(cell(S["m"][i], vals[i], pct=(i == 2)) for i in range(6))
    return f'<div class="ov-win"><div class="ov-win-h">{wlab}</div><div class="ov-cells">{cells}</div></div>'

def member(S, name, role, own=False):
    roleTxt = S["owner"] if role == "owner" else S["member"]
    wins = window(S, S["daily"], VALS[role][0]) + window(S, S["weekly"], VALS[role][1]) + window(S, S["monthly"], VALS[role][2])
    head = (f'<header class="ov-mh"><div class="ov-mid"><h3 class="ov-mn" dir="auto">{name}</h3>'
        f'<span class="ov-role chip-st">{roleTxt}</span></div><div class="ov-trend">{spark(TREND)}</div></header>')
    trail = f'<details class="ov-trail"><summary class="ov-trail-s">{S["trail"]} <span class="ov-tl-n"><span class="n">42</span></span></summary></details>'
    return f'<section class="ov-member{" is-own" if own else ""}">{head}<div class="ov-wins">{wins}</div>{trail}</section>'

def roster(S):
    rows = ""
    for name, role in S["people"]:
        roleTxt = S["owner"] if role == "owner" else S["member"]
        rows += (f'<div class="ov-roster-row"><span class="ov-rn" dir="auto">{name}</span>'
            f'<span class="ov-re mono-iso" dir="ltr">{name.lower()}@thriveiii.com</span>'
            f'<span class="ov-rr chip-st">{roleTxt}</span></div>')
    return (f'<section class="ov-roster"><h3 class="ov-roster-h">{S["roster"]}</h3><div class="ov-roster-list">{rows}</div>'
        f'<p class="ov-roster-note">{S["roster_note"]}</p></section>')

def page(lang):
    S = STR[lang]
    panels = member(S, S["people"][0][0], "owner") + member(S, S["people"][1][0], "member")
    hist = (f'<section class="ov-hist"><h3 class="ov-hist-h">{S["hist"]}</h3>'
        f'<p class="ov-hist-line">{S["histl"]} · {S["m"][0]} <span class="n">120</span></p></section>')
    return f"""<!doctype html><html dir="{S['d']}" lang="{lang}"><head><meta charset="utf-8">
<link rel="stylesheet" href="/library/fonts.css"><link rel="stylesheet" href="/library/styles.css"></head>
<body style="background:var(--bg);margin:0;padding:24px">
  <div style="max-width:1120px;margin:0 auto">
    <div class="page-h"><h1 class="title">{S['title']}</h1></div>
    <p class="sub">{S['sub']}</p>
    <div id="ovRoom">{panels}{roster(S)}{hist}</div>
  </div>
</body></html>"""

WIDTHS = [380, 720, 1120]
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    for lang in ("en", "ar"):
        with open(f"{OUT}/_mock-{lang}.html", "w", encoding="utf-8") as f:
            f.write(page(lang))
        for w in WIDTHS:
            ctx = b.new_context(viewport={"width": w, "height": 1000}, device_scale_factor=2)
            pg = ctx.new_page()
            pg.goto(f"{base}/shots/members-oversight/_mock-{lang}.html", wait_until="load", timeout=30000); pg.wait_for_timeout(300)
            over = pg.evaluate("() => document.documentElement.scrollWidth > window.innerWidth + 1")
            pg.screenshot(path=f"{OUT}/members-oversight-{lang}-{w}.png", full_page=True)
            print(f"ok {lang} {w}  h-overflow={over}"); ctx.close()
    b.close()
s.shutdown()
print("done -> " + OUT)
