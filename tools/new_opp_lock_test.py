"""Lock the pipeline so an opportunity created AFTER today cannot silently break it (WO-021).

The gap this closes: every prior suite (living card, derivation, matcher, identity) seeds its
opportunities by writing a hand-authored object straight into thrive_opps_v1 with a perfect shape
already stamped (stage:'sent', published:true, the exact recipient array). None of them create an
opportunity through the real mint. So a future change to how a NEW opportunity is shaped, its default
stage, its type, the roster a group records, could break derivation, matching, or child spawning while
every seeded suite stayed green. This lock creates opportunities the real way, through
ThriveIntake.toRecord (the record every batch/new opportunity is minted from) and saveDraft (the real
persistence), then walks them:

  - a fresh single opportunity derives Draft -> Ready -> Sent -> Opened -> Replied through effStage
    (#82), and a reply to it attributes through the real matcher (rematchHeld) and flips it to Replied;
  - a fresh group campaign derives, a replier spawns exactly one idempotent child in Replied linked to
    the campaign, the parent stays in its lane and its recipient row reads Replied, and the group card
    never enters Replied;
  - the same freshly minted record survives the Supabase-only read path (Stage 4) and still derives.

Each scenario is reseeded from empty and run five times in-process; the derived facts are asserted
byte-identical across all five, so the lock is order-independent and deterministic, not flaky. The
live Supabase and WebKit rendering stay Thyab's device gate; this proves the engine-independent logic."""
import threading, http.server, socketserver, functools, os, json
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

# The real mint + real persistence, then the full ladder, reseeded from empty. Every stage read goes
# through mergedOpps (the board's own read, which stamps _local so a freshly created, unpublished
# opportunity reads Draft exactly as the board shows it). Returns only derived facts, never a
# Date.now-stamped field, so repeated runs are byte-identical.
SINGLE = r"""
async () => {
  ['thrive_opps_v1','thrive_mail_v1','thrive_inbound_v1','thrive_hits_v1'].forEach(k=>localStorage.setItem(k,'[]'));
  window.invalidateSends&&window.invalidateSends(); window.invalidateHits&&window.invalidateHits();
  const stageOf = async (slug) => { const rows = await window.mergedOpps(); const o = rows.find(x=>x.slug===slug); return o ? window.effStage(o) : '(missing)'; };
  // Created fresh, the real way: minted from an intake entry, not hand-authored into the store.
  const rec = window.ThriveIntake.toRecord({business:'Newco Ltd', slug_hint:'newco-ltd', email:'owner@newco.com', channel:'email', extra:{}, alternates:[]}, {today:'2026-09-01'});
  window.saveDraft(rec);
  const L = {};
  L.minted = { stage: rec.stage, published: rec.published, type: (rec.type===undefined ? '(unset)' : rec.type) };
  L.draft = await stageOf('newco-ltd');                                         // fresh mint, unpublished
  window.saveDraft({ slug:'newco-ltd', published:true });                       // publish
  L.ready = await stageOf('newco-ltd');                                         // live / Ready
  window.logMail({ opp:'newco-ltd', to:'owner@newco.com', toName:'Newco', subject:'A page for you', status:'sent', direction:'out', ts:'2026-09-02T10:00:00Z', msgid:'<wire-newco-1@thriveiii.com>' });
  window.invalidateSends&&window.invalidateSends();
  L.sent = await stageOf('newco-ltd');
  const hits = JSON.parse(localStorage.getItem('thrive_hits_v1')); hits.push({ type:'open', slug:'newco-ltd', ts:'2026-09-02T12:00:00Z', vid:'v-newco' }); localStorage.setItem('thrive_hits_v1', JSON.stringify(hits)); window.invalidateHits&&window.invalidateHits();
  L.opened = await stageOf('newco-ltd');
  const inb = JSON.parse(localStorage.getItem('thrive_inbound_v1')); inb.push({ gid:'in-newco-1', opp:'', kind:'reply', from:'owner@newco.com', name:'Newco', subject:'Re: A page for you', snippet:'yes please', ts:'2026-09-03T09:00:00Z' }); localStorage.setItem('thrive_inbound_v1', JSON.stringify(inb));
  const rm = window.rematchHeld();
  L.matched = rm.matched;
  L.tier = (window.getInbound().find(r=>r.gid==='in-newco-1')||{}).match_tier || '';
  L.replied = await stageOf('newco-ltd');
  L.idempotent = window.rematchHeld().matched === 0;
  return L;
}
"""

