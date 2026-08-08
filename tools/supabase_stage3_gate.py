"""Supabase Stage 3 proof: read from Supabase, keep dual-write, guarded fallback, revert flag, refusal.

Drives the real console in Chromium with an in-page fake Supabase (window.fetch wrapped). It proves the
board read (getDrafts / mergedOpps) comes from Supabase when the switch is on, that writes still go to
both stores, that a forced Supabase read failure falls back to the current store and is surfaced as
degraded (never a blank), that the revert flag returns reads to the current store with no data change,
that the switch is refused when the two stores diverge (naming the divergence), and that a read no longer
depends on localStorage capacity. Every Supabase request targets a console_ table only.

The sandbox cannot run the live Supabase or WebKit, so the true read switch is Thyab's device. This runs
the real app.js read cache against a faithful fake of the PostgREST endpoint."""
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
  window.__sb = { tables:{ console_opps:{}, console_pages:{}, console_templates:{} }, calls:0, failGetOpps:false };
  const pkOf = t => (t==='console_opps'||t==='console_pages') ? 'slug' : (t==='console_mail'||t==='console_templates') ? 'id' : 'key';
  window.fetch = async (url, opts) => {
    try {
      if (typeof url === 'string' && url.indexOf('/rest/v1/') >= 0) {
        window.__sb.calls++;
        const u = new URL(url);
        const table = (u.pathname.split('/rest/v1/')[1] || '').split('?')[0];
        const method = (opts && opts.method) || 'GET';
        const store = window.__sb.tables[table] || (window.__sb.tables[table] = {});
        const pk = pkOf(table);
        if (method === 'POST') { (JSON.parse(opts.body || '[]')).forEach(r => { store[r[pk]] = r; }); return new Response('', {status:201}); }
        if (method === 'DELETE') { const q = u.searchParams.get(pk) || ''; const m = /^eq\.(.*)$/.exec(q); if (m) delete store[decodeURIComponent(m[1])]; return new Response('', {status:204}); }
        if (table === 'console_opps' && window.__sb.failGetOpps) return new Response(JSON.stringify({message:'read failed'}), {status:500});
        return new Response(JSON.stringify(Object.values(store)), {status:200, headers:{'Content-Type':'application/json'}});
      }
    } catch (e) {}
    return window.__real_fetch(url, opts);
  };
  return true;
}
"""

def seed_sb_opp(pg, slug, biz, html=None):
    pg.evaluate("""([s,b,h])=>{ window.__sb.tables.console_opps[s]={slug:s,data:{slug:s,business:b}};
       if(h!=null) window.__sb.tables.console_pages[s]={slug:s,html:h}; }""", [slug, biz, html])

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page()
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_timeout(500)
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(700)
    pg.wait_for_function("() => typeof window.getDrafts === 'function' && typeof window.supaHydrate === 'function'", timeout=15000)
    pg.evaluate(FAKE)
    pg.evaluate("() => { localStorage.setItem('thrive_opps_v1', JSON.stringify([{slug:'local-only', business:'Local Only', up:1}])); }")
    pg.evaluate("() => window.ThriveSupa.setCfg('https://fake.supabase.co','anon')")

    # A. Read source is Supabase. Seed a record ONLY in Supabase and confirm it is read; the local-only
    #    record is NOT read, proving the source really is Supabase.
    seed_sb_opp(pg, "sup-vsd", "VSD (from Supabase)", "<b>BIG PAGE</b>")
    pg.evaluate("() => localStorage.setItem('console_sb_read','1')")
    pg.evaluate("async () => await window.supaHydrate()")
    drafts = pg.evaluate("() => window.getDrafts().map(o=>o.slug)")
    ck("A: getDrafts reads from Supabase (has the Supabase-only record)", "sup-vsd" in drafts, drafts)
    ck("A: getDrafts does NOT return the localStorage-only record when reading Supabase", "local-only" not in drafts, drafts)
    ck("A: the page html joins in from console_pages", pg.evaluate("() => { const o=window.getDrafts().find(x=>x.slug==='sup-vsd'); return o && o.html; }") == "<b>BIG PAGE</b>")
    merged = pg.evaluate("async () => (await window.mergedOpps()).map(o=>o.slug)")
    ck("A: the board (mergedOpps) reads from Supabase too", "sup-vsd" in merged and "local-only" not in merged, merged)
    ck("A: the read source reports supabase", pg.evaluate("() => window.supaReadStatus().source") == "supabase")

    # B. Writes still go to both stores (dual-write unchanged).
    pg.evaluate("() => window.saveDraft({ slug:'w1', business:'Written', outreach_text:'hi' })")
    pg.wait_for_timeout(300)
    ck("B: a write lands in the current store (localStorage)", "w1" in pg.evaluate("() => JSON.parse(localStorage.getItem('thrive_opps_v1')||'[]').map(o=>o.slug)"))
    ck("B: a write lands in Supabase", pg.evaluate("() => !!window.__sb.tables.console_opps.w1"))
    ck("B: a write is visible in the read cache immediately", "w1" in pg.evaluate("() => window.getDrafts().map(o=>o.slug)"))

    # C. A failed Supabase read falls back to the current store and is surfaced as degraded, never blank.
    pg.evaluate("() => { window.__sb.failGetOpps = true; }")
    pg.evaluate("async () => await window.supaHydrate()")
    fb = pg.evaluate("() => window.getDrafts().map(o=>o.slug)")
    ck("C: a failed Supabase read falls back to the current store (not blank)", ("local-only" in fb) and ("w1" in fb), fb)
    ck("C: the degradation is surfaced honestly (degraded flag, source local)",
       pg.evaluate("() => window.supaReadStatus().degraded") is True and pg.evaluate("() => window.supaReadStatus().source") == "local")
    pg.evaluate("() => { window.__sb.failGetOpps = false; }")

    # D. The revert flag returns reads to the current store, no data change.
    pg.evaluate("async () => await window.supaSetRead(false)")
    rev = pg.evaluate("() => window.getDrafts().map(o=>o.slug)")
    ck("D: after revert, reads come from the current store", ("local-only" in rev) and ("sup-vsd" not in rev), rev)
    ck("D: the flag is off after revert", pg.evaluate("() => localStorage.getItem('console_sb_read')") == "0")

    # E. The switch is refused when the two stores diverge (a local opp missing in Supabase), named.
    pg.evaluate("() => { localStorage.setItem('thrive_opps_v1', JSON.stringify([{slug:'local-only',business:'L',up:1},{slug:'diverge-x',business:'X',up:1}])); }")
    res = pg.evaluate("async () => await window.supaSetRead(true)")
    ck("E: the read switch is refused on divergence", res.get("ok") is False and res.get("reason") == "diverge", res)
    ck("E: the divergence names the missing record", "diverge-x" in (res.get("verify", {}).get("opps", {}).get("missing", [])), res)
    ck("E: the flag stays off after a refused switch", pg.evaluate("() => localStorage.getItem('console_sb_read')") == "0")

    # F. A read no longer depends on localStorage capacity: with the switch on and the cache hydrated,
    #    an emptied (full/truncated) local store does not blank the board. First make the stores agree
    #    with a backfill (copies the current store into Supabase), so the guarded switch is allowed.
    pg.evaluate("async () => await window.supaBackfill()")
    r2 = pg.evaluate("async () => await window.supaSetRead(true)")
    ck("F: switch succeeds once the stores agree (after backfill)", r2.get("ok") is True, r2)
    pg.evaluate("() => { localStorage.setItem('thrive_opps_v1', '[]'); }")   # simulate a full/truncated local store
    cap = pg.evaluate("() => window.getDrafts().map(o=>o.slug)")
    ck("F: an emptied local store does not break the board (reads still come from Supabase)", ("local-only" in cap) and ("diverge-x" in cap), cap)

    # G. Isolation: every Supabase request targeted a console_ table only.
    ck("G: every Supabase request targeted a console_ table only",
       pg.evaluate("() => Object.keys(window.__sb.tables).every(t=>t.indexOf('console_')===0)"))

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL SUPABASE STAGE 3 CHECKS PASS"))
raise SystemExit(1 if fails else 0)
