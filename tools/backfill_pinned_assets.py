#!/usr/bin/env python3
"""One-off backfill: rewrite already-published static opp pages so their INLINED base64 assets become URLs
into the pinned public Supabase Storage `assets` bucket. Content-identical, slug/URL-unchanged, nothing lost.

Guarantees (see the PR body):
  - SUBSTITUTE BY CONTENT HASH ONLY. For each data:<mime>;base64,<X> in a page, compute md5(decode(X)) and
    replace ONLY if its 8-hex prefix is in PINNED below, swapping it for the exact pinned URL (same bytes ->
    identical render).
  - NEVER GUESS, NEVER DROP. An unknown hash (e.g. a per-prospect image) is left inlined and reported.
  - URLS/SLUGS UNCHANGED. Only the src / @font-face bytes change; every opp/<slug>/index.html keeps its path.
  - IDEMPOTENT. A re-run finds no remaining known data: URIs.

The Storage base is DERIVED from the same Supabase URL the console holds (config.js supaUrl, the base restGet
uses) -> no hardcoded project ref. Bucket: assets (public).

Run from the repo root:  python3 tools/backfill_pinned_assets.py         (rewrite + report)
                         python3 tools/backfill_pinned_assets.py --check  (report only, no writes)
"""
import base64, hashlib, glob, re, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHECK = "--check" in sys.argv

# The pinned content-hash -> path (under the `assets` bucket) map. 8-hex md5 prefix per asset.
PINNED = {
    # fonts -> assets/fonts/
    "beb41e57": "fonts/font-01-beb41e57.woff2", "22937cf9": "fonts/font-02-22937cf9.woff2",
    "151d08ee": "fonts/font-03-151d08ee.woff2", "dd8e8c5a": "fonts/font-04-dd8e8c5a.woff2",
    "e36207c4": "fonts/font-05-e36207c4.woff2", "58a22f0f": "fonts/font-06-58a22f0f.woff2",
    "ee5dbf54": "fonts/font-07-ee5dbf54.woff2", "e35f45ee": "fonts/font-08-e35f45ee.woff2",
    # opp images -> assets/opp/
    "544275ef": "opp/opp-05-544275ef.png", "216e41dc": "opp/opp-06-216e41dc.jpg",
    "bdd7d105": "opp/opp-07-bdd7d105.jpg", "f0c1a1b9": "opp/opp-08-f0c1a1b9.jpg",
    "f7a203b1": "opp/opp-09-f7a203b1.jpg", "49193d0e": "opp/opp-10-49193d0e.jpg",
    "2a8ad948": "opp/opp-11-2a8ad948.jpg", "565c5c22": "opp/opp-12-565c5c22.jpg",
    "62a329d8": "opp/opp-13-62a329d8.jpg", "121572d8": "opp/opp-14-121572d8.jpg",
    "34357b25": "opp/opp-15-34357b25.jpg", "31d33179": "opp/opp-16-31d33179.jpg",
}

def supa_base():
    cfg = open(os.path.join(ROOT, "library/config.js"), encoding="utf-8").read()
    m = re.search(r'supaUrl\s*=\s*"([^"]+)"', cfg)
    if not m:
        raise SystemExit("could not read supaUrl from library/config.js")
    return m.group(1).rstrip("/") + "/storage/v1/object/public/assets"

ASSET_BASE = supa_base()
DATA_URI = re.compile(r'data:[^,]*?;base64,([A-Za-z0-9+/=]+)')

def hash8(b64):
    try:
        raw = base64.b64decode(b64, validate=False)
    except Exception:
        return None
    return hashlib.md5(raw).hexdigest()[:8]

def rewrite(text):
    replaced = [0]
    unmatched = {}   # hash8 -> count of inlined blobs left intact
    def sub(m):
        h = hash8(m.group(1))
        if h and h in PINNED:
            replaced[0] += 1
            return ASSET_BASE + "/" + PINNED[h]
        # never guess, never drop: leave the blob inlined, record it
        key = h or "undecodable"
        unmatched[key] = unmatched.get(key, 0) + 1
        return m.group(0)
    return DATA_URI.sub(sub, text), replaced[0], unmatched

def main():
    files = sorted(glob.glob(os.path.join(ROOT, "opp", "*", "index.html")))
    print("ASSET_BASE = " + ASSET_BASE)
    print("pages: %d   mode: %s\n" % (len(files), "CHECK (no writes)" if CHECK else "REWRITE"))
    tot_before = tot_after = tot_repl = 0
    all_unmatched = {}
    changed = 0
    for f in files:
        s = open(f, encoding="utf-8").read()
        before = len(s.encode("utf-8"))
        out, n, unm = rewrite(s)
        after = len(out.encode("utf-8"))
        tot_before += before; tot_after += after; tot_repl += n
        for k, v in unm.items():
            all_unmatched[k] = all_unmatched.get(k, 0) + v
        slug = os.path.basename(os.path.dirname(f))
        if n or unm:
            unm_str = ("  UNMATCHED " + ", ".join("%s x%d" % (k, v) for k, v in sorted(unm.items()))) if unm else ""
            print("%-42s %8d -> %7d B  replaced %d%s" % (slug, before, after, n, unm_str))
        if out != s:
            changed += 1
            if not CHECK:
                open(f, "w", encoding="utf-8").write(out)
    print("\n%d/%d pages %s; %d blobs replaced; %d B -> %d B (%.1f%% lighter)" % (
        changed, len(files), "would change" if CHECK else "rewritten", tot_repl,
        tot_before, tot_after, (100.0 * (tot_before - tot_after) / tot_before) if tot_before else 0.0))
    if all_unmatched:
        print("UNMATCHED hashes left inlined (never dropped): " +
              ", ".join("%s x%d" % (k, v) for k, v in sorted(all_unmatched.items())))
    else:
        print("UNMATCHED hashes: 0 (every inlined blob was a pinned asset)")

if __name__ == "__main__":
    main()
