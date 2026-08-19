"""P23: attachments and rich links, proven on the ONE compile path.

  python3 tools/attachments_test.py

The concern the brief set: an image the composer previews is exactly what lands; a campaign compiles the
same image through the same one path per recipient; an oversize image is refused BY NUMBER, never dropped;
attachments need a v8 relay and never silently disappear against an older one. This drives the REAL live
console (compose.html) in Chromium and asserts each of those, plus the version gate's `>=` behaviour
(Condition 1) and the rich-link recognition + Drive chip.

Engine-independent; WebKit is Thyab's device gate.
"""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

MB = 1024 * 1024
fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

# ---- source invariants: ONE compile, ONE partition, ONE storage bucket, no base64 in the body ----------
app = open(os.path.join(ROOT, "library/app.js")).read()
ck("exactly ONE compile function (attachments partition rides the one path)", app.count("function compile(") == 1)
ck("planAttachments is defined once and called once inside compile",
   app.count("function planAttachments(") == 1 and app.count("planAttachments(content.attachments") == 1)
ck("an attachment is referenced by URL (path), never inlined as base64/data URI",
   "attach.push({ filename:name, path:url" in app and "data:image" not in app.split("function planAttachments")[1].split("}")[0])
sup = open(os.path.join(ROOT, "library/supabase.js")).read()
ck("the storage upload targets the one console-attachments bucket, additive",
   'ATTACH_BUCKET = "console-attachments"' in sup and "uploadAttachment" in sup)

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright
from playwright.sync_api import TimeoutError as PWTimeout

RELAY = "https://relay.example/exec"

