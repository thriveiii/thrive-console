"""Copy or open the opportunity's own live page link from inside the card.

The card modal already carried one control that copied the opportunity's PUBLIC page URL
(liveUrl -> https://console.thriveiii.com/opp/<slug>), gated on the page being live. But an
operator reading a card had no way to OPEN that page from inside the window, and the single
control was labelled ambiguously ("Copy link") so it read like it might copy the console's own
deep link. This brief adds an in-context Open control beside Copy, relabels both unambiguously in
both languages, and gates the pair together: a live page copies and opens the public URL; a
draft (not activated) shows both disabled with a quiet reason and never a broken copy.

This suite drives the real modal (window.thriveModal.open) on two seeded opportunities, one
activated and one draft, in both languages, and asserts:
  - activated -> #modalOpen and #modalCopy enabled; clicking Copy writes exactly liveUrl to the
    clipboard (never a console-internal deep link); clicking Open targets exactly liveUrl.
  - draft (not activated) -> both disabled; #modalWhy shows the mw_copy_why reason; no copy fires.
  - labels are the page-link labels in EN and AR (not the old ambiguous "Copy link").
  - the header mirrors in Arabic (dir rtl) and the actions row does not overflow.

It is a real gate: breaking the open-gate (dropping isLive from copyState's `can`) or the openLink
URL makes the relevant checks go red; restored, all are green. WebKit is Thyab's device gate;
the isolation and gating structure is proven here.
"""
import threading, http.server, socketserver, functools, os, sys
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True; threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:300])

LIVE = "https://console.thriveiii.com/opp/live-co"

# ---- Source guards ----------------------------------------------------------
app = open(f"{ROOT}/library/app.js").read()
ck("openLink opens the opportunity's own public liveUrl in a new tab",
   'function openLink()' in app and 'window.open(liveUrl(rec.slug)' in app)
ck("openLink is gated on a live page, like copyLink",
   'function openLink(){\n    if(!rec || !isLive(rec)) return;' in app)
ck("copyLink copies liveUrl, never a console-internal deep link",
   'const url=liveUrl(rec.slug);' in app)
ck("copyState gates Open and Copy together on a live page",
   'const b=el("modalCopy"), o=el("modalOpen")' in app
   and "const can=!!(rec && isLive(rec));" in app
   and "if(o) o.disabled=!can;" in app)
ck("the Open control is wired to openLink",
   'el("modalOpen").addEventListener("click", openLink)' in app)

# markup source is the bundle template; the served shell is generated from it
bnd = open(f"{ROOT}/tools/bundle.js").read()
ck("the modal header carries an Open control beside Copy (bundle source)",
   'id="modalOpen"' in bnd and 'data-i18n="mw_open_page"' in bnd)
sh = open(f"{ROOT}/library/console.html").read()
ck("the generated shell carries #modalOpen (re-bundled)", 'id="modalOpen"' in sh)

# i18n: unambiguous page-link labels in both languages
i18 = open(f"{ROOT}/library/i18n.js").read()
for key, en, ar in [("mw_copy_link", "Copy page link", "نسخ رابط الصفحة"),
                    ("mw_open_page", "Open page", "فتح الصفحة")]:
    ck(f"{key} EN label is the page-link label", f'{key}:' in i18 and en in i18)
    ck(f"{key} AR label is the page-link label", ar in i18)

OPPS = [
    {"slug": "live-co",  "business": "Live Co",  "published": True},
    {"slug": "draft-co", "business": "Draft Co", "published": False},
]

