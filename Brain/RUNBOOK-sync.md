# Runbook: the relay and live sync

الدليل التشغيلي للوسيط والمزامنة. اتبعه حرفيًا، ولا تجتهد خارج خطواته.

This is the operating manual for the one moving part of the console: the Apps Script relay
that sends email, holds the shared state, and collects page analytics. Everything that has
gone wrong with sync has been a violation of one of the four rules below.

---

## The four rules

**1. One deployment. Forever.**
Apps Script hands out a new `/exec` URL for every *new deployment*. Two deployments means two
URLs, and half your devices call the dead one. There is exactly one deployment of the Thrive
relay, and updating it always means: `Deploy → Manage deployments → Edit (pencil) →
Version: New version → Deploy`. The URL never changes. Archive anything else that exists.

**2. Saving is not deploying.**
Pasting code into the editor and pressing save changes nothing that the console can see. Only
`Deploy` publishes it. The console proves this for you: Settings → Connection health → the line
"That URL serves v4".

**3. The repository publishes the URL, not the humans.**
`library/sync.json` holds the one URL every device must call. It is written by the console
itself, from a device where GitHub is connected. A device that unlocks with the passcode reads
that file and configures itself. Nobody should ever type a relay URL on a second device.

**4. Secrets live in Script properties only.**
`RESEND_KEY` and `SYNC_KEY` exist in `Project Settings → Script properties` and nowhere else:
not in the repo, not in the browser, not in a message. Anything printed anywhere is
compromised and must be rotated the same day.

---

## First-time setup (once, on a device with a keyboard)

Do this on the iPad or a laptop, never on the phone. Apps Script is not usable on a phone.

1. **script.google.com** → open the Thrive relay project (or create one).
2. Replace the whole file with `thrive-email-resend.gs` (relay v4). Save.
3. `Project Settings → Script properties`, confirm both exist:
   - `RESEND_KEY` = the Resend API key
   - `SYNC_KEY` = the console's sync credential. Do not go looking for it in a file: on any
     unlocked device, `Settings → Connection health → Copy the sync key` puts the exact value
     on the clipboard. It is derived from the passcode, and it is not the passcode.

   Alongside them the relay writes its own properties as it runs: `state_meta`, `state_0`,
   `state_1`, ..., `hits_meta`, `hits_0`. Those are the shared console state and the collected
   page opens, written by the script itself. They are not secrets and not something you added
   by mistake. Leave them alone. Deleting them empties the shared store.
4. `Deploy → Manage deployments`. If a deployment exists: `Edit → Version: New version →
   Deploy`. If none exists: `New deployment → Web app → Execute as: Me → Access: Anyone →
   Deploy`. Copy the `/exec` URL.
   **`Who has access` must read `Anyone`, not `Anyone with a Google account`.** They look
   almost identical in the menu and only one of them works. The second one turns every call
   from a prospect, a phone, or the console itself into a Google login page.
5. **Archive every other deployment** in that list. This is the step that has bitten us three
   times.
6. In the console: `Settings → GitHub publishing`, fill owner `thriveiii`, repo
   `thrive-console`, branch `main`, and a fine-grained token limited to this repo with
   `Contents: Read and write`. Press `Test connection` until it reads write access.
7. Paste the `/exec` URL into `Live sync across devices`, then press
   **`Repair and publish`** at the top of the page.
8. Read `Connection health`. Every line must be ✓. If one is not, it names its own fix.

## Adding a device (phone, laptop, a teammate)

1. Open `console.thriveiii.com`.
2. Enter the passcode.

That is the whole procedure. The device reads the relay URL from the repository, derives its
own sync credential from the passcode, pulls the shared state, and shows the same live console.
If it does not, open Settings and read Connection health: the broken link is named there.

Nothing else is ever typed on a second device. No URL, no key, no token. The GitHub token is
deliberately never synced, so a teammate's device can read and send but cannot publish pages
until you give that device its own token.

## When something looks wrong

Go to **Settings → Connection health** first, every time. It checks, in order:

| # | Link | If it is ✕ |
|---|---|---|
| 1 | A relay URL is known | Paste the `/exec` URL in Live sync below. |
| 2 | That URL serves v4 | The deployment is stale. Rule 1 and rule 2. |
| 3 | The passcode credential is present | Lock, then unlock with the passcode. |
| 4 | The relay accepts this device | `SYNC_KEY` does not match. Paste it again exactly. |
| 5 | This device can write to the shared store | Retry. If it persists, Script properties are full. |
| 6 | Page analytics are being collected | The relay is not v4, or `SYNC_KEY` is missing. |
| 7 | The repo publishes this same URL | Connect GitHub, then `Repair and publish`. Until then every other device keeps calling an older URL. |

Read only the **first** ✕. Everything below a broken link is a symptom, not a cause.

Two symptoms and what they always mean:

- **`Error: missing "to"`** anywhere: the URL being called is running the old email-only
  script. It is not a key problem and not a console problem. Rule 1.
- **The URL answers with a Google sign-in page**: the relay is not reachable anonymously, so
  sync, analytics and email fail at once and nothing is ever saved. Prospects have no Google
  account, so this state can never record a single page open. Work through it in this order:
  1. `Who has access` is `Anyone`, not `Anyone with a Google account`.
  2. `Execute as` is `Me`. With `User accessing the web app`, Google needs an identity and
     will ask an anonymous caller to sign in.
  3. The URL the console calls belongs to **that** deployment. Compare the tail shown in
     Connection health against the deployment list.
  4. Open the URL in a **private window**. This is the only test that settles it: signed in
     as yourself, a restricted deployment looks perfectly fine.
  5. If a private window still asks for a sign-in, the account is a Google Workspace account
     and an admin policy is blocking anonymous access to Apps Script web apps. Either relax
     it in the admin console (Drive and Docs sharing, allow outside the organisation), or
     deploy the relay from a **personal Google account**. Nothing else about Thrive changes:
     the relay calls Resend with the API key, and mail still leaves as hi@thriveiii.com,
     because the sender identity belongs to Resend, not to the Google account.
- **A device shows zeros while another shows real numbers**: the two devices are calling two
  different URLs. Check line 7 on both.
- **`the relay did not answer in time`**: a timeout, not a wrong key. Apps Script cold-starts,
  and a phone network makes it slower. Run the checks again; open the URL in a tab first to
  wake the relay if it keeps timing out. The console retries once on its own before it calls
  the link broken.

## What is deliberately not automatic

- Publishing `library/sync.json` needs the GitHub token, so it happens on one device only. The
  console never claims to have published when it has not.
- The GitHub token is never synced between devices. That is a security decision, not an
  oversight.
- Email sending and page analytics both ride the same relay on purpose. One URL, one thing to
  keep alive.

## Before handing this to the team

- Rotate `SYNC_KEY` and the GitHub token if either has ever been seen in a screenshot, a chat,
  or a terminal.
- Give each teammate the passcode only. Nothing else is needed for a read-and-send device.
- Give a publishing token only to whoever publishes pages, scoped to this repository with
  `Contents: Read and write`, and to nothing else.
- Point them at this file. It is the whole procedure.
