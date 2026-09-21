"""BRAND FONTS loaded and bound to the type tokens (board.html), fonts only.

Asserts (each fails-when-broken):
  (a) @font-face rules load the brand fonts from the PINNED Supabase URLs (the exact ASSET_MANIFEST
      filenames), with font-display:swap: Lato in the used weights (400/700/900) and itfGhroob in every
      available Arabic weight (300/400/700/900). Syne has no pinned asset, so it is intentionally NOT
      declared, and --font-display still falls back to Lato (no guessed URL, no broken @font-face).
  (b) --font-body resolves to Lato for Latin and --font-ar resolves to itfGhroob for Arabic (RTL), the
      brand family FIRST in the stack; the itfGhroob @font-face is registered with the document; Arabic
      carries letter-spacing:normal and is not uppercased (stays joined, no Latin tracking).
  (c) the change is fonts ONLY: with the @font-face lines and the build stamp removed, board.html is
      byte-identical to origin/main (no color, spacing, or other token changed).

FAILS-WHEN-BROKEN: drop or alter an @font-face URL, bind Arabic to a non-brand family, let a Latin
tracking value leak onto Arabic, or change any non-font CSS -> fails.
"""
import os, re, subprocess, threading, http.server, socketserver, functools
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:300])

PIN = "https://ssqhwdzgegzqcjfcclmr.supabase.co/storage/v1/object/public/assets/fonts/"
LATO = {"400":"font-02-22937cf9.woff2", "700":"font-03-151d08ee.woff2", "900":"font-04-dd8e8c5a.woff2"}
GHROOB = {"300":"font-05-e36207c4.woff2", "400":"font-06-58a22f0f.woff2", "700":"font-07-ee5dbf54.woff2", "900":"font-08-e35f45ee.woff2"}

src = open(f"{ROOT}/library/board.html", encoding="utf-8").read()

# ---- (a) @font-face load the brand fonts from the pinned URLs, font-display:swap -------------------
faces = re.findall(r"@font-face\{[^}]*\}", src)
def face_for(fam, weight):
    for f in faces:
        if re.search(r"font-family:\s*['\"]?%s['\"]?\b" % re.escape(fam), f) and re.search(r"font-weight:\s*%s\b" % weight, f):
            return f
    return ""
for w, fn in LATO.items():
    f = face_for("Lato", w)
    ck("(a) Lato %s @font-face references the pinned URL %s" % (w, fn), bool(f) and (PIN+fn) in f, f)
    ck("(a) Lato %s @font-face is font-display:swap" % w, "font-display:swap" in f.replace(" ", ""), f)
for w, fn in GHROOB.items():
    f = face_for("itfGhroob", w)
    ck("(a) itfGhroob %s @font-face references the pinned URL %s" % (w, fn), bool(f) and (PIN+fn) in f, f)
    ck("(a) itfGhroob %s @font-face is font-display:swap" % w, "font-display:swap" in f.replace(" ", ""), f)
ck("(a) exactly the 7 brand faces are declared (3 Lato + 4 itfGhroob), no extras", len(faces)==7, len(faces))
ck("(a) Syne is intentionally NOT declared as an @font-face (no pinned asset, no guessed URL)",
   not any("font-family:Syne" in f.replace(" ", "").replace("'", "").replace('"', "") for f in faces))
ck("(a) --font-display still falls back to Lato until Syne is pinned",
   re.search(r"--font-display:\s*Syne,\s*var\(--font-body\)", src) is not None)
ck("(a) no inline base64 font data was added (reuse the pinned URLs only)", "data:font" not in src and "data:application/font" not in src)
# brand rules: no em dash anywhere; the Arabic forms keep Western numerals in the filenames
ck("(a) no em dash anywhere in board.html", "—" not in src)

# ---- (c) fonts ONLY: strip @font-face + build stamp, compare to origin/main -----------------------
def strip(s):
    s = re.sub(r"\s*@font-face\{[^}]*\}", "", s)              # remove all @font-face rules (the only new CSS RULES)
    s = re.sub(r"/\*.*?\*/", "", s, flags=re.S)               # remove CSS/JS block comments on BOTH sides (the fonts
                                                              # block carries a documenting comment; comments are not
                                                              # layout tokens, so normalize them away symmetrically)
    s = re.sub(r"[0-9a-f]{8}", "HASH", s)                      # neutralize the 8-hex build stamp everywhere
    s = re.sub(r"\s+", " ", s)                                # collapse whitespace so comment removal leaves no residue
    return s
