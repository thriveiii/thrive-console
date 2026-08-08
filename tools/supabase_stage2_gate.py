"""Supabase Stage 2 proof: dual-write, read-old, backfill, verify, honest divergence.

Drives the real console in Chromium with an in-page fake Supabase (window.fetch is wrapped so every
/rest/v1/ call lands in an in-memory table store; every other URL passes through). It proves: a save lands
in BOTH the current store (localStorage) and Supabase, with the page HTML as its own console_pages row;
reads still come from the current store and never touch Supabase; the backfill copies the existing set
idempotently; the verification reports agreement and flags a seeded divergence; and a failed Supabase
write does not fail the local save, is recorded as a divergence, and is never a false success. Every
Supabase request targets a console_ table only.

The sandbox cannot run the live Supabase or WebKit, so the true dual-write and backfill are Thyab's
device. This runs the real app.js dual-write against a faithful fake of the PostgREST endpoint."""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None:
            print("      " + str(d)[:300])

FAKE = r"""
() => {
  window.__real_fetch = window.fetch.bind(window);
  window.__sb = { tables:{}, calls:0, failOpp:false };
  const pkOf = t => (t==='console_opps'||t==='console_pages') ? 'slug'
                  : (t==='console_mail'||t==='console_templates') ? 'id' : 'key';
  window.fetch = async (url, opts) => {
    try {
      if (typeof url === 'string' && url.indexOf('/rest/v1/') >= 0) {
        window.__sb.calls++;
        const u = new URL(url);
        const table = (u.pathname.split('/rest/v1/')[1] || '').split('?')[0];
        const method = (opts && opts.method) || 'GET';
        const store = window.__sb.tables[table] || (window.__sb.tables[table] = {});
        const pk = pkOf(table);
        if (method === 'POST') {
          if (table === 'console_opps' && window.__sb.failOpp) { window.__sb.failOpp = false; return new Response(JSON.stringify({message:'permission denied'}), {status:401}); }
          (JSON.parse(opts.body || '[]')).forEach(r => { store[r[pk]] = r; });
          return new Response('', {status:201});
        }
        if (method === 'DELETE') {
          const q = u.searchParams.get(pk) || ''; const m = /^eq\.(.*)$/.exec(q);
          if (m) delete store[decodeURIComponent(m[1])];
          return new Response('', {status:204});
        }
        return new Response(JSON.stringify(Object.values(store)), {status:200, headers:{'Content-Type':'application/json'}});
      }
    } catch (e) {}
    return window.__real_fetch(url, opts);
  };
  return true;
}
"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page()
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_timeout(500)
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(700)
    pg.wait_for_function("() => typeof window.saveDraft === 'function' && typeof window.ThriveSupa === 'object'", timeout=15000)
    pg.evaluate("() => localStorage.removeItem('thrive_opps_v1')")
    pg.evaluate(FAKE)
    pg.evaluate("() => window.ThriveSupa.setCfg('https://fake.supabase.co','anon-key')")

    # 1. Dual-write: a save lands in both stores; the large page is its own console_pages row.
    big = "<div>" + ("x" * 300000) + "</div>"
    pg.evaluate("(h) => window.saveDraft({ slug:'vsd', business:'VSD Photography', outreach_text:'Hi Deborah', html:h })", big)
    pg.wait_for_timeout(400)
    local = pg.evaluate("() => JSON.parse(localStorage.getItem('thrive_opps_v1')||'[]').map(o=>o.slug)")
    ck("the save lands in the current store (localStorage)", "vsd" in local, local)
    sbOpp = pg.evaluate("() => window.__sb.tables.console_opps && window.__sb.tables.console_opps.vsd")
    ck("the save also lands in Supabase console_opps", bool(sbOpp) and sbOpp.get("slug") == "vsd")
    ck("the opportunity row carries the record but not the page html", sbOpp and ("html" not in (sbOpp.get("data") or {})))
    sbPage = pg.evaluate("() => window.__sb.tables.console_pages && window.__sb.tables.console_pages.vsd")
    ck("the page is its own console_pages row, html whole", bool(sbPage) and len(sbPage.get("html") or "") == len(big), sbPage and len(sbPage.get("html") or ""))
    onlyConsole = pg.evaluate("() => Object.keys(window.__sb.tables).every(t=>t.indexOf('console_')===0)")
    ck("every Supabase request targeted a console_ table only", onlyConsole)

    # 2. Reads still come from the current store; a read does not touch Supabase.
    before = pg.evaluate("() => window.__sb.calls")
    readSlugs = pg.evaluate("async () => (await window.mergedOpps()).map(o=>o.slug)")
    after = pg.evaluate("() => window.__sb.calls")
    ck("reads return from the current store", "vsd" in readSlugs, readSlugs)
    ck("a read makes no Supabase call (read-old holds)", after == before, str(before) + " -> " + str(after))

    # 3. Honest divergence: a failed Supabase write does not fail the local save; it is recorded.
    pg.evaluate("() => { window.__sb.failOpp = true; }")
    pg.evaluate("() => window.saveDraft({ slug:'cozy', business:'Cozy Calico', outreach_text:'Hi' })")
    pg.wait_for_timeout(400)
    local2 = pg.evaluate("() => JSON.parse(localStorage.getItem('thrive_opps_v1')||'[]').map(o=>o.slug)")
    ck("the local save still succeeds when Supabase rejects it", "cozy" in local2, local2)
    ck("Supabase did NOT get the rejected opp (no false success)", not pg.evaluate("() => !!(window.__sb.tables.console_opps && window.__sb.tables.console_opps.cozy)"))
    div = pg.evaluate("() => JSON.parse(localStorage.getItem('console_sb_diverge')||'[]')")
    ck("the failed write is recorded as a divergence, not swallowed", any(d.get("key") == "cozy" for d in div), div)

    # 4. Verify reports the divergence (cozy missing in Supabase), not green.
    v1 = pg.evaluate("async () => await window.supaVerify()")
    ck("verify flags the opportunity missing in Supabase", (not v1["ok"]) and ("cozy" in v1["opps"]["missing"]), v1)

    # 5. Backfill copies the existing set idempotently; then the two agree.
    r = pg.evaluate("async () => await window.supaBackfill()")
    pg.wait_for_timeout(200)
    ck("backfill copied the opportunities", r["opps"] >= 2, r)
    ck("backfill now has cozy in Supabase too", pg.evaluate("() => !!(window.__sb.tables.console_opps && window.__sb.tables.console_opps.cozy)"))
    v2 = pg.evaluate("async () => await window.supaVerify()")
    ck("after backfill the two stores agree on opportunities and pages", v2["ok"] and v2["opps"]["missing"] == [] and v2["pages"]["missing"] == [], v2)
    # idempotent: a second backfill changes the row set count not at all
    n_before = pg.evaluate("() => Object.keys(window.__sb.tables.console_opps).length")
    pg.evaluate("async () => await window.supaBackfill()")
    n_after = pg.evaluate("() => Object.keys(window.__sb.tables.console_opps).length")
    ck("backfill is idempotent (same rows on a second run)", n_before == n_after, str(n_before) + " -> " + str(n_after))

    # 6. A delete mirrors too, so the stores stay in agreement.
    pg.evaluate("() => window.removeDraft('vsd')")
    pg.wait_for_timeout(300)
    ck("removing an opportunity removes its Supabase rows", not pg.evaluate("() => !!(window.__sb.tables.console_opps && window.__sb.tables.console_opps.vsd)"))

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL SUPABASE STAGE 2 CHECKS PASS"))
raise SystemExit(1 if fails else 0)
