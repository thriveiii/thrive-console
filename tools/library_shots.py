"""Library card evidence: an even grid at three widths in both locales, a single card zoomed,
and assertions that every action survives (now re-tiered behind the disclosure) and cards share
one height per row."""
import threading, http.server, socketserver, functools, os, sys
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH","/opt/pw-browsers")
ROOT="/home/user/thrive-console"; PORT=int(sys.argv[2]) if len(sys.argv)>2 else 8853
TAG=sys.argv[1] if len(sys.argv)>1 else "after"
H=functools.partial(http.server.SimpleHTTPRequestHandler,directory=ROOT)
s=socketserver.TCPServer(("127.0.0.1",PORT),H); s.daemon_threads=True
threading.Thread(target=s.serve_forever,daemon=True).start()
from playwright.sync_api import sync_playwright
base=f"http://127.0.0.1:{PORT}"; CH="/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
OUT=ROOT+"/shots/library"; os.makedirs(OUT,exist_ok=True)
# a live card with opens, a draft, an archived, and a half-published, so states differ and the
# shared skeleton has to hold them all even.
SEED="""()=>{const now=Date.now(),iso=d=>new Date(now-d*86400000).toISOString();
 localStorage.setItem('thrive_opps_v1',JSON.stringify([
  {slug:'aurora',business:'Aurora Consulting',published:true,up:now,stage:'sent',template:'en-opp1',sent_on:'2026-07-30',location:'Kuwait City'},
  {slug:'borealis',business:'Borealis Media Group and Partners',published:true,up:now,template:'custom',sent_on:'2026-07-28',location:'Salmiya'},
  {slug:'cedar',business:'Cedar Draft Co',published:false,up:now,template:'en-opp1',sent_on:'2026-08-01',location:'Hawally'},
  {slug:'delta',business:'مؤسسة دلتا للتسويق',published:true,up:now,archived:true,template:'ar-opp1',sent_on:'2026-07-20',location:'الكويت'}]));
 localStorage.setItem('thrive_mail_v1',JSON.stringify([
  {mid:'a1',opp:'aurora',direction:'out',status:'sent',to:'a@x.example',ts:iso(6)}]));
 localStorage.setItem('thrive_hits_v1',JSON.stringify([
  {type:'open',slug:'aurora',vid:'v1',ts:iso(3)},{type:'open',slug:'aurora',vid:'v2',ts:iso(2)}]));
}"""
def enter(pg,lang):
 pg.goto(base+"/library/console.html"); pg.wait_for_timeout(400)
 pg.evaluate("l=>localStorage.setItem('thrive_lang',l)",lang)
 if pg.query_selector("#thriveGate"): pg.fill("#gateInput","ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1200)
 pg.evaluate(SEED); pg.reload(); pg.wait_for_timeout(1800)
 if pg.query_selector("#thriveGate"): pg.fill("#gateInput","ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1200)
 pg.evaluate("()=>{document.querySelectorAll('.brand img,.gate-logo').forEach(e=>e.style.animation='none')}")
 pg.evaluate("()=>location.hash='#library'"); pg.wait_for_timeout(1200)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=CH)
 for lang in ("en","ar"):
  for (w,h) in [(390,900),(768,1000),(1440,900)]:
   ctx=b.new_context(viewport={"width":w,"height":h},has_touch=(w<=430),is_mobile=(w<=430))
   ctx.route("https://api.github.com/**",lambda x:x.abort())
   pg=ctx.new_page(); enter(pg,lang)
   pg.screenshot(path=f"{OUT}/lib-{TAG}-{lang}-{w}.png", clip={"x":0,"y":0,"width":w,"height":min(h,880)})
   if w==768 and lang=="en":
    # single card crop for before/after
    c=pg.query_selector(".card")
    if c: c.screenshot(path=f"{OUT}/card-{TAG}.png")
    # assertions: actions reachable, even rows
    facts=pg.evaluate("""()=>{
      const cards=[...document.querySelectorAll('.card')];
      const heights=cards.map(c=>Math.round(c.getBoundingClientRect().height));
      // group by row (same top)
      const rows={}; cards.forEach(c=>{const t=Math.round(c.getBoundingClientRect().top/5)*5;(rows[t]=rows[t]||[]).push(Math.round(c.getBoundingClientRect().height));});
      const rowSpread=Object.values(rows).map(hs=>Math.max(...hs)-Math.min(...hs));
      // action inventory across all cards (face + inside details): count data-* controls and action links
      const acts=[...document.querySelectorAll('.card [data-pub],.card [data-pdf],.card [data-unpub],.card [data-prev],.card [data-arch],.card [data-del],.card [data-finish],.card .stage-sel,.card .card-more a,.card .card-act a')].length;
      const more=[...document.querySelectorAll('.card details.card-more')].length;
      return {cardHeights:heights, maxRowHeightSpread:Math.max(...rowSpread,0), actionControlsTotal:acts, cardsWithMoreDisclosure:more, cardCount:cards.length};
    }""")
    print("AFTER facts:", facts)
   ctx.close()
 b.close()
s.shutdown()
print("shots done ->", TAG)
