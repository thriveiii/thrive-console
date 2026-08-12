"""The board paints stable, without the scramble.

On the device the cards flew in from every direction and thrashed before settling. Cause, from the
code: every board render ran a FLIP (firstRects/playFlip) that translated each token from its previous
screen position to its new one, so a full re-render (a hydrate, a sign-in, a refresh) slid every moved
card across the board at once; and the entry animation rose each new card from translateY(8px). With the
sign-in interstitial fix the board now renders twice on arrival (local cards, then Supabase), which is
exactly the double render that made the FLIP visible.

The fix, CSS and render-order only, no logic: the FLIP is removed, so a re-render places each card where
it belongs with no position animation; the entry is an opacity-only fade, so a card appears in place and
never rises or flies from off-axis; reduced motion shows none of it. Proven here: a reordering re-render
never puts a token under a move transform, and the entry carries no translate.

WebKit at three widths is Thyab's device gate; the paint behaviour is proven here on the real app.js.
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

# ---- Source guards: the churn is gone from the code, not just hidden ----------
app = open(f"{ROOT}/library/app.js").read()
css = open(f"{ROOT}/library/styles.css").read()
ck("the FLIP position animation is removed from the board render",
   "playFlip" not in app and "firstRects" not in app)
ck("no token move-transform class remains", "is-moving" not in app and "is-moving" not in css)
ck("the board entry keyframe is opacity-only (no off-axis translate)",
   "@keyframes rise-in{from{opacity:0}to{opacity:1}}" in css)
ck("reduced motion turns the entry animation off",
   ".enter{animation:none}" in css.replace("\n", " ") or ".enter{ animation:none" in css or ".enter{animation:none" in css)

OPPS = [{"slug": f"calm-{i}", "business": f"Calm {i}", "published": False, "up": i+1} for i in range(5)]

def board_tokens(pg):
    return pg.evaluate("""()=>[...document.querySelectorAll('.tok[data-slug]')].map(el=>({
        slug: el.getAttribute('data-slug'),
        moving: el.classList.contains('is-moving'),
        inlineTransform: el.style.transform || '',
        computedTransform: getComputedStyle(el).transform
    }))""")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # --- behavioural: a reordering re-render never slides a card ---
    ctx = b.new_context(viewport={"width":1280,"height":900})
    ctx.route("https://api.github.com/**", lambda r: r.fulfill(status=404, body="{}"))
    ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))
    pg = ctx.new_page()
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_function("()=>typeof window.thriveBoardRefresh==='function'", timeout=15000)
    pg.evaluate("()=>{ document.documentElement.classList.remove('gate-locked'); const g=document.getElementById('thriveGate'); if(g) g.remove(); }")
    pg.evaluate("(o)=>localStorage.setItem('thrive_opps_v1', JSON.stringify(o))", OPPS)
    pg.evaluate("()=>location.hash='board'"); pg.wait_for_timeout(500)
    pg.evaluate("()=>window.thriveBoardRefresh()")
    pg.wait_for_selector(".tok[data-slug]", timeout=8000)
    first = board_tokens(pg)
    ck("the board paints its cards", len(first) >= 5, len(first))

    # Reorder the store (the scramble scenario: cards land in different positions) and re-render. Sample the
    # tokens across the frames right after the render, when a FLIP, if present, would hold a move transform.
    pg.evaluate("(o)=>localStorage.setItem('thrive_opps_v1', JSON.stringify(o))", list(reversed(OPPS)))
    pg.evaluate("""()=>{ window.__seenMoving=false; window.__seenTransform=false;
        const sample=()=>{ document.querySelectorAll('.tok[data-slug]').forEach(el=>{
            if(el.classList.contains('is-moving')) window.__seenMoving=true;
            const tf=el.style.transform||''; if(tf && tf!=='none') window.__seenTransform=true; }); };
        window.thriveBoardRefresh();
        sample(); requestAnimationFrame(()=>{ sample(); requestAnimationFrame(sample); }); }""")
    pg.wait_for_timeout(500)
    seen_moving = pg.evaluate("()=>window.__seenMoving")
    seen_transform = pg.evaluate("()=>window.__seenTransform")
    ck("a reordering re-render never puts a token under a move class", not seen_moving, seen_moving)
    ck("a reordering re-render never puts a token under an inline slide transform", not seen_transform, seen_transform)

    after = board_tokens(pg)
    ck("after the re-render no card carries a move transform (paints in place)",
       all(not tokspec["moving"] and (tokspec["inlineTransform"] in ("", "none")) for tokspec in after), after)
    # The entry class fades opacity only: a freshly rendered .enter card has no translate on its transform.
    enter_tf = pg.evaluate("""()=>{ const el=document.querySelector('.tok.enter'); return el? getComputedStyle(el).transform : 'none'; }""")
    ck("the entry animation carries no translate (opacity-only fade)", enter_tf in ("none", "matrix(1, 0, 0, 1, 0, 0)"), enter_tf)
    ctx.close()

    # --- reduced motion: no entry animation at all ---
    ctx2 = b.new_context(viewport={"width":1280,"height":900}, reduced_motion="reduce")
    ctx2.route("https://api.github.com/**", lambda r: r.fulfill(status=404, body="{}"))
    ctx2.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))
    pg2 = ctx2.new_page()
    pg2.goto(f"{base}/library/console.html")
    pg2.wait_for_function("()=>typeof window.thriveBoardRefresh==='function'", timeout=15000)
    pg2.evaluate("()=>{ document.documentElement.classList.remove('gate-locked'); const g=document.getElementById('thriveGate'); if(g) g.remove(); }")
    pg2.evaluate("(o)=>localStorage.setItem('thrive_opps_v1', JSON.stringify(o))", OPPS)
    pg2.evaluate("()=>location.hash='board'"); pg2.wait_for_timeout(400)
    pg2.evaluate("()=>window.thriveBoardRefresh()")
    pg2.wait_for_selector(".tok[data-slug]", timeout=8000)
    anim = pg2.evaluate("""()=>{ const el=document.querySelector('.tok'); return el? getComputedStyle(el).animationName : ''; }""")
    ck("reduced motion: the board entry animation is off (no motion at all)", anim == "none", anim)
    ctx2.close()

    b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
