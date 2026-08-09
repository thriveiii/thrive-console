"""Migrate the mail ledger, replies and opens, from one writer, so the states and the reply come back.

Stage 2 migrated opportunities, pages and templates but not the reply store or the opens, and Stage 3
switched reads to Supabase, so states derived from those stores fell back to Ready. This proves the fix:
one writer per store, the ledger/replies/opens dual-write and backfill, and when reads come from Supabase
effStage derives the true Sent, Opened and Replied, with the reply (the international-schools one) back.

Part 1 (source): the ledger has one writer (logMail, merging against the current store), the replies one
writer (setInbound), the opens one writer (setRemoteHits); the relay is a courier and writes no console
ledger; console_mail/inbound/hits are written only through the mirror helpers. Part 2 (Chromium, fake
PostgREST): dual-write lands each store in Supabase once, backfill is idempotent, reading from Supabase
restores Sent/Opened/Replied and the reply, and the per-table verification reports agreement and flags a
seeded per-table divergence.

The sandbox cannot run the live Supabase or WebKit, so the true restore is Thyab's device."""
import threading, http.server, socketserver, functools, os, re
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None:
            print("      " + str(d)[:300])

# ---- Part 1: single writer per store, from the source -----------------------
app = open(os.path.join(ROOT, "library/app.js")).read()
relay = open(os.path.join(ROOT, "relay/thrive-relay.gs")).read()
ck("the ledger has one writer: logMail merges against the current store and mirrors console_mail",
   "function logMail(rec)" in app and "const a=getMailLogLocal();" in app and "supaMirrorMail(r);" in app)
ck("the replies have one writer: setInbound mirrors console_inbound",
   re.search(r"function setInbound\(a\)\{[^}]*supaMirrorInbound\(a\)", app) is not None)
setrh = app[app.index("function setRemoteHits(a)"): app.index("function setRemoteHits(a)") + 200]
ck("the opens have one writer: setRemoteHits mirrors console_hits", "supaMirrorHits(a)" in setrh)
ck("console_mail is written only through the mirror/backfill (no second writer)",
   app.count('upsert("console_mail"') <= 2 and 'ThriveSupa.upsert("console_mail"' not in relay)
relay_send = relay[relay.index("function sendMail_"): relay.index("function json_")]
relay_send_code = re.sub(r"/\*.*?\*/", "", relay_send, flags=re.S)
relay_send_code = re.sub(r"//.*", "", relay_send_code)
ck("the relay is a courier: it writes no ledger of its own", "console_mail" not in relay_send_code and "console_inbound" not in relay_send_code)

# ---- Part 2: behavior against a fake PostgREST ------------------------------
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

