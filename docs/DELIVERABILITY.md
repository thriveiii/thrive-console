# Deliverability, which is the risk a year of neglect does not undo in a week

WO-013 §10.5. This is the one place in the whole console where the failure is slow, silent, and
not recoverable on the timescale it took to cause.

---

## 1. The danger here is not volume

Google, Yahoo, Microsoft and Apple now **enforce** sender requirements rather than recommending
them. The bulk thresholds apply around 5,000 messages a day, which Thrive is nowhere near. The
authentication requirements apply to **every sender at any volume**.

Compliant senders average roughly 89 percent inbox placement. Non-compliant senders see between
22 and 34 percent of their mail routed to spam. Past 0.3 percent complaints the degradation is
slow to recover from.

**The specific danger in Thrive's setup is not the numbers.** Outreach goes out from
`hi@thriveiii.com`, which is also:

- the address clients reply to,
- the address invoices come from,
- and the domain the newsroom and the website share.

Cold outreach draws more spam complaints than any other category of mail. **If outreach damages
the reputation of `thriveiii.com`, it does not only cost the next campaign. It costs client mail
and invoices.** That is the failure worth engineering against a year early, and it is why this
document exists at three sends a day.

---

## 2. What is built, and where

| Guard | Where | Why it is here |
|---|---|---|
| **Permanent suppression list** | `library/store.js`, `thrive_suppress_v1`, synced | The single highest value item in this section. A suppressed address is never written to again and the console says why |
| `List-Unsubscribe` and `List-Unsubscribe-Post` | `ThriveStore.outboundHeaders`, on every send | RFC 8058. Not required at this volume, costs nothing, and **converts a spam complaint into an unsubscribe** |
| Physical address and one line opt out | `ThriveStore.footerHtml` and `footerText` | Both required by US law for commercial email, and both already true: the Alexandria address exists |
| Bounce classification | `ThriveStore.noteBounce` | **Hard bounces suppress. Soft bounces retry once and then stop.** A bounce used to be invisible, which means a dead address was retried forever |
| Reputation panel | Settings, Sending reputation | Sends, hard bounce rate, complaint rate, suppression count, and **a plain sentence saying whether these are healthy** |

There is no unsuppress, and that is the point. An address that complained once is an address that
complains again, and the cost of never writing to it is one prospect against a domain reputation.

---

## 3. The recommendation, recorded rather than implemented

**Move outreach to a separate sending subdomain**, for example `send.thriveiii.com` or
`outreach.thriveiii.com`, with its own DKIM key and its own reputation.

That is the structural answer to the danger in §1: it puts a firewall between the mail that can
draw complaints and the mail that carries invoices. If the outreach subdomain's reputation is
damaged, client mail is untouched.

**It is a domain and DNS decision for Thyab, not a code change**, which is why it is written here
rather than built. What it would take:

1. A subdomain, with its own SPF, DKIM and DMARC records.
2. Verifying that subdomain in Resend as a second sending domain.
3. Changing one configuration value in the relay. The console reads the sender from the relay
   already, so nothing in this repository would change.
4. Warming it, which at three sends a day happens on its own.

**Trigger:** the complaint rate reaching 0.1 percent, or Thyab deciding sooner. It is in
`docs/RUNWAY.md` with that trigger.

---

## 4. The playbook, and why copying it would be a mistake

The published playbook for outbound in 2026 is consistent: register three to eight dedicated
sending domains, warm each from five to ten messages a day over four to six weeks, verify lists to
push bounces from five percent down to one, run a sequencer, and scale volume while defending
placement.

**That playbook solves a problem Thrive does not have, and following it would destroy the thing
Thrive is good at.** It exists for teams sending thousands of near identical messages and treating
reply rate as a yield on volume. Thrive sends three a day, each with a page built for one named
business, each carrying a specific observation about that business. The console's own line already
says it: three sends a day is a full week.

**The inversion is the strategy.** At this volume deliverability is not a scaling problem to be
managed. It is an asset currently being spent without measurement. Ten thoughtful messages a week
from a clean domain to named owners who were researched first will outplace a warmed up sequencer,
because **the complaint rate is what actually decides placement**, and a relevant message to a
named person does not get reported.

So the console's job is the opposite of the playbook's. Not to raise volume safely, but to make low
volume compound:

- never send to a suppressed address,
- never send a second nudge,
- never send a message with an unresolved placeholder,
- and make the reputation numbers visible so a slow leak is caught while it is still slow.

**What the playbook gets right, keep.** Authentication, suppression, bounce hygiene and
measurement are cheap, correct at any volume, and are exactly what §10.5 built.