GROUP = r"""
async () => {
  ['thrive_opps_v1','thrive_mail_v1','thrive_inbound_v1','thrive_hits_v1'].forEach(k=>localStorage.setItem(k,'[]'));
  window.invalidateSends&&window.invalidateSends(); window.invalidateHits&&window.invalidateHits();
  const stageOf = async (slug) => { const rows = await window.mergedOpps(); const o = rows.find(x=>x.slug===slug); return o ? window.effStage(o) : '(missing)'; };
  const rec = window.ThriveIntake.toRecord({business:'Summer Campaign', slug_hint:'summer-camp', channel:'email', extra:{}, alternates:[]}, {today:'2026-09-01'});
  rec.recipients = [                                                            // the roster a group send records
    {addr:'basel.personal@gmail.com', name:'Basel', lang:'ar'},
    {addr:'lina@school.com', name:'Lina', lang:'en'},
    {addr:'omar@co.com', name:'Omar', lang:'ar'}
  ];
  window.saveDraft(rec);
  const G = {};
  G.isGroup = window.isGroupOpp(window.getDraft('summer-camp'));
  G.draft = await stageOf('summer-camp');
  window.saveDraft({ slug:'summer-camp', published:true });
  [['basel.personal@gmail.com','Basel','2026-09-02T10:00:00Z'],
   ['lina@school.com','Lina','2026-09-02T10:01:00Z'],
   ['omar@co.com','Omar','2026-09-02T10:02:00Z']].forEach(function(t){
    window.logMail({ opp:'summer-camp', to:t[0], toName:t[1], subject:'A page for you', status:'sent', direction:'out', ts:t[2] });
  });
  window.invalidateSends&&window.invalidateSends();
  G.sent = await stageOf('summer-camp');
  const hits = JSON.parse(localStorage.getItem('thrive_hits_v1')); hits.push({ type:'open', slug:'summer-camp', ts:'2026-09-02T12:00:00Z', vid:'v-sc' }); localStorage.setItem('thrive_hits_v1', JSON.stringify(hits)); window.invalidateHits&&window.invalidateHits();
  G.opened = await stageOf('summer-camp');
  const inb = JSON.parse(localStorage.getItem('thrive_inbound_v1')); inb.push({ gid:'in-sc-basel', opp:'', kind:'reply', from:'basel.personal@gmail.com', name:'Basel', subject:'Re: A page for you', snippet:'na3am', ts:'2026-09-03T09:00:00Z' }); localStorage.setItem('thrive_inbound_v1', JSON.stringify(inb));
  const rm = window.rematchHeld();
  G.matched = rm.matched; G.spawned = rm.spawned;
  const childSlug = window.childSlugFor('summer-camp','basel.personal@gmail.com');
  const child = window.getDraft(childSlug);
  G.child_exists = !!child;
  G.child_linked = !!(child && child.spawned_from && child.spawned_from.parent==='summer-camp' && child.spawned_from.addr==='basel.personal@gmail.com');
  G.child_stage = await stageOf(childSlug);
  G.parent_stage = await stageOf('summer-camp');
  G.parent_stored = window.getDraft('summer-camp').stage || '';
  const bs = window.recipientState('summer-camp','basel.personal@gmail.com');
  G.basel_chip = bs.chip; G.basel_child = (bs.child === childSlug);
  G.lina_chip = window.recipientState('summer-camp','lina@school.com').chip;
  G.opps_after = JSON.parse(localStorage.getItem('thrive_opps_v1')).length;
  const rm2 = window.rematchHeld();
  G.spawned_again = rm2.spawned;
  G.opps_final = JSON.parse(localStorage.getItem('thrive_opps_v1')).length;
  G.parent_never_replied = (await stageOf('summer-camp')) !== 'replied';
  return G;
}
"""

