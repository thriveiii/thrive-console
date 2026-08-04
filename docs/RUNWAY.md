# What is deliberately not built, and the measurement that would change that

WO-013 §10.7. Each row has a **trigger**, so the decision is made on a number rather than a mood.
A capability built before its trigger is a capability maintained for a year before it is used.

| Capability | Build it when | Why not now |
|---|---|---|
| **IndexedDB migration** | The storage meter passes **3 MiB**, or built pages exceed 1 MiB | `library/store.js` is the adapter, so this is a one file change later. `ThriveStore.MIGRATE_AT_BYTES` holds the same number the meter compares against, so the code and this table cannot drift |
| **A second workspace, for a second brand** | A second brand exists | The firewall between them is a product decision before it is a technical one |
| **Multiple users and roles** | A second person operates the console | Every ledger entry needs an actor first, which is one field. **That field is added now**, set to `thyab`, because it is free now and a migration over unattributable history later |
| **Board search and saved views** | The board passes **150 live opportunities** | At three a day that is roughly two months away |
| **Automatic archiving of stale opportunities** | The board passes 150 | Same trigger, same reason |
| **A separate outreach sending domain** | The complaint rate reaches **0.1 percent**, or Thyab decides | It is a DNS decision, not a code change. `docs/DELIVERABILITY.md` §3 has the four steps |
| **Moving off Apps Script entirely** | Trigger runtime exceeds **60 minutes a day on Workspace** | The relay's HTTP interface is the seam that makes it survivable. The console calls `state_get` and `state_put` and does not know what answers |

---

## The three ceilings, and where each one is measured

| Ceiling | The number | Where it is read | What it costs to hit |
|---|---|---|---|
| Apps Script Properties | 500 KB total, 9 KB per key | Settings, Replies, `Measure the relay store` | **Already hit.** Moved to Drive in phase 1 |
| Trigger runtime | 90 minutes a day consumer, 6 hours Workspace | Settings, Sending reputation, `Ask the relay about its ceilings` | The inbox scan stops running, so replies stop arriving |
| Sending quota | 100 recipients a day consumer, 1,500 Workspace | The same panel. **Read from the relay, never hardcoded** | Sends fail. Moving to Workspace is a configuration change |
| Browser storage | roughly 5 MiB, and WebKit deletes all of it after 7 days idle | Settings, Storage on this device | The console forgets everything on that device |

**The scan exits immediately when the inbox has nothing new**, so an idle day costs almost nothing
against the trigger budget. The panel reports the measured daily total, and says so plainly when it
passes an hour a day rather than quietly running near the ceiling.

---

## One field added now, because it is free now

Every activity entry and every mail ledger entry carries `actor`, set to `thyab`.

Adding it costs one line today. Adding it after a year of history means a migration over records
that **cannot be attributed**, because the information to attribute them was never written down.
That is the cheapest row in this whole table and the one most likely to be skipped.