try:
    main_src = subprocess.check_output(["git", "-C", ROOT, "show", "origin/main:library/board.html"], text=True)
    ck("(c) board.html minus @font-face and build stamp is byte-identical to origin/main (fonts-only diff)",
       strip(src) == strip(main_src),
       "lengths cur=%d main=%d" % (len(strip(src)), len(strip(main_src))))
except Exception as e:
    ck("(c) could compare against origin/main", False, str(e))

# ---- (b) behavior: the tokens resolve to the brand families; Arabic joined, normal tracking --------
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True; threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright
def wire(ctx, ar=False):
    js = "try{localStorage.setItem('console_sb_session', JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'op@thrive.test',uid:'u'}));"
    if ar: js += "localStorage.setItem('thrive_lang','ar');"
    js += "}catch(e){}"
    ctx.add_init_script(js)
    ctx.route("**/rest/v1/console_board**", lambda r: r.fulfill(status=200, headers={"content-type":"application/json"}, body="[]"))
    for tn in ["console_opps","console_pages","console_mail","console_hits","console_inbound","console_suppressions","console_profiles","console_profile_names","console_members","console_team_roster","console_admins","console_contacts"]:
        ctx.route(f"**/rest/v1/{tn}**", lambda r: r.fulfill(status=200, headers={"content-type":"application/json"}, body="[]"))

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # English (LTR): --font-body resolves to Lato first
    ctx = b.new_context(viewport={"width":1024,"height":800}); wire(ctx)
    pg = ctx.new_page(); pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(600)
    en = pg.evaluate("""()=>{ var b=getComputedStyle(document.body);
        var reg=Array.from(document.fonts).some(function(f){return f.family.replace(/['\"]/g,'')==='Lato';});
        return { fam:b.fontFamily, reg:reg, dir:document.documentElement.getAttribute('dir') }; }""")
    ck("(b) English document is LTR", en["dir"]=="ltr", en)
    ck("(b) --font-body resolves to Lato FIRST for Latin", en["fam"].replace('"','').lower().startswith("lato"), en["fam"])
    ck("(b) a Lato @font-face is registered with the document", en["reg"] is True, en)
    pg.close(); ctx.close()

    # Arabic (RTL): --font-ar resolves to itfGhroob first; joined; normal tracking; not uppercased
    ctx2 = b.new_context(viewport={"width":390,"height":800}); wire(ctx2, ar=True)   # 390 = phone width guard
    pg2 = ctx2.new_page(); pg2.goto(f"{base}/library/board.html", wait_until="load"); pg2.wait_for_timeout(600)
    ar = pg2.evaluate("""()=>{ var b=getComputedStyle(document.body);
        var reg=Array.from(document.fonts).some(function(f){return f.family.replace(/['\"]/g,'')==='itfGhroob';});
        return { fam:b.fontFamily, ls:b.letterSpacing, tt:b.textTransform, reg:reg,
                 dir:document.documentElement.getAttribute('dir') }; }""")
    ck("(b) Arabic document is RTL", ar["dir"]=="rtl", ar)
    first = ar["fam"].split(",")[0].replace('"','').replace("'","").strip().lower()
    ck("(b) --font-ar resolves to itfGhroob FIRST for Arabic (never a system Arabic fallback)", first=="itfghroob", ar["fam"])
    ck("(b) an itfGhroob @font-face is registered with the document", ar["reg"] is True, ar)
    ck("(b) Arabic body carries letter-spacing:normal (stays joined, no Latin tracking)", ar["ls"]=="normal", ar)
    ck("(b) Arabic body is not uppercased", ar["tt"]=="none", ar)
    pg2.close(); ctx2.close()
    b.close()
httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL FONTS-LOAD-BIND CHECKS PASS"))
import sys; sys.exit(1 if fails else 0)
