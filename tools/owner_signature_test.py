"""PR-B: "use the card owner's signature" (board.html, fails-when-broken).

Live fault: opening a card owned by Basel or Agha showed an EMPTY signature, and "Use my signature" filled the
VIEWER's (Thyab's). Members' saved signatures lived only in console_profiles.prefs, which is own-row by RLS, so a
teammate could never read them. PR-B adds a shared signature book (console_signatures: open read, own-row write)
and two choices in the editor.

Asserts (each fails-when-broken):
  (a) on another member's card with no card signature, the field DEFAULTS to that owner's SAVED signature, and the
      exact-send preview shows it (never the viewer's).
  (b) both choices exist: "Use my signature" fills the viewer's; "Use Basel's signature" fills Basel's saved one;
      the preview follows each choice.
  (c) an owner with NO saved signature: the field stays EMPTY (the viewer's is never auto-inserted); "Use Agha's
      signature" fills Agha's own default (Agha's name, never the viewer's).
  (d) on your OWN card there is no owner choice and nothing is auto-inserted.
  (e) saving a signature writes the member's OWN row in the shared book (uid = currentUid).
  (f) Arabic: the owner choice is localized and the default still applies.
  (g) static: the SQL is additive (create if not exists, guarded policies, auth.uid()::text, block comments only,
      no Arabic, no drop); the send path is untouched; canon hygiene.
"""
import os, re, json, threading, http.server, socketserver, functools
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:500])

src = open(f"{ROOT}/library/board.html", encoding="utf-8").read()
sql = open(f"{ROOT}/docs/supabase-signatures.sql", encoding="utf-8").read()

# ---- (g) static ------------------------------------------------------------------------------------
ck("(g) SQL creates the shared book additively", "create table if not exists public.console_signatures" in sql)
ck("(g) SQL: teammates read every row", "for select to authenticated using (true)" in sql)
ck("(g) SQL: own-row writes compare against auth.uid()::text",
   sql.count("uid = auth.uid()::text") >= 3 and re.search(r"auth\.uid\(\)(?!::text)", re.sub(r"/\*[\s\S]*?\*/", "", sql)) is None)
ck("(g) SQL: block comments only (no double-dash)", "--" not in sql)
ck("(g) SQL: no Arabic", re.search(r"[؀-ۿ]", sql) is None)
ck("(g) SQL: no destructive statement", re.search(r"\b(drop|truncate|delete\s+from)\b", re.sub(r"/\*[\s\S]*?\*/", "", sql), re.I) is None)
ck("(g) the send path is untouched: unifiedSend -> runSend", re.search(r"function unifiedSend[\s\S]{0,3200}runSend\(slug\)", src) is not None)
ck("(g) no em dash", "—" not in src)
ck("(g) itfGhroob 0 refs", "itfGhroob" not in src)
for lit in ["#C98B8B", "#9c5757", "#a85f5f"]:
    ck("(g) no dusty rose " + lit, lit not in src)

# ---- browser harness -------------------------------------------------------------------------------
U_T, U_B, U_A = "u_thyab", "u_basel", "u_agha"
PROFILES = [{"uid":U_T,"display_name":"Thyab","email":"abdu.thyab@gmail.com"},
            {"uid":U_B,"display_name":"Basel","email":"alnajjarjawad97@gmail.com"},
            {"uid":U_A,"display_name":"Agha","email":"muhelagha@gmail.com"}]
