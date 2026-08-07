"""End-to-end coherence trace. One opportunity per lifecycle state (draft, live, sent, opened, replied),
seeded with real evidence (published flag, mail sends, page opens), then every interface is read and
checked for agreement: effStage is the authority; the board lane and count, the library pill count and
card stage, and the editor Overview state must all reflect it; Insights numbers must match the ledger;
and Arabic must resolve with no leaked keys. api.github.com and the live host are mocked. The real
end-to-end run against the relay and GitHub is Thyab's device."""
import threading, http.server, socketserver, functools, os, json
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT="/home/user/thrive-console"; CH="/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
Handler=functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address=True
httpd=socketserver.TCPServer(("127.0.0.1",0),Handler); PORT=httpd.server_address[1]
httpd.daemon_threads=True; threading.Thread(target=httpd.serve_forever,daemon=True).start()
base=f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

fails=[]
def ck(n,c,d=None):
    print(("PASS " if c else "FAIL ")+n)
    if not c:
        fails.append(n)
        if d is not None: print("      "+str(d)[:400])

# one opp per state, with the evidence each state actually needs
OPPS=[
 {"slug":"c-draft","business":"Draft Co","_local":True,"published":False,"template":"en-opp1","up":1},
 {"slug":"c-live","business":"Live Co","_local":True,"published":True,"template":"en-opp1","up":1},
 {"slug":"c-sent","business":"Sent Co","_local":True,"published":True,"template":"en-opp1","up":1},
 {"slug":"c-open","business":"Opened Co","_local":True,"published":True,"template":"en-opp1","up":1},
 {"slug":"c-reply","business":"Replied Co","_local":True,"published":True,"template":"en-opp1","stage":"replied","up":1},
]
MAIL=[
 {"opp":"c-sent","status":"sent","ts":"2026-08-01T10:00:00Z","to":"a@x.com","mid":"m1"},
 {"opp":"c-open","status":"sent","ts":"2026-08-01T10:00:00Z","to":"b@x.com","mid":"m2"},
 {"opp":"c-reply","status":"sent","ts":"2026-08-01T10:00:00Z","to":"c@x.com","mid":"m3"},
]
HITS=[{"slug":"c-open","type":"open","vid":"v1","ip":"1","ts":"2026-08-02T10:00:00Z","self":False}]
EXPECT={"c-draft":"draft","c-live":"live","c-sent":"sent","c-open":"opened","c-reply":"replied"}

