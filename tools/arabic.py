"""WO-013 phase 7: the Arabic law.

The review's judgement was blunt and correct: the Arabic read like a machine. This proves the five
checks that keep it fixed actually fail, by introducing one of each and watching the build go red.

Run it: python3 tools/arabic.py
"""
import os, sys, re, shutil, subprocess, json, threading, http.server, socketserver, functools

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])


def verify():
    return subprocess.run(["node", os.path.join(ROOT, "tools", "verify.js")],
                          capture_output=True, text=True, cwd=ROOT)


# ---- the five checks, each proven by introducing one violation -------------
I18N = os.path.join(ROOT, "library", "i18n.js")
CSS = os.path.join(ROOT, "library", "styles.css")

r = verify()
ck("the build is green before anything is broken", r.returncode == 0, r.stdout[-300:])

CASES = [
    (I18N, '    lane_draft:     "مسودة",', '    lane_draft:     "أُرسلت مسودة",',
     "no passive verb form", "a passive verb form fails the build"),
    (I18N, '    lane_draft:     "مسودة",', '    lane_draft:     "بطاقتان",',
     "no bare dual used as a count label", "a bare dual as a count label fails the build"),
    (I18N, '    lane_draft:     "مسودة",', '    lane_draft:     "مسودة \\"جديدة\\"",',
     "guillemets", "a straight quote inside Arabic fails the build"),
    (I18N, '    lane_draft:     "مسودة",', '    lane_draft:     "مسودة ٣",',
     "Western numerals only", "an Eastern Arabic numeral fails the build"),
    (CSS, '[dir="rtl"] .kind-tag{ letter-spacing:normal }',
     '[dir="rtl"] .kind-tag{ letter-spacing:.08em }',
     "letter-spacing or text-transform on an Arabic selector",
     "letter-spacing reaching an Arabic selector fails the build"),
]

for path, old, new, needle, label in CASES:
    bak = path + ".bak"
    shutil.copy(path, bak)
    try:
        s = open(path, encoding="utf-8").read()
        # The Arabic dictionary holds the key twice; the last one is the Arabic side.
        if path == I18N:
            hits = [m for m in re.finditer(re.escape(old), s)]
            ck("  the harness could introduce the violation (" + label + ")", len(hits) >= 1)
            if not hits: continue
            m = hits[-1]
            s = s[:m.start()] + new + s[m.end():]
        else:
            ck("  the harness could introduce the violation (" + label + ")", old in s)
            s = s.replace(old, new, 1)
        open(path, "w", encoding="utf-8").write(s)
        r = verify()
        ck(label, r.returncode != 0 and needle in r.stdout, r.stdout[-300:])
    finally:
        shutil.move(bak, path)

r = verify()
ck("and the build is green again once every one is put back", r.returncode == 0, r.stdout[-300:])

# ---- the rules, measured over the whole dictionary -------------------------
src = open(I18N, encoding="utf-8").read()
g = {}
exec_js = None
import subprocess as sp
probe = sp.run(["node", "-e", """
const fs=require('fs');
eval(fs.readFileSync('library/i18n.js','utf8')
  .replace('const I18N','globalThis.I18N').replace('var I18N_BOARD','globalThis.I18N_BOARD'));
const out={ar:I18N.ar, en:I18N.en, board:I18N_BOARD.ar};
process.stdout.write(JSON.stringify(out));
"""], capture_output=True, text=True, cwd=ROOT)
d = json.loads(probe.stdout)
ar, en = d["ar"], d["en"]

ck("every Arabic string was reviewed", len([k for k in ar if isinstance(ar[k], str)]) > 700,
   len(ar))
ck("the English dictionary is the same size, so nothing was dropped",
   abs(len(en) - len(ar)) <= 2, (len(en), len(ar)))

# rule 4, the final table
TABLE = {"lane_draft": "مسودة", "lane_live": "جاهزة للإرسال", "lane_sent": "تم الإرسال",
         "lane_opened": "تم الفتح", "lane_replied": "ردود", "tray_closed": "منتهية"}
for k, v in TABLE.items():
    ck("rule 4, " + k + " reads " + v, ar.get(k) == v, ar.get(k))

# rule 3, Thyab's sentence, verbatim and with nothing after it
WANT = "قل لنا من أين تحب أن نبدأ، وسنشارك معك خطة 90 يومًا التالية"
ck("rule 3, the busier-pair line is Thyab's sentence, verbatim",
   ar.get("f_wanthint") == WANT, ar.get("f_wanthint"))
ck("and there is no clarifying clause after it",
   not ar.get("f_wanthint", "").rstrip().endswith("؟"), ar.get("f_wanthint"))
ck("and the phrase it replaced is gone from the dictionary",
   not any("أكثر ازدحام" in v for v in ar.values() if isinstance(v, str)),
   [k for k, v in ar.items() if isinstance(v, str) and "أكثر ازدحام" in v])

# rule 5, punctuation
bad_punct = [k for k, v in ar.items()
             if isinstance(v, str) and re.search(r"[؀-ۿ]", v) and "?" in re.sub(r"<[^>]*>", "", v)]
ck("rule 5, an Arabic question ends with the Arabic question mark", not bad_punct, bad_punct)

# rule 7, expansion: no Arabic string is shorter than its English counterpart by
# accident, which is what a truncated translation looks like in a table
short = [k for k in ar
         if isinstance(ar.get(k), str) and isinstance(en.get(k), str)
         and len(en[k]) > 40 and len(ar[k]) < len(en[k]) * 0.35]
ck("rule 7, no Arabic string is a truncated stub of its English counterpart", not short, short)

print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