FAKE = r"""
() => {
  window.__real_fetch = window.fetch.bind(window);
  window.__sb = { tables:{ console_opps:{}, console_pages:{}, console_templates:{}, console_mail:{}, console_inbound:{}, console_hits:{}, console_settings:{} }, calls:0 };
  const pk = t => (t==='console_opps'||t==='console_pages') ? 'slug' : (t==='console_settings') ? 'key' : 'id';
  window.fetch = async (url, opts) => {
    try {
      if (typeof url === 'string' && url.indexOf('/rest/v1/') >= 0) {
        window.__sb.calls++;
        const u = new URL(url);
        const table = (u.pathname.split('/rest/v1/')[1] || '').split('?')[0];
        const method = (opts && opts.method) || 'GET';
        const store = window.__sb.tables[table] || (window.__sb.tables[table] = {});
        const key = pk(table);
        if (method === 'POST') { (JSON.parse(opts.body || '[]')).forEach(r => { store[r[key]] = r; }); return new Response('', {status:201}); }
        if (method === 'DELETE') { const q = u.searchParams.get(key) || ''; const m = /^eq\.(.*)$/.exec(q); if (m) delete store[decodeURIComponent(m[1])]; return new Response('', {status:204}); }
        return new Response(JSON.stringify(Object.values(store)), {status:200, headers:{'Content-Type':'application/json'}});
      }
    } catch (e) {}
    return window.__real_fetch(url, opts);
  };
  return true;
}
"""
SLUG = "intl-schools"

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page()
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_timeout(500)
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(700)
    pg.wait_for_function("() => typeof window.logMail === 'function' && typeof window.supaHydrate === 'function'", timeout=15000)
    pg.evaluate("() => { ['thrive_opps_v1','thrive_mail_v1','thrive_inbound_v1','thrive_hits_remote_v1','thrive_hits_v1'].forEach(k=>localStorage.removeItem(k)); }")
    pg.evaluate(FAKE)
    pg.evaluate("() => window.ThriveSupa.setCfg('https://fake.supabase.co','anon')")

    # Dual-write each store through its one writer.
    pg.evaluate("(s) => window.saveDraft({ slug:s, business:'International Schools', published:true })", SLUG)
    pg.evaluate("(s) => window.logMail({ opp:s, status:'sent', to:'head@intlschools.example', subject:'Introduction', ts:'2026-08-01T10:00:00Z' })", SLUG)
    pg.evaluate("(s) => window.setInbound([{ gid:'g-intl-1', opp:s, kind:'', direction:'in', ts:'2026-08-03T09:00:00Z', snippet:'Yes, let us talk.' }])", SLUG)
    pg.evaluate("(s) => window.setRemoteHits([{ type:'open', slug:s, ts:'2026-08-02T10:00:00Z', vid:'v1' }])", SLUG)
    pg.wait_for_timeout(400)
    ck("dual-write: the sent landed in console_mail", pg.evaluate("() => Object.keys(window.__sb.tables.console_mail).length") == 1)
    ck("dual-write: the reply landed in console_inbound", pg.evaluate("() => !!window.__sb.tables.console_inbound['g-intl-1']"))
    ck("dual-write: the open landed in console_hits", pg.evaluate("() => Object.keys(window.__sb.tables.console_hits).length") == 1)

    # Backfill is idempotent: re-running does not double a row.
    pg.evaluate("async () => await window.supaBackfill()")
    pg.evaluate("async () => await window.supaBackfill()")
    ck("no doubled counts: console_mail still holds one row after two backfills",
       pg.evaluate("() => Object.keys(window.__sb.tables.console_mail).length") == 1)
    ck("no doubled counts: console_inbound still holds one row", pg.evaluate("() => Object.keys(window.__sb.tables.console_inbound).length") == 1)

    # Read from Supabase: the states derive from the migrated rows, and the reply is back.
    pg.evaluate("() => localStorage.setItem('console_sb_read','1')")
    pg.evaluate("async () => await window.supaHydrate()")
    ck("reading from Supabase, the ledger has the send", pg.evaluate("(s)=>window.sendsFor(s).count>=1", SLUG))
    ck("reading from Supabase, the open is counted (Opened)", pg.evaluate("(s)=>window.outreachOpens(s)>=1", SLUG))
    ck("reading from Supabase, the reply is present (Replied)", pg.evaluate("(s)=>window.inboundFor(s).length>=1", SLUG))
    stage = pg.evaluate("async (s)=>{ const opps=await window.mergedOpps(); const o=opps.find(x=>x.slug===s); return window.effStage(o); }", SLUG)
    ck("reading from Supabase, effStage is a true state, not Ready/draft", stage in ("sent", "opened", "replied"), stage)
    ck("the international-schools reply shows again", pg.evaluate("(s)=>window.inboundFor(s).some(r=>/talk/i.test(r.snippet||''))", SLUG))

    # Per-table verification: agreement, then a seeded per-table divergence is named.
    v1 = pg.evaluate("async () => await window.supaVerify()")
    ck("per-table verify reports agreement across every table", v1["ok"] and v1["mail"]["missing"] == [] and v1["inbound"]["missing"] == [] and v1["hits"]["missing"] == [], v1)
    pg.evaluate("() => { delete window.__sb.tables.console_inbound['g-intl-1']; }")
    v2 = pg.evaluate("async () => await window.supaVerify()")
    ck("per-table verify flags the divergence on the right table (inbound), not the others",
       (not v2["ok"]) and len(v2["inbound"]["missing"]) == 1 and v2["mail"]["missing"] == [], v2)

    ck("isolation: every Supabase request targeted a console_ table only",
       pg.evaluate("() => Object.keys(window.__sb.tables).every(t=>t.indexOf('console_')===0)"))

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL MAIL MIGRATE CHECKS PASS"))
raise SystemExit(1 if fails else 0)
