"""One visual-state law, and no endless sending.

Two defects, one root: behaviour must follow an explicit named state, not an ad-hoc effect.

Part 1 - the write is confirmed, timed out, or visibly failed (never endless). A send that dispatches
sets a 'sending' row stamped with the time it entered sending; if the server never confirms within
SEND_CONFIRM_TIMEOUT_MS the row moves to 'unrecorded' (a visible failed state with a retry), recorded on
the diverge ledger and counted by the unsynced indicator, so a card can never hang on 'sending'. A legacy
sending row with no stamp (Fleurs before the fix) surfaces as failed at once. Retry re-records without
re-sending. The delivered Fleurs send whose row was lost is reconciled by docs/supabase-fleurs-backfill.sql.

Part 2 - one visual-state law. cardState resolves exactly ONE state per card by priority (failed >
in-flight > new-activity > awaiting-action > settled), each reading one named source; the token wears at
most one emphasis class and a data-state attribute. The parallel lane-literal glow (is-glow) and the
standalone is-hot / is-provisional treatments are retired: no card wears emphasis without a state.

Engine-independent (WebKit and the final glyphs are Thyab's device gate): this asserts the state machine and
the one-state mapping in the running page. Fails-when-broken: remove the timeout and the stuck send stays
'sending'; restore is-glow and a card wears emphasis with no state."""
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
css = open(f"{ROOT}/library/styles.css", encoding="utf-8").read()
i18n = open(f"{ROOT}/library/i18n.js", encoding="utf-8").read()

# ---- source guards: Part 1 (bounded lifetime) --------------------------------------------------------
ck("a 'sending' row is stamped with the time it entered sending (bounded lifetime is possible)",
   'status:"sending", id:id, error:"", confirmPending:true, sending_since:Date.now()' in app)
ck("the timeout reconciler moves an overdue 'sending' row to 'unrecorded', not left hanging",
   "function reconcileStuckSending(" in app and 'status:"unrecorded"' in app and "SEND_CONFIRM_TIMEOUT_MS" in app)
ck("the timeout runs on the flush cadence and before every paint",
   "try{ reconcileStuckSending(); }catch(_){}" in app and "reconcileStuckSending(undefined, true)" in app)
ck("the failed/unrecorded write is recorded on the diverge ledger, never swallowed",
   'supaRecordDiverge("write", "console_mail", "unrecorded:' in app)
ck("an unrecorded row is never mirrored to the server as a phantom send",
   'rec.status==="unrecorded"' in app and 'if(rec.status==="pending" || rec.status==="sending" || rec.status==="unrecorded") return;' in app)
ck("retry re-records (not re-sends): unrecorded -> sending + confirmed write",
   "function retryRecord(" in app and "supaConfirmMail(Object.assign({}, row, { status:\"sent\" }))" in app)
ck("the unsynced indicator (boardDrift) counts stuck/unrecorded sends",
   'm.status==="sending" || m.status==="unrecorded"' in app and "out.stuck" in app)
ck("i18n for the failed state exists in both languages",
   i18n.count("tok_unrecorded:") == 2 and i18n.count("mw_unrecorded_h:") == 2 and i18n.count("mw_retry_record:") == 2)

# ---- source guards: Part 2 (one visual-state law) ----------------------------------------------------
ck("cardState resolves exactly one state by priority, each from a named source",
   "function cardState(tk)" in app and 'if(cardUnrecorded(slug)) return "failed";' in app
   and 'if(cardSending(slug))    return "in-flight";' in app and 'return "new-activity";' in app
   and 'return "awaiting-action";' in app and 'return "settled";' in app)
ck("the token wears at most one emphasis class, from the one state, and emits data-state",
   "const state = cardState(tk);" in app and "if(STATE_CLASS[state]) cls.push(STATE_CLASS[state]);" in app
   and 'data-state="\'+esc(state)+\'"' in app)
ck("the parallel lane-literal glow (is-glow / is-glow-new) is retired from the board token",
   'gcls="is-glow ' not in app and "glowChanged(\"card:\"+tk.slug" not in app)