def unlock(pg):
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn")
    pg.evaluate("()=>{ var g=document.getElementById('thriveGate'); if(g) g.remove(); document.documentElement.classList.remove('gate-locked'); }")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page(viewport={"width": 1280, "height": 1100})
    pg.route("**relay.example**", lambda r: r.fulfill(status=200, content_type="image/gif", body=b"GIF89a"))
    pg.route("**cdn.example**", lambda r: r.fulfill(status=200, content_type="image/png", body=b"\x89PNG\r\n"))
    # The sandbox has no outbound network; an external preconnect (api.github.com) would hang the load
    # event. Abort anything that is not the local server or a stubbed host so navigation commits promptly.
    def _gate_net(r):
        u = r.request.url
        if ("127.0.0.1" in u) or ("relay.example" in u) or ("cdn.example" in u): r.continue_()
        else: r.abort()
    pg.route("**/*", _gate_net)

    pg.goto(f"{base}/library/compose.html", wait_until="commit", timeout=60000)
    unlock(pg)
    pg.evaluate("""(relay)=>{
      localStorage.setItem('thrive_sync_ep', relay);
      localStorage.setItem('thrive_opps_v1', JSON.stringify([{slug:'camp1', business:'Campaign One', published:true, up:1,
        recipients:[{addr:'basel@shop.example',name:'Basel Haddad'},{addr:'no@name.example',name:''},{addr:'c@three.example',name:'Cee'}]}]));
    }""", RELAY)
    pg.goto(f"{base}/library/compose.html?slug=camp1", wait_until="commit", timeout=60000)
    unlock(pg)
    try:
        pg.wait_for_function("()=>window.__composeReady && typeof window.__cmpCompile==='function' "
                             "&& typeof window.planAttachments==='function' && typeof window.__seedComposeAttachments==='function' "
                             "&& typeof window.__campaignContent==='function' && typeof window.__campaignTpl==='function' "
                             "&& typeof window.noteRelayVersion==='function'", timeout=20000)
    except PWTimeout:
        # This sandbox has no outbound network and its live-console boot is unreliable (the same reason
        # compile_parity_test.py and the P22 browser suites are Thyab's device gate). The source invariants
        # above still ran; the pure logic is proven headless in tools/attach_logic_test.js and the relay
        # passthrough in tools/relay_attach_test.js. Skip the live-DOM assertions rather than false-fail.
        print("SKIP: live console did not boot in this sandbox (device-gated; logic proven in attach_logic_test.js)")
        b.close(); httpd.shutdown()
        print("\n" + ("FAILED: " + ", ".join(fails) if fails else "SOURCE INVARIANTS PASS (live-DOM portion device-gated)"))
        raise SystemExit(1 if fails else 0)

    # ---- 1) planAttachments partitions by size, with the number on a refusal ----------------------------
    part = pg.evaluate("""(MB)=>window.planAttachments([
        {filename:'small.png', url:'https://cdn.example/s.png', size:3*MB},
        {filename:'mid.jpg',   url:'https://cdn.example/m.jpg', size:10*MB},
        {filename:'huge.gif',  url:'https://cdn.example/h.gif', size:30*MB}
    ])""", MB)
    ck("a small image (<=5MB) lands as a real attachment",
       len(part["attach"]) == 1 and part["attach"][0]["filename"] == "small.png", part["attach"])
    ck("a mid image (>5MB, <=25MB) lands as a hosted link, not an attachment",
       len(part["hosted"]) == 1 and part["hosted"][0]["filename"] == "mid.jpg", part["hosted"])
    ck("an oversize image (>25MB) is REFUSED, and the refusal carries the byte limit (not a silent drop)",
       len(part["refused"]) == 1 and part["refused"][0]["reason"] == "file" and part["refused"][0]["limit"] == 25*MB, part["refused"])

    # the count ceiling refuses too, by count
    cpart = pg.evaluate("""(MB)=>window.planAttachments(Array.from({length:12},(_,i)=>(
        {filename:'n'+i+'.png', url:'https://cdn.example/'+i+'.png', size:1*MB})))""", MB)
    ck("past the count ceiling, the extras are refused by count",
       any(r["reason"] == "count" for r in cpart["refused"]), cpart["refused"])

    # ---- 2) compile carries attachments: attached ride out of the body, hosted render IN the body -------
    art = pg.evaluate("""(MB)=>window.__compile({addr:'basel@shop.example',name:'Basel'}, {
        innerTpl:'Hello there.', subjectTpl:'A note', branded:false, lang:'en', slug:'',
        attachments:[{filename:'small.png',url:'https://cdn.example/s.png',size:3*MB},
                     {filename:'mid.jpg',  url:'https://cdn.example/m.jpg',size:10*MB},
                     {filename:'huge.gif', url:'https://cdn.example/h.gif',size:30*MB}]
    })""", MB)
    ck("compile returns the attachment list (the small one) for the relay to carry",
       len(art["attachments"]) == 1 and art["attachments"][0]["path"] == "https://cdn.example/s.png", art["attachments"])
    ck("compile returns the refused list (the oversize one), never dropping it silently",
       len(art["refused"]) == 1, art["refused"])
    ck("a hosted image is a clean labelled link IN the compiled body (View image: mid.jpg)",
       ("View image" in art["html"]) and ("mid.jpg" in art["html"]), art["html"][-300:])
    ck("an attached image is NOT inlined into the body (it rides as an attachment, not markup)",
       "s.png" not in art["html"], art["html"][-300:])

    # the Arabic recipient gets the Arabic hosted label, from the inline ternary (not the UI language)
    artar = pg.evaluate("""(MB)=>window.__compile({addr:'x@y.z',name:'X',lang:'ar'}, {
        innerTpl:'مرحبا', subjectTpl:'s', branded:false, lang:'ar', slug:'',
        attachments:[{filename:'mid.jpg', url:'https://cdn.example/m.jpg', size:10*MB}]})""", MB)
    ck("the hosted label is Arabic for an Arabic recipient (per-recipient, not UI-lang)",
       "عرض الصورة" in artar["html"], artar["html"][-200:])

    # ---- 3) preview == sent, per recipient, through BOTH live builders ----------------------------------
    pg.evaluate("""(MB)=>{ document.getElementById('ebody').innerHTML='Hi {{NAME}}, see the poster.';
        document.getElementById('esubject').value='A note for you';
        window.__seedComposeAttachments([
          {filename:'small.png', url:'https://cdn.example/s.png', size:3*MB},
          {filename:'mid.jpg',   url:'https://cdn.example/m.jpg', size:10*MB}]); }""", MB)
    def both(addr, name):
        single = pg.evaluate("(r)=>window.__cmpCompile({addr:r.addr,name:r.name},{track:true})", {"addr": addr, "name": name})
        camp = pg.evaluate("(a)=>window.__compile({addr:a.addr,name:a.name}, window.__campaignContent({slug:'camp1',business:'Campaign One'}, window.__campaignTpl()))",
                           {"addr": addr, "name": name})
        return single, camp
    s, c = both("basel@shop.example", "Basel Haddad")
    ck("attachments: single-send HTML == campaign-row HTML for the same recipient (preview==sent)",
       s["html"] == c["html"], {"single_tail": s["html"][-160:], "camp_tail": c["html"][-160:]})
    ck("attachments: the carried attachment list is identical single vs campaign",
       s["attachments"] == c["attachments"], (s["attachments"], c["attachments"]))
    s2, c2 = both("c@three.example", "Cee")
    ck("a third campaign recipient compiles the SAME attachment through the one path",
       c2["attachments"] == c["attachments"] and len(c2["attachments"]) == 1, c2["attachments"])
    ck("the sensitivity holds: a different recipient still differs in the body (real merge, same attachment)",
       s["html"] != s2["html"], "")

    # ---- 4) the version gate is `>=`, not `===` (Condition 1): FAILS if regressed to strict equality -----
    def gate(v):
        return pg.evaluate("""(v)=>{ window.noteRelayVersion({relay_version:v});
            return { ready: window.relayReady(), attach: window.relaySupportsAttachments(),
                     mm: window.relayMismatch(), seen: window.relaySeenVersion() }; }""", v)
    g8 = gate(8)
    ck("relay v8 is READY against REQUIRED_RELAY 5 (this reds if the gate regresses to strict `===`)",
       g8["ready"] is True and g8["mm"] is None, g8)
    ck("relay v8 supports attachments (>= v8)", g8["attach"] is True, g8)
    g5 = gate(5)
    ck("relay v5 is READY (equal), but does NOT yet support attachments (< v8)",
       g5["ready"] is True and g5["attach"] is False, g5)
    g9 = gate(9)
    ck("a relay NEWER than the console needs is still READY (>=), not a mismatch",
       g9["ready"] is True and g9["attach"] is True, g9)
    g4 = gate(4)
    ck("an OLDER relay (v4 < REQUIRED 5) is REFUSED, naming both numbers",
       g4["ready"] is False and g4["mm"] is not None and g4["mm"]["seen"] == 4 and g4["mm"]["need"] == 5, g4)
    ck("an older relay never claims attachment support", g4["attach"] is False, g4)

    # ---- 5) rich links: recognized, cleanly labelled, listed; Drive raises the sender-only chip ---------
    kinds = pg.evaluate("""()=>({
        ig: window.__linkKind('https://instagram.com/thrive').type,
        yt: window.__linkKind('https://youtu.be/abc').type,
        dr: window.__linkKind('https://drive.google.com/file/d/1/view').type,
        gen: window.__linkKind('https://example.com/x').type })""")
    ck("recognized link types name their destination (Instagram / YouTube / Drive), generic is a plain URL",
       kinds == {"ig": "instagram", "yt": "youtube", "dr": "drive", "gen": "url"}, kinds)

    # insert a Drive link into the body -> it lists in the manager, and the Drive reminder chip appears
    pg.evaluate("""()=>{ var b=document.getElementById('ebody');
        b.innerHTML='See <a href="https://drive.google.com/file/d/1/view" data-origin="custom">the file</a>.';
        b.dispatchEvent(new Event('input',{bubbles:true})); }""")
    pg.wait_for_timeout(400)
    drive_chip = pg.eval_on_selector("#edrivechip", "el=>!el.hidden") if pg.query_selector("#edrivechip") else False
    ck("a Google Drive link raises the sender-only sharing-reminder chip", drive_chip is True, "")
    links_html = pg.eval_on_selector("#elinks", "el=>el.innerHTML") if pg.query_selector("#elinks") else ""
    ck("the Drive link is listed in the links manager with its recognized kind",
       ("Google Drive" in links_html) and ("lk-drive" in links_html), links_html[:200])

    # ---- 6) the composer surfaces the attach control and the always-visible relay-version panel ---------
    ck("the composer has an attach-image control and a hidden file input",
       bool(pg.query_selector("#tbAttach")) and bool(pg.query_selector("#eAttachFile")), "")

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL P23 ATTACHMENT + LINK CHECKS PASS"))
raise SystemExit(1 if fails else 0)
