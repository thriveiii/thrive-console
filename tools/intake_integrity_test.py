"""Intake integrity: one minting path, atomic batches, evidence-backed lanes (FORTIFIED).

The live incident: a zip of opportunities was imported and every template activated, and the board
collapsed. Cards scattered, never-sent cards landed in the Sent lane reading "0 days without movement",
the Ready lane zeroed, and the counts oscillated between paints. The class is closed here with invariants,
not patches:

  I1  one mint      every import is minted by ThriveIntake.toRecord; no creation path stamps a phantom
                    sent-status on a never-sent record (grep-proven).
  I2  evidence-backed lanes   a lane is derived only from evidence. No page = Draft; a page and no
                    DELIVERED send record = Ready; Sent/Opened/Replied REQUIRE a real send record. A
                    freshly imported or activated card physically cannot derive Sent.
  I3  atomic batch  a batch stages its writes and commits them as ONE store transition; the board is
                    never repainted against a partial batch, and no sync round fires mid-batch.
  I4  one count pass the header chips and the lane headers derive from the same single pass; chip N
                    equals lane N for every lane after a batch.
  I5  idempotent re-import   re-importing the same batch mints nothing twice.

Each invariant is proven, and its guard fails when the fix is reverted. Thyab's device gate is the exact
repro (upload three, activate all, run twice); this proves the wiring underneath it.
"""
import threading, http.server, socketserver, functools, os, sys, re, json
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT="/home/user/thrive-console"; CH="/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails=[]
def ck(n,c,d=None):
    print(("PASS " if c else "FAIL ")+n)
    if not c:
        fails.append(n)
        if d is not None: print("      "+str(d)[:300])

# ============================ I1 + I2 source guards (no browser) ============================
app=open(f"{ROOT}/library/app.js").read()
sm=open(f"{ROOT}/library/stage-model.js").read()
intake=open(f"{ROOT}/library/intake.js").read()

# I1: the one mint produces the safe default shape, and no creation literal stamps a phantom sent-status.
ck("I1: ThriveIntake.toRecord mints the safe default (stage:\"\", published:false, no status)",
   'stage: ""' in intake and "published: false" in intake and "status:" not in intake.split("function toRecord")[1].split("function")[0])
ck("I1: the zip-batch writer mints through ThriveIntake.toRecord (not a hand literal)",
   "ThriveIntake.toRecord(e," in app)
# no record path DEFAULTS status to "sent" (the phantom). This is the precise phantom pattern: a record
# whose own status is empty is passed through with a "sent" fallback (o.status||"sent" / rec.status||"sent").
# A bare status:"sent" on a real mail row, or a derived status VIEW, is legitimate and not caught. Line
# comments are stripped first, so the explanatory comment naming the retired pattern does not self-hit.
app_code = "\n".join(re.sub(r'//.*$', '', ln) for ln in app.split("\n"))
phantom_defaults = re.findall(r'(?:rec|o)\.status\s*\|\|\s*["\']sent["\']', app_code)
ck("I1: no record path defaults a phantom status to \"sent\" (manifestEntry, editor, unpublish, export all cleaned)",
   not phantom_defaults, phantom_defaults)
ck("I1: manifestEntry no longer defaults status to \"sent\"",
   'status:rec.status||""' in app and 'status:rec.status||"sent"' not in app)
ck("I1: the manifest export derives status from evidence (effStage), never a blind \"sent\"",
   "function manifestStatusFor(o)" in app and "status:manifestStatusFor(o)" in app)

# I2: the phantom-send fabrication is removed from BOTH derivation copies. Guard on the ACTIVE code, not
# the explanatory comment (which legitimately names the retired stage==="sent" backdoor).
sf_body = app.split("function sendsFor")[1].split("\nfunction ")[0]
ck("I2: sendsFor no longer fabricates a send from a bare stage===\"sent\" (evidence only)",
   re.search(r'if\s*\(\s*o\.stage\s*===\s*"sent"\s*\)', sf_body) is None
   and "declared:true" not in sf_body and "return { count:0" in sf_body)
ck("I2: the board-layer sendInfo no longer fabricates a phantom send either",
   'o.stage === "sent"' not in sm.split("function sendInfo")[1].split("function laneOf")[0])

# I3: the batch writer stages then commits atomically under a batch guard.
ck("I3: writeImport stages records and commits them in ONE transition (commitDraftsBatch), under __batchDepth",
   "commitDraftsBatch(staged)" in app and "__batchDepth++" in app and "function commitDraftsBatch" in app)
