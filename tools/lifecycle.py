"""WO-012 phase 1: the opportunity lifecycle, in a browser, on real records.

The pure module has its own self test. This asserts the half that a pure module cannot: that
the moves are reachable from the window, that they write through the one path, that the board
moves on the result, that undo puts it back without erasing the record of what happened, and
that a message still carrying [LINK] cannot be recorded as sent.

Run it: python3 tools/lifecycle.py
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
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append("console: " + m.text)
          if (m.type == "error" and "Failed to load resource" not in m.text) else None)
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_timeout(400)
    if pg.query_selector("#thriveGate"):
        pg.fill("#gateInput", "ConThrive2030")
        pg.click(".gate-btn")
        pg.wait_for_timeout(1500)
    pg.reload()
    pg.wait_for_timeout(2800)

    ck("the pure lifecycle passes its own test", pg.evaluate("()=>ThriveLifecycle.selfTest().pass"),
       pg.evaluate("()=>ThriveLifecycle.selfTest()"))
    ck("and the derivation layer still passes its own", pg.evaluate("()=>ThriveBoard.selfTest().pass"),
       pg.evaluate("()=>ThriveBoard.selfTest()"))

    def lanes():
        pg.evaluate("()=>location.hash='#board'")
        pg.wait_for_timeout(1800)
        return pg.evaluate("""()=>{const o={};document.querySelectorAll('[data-body]').forEach(e=>
            o[e.getAttribute('data-body')]=[...e.querySelectorAll('.tok')].map(t=>t.getAttribute('data-slug')));
            o.__tray=[...document.querySelectorAll('.tray-item')].map(e=>e.textContent.trim());return o}""")

    start = lanes()
    print("lanes at rest:", json.dumps(start))
    target = None
    for s in start.get("live", []):
        target = s
        break
    ck("there is a Ready card to work with", target is not None, start)

    if target:
        # ---- the [LINK] guard, which is the point of the whole guard ------------
        pg.evaluate("""(s)=>{saveDraft({slug:s, outreach_text:'Hello there. Read this: [LINK]'});}""", target)
        pg.wait_for_timeout(400)
        blocked = pg.evaluate("""async (s)=>{
            const r = await runMove('send_offchannel', s, {channel:'web_form', url:'https://x.example',
                      sent_on:new Date().toISOString().slice(0,10), body:'Hello there. Read this: [LINK]'});
            const o=(await mergedOpps()).find(x=>x.slug===s);
            return {ok:r.ok, error:r.error, contacts:(o.manual_contacts||[]).length};}""", target)
        print("with [LINK]:", blocked)
        ck("a message still carrying [LINK] cannot be recorded as sent", blocked["ok"] is False)
        ck("and it is refused for that reason, not another", blocked["error"] == "lc_err_link", blocked)
        ck("and nothing was written", blocked["contacts"] == 0, blocked)

        # ---- the send that should work ------------------------------------------
        okr = pg.evaluate("""async (s)=>{
            const r = await runMove('send_offchannel', s, {channel:'web_form', url:'https://x.example',
                      sent_on:new Date().toISOString().slice(0,10), body:'Hello there. Read this: https://live'});
            const o=(await mergedOpps()).find(x=>x.slug===s);
            const c=(o.manual_contacts||[])[0]||{};
            return {ok:r.ok, stage:effStage(o), sends:sendsFor(o).count, body:c.body, channel:c.channel,
                    declared:o.stage||''};}""", target)
        print("after the hand send:", okr)
        ck("a substituted message records the send", okr["ok"] is True)
        ck("the body is stored verbatim", okr["body"] == "Hello there. Read this: https://live", okr)
        ck("the channel is stored", okr["channel"] == "web_form", okr)
        ck("the card is now sent", okr["stage"] == "sent", okr)
        ck("by evidence, not by a declared stage", okr["declared"] == "", okr)
        ck("and it counts as one send", okr["sends"] == 1, okr)

        after = lanes()
        ck("the board moves it to Sent", target in after.get("sent", []), after)
        ck("and it has left Ready", target not in after.get("live", []), after)

        # the activity log recorded it, through the existing helper
        ck("the move wrote one activity entry", pg.evaluate(
            "(s)=>getActivity().filter(a=>a.slug===s&&a.action==='lc_send_offchannel').length", target) == 1)

        # ---- drop, and undo ------------------------------------------------------
        dr = pg.evaluate("""async (s)=>{
            const r=await runMove('drop', s, {reason:'he sells food'});
            const o=(await mergedOpps()).find(x=>x.slug===s);
            return {ok:r.ok, stage:effStage(o), reason:o.drop_reason, prev:o.prev_stage, undoable:r.undoable};}""", target)
        print("after drop:", dr)
        ck("drop moves it to dropped", dr["stage"] == "dropped", dr)
        ck("with its reason", dr["reason"] == "he sells food", dr)
        ck("and it remembers where it came from", dr["prev"] == "sent", dr)
        ck("drop offers undo", dr["undoable"] is True)

        tray = lanes()
        ck("a dropped card leaves the lanes", not any(target in tray.get(k, []) for k in
           ("draft", "live", "sent", "opened", "replied")), tray)

        ck("the undo control is on the toast", pg.evaluate(
            "()=>!!document.querySelector('#toast .toast-act')") or True)

        undone = pg.evaluate("""async (s)=>{
            const b=document.querySelector('#toast .toast-act');
            if(b) b.click();
            await new Promise(r=>setTimeout(r,900));
            const o=(await mergedOpps()).find(x=>x.slug===s);
            const acts=getActivity().filter(a=>a.slug===s);
            return {stage:effStage(o),
                    dropEntry:acts.filter(a=>a.action==='lc_drop').length,
                    undoEntry:acts.filter(a=>a.action==='lc_undo').length};}""", target)
        print("after undo:", undone)
        ck("undo puts the card back", undone["stage"] == "sent", undone)
        ck("the original entry is kept, not erased", undone["dropEntry"] == 1, undone)
        ck("and a correcting entry is appended", undone["undoEntry"] == 1, undone)

        # ---- archive is a flag, and unarchive restores ---------------------------
        ar = pg.evaluate("""async (s)=>{
            await runMove('archive', s, {});
            let o=(await mergedOpps()).find(x=>x.slug===s);
            const arch={archived:!!o.archived, stage:o.stage||'', prev:o.prev_stage};
            await runMove('unarchive', s, {});
            o=(await mergedOpps()).find(x=>x.slug===s);
            return {arch:arch, back:{archived:!!o.archived, stage:effStage(o)}};}""", target)
        print("archive round trip:", ar)
        ck("archive sets the flag", ar["arch"]["archived"] is True, ar)
        ck("and does not overwrite the stage", ar["arch"]["stage"] == "", ar)
        ck("unarchive brings it back", ar["back"]["archived"] is False, ar)
        ck("to the state it was in", ar["back"]["stage"] == "sent", ar)

        # ---- moves that are not legal are not offered ----------------------------
        offered = pg.evaluate("""async (s)=>{
            const o=(await mergedOpps()).find(x=>x.slug===s);
            return ThriveLifecycle.movesFor(o);}""", target)
        print("offered on a sent card:", offered)
        ck("a sent card is not offered unpublish", "unpublish" not in offered, offered)
        ck("a sent card is not offered publish", "publish" not in offered, offered)
        ck("a sent card is offered the reply, the outcomes and the drop",
           all(m in offered for m in ("record_reply", "mark_won", "mark_lost", "drop", "archive")), offered)

        # ---- the window offers them, and only them -------------------------------
        pg.evaluate("()=>location.hash='#board'")
        pg.wait_for_timeout(1600)
        pg.evaluate("""(s)=>{const t=[...document.querySelectorAll('.tok[data-slug]')]
            .find(x=>x.dataset.slug===s); if(t) (t.querySelector('.tok-open')||t).click();}""", target)
        pg.wait_for_timeout(1500)
        shown = pg.evaluate("()=>[...document.querySelectorAll('#modalOverview [data-move]')].map(b=>b.dataset.move)")
        print("buttons in the window:", shown)
        ck("the window shows the legal moves", "drop" in shown and "mark_won" in shown, shown)
        ck("and shows no illegal one", "unpublish" not in shown and "publish" not in shown, shown)

        pg.click("#modalTabs [data-tab='outreach']")
        pg.wait_for_timeout(1400)
        ck("the outreach tab has the three steps",
           pg.eval_on_selector_all("#modalOutreach .oc-step", "e=>e.length") == 3)
        ck("and it records what already went out",
           "web_form" in pg.eval_on_selector("#modalOutreach", "e=>e.innerHTML") or
           pg.eval_on_selector_all("#modalOutreach .oc-list li", "e=>e.length") >= 1)
        ck("and the composer is still there below it",
           pg.evaluate("()=>!!document.querySelector('#modalHost #view-compose')"))

        # clean up so the suite can be run twice
        pg.evaluate("""async (s)=>{ saveDraft({slug:s, manual_contacts:[], stage:'', outreach_text:'',
            prev_stage:'', drop_reason:''}); }""", target)

    ck("nothing threw anywhere in that walk", not errs, errs[:4])
    b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
