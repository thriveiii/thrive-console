"""The Replied column boundary reads as a clear, calm separator with room on both sides (WO-024).

The dashed rule before the Replied column (from the visual-language PR) was too faint (a .10 white
hair) and too close (only the 4px board gap on the neighbour side, versus 8px padding inside), so on
the device it read as a line crammed against the Opened column rather than a boundary. This is a
spacing-and-clarity fix, CSS only, no logic: one spacing token on BOTH sides of the rule (a margin
before it, a padding after it), and a touch more contrast on the existing hair (.10 -> .16 white, no
new colour). The rule stays the ONLY separator on the board, full column height, and mirrors in Arabic.

Measured at the three widths the device is tested at (mobile lane / iPad landscape / desktop) in both
directions: the rule is dashed and continuous the full column height, the gutter is symmetric and
generous, the reply glow clears it, and on the phone layout the same clarity and spacing carry to the
dashed top rule. WebKit at three widths is Thyab's device gate; the structure is proven here.
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

# ---- Source guards: one spacing token, symmetric, a hair contrast tweak, both layouts --------------
css = open(f"{ROOT}/library/styles.css").read()
ck("the wide boundary uses one spacing token on both sides (margin + padding), a contrast tweak of the hair",
   "border-inline-start:1px dashed rgba(255,255,255,.16);" in css
   and "margin-inline-start:var(--s-3);" in css and "padding-inline-start:var(--s-3);" in css)
ck("the phone boundary carries the same contrast and the same token above and below",
   "border-top:1px dashed rgba(255,255,255,.16);" in css
   and "margin-top:var(--s-3);" in css and "padding-top:var(--s-3);" in css)

# 4 opened cards, 1 replied card WITH a conversation (so it glows): the Replied lane is shorter, to
# prove the rule still spans the full column height, and the glow is present to prove it clears the rule.
OPPS=[{"slug":f"op{i}","business":f"Opened {i}","stage":"opened","published":True} for i in range(4)] + \
     [{"slug":"rep1","business":"Replied 1","stage":"replied","published":True}]
INBOUND=[{"gid":"g1","opp":"rep1","kind":"reply","from":"a@x.com","name":"A","subject":"Re: hi","snippet":"yes","ts":"2026-08-03T09:00:00Z","messageId":"<w1@x>"}]

def boot(pg, lang):
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_function("()=>typeof window.thriveBoardRefresh==='function'", timeout=15000)
    pg.evaluate("()=>{document.documentElement.classList.remove('gate-locked');const g=document.getElementById('thriveGate');if(g)g.remove();}")
    pg.evaluate("""(a)=>{ localStorage.setItem('thrive_lang',a.lang);
        localStorage.setItem('thrive_opps_v1',JSON.stringify(a.opps));
        localStorage.setItem('thrive_inbound_v1',JSON.stringify(a.inbound)); }""",
        {"lang":lang,"opps":OPPS,"inbound":INBOUND})
    pg.reload()
    pg.wait_for_function("()=>typeof window.thriveBoardRefresh==='function'", timeout=15000)
    pg.evaluate("()=>{document.documentElement.classList.remove('gate-locked');const g=document.getElementById('thriveGate');if(g)g.remove();}")
    pg.evaluate("()=>location.hash='board'"); pg.wait_for_timeout(500)
    pg.evaluate("()=>window.thriveBoardRefresh()"); pg.wait_for_timeout(400)

MEASURE = r"""
() => {
  const rep=document.querySelector('#boardLanes .lane[data-lane="replied"]');
  const op=document.querySelector('#boardLanes .lane[data-lane="opened"]');
  const sent=document.querySelector('#boardLanes .lane[data-lane="sent"]');
  const board=document.getElementById('boardLanes');
  if(!rep||!op) return {missing:true};
  const cs=getComputedStyle(rep), rr=rep.getBoundingClientRect(), or_=op.getBoundingClientRect();
  const boardH=board.getBoundingClientRect().height;
  const dir=document.documentElement.dir;
  const openedSideGap = dir==='rtl' ? (or_.left - rr.right) : (rr.left - or_.right);
  const pad=parseFloat(cs.paddingInlineStart), mar=parseFloat(cs.marginInlineStart), bw=parseFloat(cs.borderInlineStartWidth||'1');
  // the glowing reply card, and its inset from the dashed rule (must exceed the glow reach)
  const card=rep.querySelector('.tok.has-reply');
  const cr=card?card.getBoundingClientRect():null;
  const cardInsetFromRule = cr ? (dir==='rtl' ? (rr.right - bw - cr.right) : (cr.left - (rr.left + bw))) : null;
  const sc=sent?getComputedStyle(sent):null;
  return { dir,
    style: cs.borderInlineStartStyle, color: cs.borderInlineStartColor,
    pad, mar, symmetric: Math.abs(pad-mar) < 0.5,
    openedSideGap: Math.round(openedSideGap),
    fullHeight: Math.abs(rr.height - boardH) <= 2,
    cardInsetFromRule: cardInsetFromRule==null?null:Math.round(cardInsetFromRule),
    sentHasRule: sc ? (sc.borderInlineStartStyle==='dashed' || sc.borderTopStyle==='dashed') : false,
    hasGlow: !!card };
}
"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width":1280,"height":900})
    ctx.route("https://api.github.com/**", lambda r: r.abort())
    ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))
    pg = ctx.new_page()

    # ---- Wide layout, the three device widths, LTR ----
    boot(pg, "en")
    for w in (1024, 1180, 1440):
        pg.set_viewport_size({"width":w,"height":900}); pg.wait_for_timeout(300)
        m = pg.evaluate(MEASURE); tag = f"LTR/{w}"
        ck(f"{tag}: the boundary is a dashed rule at a clearer contrast (.16 white), calm not loud",
           m.get("style")=="dashed" and m.get("color")=="rgba(255, 255, 255, 0.16)", m)
        ck(f"{tag}: the gutter is symmetric, one token on both sides (margin == padding)",
           m.get("symmetric") and m.get("pad")>=12, m)
        ck(f"{tag}: there is more room on the neighbour side than the old cramped gap (>= 12px, was 4px)",
           m.get("openedSideGap") >= 12, m)
        ck(f"{tag}: the rule spans the full column height (continuous, not a short broken line)",
           m.get("fullHeight") is True, m)
        ck(f"{tag}: the reply glow clears the rule (the card is inset past the glow reach)",
           m.get("hasGlow") and m.get("cardInsetFromRule") is not None and m.get("cardInsetFromRule") >= 11, m)
        ck(f"{tag}: no neighbour column carries a separator (the rule is the only one, before Replied)",
           m.get("sentHasRule") is False, m)

    # ---- Arabic mirrors: the rule sits before Replied in reading order (the right edge), same gutter ----
    boot(pg, "ar")
    pg.set_viewport_size({"width":1024,"height":900}); pg.wait_for_timeout(300)
    ar = pg.evaluate(MEASURE)
    ck("RTL: the document mirrors and the dashed rule keeps its clarity and symmetric gutter",
       ar.get("dir")=="rtl" and ar.get("style")=="dashed" and ar.get("color")=="rgba(255, 255, 255, 0.16)"
       and ar.get("symmetric") and ar.get("openedSideGap")>=12, ar)
    ck("RTL: the rule still spans the full column height and the glow clears it",
       ar.get("fullHeight") is True and ar.get("cardInsetFromRule") is not None and ar.get("cardInsetFromRule")>=11, ar)
    rtl_edge = pg.evaluate("""()=>{ const l=document.querySelector('#boardLanes .lane[data-lane="replied"]'); const cs=getComputedStyle(l);
        return { right:cs.borderRightStyle, left:cs.borderLeftStyle }; }""")
    ck("RTL: the dash is on the right edge (inline-start mirrors), so it reads before Replied",
       rtl_edge["right"]=="dashed" and rtl_edge["left"]!="dashed", rtl_edge)

    # ---- Phone layout: the same clarity and spacing carry to a dashed TOP rule ----
    boot(pg, "en")
    pg.set_viewport_size({"width":420,"height":900}); pg.wait_for_timeout(300)
    pg.evaluate("""()=>{ const b=document.getElementById('boardLanes'); if(b) b.setAttribute('data-active-lane','replied'); }""")
    pg.wait_for_timeout(200)
    phone = pg.evaluate("""()=>{ const l=document.querySelector('#boardLanes .lane[data-lane="replied"]'); const cs=getComputedStyle(l);
        const s=document.querySelector('#boardLanes .lane[data-lane="sent"]'); const cs2=s?getComputedStyle(s):null;
        return { top:cs.borderTopStyle, color:cs.borderTopColor, padTop:parseFloat(cs.paddingTop), marTop:parseFloat(cs.marginTop),
                 left:cs.borderLeftStyle, sentTop:cs2?cs2.borderTopStyle:'none' }; }""")
    ck("phone: the Replied lane carries the same clear dashed TOP rule (.16), same spacing above and below",
       phone["top"]=="dashed" and phone["color"]=="rgba(255, 255, 255, 0.16)"
       and abs(phone["padTop"]-phone["marTop"])<0.5 and phone["padTop"]>=12, phone)
    ck("phone: no vertical column rule, and no neighbour lane carries a rule",
       phone["left"]!="dashed" and phone["sentTop"]!="dashed", phone)

    ctx.close(); b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