ck("the standalone is-hot and is-provisional token treatments are retired",
   'cls.push("is-hot")' not in app and 'cls.push("is-provisional")' not in app
   and ".tok.is-hot{" not in css and ".tok.is-provisional{" not in css)
ck("the failed treatment is static (no animation, so reduced-motion needs no special case)",
   ".tok.is-failed{" in css and "animation" not in css[css.find(".tok.is-failed{"): css.find(".tok.is-failed{")+200])
ck("no em dash / zero-Lotus in the touched sources",
   "\u2014" not in app and "\u2014" not in css and "lotus" not in app.lower())

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page(viewport={"width": 1280, "height": 900})
    pg.goto(f"{base}/library/console.html")
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn")
    pg.wait_for_function("()=>typeof window.reconcileStuckSending==='function' && typeof window.cardState==='function' && typeof window.boardDrift==='function'", timeout=15000)

    # ---- Part 1 state machine: sending -> (timeout) -> unrecorded, and never hangs -------------------
    # NOW is a fixed clock the test injects; the send entered 'sending' 10 minutes ago (past the 90s window).
    r = pg.evaluate("""()=>{
      const NOW = 1000000000000;
      const OLD = NOW - 10*60*1000;      // 10 min ago: past the timeout
      const FRESH = NOW - 5*1000;        // 5s ago: within the timeout
      localStorage.setItem('thrive_mail_v1', JSON.stringify([
        { mid:'stuck', opp:'fleurs-de-lea', to:'a@x.example', subject:'Hi', status:'sending', direction:'out', ts:'2026-08-01T10:00:00Z', sending_since:OLD },
        { mid:'fresh', opp:'organic-allure', to:'b@x.example', subject:'Hey', status:'sending', direction:'out', ts:'2026-08-01T10:00:00Z', sending_since:FRESH },
        { mid:'legacy', opp:'echo', to:'c@x.example', subject:'Yo', status:'sending', direction:'out', ts:'2026-08-01T10:00:00Z' }
      ]));
      window.invalidateSends && window.invalidateSends();
      const changed = window.reconcileStuckSending(NOW);
      const log = JSON.parse(localStorage.getItem('thrive_mail_v1'));
      const byId = {}; log.forEach(m=>byId[m.mid]=m.status);
      return { changed, byId,
        stuckSending: window.cardSending('fleurs-de-lea'), stuckUnrec: window.cardUnrecorded('fleurs-de-lea'),
        freshSending: window.cardSending('organic-allure'), legacyUnrec: window.cardUnrecorded('echo') };
    }""")
    ck("an overdue 'sending' send times out to 'unrecorded' (it never hangs)",
       r["byId"].get("stuck")=="unrecorded" and r["stuckUnrec"] is True and r["stuckSending"] is False, r)
    ck("a fresh 'sending' send within the timeout stays 'sending' (still genuinely in flight)",
       r["byId"].get("fresh")=="sending" and r["freshSending"] is True, r)
    ck("a legacy 'sending' row with no stamp (Fleurs before the fix) surfaces as failed at once",
       r["byId"].get("legacy")=="unrecorded" and r["legacyUnrec"] is True, r)

    # ---- Part 1: the unsynced indicator counts the failures and drains to zero when they resolve -----
    drift = pg.evaluate("""()=>{
      const before = window.boardDrift().stuck;
      // retry records the fleurs row: unrecorded -> sending (its confirmed write is re-enqueued)
      window.retryRecord('fleurs-de-lea');
      // simulate the record landing: mark every stuck row 'sent'
      const log = JSON.parse(localStorage.getItem('thrive_mail_v1')).map(m => (m.status==='sending'||m.status==='unrecorded') ? Object.assign({}, m, {status:'sent'}) : m);
      localStorage.setItem('thrive_mail_v1', JSON.stringify(log));
      window.invalidateSends && window.invalidateSends();
      return { before, after: window.boardDrift().stuck, retried: log.some(m=>m.mid==='fleurs' ) };
    }""")
    ck("the unsynced indicator counted the stuck/failed sends, and drains to zero once they record",
       drift["before"] >= 2 and drift["after"] == 0, drift)

    # ---- Part 2: cardState is one state per card, by priority ----------------------------------------
    st = pg.evaluate("""()=>{
      const set=(k,v)=>localStorage.setItem(k, JSON.stringify(v));
      set('thrive_card_seen_v1', {});   // nothing seen yet
      set('thrive_mail_v1', [
        { mid:'f1', opp:'failcard', to:'a@x', subject:'s', status:'unrecorded', direction:'out', ts:'2026-08-01T10:00:00Z' },
        { mid:'s1', opp:'sendcard', to:'a@x', subject:'s', status:'sending', direction:'out', ts:'2026-08-01T10:00:00Z', sending_since: 9e15 },
        { mid:'m1', opp:'newcard', to:'a@x', subject:'s', status:'sent', direction:'out', ts:'2026-08-01T10:00:00Z' }
      ]);
      set('thrive_inbound_v1', [
        { gid:'r1', opp:'newcard', kind:'reply', from:'a@x', subject:'Re: s', snippet:'yes', ts:'2026-08-03T09:00:00Z' }
      ]);
      window.invalidateSends && window.invalidateSends();
      return {
        failed:    window.cardState({slug:'failcard', stalled:true}),   // failed outranks a stall
        inflight:  window.cardState({slug:'sendcard'}),
        newact:    window.cardState({slug:'newcard'}),                  // unseen reply
        awaiting:  window.cardState({slug:'stallcard', stalled:true}),  // no send/reply, just stalled
        settled:   window.cardState({slug:'nothing'})
      };
    }""")
    ck("cardState: a delivered-but-unrecorded card is 'failed' (outranks a stall)", st["failed"]=="failed", st)
    ck("cardState: an unconfirmed send is 'in-flight'", st["inflight"]=="in-flight", st)
    ck("cardState: an unseen reply is 'new-activity'", st["newact"]=="new-activity", st)
    ck("cardState: a stalled card with nothing new is 'awaiting-action'", st["awaiting"]=="awaiting-action", st)
    ck("cardState: a card with no signal is 'settled' (no emphasis)", st["settled"]=="settled", st)

    # ---- Part 2: the token wears data-state and exactly one emphasis class ---------------------------
    tok = pg.evaluate("""async ()=>{
      const set=(k,v)=>localStorage.setItem(k, JSON.stringify(v));
      set('thrive_opps_v1', [
        {slug:'failcard', business:'Fail', published:true, up:1},
        {slug:'calmcard', business:'Calm', published:true, up:1}
      ]);
      set('thrive_mail_v1', [
        { mid:'f1', opp:'failcard', to:'a@x', subject:'s', status:'unrecorded', direction:'out', ts:'2026-08-01T10:00:00Z' }
      ]);
      set('thrive_inbound_v1', []); set('thrive_hits_v1', []); set('thrive_card_seen_v1', {});
      window.invalidateSends && window.invalidateSends();
      location.hash='#board';
      window.__boardViewSet([
        {slug:'failcard', stage:'sent', open_count:0, replied:false, idle_days:1, has_page:true, has_email:false, archived:false},
        {slug:'calmcard', stage:'sent', open_count:0, replied:false, idle_days:1, has_page:true, has_email:false, archived:false}
      ]);
      await window.thriveBoardRefresh();
      await new Promise(r=>setTimeout(r,400));
      const read=s=>{ const t=document.querySelector('#boardLanes .tok[data-slug="'+s+'"]'); if(!t) return null;
        const emph=['is-failed','is-sending','has-reply','is-stalled'].filter(c=>t.classList.contains(c));
        return { state:t.getAttribute('data-state'), emph:emph, glow:t.classList.contains('is-glow') }; };
      return { fail:read('failcard'), calm:read('calmcard') };
    }""")
    ck("a failed card wears data-state='failed' and exactly the is-failed emphasis (one class)",
       tok["fail"] and tok["fail"]["state"]=="failed" and tok["fail"]["emph"]==["is-failed"], tok["fail"])
    ck("a settled card wears data-state='settled' and NO emphasis class (no emphasis without a state)",
       tok["calm"] and tok["calm"]["state"]=="settled" and tok["calm"]["emph"]==[] and tok["calm"]["glow"] is False, tok["calm"])

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL STATE-LAW CHECKS PASS"))
raise SystemExit(1 if fails else 0)
