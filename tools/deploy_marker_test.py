"""Deploy truth: a build marker on the gate, and a deterministic bundle.

The live site looked stale because merge is not deploy and nothing on the device said which code it
was serving. bundle.js now stamps a content-signature build id into meta[name=thrive-build], and the
gate prints it on both steps (passcode and operator), before sign-in, so a deploy is verifiable at a
glance on the device. This proves: the marker renders and equals the stamped meta; it survives into
the operator step; the id is a real hex signature; and re-bundling is byte-for-byte identical EXCEPT the
build-time stamp (the one intentional deploy-time value the fresh-code brief adds), so nothing else in
the shipped shell churns between re-bundles."""
import threading, http.server, socketserver, functools, os, subprocess, hashlib, re
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
PASSCODE = "ConThrive2030"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:300])

# ---- determinism: the content signature never churns; only the deploy-time stamp does. ----
# Mask the one intentionally non-deterministic value (the build time) so the guard still proves that
# nothing ELSE in the shell changes between re-bundles.
def masked_sha(p):
    s = open(p, encoding="utf-8").read()
    s = re.sub(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', 'BUILT_AT', s)
    return hashlib.sha256(s.encode("utf-8")).hexdigest()
before = masked_sha(os.path.join(ROOT, "library/console.html"))
meta_before = re.search(r'name="thrive-build" content="([0-9a-f]+)"', open(os.path.join(ROOT, "library/console.html")).read()).group(1)
subprocess.run(["node", "tools/bundle.js"], cwd=ROOT, check=True, capture_output=True)
after = masked_sha(os.path.join(ROOT, "library/console.html"))
meta_after = re.search(r'name="thrive-build" content="([0-9a-f]+)"', open(os.path.join(ROOT, "library/console.html")).read()).group(1)
ck("re-running the bundle is byte-identical except the build-time stamp (the content signature never churns)", before == after, before[:12] + " vs " + after[:12])
ck("the stamped build id is a stable 8-hex signature, unchanged across bundles", meta_before == meta_after and re.fullmatch(r"[0-9a-f]{8}", meta_before) is not None, meta_before)

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

# Configure Supabase so the operator step exists after the passcode (gate two), and answer sign-in.
INIT = r"""
(() => {
  try { localStorage.setItem('console_sb_url','https://fake.supabase.co'); localStorage.setItem('console_sb_anon','anon-key'); } catch(e){}
  const real = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = async (url, opts) => {
    const body=(opts&&opts.body)?JSON.parse(opts.body):null;
    if (typeof url==='string' && url.indexOf('/auth/v1/token')>=0 && url.indexOf('grant_type=password')>=0) {
      if (body.email==='op@thrive.co' && body.password==='right')
        return new Response(JSON.stringify({access_token:'jwt-x', refresh_token:'r', expires_at:9999999999, user:{id:'uid-1'}}), {status:200, headers:{'Content-Type':'application/json'}});
      return new Response(JSON.stringify({error_description:'bad'}), {status:400, headers:{'Content-Type':'application/json'}});
    }
    if (typeof url==='string' && url.indexOf('/rest/v1/')>=0) return new Response('[]',{status:200,headers:{'Content-Type':'application/json'}});
    return real?real(url,opts):new Response('',{status:200});
  };
})()
"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page()
    pg.add_init_script(INIT)
    pg.goto(f"{base}/library/console.html"); pg.wait_for_timeout(300)

    # The meta the page actually served, and the marker the gate rendered on the passcode step.
    pg.wait_for_selector("#gateInput", timeout=10000)
    meta = pg.evaluate("()=>{var m=document.querySelector('meta[name=\"thrive-build\"]');return m&&m.getAttribute('content');}")
    ck("the served page carries the build meta equal to the bundle's stamp", meta == meta_after, meta)
    mark = pg.evaluate("()=>{var e=document.querySelector('#thriveGate .gate-build');return e?e.textContent.trim():null;}")
    ck("the passcode step prints a visible build marker", bool(mark) and meta in mark, mark)
    ck("the marker is the build label plus the id (no empty label, hex only)",
       bool(mark) and mark.startswith("Build ") and re.search(r"[0-9a-f]{8}", mark) is not None, mark)

    # Into the operator step (gate two): the marker stays, same id, before any sign-in.
    pg.fill("#gateInput", PASSCODE); pg.click(".gate-btn")
    pg.wait_for_selector("#gateEmail", timeout=10000)
    mark2 = pg.evaluate("()=>{var e=document.querySelector('#thriveGate .gate-build');return e?e.textContent.trim():null;}")
    ck("the operator step also prints the marker, same id", bool(mark2) and meta in mark2, mark2)

    # Arabic: the label localizes and the id sits in an isolated run (bdi), so RTL cannot reorder it.
    # Clear the passcode session first so the reload lands back on the passcode step (unlocking above
    # set it), then switch to Arabic.
    # Clearing the passcode now means clearing the 30-minute presence too (session lifecycle), else the
    # device stays unlocked and the passcode step never returns.
    pg.evaluate("""()=>{try{sessionStorage.clear();localStorage.removeItem('thrive_presence');localStorage.setItem('thrive_lang','ar');}catch(e){}}""")
    pg.reload(); pg.wait_for_timeout(300)
    pg.wait_for_selector("#gateInput", timeout=10000)
    ar = pg.evaluate("""()=>{var e=document.querySelector('#thriveGate .gate-build');
      return e?{txt:e.textContent.trim(), bdi:!!e.querySelector('bdi')}:null;}""")
    ck("Arabic gate localizes the build label and isolates the id in a bdi run",
       bool(ar) and ("الإصدار" in ar["txt"]) and (meta in ar["txt"]) and ar["bdi"], ar)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL DEPLOY-MARKER CHECKS PASS"))
raise SystemExit(1 if fails else 0)
