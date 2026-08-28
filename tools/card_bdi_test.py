"""CARD_BDI (browser + source, fails-when-broken).

The Arabic card summary line ("N إرسال  ·  N فتح  ·  N يوم خمول") mixes a Western number with an Arabic
word per bit. Without isolation the digit runs and the middot separators reorder in RTL. This locks the
fix: cardHtml wraps EACH number+word bit in its own <bdi>, with the "·" separators OUTSIDE the bdi, so
every count isolates and the number+Arabic order is correct in both directions. Digits stay Western
(B3: the idle bit is spaced consistently, "14 يوم خمول" / "14 days idle").

The board.html render harness is the same mocked GoTrue + console_board path as standalone_board_test:
one seeded row with sends, opens and idle days produces a three-bit summary line, asserted in the DOM.
Synthetic rows only.
"""
import os, json, threading, http.server, socketserver, functools, re
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

board = open(os.path.join(ROOT, "library/board.html")).read()

# ---- source guard: cardHtml isolates each bit in a <bdi>, separators outside -----------------------
ck("cardHtml maps each summary bit into its own <bdi> (separators stay outside the bdi)",
   "bits.map(function(bt){ return '<bdi>' + esc(bt) + '</bdi>'; })" in board, )
ck("the idle bit is composed with an explicit space (B3), like sends and opens",
   'row.idle_days + " " + t("b_idle")' in board)
ck("the Arabic idle label carries no leading space (B3), and English reads 'days idle'",
   'b_idle:"يوم خمول"' in board and 'b_idle:"days idle"' in board)

# One seeded row with all three signals present -> a three-bit summary line.
ROWS = [
  {"slug":"gamm","business":"Gamma Inc","stage":"sent","sent_count":3,"open_count":2,"replied":False,
   "idle_days":14,"last_activity_ts":"2026-08-01T00:00:00Z","has_page":True,"has_email":True,"archived":False},
]

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
handler = functools.partial(Handler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

def probe_summary(pg):
    return pg.evaluate("""()=>{
      var s = document.querySelector('.card .s');
      if(!s) return { found:false };
      var bdis = Array.prototype.map.call(s.querySelectorAll('bdi'), function(b){ return b.textContent; });
      // separator text lives in the element OUTSIDE any <bdi> (direct child text nodes)
      var outside = Array.prototype.filter.call(s.childNodes, function(n){ return n.nodeType===3; })
                        .map(function(n){ return n.textContent; }).join('');
      return { found:true, html:s.innerHTML, text:s.textContent, bdis:bdis, outside:outside };
    }""")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context()
    # Arabic chrome language before first paint (the board reads thrive_lang to set dir=rtl and the dict).
    ctx.add_init_script("try{ localStorage.setItem('thrive_lang','ar'); }catch(e){}")
    pg = ctx.new_page()

    pg.route("**/auth/v1/token**", lambda r: r.fulfill(status=200, headers={"content-type":"application/json"},
             body=json.dumps({"access_token":"T","refresh_token":"R","expires_at":9999999999,"user":{"id":"u1"}})))
    pg.route("**/rest/v1/console_board**", lambda r: r.fulfill(status=200, headers={"content-type":"application/json"}, body=json.dumps(ROWS)))
    pg.route("**/rest/v1/console_inbound**", lambda r: r.fulfill(status=200, headers={"content-type":"application/json"}, body="[]"))

    pg.goto(f"{base}/library/board.html", wait_until="load")
    pg.wait_for_timeout(200)
    ck("the board rendered in Arabic (dir=rtl)", pg.evaluate("()=>document.documentElement.getAttribute('dir')")=="rtl")
    pg.fill("#em", "op@thrive.test"); pg.fill("#pw", "correct horse"); pg.click("#go")
    pg.wait_for_selector(".card .s", timeout=8000)

    r = probe_summary(pg)
    ck("the summary line rendered", r.get("found"), r)
    # three bits: sends, opens, idle -- each wrapped in its own <bdi>
    ck("each of the three counts renders inside its own <bdi>", len(r.get("bdis", []))==3, r.get("html"))
    # every bit is number + Arabic word, starting with a Western digit
    ok_bits = all(re.match(r'^\s*\d', x) and re.search(r'[؀-ۿ]', x) for x in r.get("bdis", []))
    ck("each <bdi> holds a Western number followed by its Arabic word", ok_bits, r.get("bdis"))
    # the idle bit reads "14 يوم خمول" (spaced, Western digits) somewhere in the line
    ck("the idle bit reads '14 يوم خمول' (spaced, Western numerals)",
       any("14 يوم خمول" == x.strip() for x in r.get("bdis", [])), r.get("bdis"))
    # the middot separators live OUTSIDE the <bdi> elements
    ck("the '·' separators sit outside the <bdi> isolates", "·" in r.get("outside",""), r.get("outside"))
    ck("no Arabic-Indic digits leaked in (numerals stay Western)",
       not re.search(r'[٠-٩۰-۹]', r.get("text","")), r.get("text"))

    ctx.close()
    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL CARD-BDI CHECKS PASS"))
raise SystemExit(1 if fails else 0)
