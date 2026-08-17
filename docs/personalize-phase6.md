# Personalize names (P6 / D4): greeting-aware {{NAME}} merge

The UX layer on the shipped `{{NAME}}` token (R2). The merge backend already exists
(`renderPersonalized`, `greetingFor`, `groupSendPlan`, per-recipient language, blocked-if-no-name);
this brief adds only the composer surface and the pre-send roster. Additive only. Nothing here
sends; the send path is untouched (P7). One token spelling only: `{{NAME}}`.

## The chip

A "Personalize names" toggle in the composer toolbar (`#tbPersonalize`). It builds on the token
system the templates already use: `{{NAME}}` lives in the editor as a tagged span
(`data-m="name"`), kept in sync by `syncMerge`, stripped to clean text on send by `htmlOut`. P6 makes
that span a soft pill and lets the writer add and remove it.

- **Enable**: detect the greeting line and insert `{{NAME}}` after the greeting word, before any
  trailing comma, one space between. Recognized forms, EN and AR:
  Hi, Hello, Good day, Dear / مرحبا, أهلا وسهلا, يوم سعيد, عزيزي. The insertion is DOM-logical
  (greeting, space, token), so it renders correctly in both RTL and LTR.
- **Manual insertion at the cursor**: when the caret sits in the body and no greeting is matched, the
  token drops at the caret, padded so it never glues to a neighbouring word.
- **Disable**: remove every name pill and heal the seam, so a nameless greeting reads "Hi," and never
  "Hi ," and no double space is left behind. No token residue.

## The pill

`{{NAME}}` renders as a soft pill (`.ebody [data-m="name"]`: tinted, rounded, never raw braces). The
span is `contenteditable="false"`, so a delete removes the whole token at once rather than eating it
letter by letter. On send, `htmlOut` unwraps the span to plain text, so the outgoing HTML carries no
pill markup, exactly as before.

## The explicit fallback

`stripNameTokenClean` and `mergeGreetingLine` (pure helpers) render the greeting each recipient will
read: the name merged in, or, for a nameless recipient, the token removed cleanly. The healing
collapses a space stranded before a comma or a stop and any double space, in both languages
(the Arabic comma `،` included). These are DISPLAY helpers; they do not change
`renderPersonalized`'s send-side block for a nameless recipient (that is the send path, P7). The
brief's evidence is "verified in preview", which these satisfy.

## The pre-send roster

`#mergeRoster`, rendered in the composer's pre-send surface for a campaign (more than one recipient)
once personalization is on. Every recipient with the **exact** name that will merge (from
`greetingFor`, the backend) and the greeting each will read (named merged, nameless fallback clean).
Read-only: the P5 roster rows are the single name source; this only shows what will happen. It reads
`campaignRecipients` (the opp's `recipients[]`), writes nothing, and sends nothing.

## Evidence

`tools/personalize_merge_test.py` (24 checks): the pure fallback helpers heal EN and AR greetings and
keep Arabic names intact; the chip inserts the pill after each of the eight supported greeting forms;
the pill is a pill (not raw braces) and atomic (`contenteditable=false`); toggling off leaves no
residue ("Hi,", no "Hi ,", no double space); manual insertion drops the token at the cursor; a
three-recipient campaign (one English name, one Arabic name, one nameless) produces three correct
greetings in an EN body and an AR body, with the nameless recipient flagged, not invented; and no
mail row is written throughout. Fails-when-broken proven by neutering the seam-heal in
`stripNameTokenClean` (the five fallback/clean checks red; the toggle-off check stays green because it
uses the composer's own `removeNamesClean`, independent by design).

Full bed green. Gates green (verify 35/35, arabic, flows, perf 0 failed; APP_JS_MAX and DIST_MAX
raised for P6 growth, noted in `perf_gate.py`). Isolation grep 0. Em-dash clean.

## Device gate (Thyab, WebKit)

Three recipients (one Arabic name, one English, one nameless): confirm three correct greetings in the
preview, EN and AR bodies. The pill inserts after each supported greeting form; RTL placement is
correct; no letter-spacing on Arabic anywhere. Toggling the chip off restores the body with no token
residue. Deleting a pill removes the whole token in one keystroke.