# A fake Supabase REST store, so a freshly minted record can be read back through the Stage 4 path.
FAKE = r"""
() => {
  window.__real_fetch = window.fetch.bind(window);
  window.__sb = { tables:{ console_opps:{}, console_pages:{}, console_templates:{}, console_mail:{}, console_inbound:{}, console_hits:{}, console_settings:{} } };
  const pk = t => (t==='console_opps'||t==='console_pages') ? 'slug' : (t==='console_settings') ? 'key' : 'id';
  window.fetch = async (url, opts) => {
    try {
      if (typeof url === 'string' && url.indexOf('/rest/v1/') >= 0) {
        const u = new URL(url); const table = (u.pathname.split('/rest/v1/')[1]||'').split('?')[0];
        const method = (opts&&opts.method)||'GET'; const store = window.__sb.tables[table]||(window.__sb.tables[table]={}); const key = pk(table);
        if (method==='POST'){ (JSON.parse(opts.body||'[]')).forEach(r=>{ store[r[key]]=r; }); return new Response('',{status:201}); }
        if (method==='DELETE'){ const q=u.searchParams.get(key)||''; const m=/^eq\.(.*)$/.exec(q); if(m) delete store[decodeURIComponent(m[1])]; return new Response('',{status:204}); }
        return new Response(JSON.stringify(Object.values(store)), {status:200, headers:{'Content-Type':'application/json'}});
      }
    } catch (e) {}
    return window.__real_fetch(url, opts);
  };
  return true;
}
"""

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

