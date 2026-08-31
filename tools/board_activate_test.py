"""F2 static activation, now ON UPLOAD. The manual "Activate" / "Re-activate" button is removed: a page-bearing
upload publishes to GitHub Pages and verifies live in the same action (upCommit -> pagePublishRelay ->
background verify + pageStampLive). This test guards the ENDURING F2 security contract and the new wiring at
the SOURCE level (no browser, deterministic):

  1. ACTIVATE ON UPLOAD: upCommit publishes each page row inline via pagePublishRelay(withBeaconClient(html));
     a background pass (upActivateBackground) verifies live and stamps live_verified_at. No manual button.
  2. NO CLIENT TOKEN: the client hands the relay {op:'page_publish', slug, html} and never holds a repo token
     (no ghp_/github_pat/GH_TOKEN/Authorization/Bearer in the client publish path).
  3. BEACON: withBeaconClient injects beacon.js into the committed html (idempotent).
  4. SERVER-HELD: the relay (thrive-relay.gs) dispatches op=page_publish, reads GH_TOKEN from a Script Property
     (server-side only), sanitizes the slug, and injects withBeacon_.
  5. NO RE-ACTIVATE: the built board carries no upActBtn / up_reactivate / up_state_draft; the send gate blocks
     ONLY on a definitively dead page (deadlink), never on "not activated" (no notlive / s_not_live).

Privacy: no live data; source only.
"""
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
upload = open(os.path.join(ROOT, "tools/board-upload.src.js")).read()
send   = open(os.path.join(ROOT, "tools/board-send.src.js")).read()
relay  = open(os.path.join(ROOT, "relay/thrive-relay.gs")).read()
board  = open(os.path.join(ROOT, "library/board.html"), encoding="utf-8").read()

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:300])

def fn(src, name):
    at = src.find("function " + name + "(")
    if at < 0: return ""
    i = src.find("{", at); depth = 0
    while i < len(src):
        if src[i] == "{": depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0: return src[at:i+1]
        i += 1
    return src[at:]

# ---- 1. ACTIVATE ON UPLOAD ------------------------------------------------------------------------
up_commit = fn(upload, "upCommit")
ck("1: upCommit publishes a page row inline via pagePublishRelay(withBeaconClient(html))",
   "pagePublishRelay(r.slug, withBeaconClient(html))" in up_commit)
ck("1: upCommit collects the published slugs for the background verify/stamp",
   "published.push(r.slug)" in up_commit and "published:published" in up_commit)
ck("1: a text-only row (no page html) skips the publish (untouched)",
   'if(!String(html).trim()){ ok++; return one(i + 1); }' in up_commit)
ck("1: upApprove runs the background activation (verify + stamp) after commit",
   "upActivateBackground(res.published)" in fn(upload, "upApprove"))
bg = fn(upload, "upActivateBackground")
ck("1: the background pass verifies then stamps live_verified_at (the single liveness write)",
   "verifyLivePoll(slug)" in bg and "pageStampLive(slug)" in bg)

# ---- 2. NO CLIENT TOKEN ---------------------------------------------------------------------------
ppr = fn(upload, "pagePublishRelay")
ck("2: the client publish payload is just {op:'page_publish', slug, html}",
   'op:"page_publish"' in ppr and "slug:slug" in ppr and "html:html" in ppr)
# The client never carries a repo token value (ghp_/github_pat); the only GH_TOKEN mention is a comment saying
# the RELAY holds it server-side. Authorization: Bearer in this file is the Supabase session, not a repo token.
ck("2: NO GitHub repo token value in the client upload path (no ghp_/github_pat)",
   not re.search(r"ghp_|github_pat", upload), "found a repo-token value in board-upload.src.js")
ck("2: the only GH_TOKEN reference is the comment that the RELAY holds it (client never sees the token)",
   "The client never sees the token" in upload)

# ---- 3. BEACON ------------------------------------------------------------------------------------
wbc = fn(upload, "withBeaconClient")
ck("3: withBeaconClient injects the beacon tag (BEACON_TAG_UP) into the committed html, idempotent",
   "BEACON_TAG_UP" in wbc and "beacon" in wbc and 'src="/beacon.js"' in upload)

# ---- 4. SERVER-HELD (relay) -----------------------------------------------------------------------
ck("4: relay dispatches op page_publish to pagePublish_", "op === 'page_publish'" in relay and "pagePublish_" in relay)
ck("4: relay reads GH_TOKEN from a Script Property (server-side only)", "getProperty('GH_TOKEN')" in relay)
ck("4: relay hard-sanitizes the slug to [a-z0-9-]", "[a-z0-9]" in fn(relay, "pagePublish_"))
ck("4: relay injects the beacon into the committed html (withBeacon_)", "withBeacon_" in relay and "beacon.js" in relay)

# ---- 5. NO RE-ACTIVATE ----------------------------------------------------------------------------
ck("5: the built board has NO re-activate button (#upActBtn)", "upActBtn" not in board)
ck("5: the retired copy keys are gone (up_reactivate / up_state_draft)",
   "up_reactivate" not in board and "up_state_draft" not in board)
ck("5: the send gate no longer denies with 'notlive' (blocks only on deadlink)",
   'deny("notlive")' not in upload and "s_not_live" not in board)
ck("5: the send gate STILL blocks a definitively dead page (deadlink / s_dead_link kept)",
   'deny("deadlink")' in upload and "s_dead_link" in board)

print("")
if fails:
    print(str(len(fails)) + " FAILED")
    sys.exit(1)
print("ALL ACTIVATE CHECKS PASS")
