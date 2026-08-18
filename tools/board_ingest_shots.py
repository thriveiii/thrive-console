"""P14 shots: the board's "Today's batch" drop now renders the tolerant resolver's report (provenance +
needs-message Write), the same as the editor upload. Batch-13 shape, EN and AR, phone / desktop."""
import threading, http.server, socketserver, functools, os, json
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH","/opt/pw-browsers")
ROOT="/home/user/thrive-console"; CH="/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
OUT=os.path.join(ROOT,"scratchpad_shots"); os.makedirs(OUT,exist_ok=True)
RESEARCH=open(os.path.join(ROOT,"tools/fixtures/BATCH13_research_and_messages.md")).read()
SLUGS=["river-sea-chocolates","ludic-lillian","wise-butterfly","jamiyat-alsharq-lilhulwiat","wander-wick-candles","corner-bloom-studio"]
H=functools.partial(http.server.SimpleHTTPRequestHandler,directory=ROOT)
socketserver.TCPServer.allow_reuse_address=True
s=socketserver.TCPServer(("127.0.0.1",0),H); PORT=s.server_address[1]; s.daemon_threads=True
threading.Thread(target=s.serve_forever,daemon=True).start()
base=f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright
def drop_js():
    fs=[{"name":f"opp/{x}/index.html","text":f"<!doctype html><title>{x}</title><h1>{x}</h1>","type":"text/html"} for x in SLUGS]
    fs.append({"name":"opp/silent-shop/index.html","text":"<!doctype html><title>Silent</title><p>x</p>","type":"text/html"})
    fs.append({"name":"BATCH13_research_and_messages.md","text":RESEARCH,"type":"text/markdown"})
    return "const SPEC="+json.dumps(fs)+";"+r"""
      const dt=new DataTransfer(); SPEC.forEach(f=>dt.items.add(new File([f.text],f.name,{type:f.type})));
      const inp=document.getElementById('intakeFile'); inp.files=dt.files; inp.dispatchEvent(new Event('change',{bubbles:true}));"""
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CH)
    for lang in ("en","ar"):
        for (w,h,tag) in [(390,900,"phone"),(1280,900,"desktop")]:
            pg=b.new_page(viewport={"width":w,"height":h})
            pg.goto(f"{base}/library/board.html")
            if pg.query_selector("#gateInput"): pg.fill("#gateInput","ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(300)
            if lang=="ar":
                pg.evaluate("()=>{try{localStorage.setItem('thrive_lang','ar');}catch(e){}}"); pg.reload()
                if pg.query_selector("#gateInput"): pg.fill("#gateInput","ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(300)
            pg.wait_for_function("()=>window.ThriveIntake && ThriveIntake.readBatch && document.getElementById('intakeFile')",timeout=15000)
            pg.wait_for_timeout(400)
            pg.evaluate(drop_js())
            pg.wait_for_selector("#intakeOut .bt tr.is-matched, #intakeOut .bt tr.is-needs",timeout=15000)
            pg.wait_for_timeout(500)
            hscroll=pg.evaluate("()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1")
            pg.locator("#intakeZone").screenshot(path=f"{OUT}/board_ingest_{lang}_{tag}.png")
            print(f"wrote board_ingest_{lang}_{tag}.png hscroll={hscroll}")
            pg.close()
    b.close()
s.shutdown()
