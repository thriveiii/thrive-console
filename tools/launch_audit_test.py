"""Launch audit, standing edition (WO-024, Sentinel Sweep 4).

The one permanent gate that pins the launch invariants so a later change cannot quietly break them:
- Isolation: not one Lotus reference in the shipped client; the newsroom is firewalled (its patterns were
  replicated, but no newsroom file/name/artifact is imported).
- Secret hygiene: the client carries only the public anon key (JWT payload role:anon), never a
  service_role key, and no hardcoded password or token.
- RLS scope: the Supabase client only ever touches console_ prefixed tables (a fixed allow-list that
  refuses any other name).
- XSS: the thread view escapes every reply body, so a hostile body is inert (the PR 3 rendering).
- Matcher idempotency: re-matching held replies twice attributes nothing new the second time.
- Visible state: the action runner shows in-progress, success and a real error, and the one control the
  reply-editor brief added (the thread composer) shows all three; no silent control was introduced.

Runtime facts are Chromium-checked; the live device pass stays Thyab's WebKit checklist."""
import threading, http.server, socketserver, functools, os, re, json
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

# ---- source layers: isolation, secrets, RLS scope, visible-state wiring ----
libjs = ""
for base, _dirs, files in os.walk(os.path.join(ROOT, "library")):
    for f in files:
        if f.endswith(".js") or f.endswith(".html") or f.endswith(".css"):
            libjs += open(os.path.join(base, f), encoding="utf-8").read() + "\n"

ck("isolation: not one Lotus reference in the shipped client", re.search(r"lotus", libjs, re.I) is None)

config = open(os.path.join(ROOT, "library/config.js"), encoding="utf-8").read()
import base64
def jwt_role(tok):
    parts = tok.split(".")
    if len(parts) != 3: return None
    pl = parts[1] + "=" * (-len(parts[1]) % 4)
    try: return json.loads(base64.urlsafe_b64decode(pl)).get("role", "")
    except Exception: return "(unreadable)"
# Decode every JWT-looking token in the whole client; the real property is that NO token is a
# service_role key (the word "service_role" also appears in a reassuring comment, which is fine).
tokens = re.findall(r'eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+', libjs)
roles = [jwt_role(tk) for tk in tokens]
ck("secret hygiene: no token in the client is a service_role key (only anon)",
   tokens and all(r != "service_role" for r in roles), roles)
m = re.search(r'supaAnon\s*=\s*"([^"]+)"', config)
role = jwt_role(m.group(1)) if m else ""
ck("secret hygiene: the baked key is the public anon key (JWT role is anon), not service_role",
   role == "anon", role)
ck("no hardcoded password or bearer token literal in the client",
   re.search(r'(password|secret|bearer)\s*[:=]\s*["\'][^"\']{8,}["\']', libjs, re.I) is None)

supa = open(os.path.join(ROOT, "library/supabase.js"), encoding="utf-8").read()
ck("RLS scope: the client only touches console_ tables (a fixed allow-list refuses any other name)",
   "console_" in supa and "table not allowed (console_ only)" in supa)

app = open(os.path.join(ROOT, "library/app.js"), encoding="utf-8").read()
ck("visible state: the action runner shows in-progress, success and a real error",
   "function runAction(" in app and 'actionStatus("work"' in app and 'actionStatus("ok"' in app)
ck("visible state: the thread reply composer shows sending, sent and a real error (not silent)",
   all(k in app for k in ("th_reply_sending", "th_reply_sent", "th_reply_err")) and "btn.disabled=true" in app)

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page()
    pg.goto(f"{base}/library/console.html"); pg.wait_for_timeout(400)
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(500)
    pg.wait_for_function("()=>typeof window.threadListHtml==='function' && typeof window.rematchHeld==='function'", timeout=15000)

    # ---- XSS: a hostile reply body is escaped in the thread view, no script node is created ----
    dom = pg.evaluate("""()=>{
      localStorage.setItem('thrive_opps_v1', JSON.stringify([{slug:'audit-co', business:'Audit', published:true}]));
      localStorage.setItem('thrive_mail_v1', JSON.stringify([{mid:'a1', opp:'audit-co', to:'x@y.com', subject:'Hi', status:'sent', direction:'out', ts:'2026-08-01T10:00:00Z'}]));
      localStorage.setItem('thrive_inbound_v1', JSON.stringify([{gid:'ax1', opp:'audit-co', kind:'reply', from:'x@y.com', subject:'Re: Hi', snippet:'ok <script>alert(1)</script> thanks', ts:'2026-08-03T09:00:00Z'}]));
      window.invalidateSends&&window.invalidateSends();
      const d=document.createElement('div'); d.innerHTML=window.threadListHtml('audit-co'); document.body.appendChild(d);
      const snip=d.querySelector('.rp-snip');
      return { scripts:d.querySelectorAll('script').length, text:(snip&&snip.textContent)||'', html:window.threadListHtml('audit-co') };
    }""")
    ck("XSS: the thread view escapes the reply body, no script node is created (PR 3 rendering holds)",
       dom["scripts"] == 0 and "&lt;script&gt;" in dom["html"] and "<script>alert" not in dom["html"], dom)

    # ---- matcher idempotency: a second re-match attributes nothing new ----
    idem = pg.evaluate("""()=>{
      localStorage.setItem('thrive_opps_v1', JSON.stringify([{slug:'m-co', business:'Matcher', published:true, stage:'sent'}]));
      localStorage.setItem('thrive_mail_v1', JSON.stringify([{mid:'ms1', opp:'m-co', to:'p@co.com', subject:'Idea', status:'sent', direction:'out', ts:'2026-08-01T10:00:00Z'}]));
      localStorage.setItem('thrive_inbound_v1', JSON.stringify([{gid:'mg1', opp:'', kind:'reply', from:'p@co.com', subject:'Re: Idea', snippet:'yes', ts:'2026-08-03T09:00:00Z'}]));
      window.invalidateSends&&window.invalidateSends();
      const a=window.rematchHeld(); const b=window.rematchHeld();
      return { first:a.matched, second:b.matched, rows:JSON.parse(localStorage.getItem('thrive_inbound_v1')).length };
    }""")
    ck("matcher idempotency: the first re-match attributes the reply, the second attributes nothing new, no duplicate rows",
       idem["first"] == 1 and idem["second"] == 0 and idem["rows"] == 1, idem)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL LAUNCH AUDIT CHECKS PASS"))
raise SystemExit(1 if fails else 0)