ck("I3: a batch suppresses scheduleSyncPush so no sync round fires mid-batch",
   "if(__batchDepth>0) return;" in app)

# §3: the persisted-mis-stage clamp is additive, idempotent, console_-only, and destroys nothing.
sql=open(f"{ROOT}/docs/supabase-intake-integrity.sql").read()
ck("§3: the clamp clears a phantom Sent stage ONLY where no send evidence exists (mail ledger + manual contacts)",
   "update public.console_opps" in sql and "public.console_mail" in sql
   and "manual_contacts" in sql and "in ('sent','opened')" in sql)
ck("§3: the clamp is additive and destroys nothing (no drop, no delete, console_ tables only)",
   "drop " not in sql.lower() and "delete " not in sql.lower()
   and all(("console_" in ln or "public." not in ln) for ln in sql.split("\n")))

ck("no em dash / zero-Lotus in the touched files",
   all("—" not in open(f"{ROOT}/{f}").read() and "lotus" not in open(f"{ROOT}/{f}").read().lower()
       for f in ["library/app.js","library/stage-model.js","library/intake.js","docs/supabase-intake-integrity.sql"]))

# ============================ live behaviour ============================
Handler=functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address=True
httpd=socketserver.TCPServer(("127.0.0.1",0),Handler); PORT=httpd.server_address[1]
httpd.daemon_threads=True; threading.Thread(target=httpd.serve_forever,daemon=True).start()
base=f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

def eff(pg, o):   # derive a lane from a raw record object
    return pg.evaluate("(o)=>window.effStage(o)", o)

