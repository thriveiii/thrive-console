"""WO-002 layer 2: data safety. Export a backup before and after using the new window,
diff the two, and confirm the only differences are ones the actions taken explain."""
import threading, http.server, socketserver, functools, os, json, sys
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH","/opt/pw-browsers")
ROOT=os.path.abspath("."); CH="/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
H=functools.partial(http.server.SimpleHTTPRequestHandler,directory=ROOT)
socketserver.TCPServer.allow_reuse_address=True
httpd=socketserver.TCPServer(("127.0.0.1",0),H); PORT=httpd.server_address[1]
httpd.daemon_threads=True; threading.Thread(target=httpd.serve_forever,daemon=True).start()
base=f"http://127.0.0.1:{PORT}"; EP=f"{base}/exec"
STORE={"data":None}; PUTS=[0]
def relay(route):
    if route.request.method=="GET":
        return route.fulfill(status=200, body="Thrive relay v4 is running.")
    d=json.loads(route.request.post_data or "{}"); op=d.get("op")
    if op=="state_get": return route.fulfill(status=200, body=json.dumps({"ok":True,"data":STORE["data"]}))
    if op=="state_put":
        STORE["data"]=d.get("data"); PUTS[0]+=1
        return route.fulfill(status=200, body=json.dumps({"ok":True}))
    if op=="hits_get": return route.fulfill(status=200, body=json.dumps({"ok":True,"events":[]}))
    return route.fulfill(status=200, body=json.dumps({"ok":True,"id":"x"}))

from playwright.sync_api import sync_playwright
fails=[]
def ck(n,c,d=None):
    print(("PASS " if c else "FAIL ")+n)
    if not c:
        fails.append(n)
        if d is not None: print("      "+str(d)[:400])

with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CH)
    ctx=b.new_context(viewport={"width":1280,"height":900})
    ctx.route("**/exec", relay)
    ctx.route("**/library/sync.json", lambda r:r.fulfill(status=200, body=json.dumps({"ep":EP,"up":1})))
    ctx.route("https://api.github.com/**", lambda r:r.abort())
    pg=ctx.new_page(); errs=[]
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{base}/library/console.html"); pg.wait_for_timeout(400)
    if pg.query_selector("#thriveGate"):
        pg.fill("#gateInput","ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1500)
    pg.reload(); pg.wait_for_timeout(2800)

    keys_before = pg.evaluate("()=>Object.keys(localStorage).sort()")
    before = pg.evaluate("()=>JSON.stringify(exportBackup())")
    puts_before = PUTS[0]

    # Use the window the way a person would: open it, walk every tab, close it.
    pg.evaluate("()=>location.hash='#board'"); pg.wait_for_timeout(1600)
    pg.query_selector(".tok[data-slug]").click(); pg.wait_for_timeout(1400)
    for tab in ("text","page","outreach","history","overview"):
        pg.click(f"#modalTabs [data-tab='{tab}']"); pg.wait_for_timeout(1200)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(900)

    keys_after = pg.evaluate("()=>Object.keys(localStorage).sort()")
    after = pg.evaluate("()=>JSON.stringify(exportBackup())")

    ck("no storage key was renamed, added, or removed", keys_before==keys_after,
       {"only_before":[k for k in keys_before if k not in keys_after],
        "only_after":[k for k in keys_after if k not in keys_before]})

    a=json.loads(before); c=json.loads(after)
    diff={}
    for k in set(list(a.keys())+list(c.keys())):
        if a.get(k)!=c.get(k): diff[k]=(str(a.get(k))[:120], str(c.get(k))[:120])
    print("backup fields that differ:", list(diff.keys()) or "none")
    # The export stamps itself with the moment it was taken, so two exports always differ by
    # that one field. It is the difference the act of exporting causes, not a data change.
    ck("the export stamps its own time, which is the one intended difference",
       "exported" in diff, list(diff.keys()))
    rest={k:v for k,v in diff.items() if k!="exported"}
    ck("nothing else in the backup changed", not rest, rest)

    # Sync now, and confirm the counters move exactly as they did before.
    pg.evaluate("()=>location.hash='#settings'"); pg.wait_for_timeout(2200)
    ok = pg.evaluate("async ()=>{ try{ await syncNow(); return true; }catch(e){ return String(e); } }")
    pg.wait_for_timeout(1200)
    ck("Sync now completes", ok is True, ok)
    ck("and the relay received a push", PUTS[0] > puts_before, (puts_before, PUTS[0]))
    ck("and a last sync time is recorded", bool(pg.evaluate("()=>syncLast()")))
    ck("nothing threw", not errs, errs[:3])
    b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
