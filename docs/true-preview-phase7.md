# True preview (P7 / D5): exactly what lands, per recipient

One compile produces the final artifact; the preview renders it and the send submits it, byte-for-byte.
The recipient switcher steps the actual roster so the operator sees each person's exact email. Off
latest main; author only; Thyab merges; additive only. Nothing new sends here.

## One compile

`compileArtifact(recipient, opts)` is the single place a message is assembled:

- merge resolved for THAT recipient (name merged, or the clean fallback for a nameless one, in EN and AR),
- the closing block and the footer (the single POSTAL source),
- the tokenized page link (`liveUrl?r=<token>`) and the P2 open pixel, the token derived from the
  recipient and subject (`recipientOpenToken`).

It returns `{ to, name, subject, html, text, token, lang }`. The send path (`eSend`) submits this
object's `html`/`text`/`subject`/`token` verbatim, and the proof copy (`eSelf`) uses the same function with
`track:false` so a copy to the operator never tokenizes. `sendBody` and the module-level `__sendToken` are
gone; there is now one function, imported by both preview and send, and nothing composes a footer or a
token anywhere else.

## True preview

`refreshPreview` renders `compileArtifact(currentPreviewRecipient())` in the sandboxed iframe, through an
email-safe document (not editor CSS): a `dir` from the recipient's language and a body that wraps within
the frame. The preview is byte-for-byte the compiled artifact, so what the operator sees is what Resend
delivers, pixel and tokenized link included.

The pixel is **shown, not stripped**: a Content-Security-Policy in the preview frame allows the site logo
and `data:` images but blocks the relay open pixel from firing. So the preview carries the pixel in its
source (the truth) yet never records a phantom open. The old preview-only link card, which the sent email
never carried, is gone: the preview shows only what lands.

## The recipient switcher

`#cmpRecipSwitch` (prev / label / next) above the preview steps the **actual** roster: a campaign's
recipients, or the single field recipient for a single send (a campaign of one). Each step recompiles and
re-renders, so the operator sees each person's exact email in turn, name and address, RTL and LTR correct,
no console chrome. A nameless recipient shows the clean fallback greeting. It only chooses which recipient
the preview compiles; it sends nothing.

## Applies everywhere

The same composer, the same compile: a single send previews as a campaign of one, and a reply (which does
not tokenize) previews through the same function.

## Evidence

`tools/true_preview_test.py` (19 checks): compile merges a named recipient, keeps an Arabic name intact,
and falls back cleanly for a nameless one (EN and AR), always carrying the footer, the pixel and the
tokenized link; the preview renders exactly that artifact through the CSP frame with the pixel present in
source; the pixel never fires (a route counter proves zero open requests leave the frame, so no phantom
open); the switcher walks all three recipients in order with per-recipient greetings and the nameless
fallback. **Fails-when-broken**: a dev-only hook bypasses compile in the preview and the pixel/token
vanish (the match breaks); restored, the pixel returns.

Full bed green. Gates green (verify 35/35, arabic, flows, perf 0 failed; APP_JS_MAX and DIST_MAX raised for
the compile+switcher, noted in `perf_gate.py`; the module split remains overdue). Isolation grep 0.
Em-dash clean.

## Device gate (Thyab, WebKit)

Preview one recipient and compare it to the delivered message in Resend: they match exactly, EN and AR
samples, pixel and token present in both. Walk the switcher through the roster in order; the nameless
recipient shows the clean fallback greeting; RTL and LTR render correctly with no letter-spacing on Arabic.
Confirm no open is recorded from opening the preview.

## Note on branch base and overlap

P7 branches off latest main (through PR #167). The clean nameless fallback here overlaps P6's
`stripNameTokenClean`; when both land they should share one helper. P6's editor pill and P5's roster rows
compose with this compile: the pill's `data-m="name"` span already becomes `{{NAME}}` in the compile
template, so a personalized body previews per recipient the moment those merge.
