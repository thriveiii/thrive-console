# Self-exclusion must not depend on a session alone (open item)

**Symptom.** Even the page-visit engaged count can include the operator's own views when a
hosted page is opened from a channel without the console session (signed-out Safari, an
in-app browser), which scores self=false.

**Root.** self is derived from a localStorage console session on the same origin. Any
operator view outside that session is untagged and pollutes the human count.

**How we proved it.** A page hit from an in-app browser (ref android-app://com.slack) scored
self=false in the production sample.

**Fix (proposed, not yet built).** Issue a persistent, signed operator token (cookie or
signed URL param) that tags any operator-originated page view as self regardless of channel,
and exclude it in the view. Interim mitigation already shipped: exclude known app-webview and
unfurl refs and bot UAs.

**Guard.** Self-exclusion cannot rely on a same-origin session alone. Give the operator a
durable identity the analytics always recognizes.
