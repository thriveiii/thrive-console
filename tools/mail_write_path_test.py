"""The send ledger stopped writing: fix the whole path.

THE BREAK (named): commit 583207b (profile Phase B, Aug 14) made supaMailRow emit a top-level `actor`
column on every console_mail row (library/app.js). `actor` exists only after the manual migration
docs/supabase-profile-phase-b.sql. A deployed DB that never ran it rejects EVERY console_mail upsert with
PGRST204 ("Could not find the 'actor' column ..."); supaConfirmMail and supaFlush caught the 400 onto the
diverge ledger but never surfaced it, so no send has written a row for days (frozen at 28).

THE FIX: mailUpsert tries the full row and, when the server is a migration behind (a missing-column /
PGRST204 / 42703 error), retries WITHOUT the optional column - it survives inside data jsonb, so nothing is
lost and the send finally records. Both write sites (supaConfirmMail, the durable supaFlush) route through
it. reconcileMailToServer pushes the whole local ledger on sign-in so the historical backlog records. A
non-schema error still throws (never hidden), so a real failure still shows the card's failed state.
docs/supabase-mail-actor-column.sql adds the column back additively and verifies the count moved.

Engine-independent (WebKit is Thyab's gate): this drives the real write path against a mock server that
rejects the `actor` column, exactly as the frozen DB does, and proves the row lands. Fails-when-broken:
route the write back through raw ThriveSupa.upsert and the write throws and no row lands."""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

app = open(f"{ROOT}/library/app.js", encoding="utf-8").read()

# ---- source guards: the named break and the resilient fix --------------------------------------------
ck("the resilient writer exists: mailUpsert tries console_mail, then retries without the optional column",
   "async function mailUpsert(rows)" in app and 'window.ThriveSupa.upsert("console_mail", arr)' in app
   and "arr.map(stripOptionalMailCols)" in app and 'MAIL_OPTIONAL_COLS=["actor"]' in app)
ck("a missing-column / schema-cache error is detected (PGRST204 / 42703 / message)",
   "function mailColMissing(" in app and 'code==="PGRST204"' in app and 'code==="42703"' in app
   and "schema cache" in app)
ck("the confirmed write routes through mailUpsert, not the raw upsert",
   "await mailUpsert([row]);" in app and 'await window.ThriveSupa.upsert("console_mail", [row])' not in app)
ck("the durable flush routes console_mail through mailUpsert",
   'else if(e.t==="console_mail") await mailUpsert(e.rows);' in app)
ck("the historical backlog is reconciled from the local ledger, on sign-in, idempotently",
   "async function reconcileMailToServer(" in app and "await mailUpsert([supaMailRow(" in app
   and 'onThrive("unlock","mailreconcile"' in app)
ck("the drift is recorded when the server is behind (visible, never silent)",
   'supaRecordDiverge("write", "console_mail", "schema behind' in app)
ck("no em dash / zero-Lotus in the touched source", "\u2014" not in app and "lotus" not in app.lower())

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

