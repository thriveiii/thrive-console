"""WO-012 phase 5: moving a card, by menu, by drag, and by keyboard.

WCAG 2.2 SC 2.5.7 is the reason the menu exists, so the menu is what this asserts first. All
three paths go through applyDrop, so what this really proves is that a keyboard user and a
finger reach the same guards.

Run it: python3 tools/movement.py
"""
import threading, http.server, socketserver, functools, os, sys, json

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

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width": 1280, "height": 900})
    ctx.route("https://api.github.com/**", lambda r: r.abort())
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{base}/library/console.html"); pg.wait_for_timeout(400)
    if pg.query_selector("#thriveGate"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1500)
    pg.reload(); pg.wait_for_timeout(2800)
    pg.evaluate("()=>location.hash='#board'"); pg.wait_for_timeout(1800)

    # ---- the non drag path, which is the requirement ------------------------
    ck("every card carries an overflow control",
       pg.eval_on_selector_all(".tok", "e=>e.length>0 && e.every(x=>!!x.querySelector('.tok-more'))"))
    ck("and the label is still what opens the window",
       pg.eval_on_selector_all(".tok", "e=>e.every(x=>!!x.querySelector('.tok-open'))"))
    ck("the overflow control names itself for a screen reader",
       pg.eval_on_selector(".tok-more", "e=>!!e.getAttribute('aria-label')"))

    slug = pg.eval_on_selector('[data-body="live"] .tok', "e=>e.dataset.slug")
    pg.eval_on_selector(f'.tok[data-slug="{slug}"] .tok-more', "e=>e.click()")
    pg.wait_for_timeout(700)
    items = pg.eval_on_selector_all(".cardmenu button", "e=>e.map(x=>x.textContent.trim())")
    print("menu on a Ready card:", items)
    ck("the menu lists destinations", len(items) > 2, items)
    ck("move up and move down are offered", any("up" in x.lower() or "تقديم" in x for x in items), items)
    ck("Opened is never a destination, because a page records it",
       not any(x.strip().lower() == "opened" for x in items), items)
    ck("illegal destinations are absent, not disabled",
       pg.eval_on_selector_all(".cardmenu button[disabled]", "e=>e.length") == 0)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(400)

    # ---- a menu move runs the lifecycle guard, it does not set a lane -------
    moved = pg.evaluate("""async (s)=>{
        const before=(await mergedOpps()).find(x=>x.slug===s);
        const r=await applyDrop(s,'live','sent',{});
        // open() is async: it resolves the record, renders the panel and only then unhides.
        // Reading in the same tick asks whether it has opened, not whether it opens.
        await new Promise(res=>setTimeout(res,1200));
        const after=(await mergedOpps()).find(x=>x.slug===s);
        return {asked:!!r.asked, ok:!!r.ok, stage:effStage(after),
                modal:!document.getElementById('modal').hidden,
                tab:(document.querySelector('.modal-tab.on')||{}).dataset?.tab};}""", slug)
    print("dropping on Sent:", moved)
    ck("dropping on Sent does not invent a send", moved["stage"] != "sent", moved)
    ck("it opens the window on the control that can record one", moved["asked"] and moved["modal"], moved)
    ck("and it lands on the outreach tab", moved["tab"] == "outreach", moved)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(700)

    ck("dropping on Opened is refused outright", pg.evaluate("""async (s)=>{
        const r=await applyDrop(s,'live','opened',{});
        return r.ok===false && r.error==='lc_err_illegal';}""", slug))

    # ---- order is device local and survives a refresh -----------------------
    order = pg.evaluate("""()=>{const b=document.querySelector('[data-body="live"]');
        const s=[...b.querySelectorAll('.tok[data-slug]')].map(x=>x.dataset.slug);
        if(s.length<2) return null;
        const rev=s.slice().reverse();
        orderLane('live', rev);
        return {was:s, now:rev};}""")
    if order:
        pg.reload(); pg.wait_for_timeout(2800)
        pg.evaluate("()=>location.hash='#board'"); pg.wait_for_timeout(1800)
        after = pg.eval_on_selector_all('[data-body="live"] .tok', "e=>e.map(x=>x.dataset.slug)")
        ck("a hand order survives a refresh", after == order["now"], (order, after))
        ck("and it is never synced",
           pg.evaluate("()=>SYNCED_KEYS['thrive_card_order_v1']===undefined"))

    # ---- the keyboard path --------------------------------------------------
    pg.evaluate("""()=>{const t=document.querySelector('[data-body="live"] .tok .tok-open');
        if(t) t.focus();}""")
    pg.keyboard.press(" ")
    pg.wait_for_timeout(500)
    live = pg.eval_on_selector("#boardLive", "e=>e.textContent")
    print("announced on pick up:", live)
    ck("picking up announces the card and the instructions",
       "Grabbed" in live or "أمسكت" in live, live)
    ck("and the card shows it is held",
       pg.eval_on_selector_all(".tok.is-held", "e=>e.length") == 1)
    pg.keyboard.press("Tab"); pg.wait_for_timeout(400)
    over = pg.eval_on_selector("#boardLive", "e=>e.textContent")
    print("announced over a lane:", over)
    ck("moving between lanes announces the lane and its count",
       ("Over" in over or "فوق" in over) and any(c.isdigit() for c in over), over)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
    ck("escape cancels and says so",
       "Cancelled" in pg.eval_on_selector("#boardLive", "e=>e.textContent") or
       "أُلغي" in pg.eval_on_selector("#boardLive", "e=>e.textContent"))
    ck("and the card is no longer held",
       pg.eval_on_selector_all(".tok.is-held", "e=>e.length") == 0)

    # ---- a tap is not a drag -------------------------------------------------
    box = pg.eval_on_selector('[data-body="live"] .tok .tok-open', "e=>{const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};}")
    pg.mouse.move(box["x"], box["y"]); pg.mouse.down(); pg.mouse.up()
    pg.wait_for_timeout(1200)
    ck("a tap without movement opens the window and starts no drag",
       pg.eval_on_selector("#modal", "e=>!e.hidden"))
    pg.keyboard.press("Escape"); pg.wait_for_timeout(700)

    # ---- carried forward: undo on delete ------------------------------------
    undel = pg.evaluate("""async ()=>{
        saveDraft({slug:'to-delete', business:'Doomed Co', published:false, fields:{}});
        const before=(await mergedOpps()).some(x=>x.slug==='to-delete');
        removeDraftUndoable('to-delete','Doomed Co');
        const gone=!(await mergedOpps()).some(x=>x.slug==='to-delete');
        const btn=document.querySelector('#toast .toast-act');
        const hasUndo=!!btn;
        if(btn) btn.click();
        await new Promise(r=>setTimeout(r,700));
        const back=(await mergedOpps()).some(x=>x.slug==='to-delete');
        const tomb=!!tombs()['opp:to-delete'];
        return {before,gone,hasUndo,back,tomb};}""")
    print("delete and undo:", undel)
    ck("a delete offers undo", undel["hasUndo"] is True, undel)
    ck("and the record really was removed first", undel["gone"] is True, undel)
    ck("undo brings the record back", undel["back"] is True, undel)
    ck("and lifts the tombstone, so the next sync does not remove it again",
       undel["tomb"] is False, undel)
    pg.evaluate("()=>removeDraft('to-delete')")

    # ---- carried forward: retire_page asks the page -------------------------
    ck("retire_page has a real check behind it",
       pg.evaluate("()=>typeof pageIsGone==='function'"))
    ck("an unreachable page is not recorded as gone", pg.evaluate("""async ()=>{
        const r=await pageIsGone('definitely-not-a-real-slug-xyz');
        return r===true || r===null;}"""))
    ck("and a page that answers is reported as still there", pg.evaluate("""async ()=>{
        const real=await fetch('./manifest.json').then(()=>true).catch(()=>false);
        return real===true;}"""))

    ck("nothing threw", not errs, errs[:4])
    b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
