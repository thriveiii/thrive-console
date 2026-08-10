"""The replies inbox wears Thrive's dark identity.

Engine-independent facts only (the brief's proof rule): the inbox surface computes to the dark panel
token and never to a light background; the attach select and button share one height and do not touch;
the row mirrors right-to-left in Arabic and left-to-right in English. The visual at three widths and
Arabic joined-letter rendering stay Thyab's WebKit device gate. Logic is untouched: this renders the
real inbox markup against the shipped stylesheet, no matcher or noise change."""
import threading, http.server, socketserver, functools, os, re
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:300])

# ---- source: the white-panel token is gone from the inbox surface ----
css = open(os.path.join(ROOT, "library/styles.css")).read()
inbox_rule = re.search(r'^\.board-inbox\{[^}]*\}', css, re.M)
ck("the .board-inbox rule no longer falls back to a light background (uses --panel, not var(--bg-2,#fff))",
   bool(inbox_rule) and "var(--panel)" in inbox_rule.group(0) and "#fff" not in inbox_rule.group(0), inbox_rule.group(0) if inbox_rule else None)

# The representative inbox markup renderInboxInto produces (held row + attach + collapsed noise).
INBOX_HTML = """
<section class="board-inbox" id="probeInbox">
  <div class="board-inbox-body">
    <p class="st-line"><b>Replies</b> <span class="n">18</span> held</p>
    <div class="bar"><button class="btn sm" id="probeRematch" type="button">Re-match held replies</button></div>
    <p class="st-line"><b class="st-miss">Could not match</b></p>
    <ul class="rp-held">
      <li class="rp-held-row">
        <div class="rp-held-who"><span class="mono-iso">basel.personal@gmail.com</span><span class="rp-held-subj">Re: من جد وجد</span></div>
        <div class="rp-attach">
          <select class="input sm rp-attach-sel"><option>Attach to opportunity</option></select>
          <button class="btn ghost sm rp-attach-btn" type="button">Attach</button>
        </div>
      </li>
    </ul>
    <details class="rp-noise"><summary>Automated <span class="n">39</span></summary>
      <ul class="st-keys"><li><span class="mono-iso">notifications@instagram.com</span><span>New login</span></li></ul></details>
  </div>
</section>
"""

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

def is_light(rgb):
    m = re.findall(r"\d+", rgb or "")
    if len(m) < 3: return False
    r, g, b = int(m[0]), int(m[1]), int(m[2])
    return (r + g + b) / 3 > 160   # near-white / light panel

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page(viewport={"width": 900, "height": 820})
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_selector("#gateInput", timeout=10000)   # CSS + JS loaded
    # Inject the real inbox markup against the shipped stylesheet.
    pg.evaluate("(html)=>{ const d=document.createElement('div'); d.innerHTML=html; document.body.appendChild(d.firstElementChild); }", INBOX_HTML)

    bg = pg.evaluate("()=>getComputedStyle(document.getElementById('probeInbox')).backgroundColor")
    ck("the inbox surface computes to a dark background, not a white/light panel", not is_light(bg), bg)
    ck("the inbox background is the console panel token (#111116 = rgb(17,17,22))",
       [int(x) for x in re.findall(r'\d+', bg)[:3]] == [17, 17, 22], bg)

    # No child of the inbox carries a light background (row, noise, select).
    lights = pg.evaluate("""()=>{
      const root=document.getElementById('probeInbox');
      const out=[];
      root.querySelectorAll('.board-inbox-body,.rp-held-row,.rp-noise,.rp-attach-sel,.st-keys,ul,li,details,summary').forEach(el=>{
        const c=getComputedStyle(el).backgroundColor; const m=(c.match(/\\d+/g)||[]).map(Number);
        if(m.length>=3 && m[3]!==0 && (m[0]+m[1]+m[2])/3>160) out.push(el.className+':'+c);
      });
      return out;
    }""")
    ck("no element inside the inbox carries a light background (rows, noise group, select)", len(lights)==0, lights)

    # The attach select and button share one height and do not overlap (one gap between them).
    geo = pg.evaluate("""()=>{
      const s=document.querySelector('#probeInbox .rp-attach-sel').getBoundingClientRect();
      const btn=document.querySelector('#probeInbox .rp-attach-btn').getBoundingClientRect();
      return { sh:Math.round(s.height), bh:Math.round(btn.height), gap:Math.round(Math.min(Math.abs(btn.left-s.right), Math.abs(s.left-btn.right))) };
    }""")
    ck("the attach select and button share one height and do not touch (a real gap between them)",
       geo["sh"]==geo["bh"] and geo["gap"]>=4, geo)

    # RTL mirrors the row: who on the start, attach on the end, in each direction.
    def who_vs_attach():
        return pg.evaluate("""()=>{
          const who=document.querySelector('#probeInbox .rp-held-who').getBoundingClientRect();
          const att=document.querySelector('#probeInbox .rp-attach').getBoundingClientRect();
          return { whoLeft:Math.round(who.left), attLeft:Math.round(att.left) };
        }""")
    pg.evaluate("()=>document.documentElement.setAttribute('dir','ltr')")
    ltr = who_vs_attach()
    pg.evaluate("()=>document.documentElement.setAttribute('dir','rtl')")
    rtl = who_vs_attach()
    ck("English reads left-to-right (who on the left, attach on the right)", ltr["whoLeft"] < ltr["attLeft"], ltr)
    ck("Arabic mirrors it right-to-left (who on the right, attach on the left)", rtl["whoLeft"] > rtl["attLeft"], rtl)
    ck("the inbox direction follows the app in Arabic (rtl)",
       pg.evaluate("()=>getComputedStyle(document.getElementById('probeInbox')).direction")=="rtl")

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL DARK-INBOX CHECKS PASS"))
raise SystemExit(1 if fails else 0)
