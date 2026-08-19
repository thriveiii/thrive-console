# One signature system: per-sender, managed, never duplicated (P20)

A sent email on August 18 carried its closing block twice above the compliance footer: a sender name with
Thrive Digital Solutions and thriveiii.com, then a second sign-off with the agency and the site again. Two
places in the pipeline each wrote a closing. The one-source law that governs the rest of the console had not
yet been applied to the signature.

The need is larger than the bug. More people are about to send from the console (Thyab, Agha, Basel, any
member), and each needs an elegant text signature inserted automatically, with the agency name and site
fixed. So the fix is not a patch on the duplication; it is a single signature model that makes a second
closing structurally impossible.

## R14 · A signature is one saved text block, per sender, appended once

A signature is a saved text block: a sender **display name** (the only variable) above a **fixed agency
block** (Thrive Digital Solutions, thriveiii.com). It is clean text, English or Arabic to match the message,
no images and no styling beyond the existing tokens.

- **Per actor, additive.** Each member curates their own set of signatures, stored per actor in the profile
  prefs under the namespaced `signature.v1` key, through `profilePrefNS` / `setProfilePrefNS`. It is additive,
  synced, and never a schema change. A member's set seeds once from the legacy per-device block or, failing
  that, from their resolved operator name, so no one loses the block they had.
- **One injection site.** The compile path appends **exactly one** signature: the sender's default, or the
  one chosen for that send. `brandWrap(inner, branded, sig)` is the only function that puts a closing into an
  outgoing body, and `renderSignature(sig, loc)` is the only place the agency block is assembled. Grep proves
  it: one assembly of `AGENCY_NAME + "\n" + AGENCY_SITE`, one `brandWrap`.
- **The old closings are gone.** `brandWrap`'s invented name/site fallback is removed, so a body with no
  signature has no closing rather than a fabricated one. Every `ETPL_*` template body now ends on its own
  sentence and embeds no sign-off. The blank-body default is a bare greeting. The reply scaffold
  (`replyGreeting`) returns only the greeting and room, never "Best, Thrive Digital Solutions". A second
  closing has nowhere left to come from.
- **The footer is separate, and unchanged.** The compliance footer (POSTAL address, the STOP line) is
  appended once after the signature by `library/store.js`, exactly as before. It names the company legally,
  once, in its own `Thrive Digital Solutions, VA, USA` form, distinct from the signature's agency block.

## The surfaces

- **Composer** (`compose.html` / `initCompose`): a read-only preview of the chosen signature. When a member
  has more than one signature a small picker appears; with one, it is hidden. Changing the pick reloads the
  preview and refreshes the message preview, so **what is previewed is what is sent** (`editorContent` reads
  the same `#sigBox` value the compile path uses). "Manage signatures" jumps to the profile page.
- **Profile page** (`profile.html` / `renderSignatures` + `sigEditRow`): the manager. Each signature shows
  its label and a live text preview (name above the fixed agency block), with **set default**, inline **edit**
  of the name only, and **delete**. Below the list, one add form (name EN / name AR). Every action persists
  through the `sig*` helpers and re-renders.

## Evidence

`tools/signature_system_test.js` runs the real R14 helpers and `brandWrap`, extracted verbatim from
`library/app.js` and evaluated with a faithful per-actor store, then composes the whole message the way the
send path does (`brandWrap` + the real `store.js` footer):

- **Signature once, footer once, English and Arabic.** The signature closing block appears exactly once; the
  site appears once; the sender name appears once; the compliance address and the STOP line appear once. The
  delivered-email defect (the block repeated above the footer) cannot recur.
- **Two actors, own names, one agency block.** Actor A's signature carries A's name and not B's; actor B's
  carries B's; both carry the identical fixed `Thrive Digital Solutions` / `thriveiii.com` block; a signature
  is private to its actor.
- **Add / edit / delete / set-default persist.** Each mutation lands in the per-actor store; edit changes
  only the name; delete falls the default back to a survivor.
- **Preview equals sent.** The composer's previewed signature text is exactly what compile injects.
- **One injection site.** `renderSignature` is the one agency-block assembly; no `ETPL_*` body embeds the
  site, the agency name, or a hardcoded sender name; the reply scaffold appends no sign-off; `brandWrap` has
  no invented fallback.

Gates: `verify.js` 35/35, `arabic.py`, `flows.py`, `perf_gate.py` green (the bundle ceilings raised with a
documented P20 note: `library/app.js` 784 KB, `dist/thrive-console.html` 1834 KB, the growth being the R14
store, the profile manager, and the composer picker, additive over the removed closing block). Isolation grep
clean (lotus/newsroom only the benign `store.js:20` prose). No long dash. `mail_footer_test.js` green (the
footer is untouched).

## Do not (held)

There are never two closing sources in compile: `brandWrap` is the one injection site and `renderSignature`
the one assembly. A sender name is never hardcoded; it is per-actor data. Signatures carry no styling beyond
the existing tokens, and no images. The compliance footer is untouched, appended once, still `VA, USA`, never
`Egypt`. Sending pacing, the thread render, Lotus, and the newsroom asset are untouched.

## Real-zip / server caveat

The console's Supabase project is not reachable from the sandbox, so the per-actor persistence is proven
against the real field shapes with an in-memory `profilePrefNS` / `setProfilePrefNS` store keyed on the
signed-in actor, exactly as the client keys it on the auth uid. Signed in against the live project, the same
helpers write the `signature.v1` pref into `console_profiles`; nothing here changes a schema.
