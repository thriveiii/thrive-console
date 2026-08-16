"""The Replied lane speaks quietly: a calm breathing glow and one fine dashed boundary (WO-023).

Visual language only. Two elements, one hue (the Replied lane's green, no new colour):
1. Any card that carries a conversation glows with a continuous calm green breathing light behind it,
   derivation-driven (the .has-reply class is set from the reply derivation #82/#108, never per card), so a
   group PARENT whose child replied glows too, not only Replied-lane cards. Reduced motion shows a static glow.
2. The Replied column is set apart by one very thin dashed rule (the only separator on the board), before the
   column in reading order in both directions; on the phone layout the same language is a fine dashed top rule.

Engine-independent facts (the calm of the motion and the elegance at three widths are Thyab's device gate):
the class is truthful (a group parent with a reply glows, a no-reply card does not); the glow animates opacity
only and goes static under reduced motion; the dashed rule sits on the Replied lane alone and mirrors in
Arabic; no new colour token is introduced; and no card or address is hardcoded to glow."""
import threading, http.server, socketserver, functools, os, re
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:500])

# ---- source-level guards: derivation-driven, no new colour, no hardcoded card/address --------------------
appjs = open(os.path.join(ROOT, "library/app.js"), encoding="utf-8").read()
css = open(os.path.join(ROOT, "library/styles.css"), encoding="utf-8").read()
ck("the glow (new-activity) is derivation-driven and gated on the resolved lane via the one state law: has-reply comes from cardHasConversation through cardState, never on a card the board places at draft or ready",
   'cardHasConversation(slug) && !cardSeenHas(slug)) return "new-activity"' in appjs
   and 'var preSend = tk && (tk.lane==="draft" || tk.lane==="live")' in appjs
   and '"new-activity":"has-reply"' in appjs and "function cardHasConversation(" in appjs)
ck("cardHasConversation reads the existing reply derivation only (hasReply / groupHasAnyReply), no address literal",
   "hasReply(slug)" in appjs and "groupHasAnyReply(o)" in appjs)
# the glow reuses the Replied green via --glow-1; it must not introduce a new colour token or a raw green hex
glow_block = css[css.find(".tok.has-reply"): css.find(".tok.has-reply")+1200]
ck("the glow reuses the Replied green token (--glow-1), introducing no new colour",
   "var(--glow-1)" in glow_block and not re.search(r"#[0-9a-fA-F]{3,6}", glow_block), glow_block[:200])

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