RUNS = 5

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page()
    pg.goto(f"{base}/library/console.html"); pg.wait_for_timeout(500)
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(700)
    pg.wait_for_function("()=>typeof window.effStage==='function' && typeof window.rematchHeld==='function' && typeof window.saveDraft==='function'", timeout=15000)

    # The lock creates opportunities the real way; if the mint is gone or renamed, fail loudly rather
    # than fall back to hand-seeding (which is exactly the blind spot this lock closes).
    ck("the real opportunity mint is present (ThriveIntake.toRecord), so the lock creates, never seeds",
       pg.evaluate("()=>!!(window.ThriveIntake && typeof window.ThriveIntake.toRecord==='function' && typeof window.saveDraft==='function')"))

    # ---- Scenario A: a newly created single opportunity walks the full ladder ----
    single_runs = [pg.evaluate(SINGLE) for _ in range(RUNS)]
    S = single_runs[0]
    ck("GAP a1: a freshly MINTED single opportunity carries the real default shape (stage empty, unpublished, not an offer type)",
       S["minted"] == {"stage": "", "published": False, "type": "(unset)"}, S["minted"])
    ck("GAP a2: it derives the full ladder Draft -> Ready -> Sent -> Opened -> Replied (no seeded stage stamp)",
       [S["draft"], S["ready"], S["sent"], S["opened"], S["replied"]] == ["draft", "live", "sent", "opened", "replied"],
       {k: S[k] for k in ("draft", "ready", "sent", "opened", "replied")})
    ck("GAP a3: a reply to the new opportunity attributes through the real matcher (tier sender) and flips it to Replied",
       S["matched"] == 1 and S["tier"] == "sender" and S["replied"] == "replied" and S["idempotent"] is True, S)

    # ---- Scenario B: a newly created group campaign ----
    group_runs = [pg.evaluate(GROUP) for _ in range(RUNS)]
    G = group_runs[0]
    ck("GAP b1: a freshly minted campaign is classified a group and derives Draft -> Sent -> Opened (never seeded)",
       G["isGroup"] is True and [G["draft"], G["sent"], G["opened"]] == ["draft", "sent", "opened"],
       {k: G[k] for k in ("isGroup", "draft", "sent", "opened")})
    ck("GAP b2: a replier spawns exactly one child, in Replied, linked both ways to the campaign and recipient",
       G["matched"] == 1 and G["spawned"] == 1 and G["child_exists"] and G["child_linked"] and G["child_stage"] == "replied", G)
    ck("GAP b3: the parent group stays in its lane (Opened) and is NEVER Replied, stored stage never stamped replied",
       G["parent_stage"] == "opened" and G["parent_never_replied"] is True and G["parent_stored"] in ("", "sent"), G)
    ck("GAP b4: the replying recipient row reads Replied and links to its child; a silent recipient reads Sent",
       G["basel_chip"] == "replied" and G["basel_child"] is True and G["lina_chip"] == "sent", G)
    ck("GAP b5: spawning is idempotent, no duplicate child on re-match (one opportunity minted, one child, stable)",
       G["opps_after"] == 2 and G["spawned_again"] == 0 and G["opps_final"] == 2, G)

    # ---- Determinism: every derived fact is identical across all five reseeded runs ----
    ck(f"the single-opportunity ladder is byte-identical across {RUNS} reseeded runs (deterministic, order-independent)",
       all(json.dumps(r, sort_keys=True) == json.dumps(S, sort_keys=True) for r in single_runs),
       [r for r in single_runs if json.dumps(r, sort_keys=True) != json.dumps(S, sort_keys=True)][:1])
    ck(f"the group campaign spawn is byte-identical across {RUNS} reseeded runs (deterministic, order-independent)",
       all(json.dumps(r, sort_keys=True) == json.dumps(G, sort_keys=True) for r in group_runs),
       [r for r in group_runs if json.dumps(r, sort_keys=True) != json.dumps(G, sort_keys=True)][:1])

    # ---- Scenario C: the freshly minted record survives the Supabase-only read path (Stage 4) ----
    supa = pg.evaluate(r"""async () => {
      ['thrive_opps_v1','thrive_mail_v1','thrive_inbound_v1','thrive_hits_v1'].forEach(k=>localStorage.setItem(k,'[]'));
      const rec = window.ThriveIntake.toRecord({business:'Cloud Co', slug_hint:'cloud-co', email:'hi@cloud.co', channel:'email', extra:{}, alternates:[]}, {today:'2026-09-01'});
      rec.published = true;
      // Place the MINTED-shape record (not a hand-authored one) into Supabase, plus its send and reply.
      window.__sb.tables.console_opps['cloud-co'] = { slug:'cloud-co', data: rec };
      window.__sb.tables.console_mail['scm1'] = { id:'scm1', data:{ mid:'scm1', opp:'cloud-co', to:'hi@cloud.co', status:'sent', direction:'out', ts:'2026-09-02T10:00:00Z' } };
      window.__sb.tables.console_inbound['sci1'] = { id:'sci1', data:{ gid:'sci1', opp:'cloud-co', kind:'reply', from:'hi@cloud.co', subject:'Re: A page for you', snippet:'yes', ts:'2026-09-03T09:00:00Z' } };
      localStorage.setItem('console_sb_read','1');
      await window.supaHydrate();
      return { stage: window.effStage(window.getDraft('cloud-co')), shape: !!window.getDraft('cloud-co') };
    }""") if pg.evaluate(FAKE) and pg.evaluate("()=>{window.ThriveSupa.setCfg('https://fake.supabase.co','anon'); return true;}") else {}
    ck("GAP c: a freshly minted record read back through the Supabase-only path (Stage 4) still derives Replied",
       supa.get("shape") is True and supa.get("stage") == "replied", supa)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL NEW-OPPORTUNITY LOCK CHECKS PASS"))
raise SystemExit(1 if fails else 0)