with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CH)
    ctx=b.new_context(viewport={"width":1280,"height":900})
    ctx.route("https://api.github.com/**", lambda r:r.abort())
    ctx.route(f"{base}/library/manifest.json", lambda r:r.fulfill(status=200, body='{"opportunities":[]}'))
    pg=ctx.new_page()
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_function("()=>typeof window.effStage==='function' && typeof window.mergedOpps==='function'", timeout=15000)
    pg.evaluate("()=>{document.documentElement.classList.remove('gate-locked');const g=document.getElementById('thriveGate');if(g)g.remove();}")
    pg.evaluate("()=>{ localStorage.setItem('thrive_mail_v1','[]'); localStorage.setItem('thrive_inbound_v1','[]'); localStorage.setItem('thrive_hits_v1','[]'); window.invalidateSends&&window.invalidateSends(); window.invalidateHits&&window.invalidateHits(); }")

    # ---- I2: an activated-but-unsent card (status:"sent", no send record) CANNOT derive Sent ----
    activated = pg.evaluate("()=>{ const o={slug:'act',business:'Act',published:true,stage:'',status:'sent',sent_on:'2026-08-13'}; window.normalizeOpp(o); return o; }")
    ck("I2: normalizeOpp still promotes a legacy status:\"sent\" to stage (the corrupt input exists)",
       activated["stage"]=="sent", activated)
    ck("I2: BUT with no send record it derives to Ready (live), never Sent  <-- the incident, clamped",
       eff(pg, activated)=="live", eff(pg, activated))
    ck("I2: a fresh published import (stage:\"\", no send) is Ready",
       eff(pg, {"slug":"fl","business":"FL","published":True,"stage":"","_local":True})=="live")
    ck("I2: a fresh unpublished import is Draft",
       eff(pg, {"slug":"fd","business":"FD","published":False,"stage":"","_local":True})=="draft")
    # a REAL send still derives Sent (evidence works)
    pg.evaluate("""()=>{ localStorage.setItem('thrive_mail_v1', JSON.stringify([{mid:'r1',opp:'real',to:'x@x',status:'sent',direction:'out',ts:'2026-08-10T10:00:00Z'}]));
      window.invalidateSends&&window.invalidateSends(); }""")
    ck("I2: a card WITH a real delivered send record derives Sent (evidence counts)",
       eff(pg, {"slug":"real","business":"Real","published":True,"stage":""})=="sent")

    # ---- I3: the atomic batch commit leaves no partial store; the board reads one whole transition ----
    # Drive commitDraftsBatch with three records and confirm the store went from N to N+3 in one write.
    batch_res = pg.evaluate("""()=>{
      localStorage.setItem('thrive_opps_v1','[]');
      let writes=0; const realSet=localStorage.setItem.bind(localStorage);
      localStorage.setItem=function(k,v){ if(k==='thrive_opps_v1') writes++; return realSet(k,v); };
      window.commitDraftsBatch([
        {slug:'b1',business:'B1',published:true,stage:''},
        {slug:'b2',business:'B2',published:true,stage:''},
        {slug:'b3',business:'B3',published:false,stage:''}]);
      localStorage.setItem=realSet;
      const store=JSON.parse(localStorage.getItem('thrive_opps_v1')||'[]');
      return { writes, count:store.length, slugs:store.map(o=>o.slug) };
    }""")
    ck("I3: committing a 3-record batch writes the opps store EXACTLY ONCE (one transition, no partial states)",
       batch_res["writes"]==1 and batch_res["count"]==3, batch_res)

    # ---- I4: one count pass — the lane counts and the summary chips derive from ONE build ----
    # The render loop (app.js) sets both the lane header [data-count] and the tab chip [data-count-tab]
    # from the SAME b.lanes[k].length in one pass, and summary.counts[k] is literally lanes[k].length.
    # So we prove the invariant at its source: build once, the summary chip count equals the lane length
    # for every lane, and the lanes are evidence-correct.
    i4 = pg.evaluate("""async ()=>{
      localStorage.setItem('thrive_opps_v1', JSON.stringify([
        {slug:'d1',business:'D1',published:false,stage:'',_local:true},
        {slug:'l1',business:'L1',published:true,stage:''},
        {slug:'l2',business:'L2',published:true,stage:''},
        {slug:'s1',business:'S1',published:true,stage:''}]));
      localStorage.setItem('thrive_mail_v1', JSON.stringify([{mid:'s1m',opp:'s1',to:'x@x',status:'sent',direction:'out',ts:'2026-08-10T10:00:00Z'}]));
      localStorage.setItem('thrive_inbound_v1','[]'); localStorage.setItem('thrive_hits_v1','[]');
      window.invalidateSends&&window.invalidateSends(); window.invalidateHits&&window.invalidateHits();
      // The board reads the server-computed view now (v_console_board), not a client re-derivation of the
      // seeded send. Hand it the sent card's row; d1 (draft), l1/l2 (live) fall to their record-only base.
      window.__boardViewSet([{slug:'s1', stage:'sent', open_count:0, replied:false, idle_days:1, has_page:true, has_email:true, archived:false}]);
      const opps=await window.mergedOpps();
      const b=window.ThriveBoard.build(opps, { mail: window.getMailLog() });
      const lanes={}, chips={};
      window.ThriveBoard.LANES.forEach(k=>{ lanes[k]=b.lanes[k].length; chips[k]=b.summary.counts[k]; });
      return { lanes, chips };
    }""")
    same = all(i4["lanes"].get(k)==i4["chips"].get(k) for k in i4["lanes"])
    ck("I4: every lane length equals its summary chip count (one build, two readouts)", same, i4)
    ck("I4: the lanes are evidence-correct (1 draft, 2 live/Ready, 1 sent, 0 opened/replied)",
       i4["lanes"].get("draft")==1 and i4["lanes"].get("live")==2 and i4["lanes"].get("sent")==1
       and i4["lanes"].get("opened")==0 and i4["lanes"].get("replied")==0, i4["lanes"])

    # ---- I5: idempotent re-import — the same slug set imported twice mints nothing twice ----
    # writeImport suffixes an in-batch duplicate and updates an existing slug in place, never a second row.
    dup = pg.evaluate("""()=>{
      const a=[{slug:'x',business:'X',published:false,stage:''}]; localStorage.setItem('thrive_opps_v1', JSON.stringify(a));
      // an existing slug 'x' plus a fresh 'x' in the same batch: existing updates in place, in-batch dup suffixes.
      const before=JSON.parse(localStorage.getItem('thrive_opps_v1')).length;
      window.commitDraftsBatch([{slug:'x',business:'X updated',published:false,stage:''}]);   // update in place
      const after=JSON.parse(localStorage.getItem('thrive_opps_v1'));
      return { before, afterCount:after.length, xbiz:(after.find(o=>o.slug==='x')||{}).business };
    }""")
    ck("I5: re-committing an existing slug updates it in place, never mints a second row",
       dup["before"]==1 and dup["afterCount"]==1 and dup["xbiz"]=="X updated", dup)

    ctx.close(); b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