# A mock server whose console_mail table has NO `actor` column, exactly like the frozen DB: any upsert whose
# row carries a top-level `actor` key is rejected with PGRST204; a row without it is stored by id.
FAKE = r"""
() => {
  window.__mail = {};                 // id -> row  (the server's console_mail table)
  window.__rejectActor = true;        // the frozen DB: actor column does not exist
  window.__failMode = null;           // set to 'server' to simulate a non-schema 500 (must NOT be hidden)
  window.ThriveSupa = {
    ready: () => true, signedIn: () => true,
    cfg: () => ({ url:"https://x.supabase.co", anon:"anon" }),
    session: () => ({ access_token:"jwt" }),
    upsert: async (table, rows) => {
      const arr = Array.isArray(rows) ? rows : [rows];
      if (table === "console_mail") {
        if (window.__failMode === "server") { const e = new Error("HTTP 500"); e.status = 500; e.body = { message:"internal" }; throw e; }
        for (const r of arr) {
          if (window.__rejectActor && Object.prototype.hasOwnProperty.call(r, "actor")) {
            const e = new Error("Could not find the 'actor' column of 'console_mail' in the schema cache");
            e.status = 400; e.body = { code:"PGRST204", message:e.message }; throw e;
          }
        }
        for (const r of arr) window.__mail[r.id] = r;
        return null;
      }
      return null;
    },
    del: async () => null, rest: async () => []
  };
  return true;
}
"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page(viewport={"width": 900, "height": 700})
    pg.goto(f"{base}/library/console.html")
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn")
    pg.wait_for_function("()=>typeof window.mailUpsert==='function' && typeof window.reconcileMailToServer==='function' && typeof window.supaConfirmMail==='function'", timeout=15000)
    pg.evaluate(FAKE)

    # ---- THE FIX: a write against a DB missing `actor` still lands (stripped + retried), actor kept in data ----
    r1 = pg.evaluate("""async ()=>{
      window.__mail = {};
      const res = await window.supaConfirmMail({ mid:'m-new', opp:'fleurs-de-lea', to:'x@y.example', subject:'Hi', status:'sent', actor:'op@x' });
      const row = window.__mail['m-new'];
      return { confirmed: res && res.confirmed, count: Object.keys(window.__mail).length,
               hasTopActor: row ? Object.prototype.hasOwnProperty.call(row,'actor') : null,
               dataActor: row && row.data ? row.data.actor : null };
    }""")
    ck("a real send now WRITES its row against a DB missing the actor column (the freeze is lifted)",
       r1["confirmed"] is True and r1["count"] == 1, r1)
    ck("the retry dropped the top-level actor column but kept it inside data (nothing lost)",
       r1["hasTopActor"] is False and r1["dataActor"] == "op@x", r1)

    # ---- when the DB HAS the column, the full row (with actor) lands unchanged (no needless strip) ----
    r2 = pg.evaluate("""async ()=>{
      window.__mail = {}; window.__rejectActor = false;
      await window.supaConfirmMail({ mid:'m-ok', opp:'echo', to:'x@y', subject:'Hey', status:'sent', actor:'op@x' });
      window.__rejectActor = true;
      const row = window.__mail['m-ok'];
      return { hasTopActor: row ? Object.prototype.hasOwnProperty.call(row,'actor') : null };
    }""")
    ck("on a migrated DB the write keeps actor first-class (fallback only fires on a real schema miss)",
       r2["hasTopActor"] is True, r2)

    # ---- a NON-schema error is NOT hidden: mailUpsert re-throws, the send is not falsely confirmed ----
    # The row must be COMPLETE (opp,id,to_addr,subject) to reach the server where __failMode injects the 500;
    # the mail-integrity guard now refuses an incomplete row BEFORE any server call (a phantom never writes).
    r3 = pg.evaluate("""async ()=>{
      window.__mail = {}; window.__failMode = 'server';
      let threw = false;
      try { await window.mailUpsert([{ id:'m-err', opp:'x', to_addr:'a@b', subject:'s', status:'sent' }]); } catch(e){ threw = true; }
      const res = await window.supaConfirmMail({ mid:'m-err2', opp:'x', to:'a@b', subject:'s', status:'sent', actor:'op@x' });
      window.__failMode = null;
      return { threw, confirmed: res && res.confirmed, count: Object.keys(window.__mail).length };
    }""")
    ck("a non-schema server error still throws (never hidden): the send is not falsely confirmed",
       r3["threw"] is True and r3["confirmed"] is False and r3["count"] == 0, r3)

    # ---- Step 3: the historical backlog reconciles from the local ledger; the count moves ----
    r4 = pg.evaluate("""async ()=>{
      window.__mail = {}; window.__rejectActor = true;   // still the frozen DB; the fallback must carry it
      localStorage.setItem('thrive_mail_v1', JSON.stringify([
        { mid:'h1', opp:'fleurs-de-lea', to:'a@x', subject:'One',  status:'sent',       direction:'out', ts:'2026-08-14T10:00:00Z', actor:'op@x' },
        { mid:'h2', opp:'organic-allure', to:'b@x', subject:'Two', status:'unrecorded', direction:'out', ts:'2026-08-15T10:00:00Z', actor:'op@x' },
        { mid:'h3', opp:'echo',          to:'c@x', subject:'Three',status:'opened',     direction:'out', ts:'2026-08-16T10:00:00Z', actor:'op@x' },
        { mid:'r1', opp:'echo',          from:'c@x', subject:'Re', status:'replied',    direction:'in',  ts:'2026-08-16T11:00:00Z' }
      ]));
      window.invalidateSends && window.invalidateSends();
      const res = await window.reconcileMailToServer();
      const server = Object.keys(window.__mail).sort();
      const log = JSON.parse(localStorage.getItem('thrive_mail_v1'));
      const h2 = log.find(m=>m.mid==='h2');
      return { pushed: res.pushed, server, strandedFlipped: h2 && h2.status };
    }""")
    ck("the reconcile pushes every delivered send from the local ledger (the count moves past the freeze)",
       r4["pushed"] == 3 and r4["server"] == ["h1","h2","h3"], r4)
    ck("an inbound reply is never pushed as a send (only outbound sends record)",
       "r1" not in r4["server"], r4)
    ck("a send stranded as 'unrecorded' by the freeze flips to Sent once it records",
       r4["strandedFlipped"] == "sent", r4)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL MAIL-WRITE-PATH CHECKS PASS"))
raise SystemExit(1 if fails else 0)