BASEL_SIG = "Basel Najjar\nSenior Partner\nthriveiii.com"
BOOK = [{"uid":U_B, "signatures":[{"id":"s1","name":"Basel","text":BASEL_SIG}], "def":"s1"}]
def card(slug, biz): return {"slug":slug,"business":biz,"stage":"live","sent_count":0,"open_count":0,"replied":False,"idle_days":0,"last_activity_ts":"2026-09-29T00:00:00Z","has_page":False,"has_email":True,"archived":False,"cycle":None}
BOARD = [card("c-basel","Basel Card"), card("c-agha","Agha Card"), card("c-mine","My Card")]
OWNERS = {"c-basel":U_B, "c-agha":U_A, "c-mine":U_T}
def data_for(slug): return {"outreach_subject":"Hello there","outreach_text":"A short note for you.","sig":"","recipients":[{"addr":"lead@"+slug+".example","name":"","lang":"en"}]}

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
class TSrv(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True; allow_reuse_address = True
httpd = TSrv(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright
def J(r, o, s=200): r.fulfill(status=s, headers={"content-type":"application/json"}, body=json.dumps(o))

def make():
    st = {"book_posts":[], "book_gets":0, "sends":[]}
    def route_opps(r):
        u = r.request.url
        if r.request.method in ("POST","PATCH"): return r.fulfill(status=204, body="")
        if "select=slug,owner" in u or "select=slug%2Cowner" in u: return J(r, [{"slug":k,"owner":v} for k,v in OWNERS.items()])
        if "recipients" in u: return J(r, [{"slug":k,"to":"lead@"+k+".example"} for k in OWNERS])
        m = re.search(r"slug=eq\.([^&]+)", u)
        if m: return J(r, [{"slug":m.group(1),"data":data_for(m.group(1)),"archived_at":None}])
        return J(r, [])
    def route_book(r):
        if r.request.method == "POST":
            st["book_posts"].append(json.loads(r.request.post_data or "[]")); return r.fulfill(status=201, body="")
        st["book_gets"] += 1; return J(r, BOOK)
    def route_profiles(r):
        if r.request.method == "POST":
            body = json.loads(r.request.post_data or "{}"); return J(r, [body], 201)
        return J(r, [{"uid":U_T,"display_name":"Thyab","prefs":{}}])
    def wire(ctx, lang):
        ctx.add_init_script("try{localStorage.setItem('console_sb_session',JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'abdu.thyab@gmail.com',uid:'"+U_T+"'}));localStorage.setItem('thrive_lang','"+lang+"');}catch(e){}")
        def route_relay(r):
            try: d = json.loads(r.request.post_data or "{}")
            except Exception: d = {}
            if d.get("to"): st["sends"].append(d)
            return J(r, {"ok":True,"id":"x","relay_version":9,"delivered":True})
        ctx.route(re.compile(r"script\.google\.com/.*"), route_relay)
        ctx.route("**/rest/v1/console_board**", lambda r: J(r, BOARD))
        ctx.route("**/rest/v1/console_opps**", route_opps)
        ctx.route("**/rest/v1/console_signatures**", route_book)
        ctx.route("**/rest/v1/console_profile_names**", lambda r: J(r, PROFILES))
        ctx.route("**/rest/v1/console_profiles**", route_profiles)
        ctx.route("**/rest/v1/console_mail**", lambda r: (r.fulfill(status=204, body="") if r.request.method=="POST" else J(r, [])))
        for tn in ["console_pages","console_suppressions","console_hits","console_inbound","console_members","console_team_roster","console_admins","console_contacts","console_card_members","console_watchers"]:
            ctx.route(f"**/rest/v1/{tn}**", lambda r: J(r, []))
    return st, wire

def boot(b, lang="en", w=1440):
    st, wire = make()
    ctx = b.new_context(viewport={"width":w,"height":900}); wire(ctx, lang)
    pg = ctx.new_page(); perr = []; pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_selector(".lane", timeout=8000); pg.wait_for_timeout(900)
    return st, ctx, pg, perr

def open_msg(pg, slug):
    pg.click(f'.card[data-slug="{slug}"]'); pg.wait_for_selector("#crMsgPanel #edSig", timeout=8000); pg.wait_for_timeout(900)

def sigstate(pg):
    return pg.evaluate("""()=>{ var s=document.querySelector('#crMsgPanel #edSig'); var f=document.querySelector('#crMsgPanel #edPreview');
      var o=document.querySelector('#crMsgPanel #edSigOwner'); var m=document.querySelector('#crMsgPanel #edSigFill');
      return { val:s?s.value:null, src:s?s.getAttribute('data-sig-src'):null, prev:f?(f.getAttribute('srcdoc')||''):'',
               owner:o?o.textContent:null, mine:m?m.textContent:null }; }""")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # ---- (a)(b) Basel's card -----------------------------------------------------------------------
    st, ctx, pg, perr = boot(b)
    open_msg(pg, "c-basel"); s1 = sigstate(pg)
    ck("(a) teammates' signatures are read from the shared book", st["book_gets"] >= 1, st)
    ck("(a) Basel's empty card DEFAULTS to Basel's saved signature", s1["val"] == BASEL_SIG and s1["src"] == "owner", s1)
    ck("(a) the exact-send preview shows Basel's signature, not the viewer's",
       "Basel Najjar" in s1["prev"] and "Thyab" not in s1["prev"], s1["prev"][-300:])
    ck("(b) both choices are offered: Use my signature + Use Basel's signature",
       s1["mine"] == "Use my signature" and s1["owner"] == "Use Basel's signature", s1)
    pg.click("#crMsgPanel #edSigFill"); pg.wait_for_timeout(500); s2 = sigstate(pg)
    ck("(b) 'Use my signature' fills the viewer's signature, and the preview follows",
       s2["val"].startswith("Thyab\n") and "Basel Najjar" not in s2["val"] and "Thyab" in s2["prev"], s2)
    pg.click("#crMsgPanel #edSigOwner"); pg.wait_for_timeout(500); s3 = sigstate(pg)
    ck("(b) 'Use Basel's signature' fills Basel's saved signature, and the preview follows",
       s3["val"] == BASEL_SIG and "Basel Najjar" in s3["prev"], s3)
    ck("(a/b) no uncaught error", perr == [], perr)
    pg.close(); ctx.close()

    # ---- (c) Agha's card: no saved signature -------------------------------------------------------
    st, ctx, pg, perr = boot(b)
    open_msg(pg, "c-agha"); a1 = sigstate(pg)
    ck("(c) an owner with no saved signature: the field stays EMPTY (the viewer's is never auto-inserted)", a1["val"] == "" and a1["src"] is None, a1)
    ck("(c) the guaranteed signature is kept, as the OWNER's (Agha's) default, never the viewer's, in the preview",
       "Agha<br>Thrive Digital Solutions" in a1["prev"] and "Thyab" not in a1["prev"], a1["prev"][-260:])
    pg.evaluate("()=>{ var b=document.querySelector('#crMsgPanel #nmSend'); if(b){ b.disabled=false; b.click(); } }"); pg.wait_for_timeout(3000)
    sent = st["sends"]
    ck("(c) the ACTUAL send on Agha's card carries Agha's signature, never the viewer's",
       len(sent) == 1 and "Agha" in (sent[0].get("text") or "") and "Thyab" not in (sent[0].get("text") or "") + (sent[0].get("html") or ""),
       [(x.get("to"), (x.get("text") or "")[-80:]) for x in sent])
    ck("(c) the choice reads 'Use Agha's signature'", a1["owner"] == "Use Agha's signature", a1)
    pg.close(); ctx.close()
    st, ctx, pg, perr = boot(b)
    open_msg(pg, "c-agha")
    pg.click("#crMsgPanel #edSigOwner"); pg.wait_for_timeout(500); a2 = sigstate(pg)
    ck("(c) 'Use Agha's signature' fills Agha's own default (Agha's name, not the viewer's)",
       a2["val"].startswith("Agha\n") and "Thyab" not in a2["val"] and "Agha" in a2["prev"], a2)
    pg.close(); ctx.close()

    # ---- (d) own card, (e) save publishes to the shared book ---------------------------------------
    st, ctx, pg, perr = boot(b)
    open_msg(pg, "c-mine"); m1 = sigstate(pg)
    ck("(d) on your own card there is no owner choice and nothing is auto-inserted", m1["owner"] is None and m1["val"] == "", m1)
    pg.evaluate("()=>window.__thriveSaveSignature({id:'sig-t1', name:'Thyab', text:'Abdu Thyab\\nFounder'})"); pg.wait_for_timeout(1200)
    posts = st["book_posts"]
    row = (posts[-1][0] if posts and isinstance(posts[-1], list) and posts[-1] else {})
    ck("(e) saving a signature writes the member's OWN row in the shared book",
       row.get("uid") == U_T and any(s.get("text") == "Abdu Thyab\nFounder" for s in row.get("signatures", [])), posts)
    pg.close(); ctx.close()

    # ---- (f) Arabic -------------------------------------------------------------------------------
    st, ctx, pg, perr = boot(b, "ar", 390)
    open_msg(pg, "c-basel"); r1 = sigstate(pg)
    ck("(f) Arabic: the owner choice is localized", r1["owner"] == "استخدم توقيع Basel", r1)
    ck("(f) Arabic: the owner's saved signature is still the default", r1["val"] == BASEL_SIG, r1)
    ck("(f) no uncaught error in Arabic", perr == [], perr)
    pg.close(); ctx.close()

    b.close()

print()
if fails:
    print("FAILED: " + str(len(fails)) + " check(s)")
    for f in fails: print("  - " + f)
    raise SystemExit(1)
print("ALL OWNER-SIGNATURE CHECKS PASS")
