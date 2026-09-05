# An email open pixel is not a human open

**Symptom.** Open counts are wildly inflated: 120 pixel hits for 13 sends; a card showed 30
opens with zero human engagement.

**Root.** The email pixel (Apps Script doGet) records no self, no UA, no IP. Email privacy
proxies (Gmail image proxy, Apple Mail Privacy Protection) fetch the pixel at delivery,
before any human, and re-fetch on every render. The view counted raw count(*), so proxy
prefetch and reloads inflate it, and the operator's own views are indistinguishable.

**How we proved it.** A production console_hits sample showed 5 pixel hits for one send in
17 seconds (proxy re-fetch, not a human). Pixel rows had vid='', no ua, self always false. A
sizing query showed raw pixel >> distinct-send-opened >> human page visitors (mostly 0).

**Fix.** Demote the pixel. Define open_count as distinct human page visitors:
count(distinct data->>'vid') where vid<>'' (page beacon only), self=false, and ref/ua not an
app-webview or known bot/unfurler. Stage 'opened' then means real engagement. The pixel is at
most a separate, de-duped "reach" signal.

**Guard.** An email open pixel is a reach signal, not a human-open signal, and cannot be made
accurate on a header-blind endpoint. Prefer page visits and clicks (actions proxies do not
perform). Count distinct visitors; exclude self and bots.