def seed_script(child):
    return ("""
    (() => {
      const set=(k,v)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} };
      set('thrive_opps_v1', [
        { slug:'acme', business:'Acme', published:true, stage:'sent', recipients:[{addr:'omar@acme.example', name:'Omar'}] },
        { slug:'grp', business:'Group', published:true, stage:'sent',
          recipients:[{addr:'a@x.example', name:'A'},{addr:'b@x.example', name:'B'}] },
        { slug:'plain', business:'Plain', published:true, stage:'sent', recipients:[{addr:'p@x.example', name:'P'}] }
      ]);
      set('thrive_mail_v1', [
        { mid:'m1', opp:'acme', to:'omar@acme.example', subject:'Hi', status:'sent', direction:'out', ts:'2026-08-01T10:00:00Z' },
        { mid:'m2', opp:'grp', to:'a@x.example', subject:'Blast', status:'sent', direction:'out', ts:'2026-08-01T10:00:00Z' },
        { mid:'m3', opp:'plain', to:'p@x.example', subject:'Hey', status:'sent', direction:'out', ts:'2026-08-01T10:00:00Z' }
      ]);
      set('thrive_inbound_v1', [
        { gid:'r1', opp:'acme', kind:'reply', from:'omar@acme.example', subject:'Re: Hi', snippet:'yes', ts:'2026-08-03T09:00:00Z' },
        { gid:'r2', opp:'CHILD', kind:'reply', from:'a@x.example', subject:'Re: Blast', snippet:'sure', ts:'2026-08-03T09:00:00Z' }
      ]);
    })()
    """).replace("CHILD", child)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # compute the child slug once (deterministic), then seed with it
    boot = b.new_page(); boot.goto(f"{base}/library/console.html")
    boot.wait_for_function("()=>typeof window.childSlugFor==='function'", timeout=15000)
    child = boot.evaluate("()=>window.childSlugFor('grp','a@x.example')")
    boot.close()

    def open_board(reduced=False, rtl=False, wide=True):
        pg = b.new_page(viewport={"width": 1280 if wide else 380, "height": 900})
        if reduced: pg.emulate_media(reduced_motion="reduce")
        pg.goto(f"{base}/library/console.html")
        if pg.query_selector("#gateInput"):
            pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn")
        pg.wait_for_function("()=>typeof window.thriveBoardRefresh==='function' && typeof window.childSlugFor==='function'", timeout=15000)
        # seed AFTER boot (the app seeds demo data on boot; setting now and refreshing makes our data win)
        pg.evaluate("(s)=>{ eval(s); }", seed_script(child))
        if rtl: pg.evaluate("()=>{ try{ window.setLang&&window.setLang('ar'); }catch(e){} document.documentElement.setAttribute('dir','rtl'); }")
        try: pg.evaluate("()=>{ location.hash='#board'; }")
        except Exception: pass
        # the board reads the server-computed view now: seed the view rows so acme lands in Replied
        pg.evaluate("""()=>window.__boardViewSet([
          {slug:'acme', stage:'replied', open_count:1, replied:true, idle_days:3, has_page:true, has_email:false, archived:false},
          {slug:'grp', stage:'sent', open_count:0, replied:false, idle_days:3, has_page:true, has_email:false, archived:false},
          {slug:'plain', stage:'sent', open_count:0, replied:false, idle_days:3, has_page:true, has_email:false, archived:false}
        ])""")
        pg.evaluate("()=>window.thriveBoardRefresh&&window.thriveBoardRefresh()")
        pg.wait_for_function("""()=>{ const t=document.querySelector('#boardLanes .tok[data-slug=\\"acme\\"]');
          return !!t; }""", timeout=8000)
        return pg

    # ============================ derivation-driven glow ============================
    pg = open_board()
    cls = pg.evaluate("""()=>{
      const g=s=>{ const t=document.querySelector('#boardLanes .tok[data-slug="'+s+'"]'); return t? { has:t.classList.contains('has-reply'), lane:t.getAttribute('data-lane') } : null; };
      return { acme:g('acme'), grp:g('grp'), plain:g('plain') }; }""")
    ck("a Replied card carries has-reply (a reply is attributed to it)",
       cls["acme"] and cls["acme"]["has"] is True and cls["acme"]["lane"]=="replied", cls["acme"])
    ck("a group PARENT whose child replied carries has-reply, OUTSIDE the Replied lane (derivation, not lane)",
       cls["grp"] and cls["grp"]["has"] is True and cls["grp"]["lane"]!="replied", cls["grp"])
    ck("a card with no conversation does NOT glow (the class is truthful)",
       cls["plain"] and cls["plain"]["has"] is False, cls["plain"])

    # the glow is a breathing opacity animation on a layered pseudo-element (no layout property animates)
    glow = pg.evaluate("""()=>{
      const t=document.querySelector('#boardLanes .tok[data-slug="acme"]');
      const cs=getComputedStyle(t,'::after');
      return { anim:cs.animationName, boxShadow:cs.boxShadow, pos:getComputedStyle(t).position }; }""")
    ck("the glow breathes: a reply-breathe animation on the card's pseudo-element, with a soft green box-shadow",
       glow["anim"]=="reply-breathe" and glow["boxShadow"]!="none" and glow["pos"]=="relative", glow)
    pg.close()

    # ============================ reduced motion: static glow, no breathing ============================
    pg = open_board(reduced=True)
    rm = pg.evaluate("""()=>{ const t=document.querySelector('#boardLanes .tok[data-slug="acme"]');
      const cs=getComputedStyle(t,'::after'); return { anim:cs.animationName, boxShadow:cs.boxShadow }; }""")
    ck("under prefers-reduced-motion the glow is static (no animation) but still present (a soft green glow)",
       rm["anim"]=="none" and rm["boxShadow"]!="none", rm)
    pg.close()

    # ============================ the dashed boundary: Replied lane only, wide layout ============================
    pg = open_board(wide=True)
    dash = pg.evaluate("""()=>{
      const L=s=>{ const l=document.querySelector('#boardLanes .lane[data-lane="'+s+'"]'); const cs=getComputedStyle(l);
        return { left:cs.borderLeftStyle, right:cs.borderRightStyle, top:cs.borderTopStyle }; };
      return { replied:L('replied'), sent:L('sent'), opened:L('opened') }; }""")
    ck("in the wide (column) layout, the Replied lane carries one dashed inline-start rule (LTR: a left dash)",
       dash["replied"]["left"]=="dashed", dash["replied"])
    ck("no other column carries a separator (the dashed rule is the only one, before Replied)",
       dash["sent"]["left"]!="dashed" and dash["sent"]["right"]!="dashed"
       and dash["opened"]["left"]!="dashed" and dash["opened"]["right"]!="dashed", dash)
    pg.close()

    # ============================ RTL mirror: the dash sits on the inline-start (right in Arabic) ============================
    pg = open_board(wide=True, rtl=True)
    rtl = pg.evaluate("""()=>{ const l=document.querySelector('#boardLanes .lane[data-lane="replied"]'); const cs=getComputedStyle(l);
      return { left:cs.borderLeftStyle, right:cs.borderRightStyle, dir:getComputedStyle(l).direction }; }""")
    ck("in Arabic the dashed rule mirrors: inline-start is the RIGHT edge, so the dash sits before Replied in RTL",
       rtl["dir"]=="rtl" and rtl["right"]=="dashed" and rtl["left"]!="dashed", rtl)
    pg.close()

    # ============================ phone layout: a fine dashed TOP rule on the Replied lane ============================
    pg = open_board(wide=False)
    # make the replied lane the active (shown) one so it is laid out
    pg.evaluate("""()=>{ const b=document.getElementById('boardLanes'); if(b) b.setAttribute('data-active-lane','replied'); }""")
    phone = pg.evaluate("""()=>{ const l=document.querySelector('#boardLanes .lane[data-lane="replied"]'); const cs=getComputedStyle(l);
      const s=document.querySelector('#boardLanes .lane[data-lane="sent"]'); const cs2=getComputedStyle(s);
      return { repliedTop:cs.borderTopStyle, repliedLeft:cs.borderLeftStyle, sentTop:cs2.borderTopStyle }; }""")
    ck("on the phone layout the Replied lane carries the fine dashed TOP rule (same language, no columns)",
       phone["repliedTop"]=="dashed", phone)
    ck("on the phone layout no vertical column rule is drawn, and other lanes carry no dashed rule",
       phone["repliedLeft"]!="dashed" and phone["sentTop"]!="dashed", phone)
    pg.close()

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL REPLIED-GLOW CHECKS PASS"))
raise SystemExit(1 if fails else 0)