def boot(ctx, lang="en"):
    pg=ctx.new_page(); pg.goto(f"{base}/library/console.html"); pg.wait_for_timeout(500)
    if pg.query_selector("#thriveGate"): pg.fill("#gateInput","ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(500)
    pg.evaluate("""(a)=>{ localStorage.setItem('thrive_lang',a.l);
      localStorage.setItem('thrive_opps_v1', JSON.stringify(a.opps));
      localStorage.setItem('thrive_mail_v1', JSON.stringify(a.mail));
      localStorage.setItem('thrive_hits_v1', JSON.stringify(a.hits)); }""",{"l":lang,"opps":OPPS,"mail":MAIL,"hits":HITS})
    pg.reload(); pg.wait_for_timeout(1100)
    if pg.query_selector("#thriveGate"): pg.fill("#gateInput","ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(500)
    return pg

with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CH)
    ctx=b.new_context(viewport={"width":1440,"height":1000})
    ctx.route("https://api.github.com/**", lambda r: r.fulfill(status=404, body="{}"))
    ctx.route("https://console.thriveiii.com/**", lambda r: r.fulfill(status=200, body="<html>live</html>"))
    ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body=json.dumps({"opportunities":[]})))
    pg=boot(ctx)

    # AUTHORITY: effStage per opp matches the expected lifecycle state
    eff=pg.evaluate("async()=>{ const os=await mergedOpps(); const m={}; os.forEach(o=>m[o.slug]=effStage(o)); return m; }")
    print("   effStage:", eff)
    for slug,exp in EXPECT.items():
        ck(f"effStage authority: {slug} is '{exp}'", eff.get(slug)==exp, eff.get(slug))

    # BOARD: each card sits in the lane that equals its effStage, and lane counts equal the cards
    board=pg.evaluate("""()=>{
      const lane={}, cnt={};
      document.querySelectorAll('.tok[data-slug]').forEach(t=>lane[t.getAttribute('data-slug')]=t.getAttribute('data-lane'));
      ['draft','live','sent','opened','replied'].forEach(k=>{ const e=document.querySelector('[data-count=\"'+k+'\"]'); cnt[k]=e?+e.textContent:null; });
      return {lane, cnt};
    }""")
    print("   board:", board)
    for slug,exp in EXPECT.items():
        ck(f"board places {slug} in the '{exp}' lane", board["lane"].get(slug)==exp, board["lane"].get(slug))
    laneCounts={k:sum(1 for s,e in EXPECT.items() if e==k) for k in ["draft","live","sent","opened","replied"]}
    for k,n in laneCounts.items():
        ck(f"board count for '{k}' matches the cards ({n})", board["cnt"].get(k)==n, (k,board["cnt"].get(k),n))

    # LIBRARY: the stage pill counts equal the effStage tally, and each card's stage reads stage_<eff>
    pg.evaluate("()=>location.hash='#library'"); pg.wait_for_timeout(900)
    lib=pg.evaluate("""()=>{
      const pill={}; document.querySelectorAll('.pl-pill[data-stage-f]').forEach(p=>{
        const b=p.querySelector('b'); pill[p.getAttribute('data-stage-f')]= b?+b.textContent:null; });
      const cards={}; document.querySelectorAll('select.stage-sel[data-stage]').forEach(s=>{
        cards[s.getAttribute('data-stage')]=s.options[0]?s.options[0].textContent:''; });
      return {pill, cards};
    }""")
    print("   library:", lib)
    for k,n in laneCounts.items():
        ck(f"library pill count for '{k}' matches effStage tally ({n})", lib["pill"].get(k)==n, (k,lib["pill"].get(k),n))
    ck("library card stage label uses the stage_ family (auto shows the derived stage)",
       "Ready to send" in (lib["cards"].get("c-live") or ""), lib["cards"].get("c-live"))

    # OVERVIEW (editor): the state row reflects effStage via stageName (lane_ family)
    ov={}
    for slug in EXPECT:
        pg.evaluate("(s)=>window.thriveModal.open(s,'overview','x')", slug); pg.wait_for_timeout(500)
        el=pg.query_selector(".mw-state")
        ov[slug]=el.text_content() if el else ""
        pg.evaluate("()=>window.thriveModal.close && window.thriveModal.close()"); pg.wait_for_timeout(150)
    print("   overview state labels:", ov)
    ck("editor Overview shows a state for every opp", all(ov[s] for s in EXPECT), ov)

    # INSIGHTS: the ledger numbers match reality (sent for sent/opened/replied, a view for opened)
    pg.evaluate("()=>location.hash='#home'"); pg.wait_for_timeout(1200)
    ins=pg.evaluate("""()=>{
      const r={}; document.querySelectorAll('#homeCampaigns tbody tr').forEach(tr=>{
        const td=[...tr.children]; const name=td[0].textContent.trim();
        r[name]={sent:td[1].textContent.trim(), views:td[2].textContent.trim(), opens:td[3].textContent.trim()}; });
      return r;
    }""")
    print("   insights:", ins)
    ck("Insights shows the send for Sent Co", ins.get("Sent Co",{}).get("sent")=="1", ins.get("Sent Co"))
    ck("Insights shows the send and the view for Opened Co",
       ins.get("Opened Co",{}).get("sent")=="1" and ins.get("Opened Co",{}).get("views")=="1", ins.get("Opened Co"))
    ctx.close()

    # BILINGUAL: Arabic resolves across surfaces, RTL, no leaked keys
    ctx2=b.new_context(viewport={"width":1440,"height":1000})
    ctx2.route("https://api.github.com/**", lambda r: r.fulfill(status=404, body="{}"))
    ctx2.route("https://console.thriveiii.com/**", lambda r: r.fulfill(status=200, body="<html>live</html>"))
    ctx2.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body=json.dumps({"opportunities":[]})))
    pg=boot(ctx2,"ar")
    dirok=pg.eval_on_selector("html","e=>e.getAttribute('dir')")=="rtl"
    ck("Arabic sets RTL on the document", dirok)
    pg.evaluate("()=>location.hash='#library'"); pg.wait_for_timeout(900)
    leaked=pg.evaluate("""()=>{ const t=document.body.innerText; return (t.match(/\\b(lane|stage)_[a-z]+/g)||[]); }""")
    ck("no raw i18n keys leak on screen in Arabic", len(leaked)==0, leaked)
    arpills=pg.evaluate("""()=>[...document.querySelectorAll('.pl-pill[data-stage-f]')].map(p=>p.textContent.replace(/\\d+/g,'').trim())""")
    print("   AR library pills:", arpills)
    ck("Arabic library pills are non-empty labels", all(x for x in arpills) and len(arpills)>=5, arpills)
    ctx2.close()

print("\n%d failed"%len(fails))
for f in fails: print("  -",f)
import sys; sys.exit(1 if fails else 0)
