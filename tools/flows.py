"""WO-013 phase 6: one registry, no open loops.

A flow that can be entered and not left is a dead end, and the review found several. Finding them
one at a time does not last. This makes a flow with no ending impossible to ship.

Run it: python3 tools/flows.py
"""
import threading, http.server, socketserver, functools, os, sys, json, subprocess, shutil

os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"

from playwright.sync_api import sync_playwright

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

SEED = """()=>{ const now=Date.now();
 localStorage.setItem('thrive_opps_v1', JSON.stringify([
  { slug:'one', business:'One Co', published:true, up:now, contact_tier:'A',
    channel:{kind:'email', to:'a@one.example'}, outreach_text:'Hello.' }]));
}"""


def session(b, relay=None):
    ctx = b.new_context(viewport={"width": 1280, "height": 900})
    if relay: ctx.route("**/exec", relay)
    ctx.route("https://api.github.com/**", lambda x: x.abort())
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{base}/library/console.html"); pg.wait_for_timeout(400)
    if pg.query_selector("#thriveGate"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1400)
    pg.evaluate(SEED)
    pg.reload(); pg.wait_for_timeout(2800)
    return ctx, pg, errs


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx, pg, errs = session(b)

    st = pg.evaluate("()=>ThriveFlows.selfTest()")
    ck("the flow registry passes its own test", st["pass"], st.get("failures"))

    a = pg.evaluate("()=>ThriveFlows.audit()")
    ck("every multi-step interaction is in the registry", a["count"] >= 6, a)
    ck("and every one of them is complete", a["ok"], a["problems"])

    ck("a flow not in the registry does not open",
       pg.evaluate("()=>ThriveFlows.canOpen('invented').ok") is False)
    ck("and it says why",
       "not registered" in pg.evaluate("()=>ThriveFlows.canOpen('invented').why"))

    ck("every registered flow declares a back, a close and a completion",
       pg.evaluate("""()=>ThriveFlows.names().every(n=>{const f=ThriveFlows.get(n);
         return !!(f.back && f.close && f.completion);})"""))

    # ---- every action ends in one of exactly three outcomes ----------------
    ck("there are exactly three outcomes",
       pg.evaluate("()=>ThriveFlows.OUTCOMES.join(',')") == "success,failure,cancelled")
    ck("and a fourth throws rather than becoming a silent success",
       pg.evaluate("""()=>{try{ThriveFlows.result('maybe','x');return false;}catch(e){return true;}}"""))
    ck("every result carries a message",
       pg.evaluate("()=>!!ThriveFlows.result('failure','the relay did not answer').message"))

    # ---- every network call has a timeout and a stated failure -------------
    ck("a promise that never settles is rejected, with a message that names it",
       pg.evaluate("""async ()=>{
         try{ await ThriveFlows.withTimeout(new Promise(()=>{}), 120, 'the relay');
              return false; }
         catch(e){ return e.timeout===true && /the relay/.test(e.message)
                          && /timed out/.test(e.message); }}"""))
    ck("and a call that answers in time is untouched",
       pg.evaluate("""async ()=>{
         const v=await ThriveFlows.withTimeout(Promise.resolve('ok'), 1000, 'x'); return v==='ok';}"""))
    ck("a rejection with no message gains one",
       pg.evaluate("""async ()=>{
         try{ await ThriveFlows.withTimeout(Promise.reject(new Error('')), 1000, 'the relay'); return false; }
         catch(e){ return /the relay/.test(e.message); }}"""))

    # ---- the console's own calls are time boxed ----------------------------
    # A route that never answers, which is what a cold Apps Script deployment on a
    # weak network looks like from the browser's side.
    pg.route("**/stalls-forever", lambda r: None)
    ck("the console's relay helper aborts rather than hanging",
       pg.evaluate("""async ()=>{
         try{ await fetchT('/stalls-forever', {}, 300); return false; }
         catch(e){ return !!e.timeout || /abort|time/i.test(e.message||''); }}"""))

    # ---- the registry gates the one entry point ---------------------------
    pg.evaluate("()=>location.hash='#board'"); pg.wait_for_timeout(1300)
    pg.click(".tok[data-slug='one']"); pg.wait_for_timeout(1200)
    ck("a registered flow opens", pg.eval_on_selector("#modal", "e=>!e.hidden"))
    pg.keyboard.press("Escape"); pg.wait_for_timeout(800)
    if pg.query_selector("#threeWay"): pg.click("#threeWay [data-tw='2']"); pg.wait_for_timeout(600)

    broke = pg.evaluate("""async ()=>{
      const saved=ThriveFlows.FLOWS.opportunity.completion;
      ThriveFlows.FLOWS.opportunity.completion="";
      await window.thriveModal.open('one');
      const opened=!document.getElementById('modal').hidden;
      ThriveFlows.FLOWS.opportunity.completion=saved;
      return opened;}""")
    ck("and a flow whose completion is removed refuses to open", broke is False)
    pg.click(".tok[data-slug='one']"); pg.wait_for_timeout(1200)
    ck("and it opens again once the declaration is whole",
       pg.eval_on_selector("#modal", "e=>!e.hidden"))
    pg.keyboard.press("Escape"); pg.wait_for_timeout(800)
    if pg.query_selector("#threeWay"): pg.click("#threeWay [data-tw='2']"); pg.wait_for_timeout(600)

    ck("nothing threw", not errs, errs[:3])
    ctx.close()
    b.close()

httpd.shutdown()

# ---- the build gate, proven by breaking it --------------------------------
src = os.path.join(ROOT, "library", "flows.js")
bak = src + ".bak"
shutil.copy(src, bak)
try:
    with open(src, encoding="utf-8") as fh:
        s = fh.read()
    broken = s.replace('      back: "modalBack",\n      close: "modalClose",\n'
                       '      completion: "the message is sent and enters the mail ledger, or it is not",',
                       '      back: "",\n      close: "modalClose",\n'
                       '      completion: "the message is sent and enters the mail ledger, or it is not",', 1)
    ck("the harness could actually break the registry", broken != s)
    with open(src, "w", encoding="utf-8") as fh:
        fh.write(broken)
    r = subprocess.run(["node", os.path.join(ROOT, "tools", "verify.js")],
                       capture_output=True, text=True, cwd=ROOT)
    ck("removing a flow's back fails the build", r.returncode != 0, r.stdout[-400:])
    ck("and the build says which flow and what is missing",
       "compose: no back" in r.stdout, r.stdout[-400:])
finally:
    shutil.move(bak, src)

r = subprocess.run(["node", os.path.join(ROOT, "tools", "verify.js")],
                   capture_output=True, text=True, cwd=ROOT)
ck("and the build is green again once it is put back", r.returncode == 0, r.stdout[-300:])

print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
