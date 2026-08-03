# Every number the console shows

One definition per quantity, one function per quantity, and every surface calls that function.
No surface computes anything locally.

This file exists because on 3 August 2026 the Insights page reported pages opened 2 times and 8
views, while the board reported one card with 2 opens and another with 5 views, and an earlier
capture of the same data reported 5 total opens. Three answers to one question. The cause was
parallel counters, not a bug in any one of them.

## The rule

**If a number appears on screen, it came from `ThriveNumbers`.** A surface that computes its own
is a surface that will eventually disagree with another one, and the disagreement will be
discovered by the person the numbers were supposed to serve.

Every number in the interface also carries an information control stating its definition and its
source in one sentence. That is what permanently ends "which number is right".

## The definitions

| Quantity | Definition | Source |
|---|---|---|
| `views` | Every beacon hit on a page, including Thyab's own | hit ledger |
| `opens` | Hits excluding those from a browser carrying the local self marker | hit ledger |
| `unique_opens` | Distinct visitor identifiers among `opens` | hit ledger |
| `sent_today` | Outbound mail ledger entries plus hand contacts stamped inside today's local day | mail ledger, `manual_contacts` |
| `sent_month` | The same for the current calendar month, local time | rollup plus live ledger |
| `people_contacted` | Distinct recipients across the mail ledger and `manual_contacts` | both |
| `replies` | Inbound mail ledger entries plus `record_reply` events | mail ledger, activity |
| `reply_rate` | `replies / people_contacted`, always shown with its denominator | derived |
| `needs_followup` | Sent, zero opens, age at or beyond the follow-up threshold | derived |

**Off-channel sends count everywhere email sends count.** A send is a send. The console did not
witness either one: it witnessed a mail relay's answer in one case and your word in the other,
and it records which. Neither is a reason to leave a card out of a total.

**A rate is a share of something.** `reply_rate` is capped at 100 and shown with its denominator,
because an open rate once printed 200% by dividing unique visitors by people written to.

## Two things that make a number wrong quietly

### Double counting

- Beacon hits are deduplicated by visitor, slug and minute. A refresh is not a second open.
- Every mail ledger entry carries a unique message id. A resend writes a new entry rather than
  mutating one, so the count moves for a reason you can find.
- Sync merges by that id, so a record present on two devices appears once.

`tools/numbers.py` syncs the same batch twice and asserts every count is unchanged. That test
exists because idempotency is the property nobody notices until it is missing.

### Truncation

The ledgers are capped: mail at 800 entries, activity at 500, local hits at 150. At dozens of
operations a day the activity log truncates within weeks, and **any number derived by scanning a
capped log silently becomes wrong at the moment of truncation.** Nothing throws. The number just
starts being smaller than the truth.

Three answers, in this order:

1. **No displayed number may depend on a capped log.** Every quantity above names its source, and
   anything that read a capped log was rewritten.
2. **A monthly rollup**, written when a month closes, holding that month's counts. Never
   truncated. Historical months read the rollup; the current month reads the live ledger.
3. **Caps by size rather than by entry count**, because one long body is worth many short ones
   and counting entries treats them as equal.

## Storage, which is the risk that is not a defect

WebKit deletes **all** script writeable storage for an origin with no user interaction in the last
seven days of browser use. Not part of it. All of it, at once. The console's data layer is
localStorage on an iPad, and localStorage throws `QuotaExceededError` past roughly 5 MiB.

So one quiet week away can erase every opportunity, every draft and the whole mail ledger on that
device. The relay is the only durable copy.

Four answers:

- Every write is wrapped for `QuotaExceededError` and says what to do, rather than failing silently.
- A storage meter in Settings: bytes used, the approximate ceiling, and the largest keys by size.
- A sync freshness band on the board after **three** days, not seven, because the guard has to
  fire before the eviction window closes.
- A relay completeness check that compares local record counts against the relay's, per key. A
  backup nobody has verified is a belief.