def boot(pg, lang):
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_function("()=>typeof window.thriveModal==='object'", timeout=15000)
    pg.evaluate("()=>{document.documentElement.classList.remove('gate-locked');const g=document.getElementById('thriveGate');if(g)g.remove();}")
    pg.evaluate("""(a)=>{ localStorage.setItem('thrive_lang',a.lang);
        localStorage.setItem('thrive_opps_v1',JSON.stringify(a.opps)); }""",
        {"lang": lang, "opps": OPPS})
    pg.reload()
    pg.wait_for_function("()=>typeof window.thriveModal==='object'", timeout=15000)
    pg.evaluate("()=>{document.documentElement.classList.remove('gate-locked');const g=document.getElementById('thriveGate');if(g)g.remove();}")

def open_card(pg, slug, title):
    # capture window.open targets deterministically; noopener returns null anyway
    pg.evaluate("()=>{ window.__opened=[]; window.open=(u)=>{ window.__opened.push(u); return null; }; }")
    pg.evaluate("(a)=>window.thriveModal.open(a.slug,'overview',a.title)", {"slug": slug, "title": title})
    pg.wait_for_timeout(300)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width": 1280, "height": 900},
                        permissions=["clipboard-read", "clipboard-write"])
    ctx.route("https://api.github.com/**", lambda r: r.abort())
    ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))
    pg = ctx.new_page()

    # ===== English =====
    boot(pg, "en")

    # -- Activated opportunity: Open + Copy enabled, both target liveUrl --
    open_card(pg, "live-co", "Live Co")
    st = pg.evaluate("""()=>({
        openDis:  document.getElementById('modalOpen').disabled,
        copyDis:  document.getElementById('modalCopy').disabled,
        openTxt:  document.getElementById('modalOpen').textContent.trim(),
        copyTxt:  document.getElementById('modalCopy').textContent.trim(),
        whyHidden:document.getElementById('modalWhy').hidden })""")
    ck("EN activated: Open control is enabled", st["openDis"] is False, st)
    ck("EN activated: Copy control is enabled", st["copyDis"] is False, st)
    ck("EN activated: no disabled reason is shown", st["whyHidden"] is True, st)
    ck("EN activated: Copy is labelled 'Copy page link'", st["copyTxt"] == "Copy page link", st)
    ck("EN activated: Open is labelled 'Open page'", st["openTxt"] == "Open page", st)

    pg.evaluate("()=>navigator.clipboard.writeText('')")
    pg.click("#modalCopy"); pg.wait_for_timeout(200)
    copied = pg.evaluate("()=>navigator.clipboard.readText()")
    ck("EN activated: Copy places exactly the public liveUrl on the clipboard", copied == LIVE, copied)
    ck("EN activated: the copied link is not a console-internal deep link",
       "console.html" not in copied and "#" not in copied and "127.0.0.1" not in copied, copied)

    pg.click("#modalOpen"); pg.wait_for_timeout(200)
    opened = pg.evaluate("()=>window.__opened||[]")
    ck("EN activated: Open targets exactly the public liveUrl", opened == [LIVE], opened)

    pg.evaluate("()=>window.thriveModal.close(true)"); pg.wait_for_timeout(150)

    # -- Draft (not activated): both disabled, quiet reason, no broken copy --
    open_card(pg, "draft-co", "Draft Co")
    why = pg.evaluate("""()=>({
        openDis:  document.getElementById('modalOpen').disabled,
        copyDis:  document.getElementById('modalCopy').disabled,
        whyHidden:document.getElementById('modalWhy').hidden,
        whyTxt:   document.getElementById('modalWhy').textContent.trim() })""")
    ck("EN draft: Open control is disabled", why["openDis"] is True, why)
    ck("EN draft: Copy control is disabled", why["copyDis"] is True, why)
    ck("EN draft: a quiet reason is shown", why["whyHidden"] is False, why)
    ck("EN draft: the reason is the not-activated explanation",
       why["whyTxt"] == "Not activated yet, so there is no page to open or copy.", why)

    # a disabled control must never place a link on the clipboard
    pg.evaluate("()=>navigator.clipboard.writeText('SENTINEL')")
    pg.evaluate("()=>{ const b=document.getElementById('modalCopy'); b.dispatchEvent(new MouseEvent('click',{bubbles:true})); }")
    pg.wait_for_timeout(150)
    after = pg.evaluate("()=>navigator.clipboard.readText()")
    ck("EN draft: a disabled Copy never writes a link (no broken copy)", after == "SENTINEL", after)
    pg.evaluate("()=>window.thriveModal.close(true)"); pg.wait_for_timeout(150)

    # ===== Arabic: labels, mirrored header, gating unchanged =====
    boot(pg, "ar")
    open_card(pg, "live-co", "Live Co")
    ar = pg.evaluate("""()=>{
        const head=document.querySelector('#modal .modal-acts');
        return {
          dir:      document.documentElement.dir,
          copyTxt:  document.getElementById('modalCopy').textContent.trim(),
          openTxt:  document.getElementById('modalOpen').textContent.trim(),
          openDis:  document.getElementById('modalOpen').disabled,
          copyDis:  document.getElementById('modalCopy').disabled,
          overflow: head ? (head.scrollWidth - head.clientWidth) : 999 }; }""")
    ck("AR: the document mirrors to rtl", ar["dir"] == "rtl", ar)
    ck("AR activated: Copy is labelled «نسخ رابط الصفحة»", ar["copyTxt"] == "نسخ رابط الصفحة", ar)
    ck("AR activated: Open is labelled «فتح الصفحة»", ar["openTxt"] == "فتح الصفحة", ar)
    ck("AR activated: Open and Copy are enabled", ar["openDis"] is False and ar["copyDis"] is False, ar)
    ck("AR: the actions row does not overflow its header", ar["overflow"] <= 1, ar)

    pg.evaluate("()=>navigator.clipboard.writeText('')")
    pg.click("#modalCopy"); pg.wait_for_timeout(200)
    ar_copied = pg.evaluate("()=>navigator.clipboard.readText()")
    ck("AR activated: Copy places exactly the public liveUrl", ar_copied == LIVE, ar_copied)

    pg.evaluate("()=>window.thriveModal.close(true)"); pg.wait_for_timeout(150)
    open_card(pg, "draft-co", "Draft Co")
    ar_why = pg.evaluate("""()=>({
        openDis:  document.getElementById('modalOpen').disabled,
        copyDis:  document.getElementById('modalCopy').disabled,
        whyTxt:   document.getElementById('modalWhy').textContent.trim() })""")
    ck("AR draft: both controls disabled", ar_why["openDis"] is True and ar_why["copyDis"] is True, ar_why)
    ck("AR draft: the reason is the Arabic not-activated explanation",
       ar_why["whyTxt"] == "غير مُنشّطة بعد، فلا صفحة لفتحها أو نسخ رابطها.", ar_why)

    # -- Mobile sheet (390), the mirrored case: three controls plus Close must not
    #    push a button past the sheet edge; they wrap onto a second row instead. --
    pg.evaluate("()=>window.thriveModal.close(true)"); pg.wait_for_timeout(150)
    pg.set_viewport_size({"width": 390, "height": 900})
    open_card(pg, "live-co", "Live Co")
    no_ovf = pg.evaluate("""()=>{ const m=document.getElementById('modal');
        const r=m.getBoundingClientRect();
        return [...m.querySelectorAll('*')].every(e=>{ const q=e.getBoundingClientRect();
          if(!q.width && !q.height) return true;
          return q.left>=r.left-1 && q.right<=r.right+1; }); }""")
    ck("AR 390: nothing in the header overflows the sheet on a mobile width", no_ovf)
    both_vis = pg.evaluate("""()=>{ const o=document.getElementById('modalOpen').getBoundingClientRect();
        const c=document.getElementById('modalCopy').getBoundingClientRect();
        return o.width>0 && o.height>0 && c.width>0 && c.height>0; }""")
    ck("AR 390: Open and Copy both remain visible on the mobile sheet", both_vis)

    ctx.close(); b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
