# How the business runs, and why the software is shaped this way

**Read at the start of every session.** Updated in the same pull request as the behaviour it
describes, never after.

**The rule that makes this load-bearing:** any behaviour not described in this document is a gap.
If you find yourself implementing logic this file does not explain, stop and write the explanation
first, or raise it.

---

## 1. What the console is for

It turns one page built for one named business into a send, a reply, and a client, and it keeps an
honest record of every step so nobody has to remember.

---

## 2. The daily rhythm

A batch of pages and one manifest arrives each day. **Roughly three sends a day is a full week.
Five decided moves is a full day.**

Those two numbers decide almost every design choice in the console:

- The board is a surface for tens of opportunities, not thousands, which is why there is no search
  and no saved views until it passes 150.
- Deliverability is not a volume problem, it is an asset being spent without measurement.
- A composer that saves ten seconds a message saves thirty seconds a day. A composer that lets one
  broken message reach a prospect costs a client.

The console optimises for **not making a bad send**, never for making more sends.

---

## 3. The lifecycle, in the world rather than in the code

Nine states. `library/lifecycle.js` is the only authority; the interface asks it rather than
knowing the rules itself.

| State | What it means to a person |
|---|---|
| `draft` | A page exists, unfinished or unpublished. Nobody outside Thrive has seen it |
| `ready` | Published and live at its URL. Nobody has been told about it |
| `sent` | Somebody was told. By email, or through one of their own channels |
| `opened` | The page recorded a real visit that was not Thyab's own |
| `replied` | A human answered. Machinery does not count |
| `won` | They became a client |
| `lost` | They said no, with a reason |
| `dropped` | Thyab decided not to pursue it. **Different from lost on purpose** |
| `archived` | A flag beside the stage, not a replacement for it |

**`lost` and `dropped` are not the same, and collapsing them loses the only distinction that says
whether the pipeline is failing or you are choosing.** `lost` is a judgement about the prospect;
`dropped` is a decision about the work.

`archived` is a flag rather than a stage because unarchiving has to put a record back, and a record
that forgot its stage cannot be put back.

**Thirteen moves, each with guards.** A transition not in the table does not exist. The one guard
worth naming here: **a card cannot be recorded as sent while its body still contains `[LINK]`.** An
unsubstituted placeholder means the prospect received a broken message, and the console makes that
impossible rather than detectable, because detectable is after it was sent.

---

## 4. What counts as a send, and why off-channel counts the same

**A send is a send.** The console did not witness either one: it witnessed a mail relay's answer in
one case and Thyab's word in the other, and it records which. Neither is a reason to leave a card
out of a total.

Two thirds of the batch typically has no email address. A console that only counted email would
report a third of the work and call it the whole.

**`sent_on` means "made on" and never moves a card to Sent.** Every record has one. Reading it as a
send would put the entire board in Sent on first load, which is the failure `tools/lane-truth.py`
exists to prevent.

---

## 5. The reply path, end to end

Until WO-013 nothing watched the inbox. A campaign went out, the prospect replied, the reply landed
in `hi@thriveiii.com`, and the console's replies column read zero and always had.

The relay scans the inbox every fifteen minutes and files inbound records. **The first rule that
matches wins, and the record stores which one did**, so a wrong attribution is diagnosable rather
than mysterious:

1. **The reply-to tag**, `hi+<slug>@thriveiii.com`. Exact, and it comes first because it is an
   address and no mail client rewrites an address. Gmail delivers plus-addressed mail to the same
   inbox.
2. **The threading headers**, `In-Reply-To` or `References` against a stored `mid`. This is what
   attributes replies to everything sent before the tag existed.
3. **The sender address**, against a known recipient.
4. **No match.** Stored, named on screen, never discarded and never guessed.

A matched card moves through the ordinary lifecycle move, with its guards and its activity entry.
It is never written directly.

**Machinery is not a reply.** Bounces and out-of-office notices are stored, because a bounce is
evidence about an address, and neither is a person answering.

Full detail: `docs/RELAY.md`.

---

## 6. The numbers contract

One definition per quantity, one function per quantity, every surface calls it, no surface computes
anything locally. Definitions live in **`docs/NUMBERS.md`** and are duplicated nowhere.

The two failures that motivated it: three surfaces once gave three answers to one question, and any
number derived by scanning a capped log becomes wrong at the moment of truncation **without
throwing**.

---

## 7. The three kinds, and the Library rule

| Kind | What it is | Where it lives |
|---|---|---|
| **Page template** | An HTML skeleton with named fields | The Library, per locale |
| **Finished offer** | A complete page for one named prospect | On the opportunity, never in the Library |
| **Outreach text** | The words that carry the offer | On the opportunity, or in the Library when reusable |

> **The Library holds only what gets reused. Anything belonging to one prospect lives on that
> opportunity.**

That sentence decides every future case without another meeting. Field syntax and the shipped
templates: `docs/TEMPLATES.md`.

---

## 8. The prohibitions

These are business rules with a history. **Breaking one costs a client.**

- **Never pitch design or brand creation to an owner who designs.** They will read it as being told
  their work is inadequate by somebody who did not look.
- **Never claim what a prospect lacks or has without checking their own sources.** "You have no
  Instagram" to somebody with 40,000 followers ends the conversation and deserves to.
- Per-opportunity prohibitions arrive in the manifest and are shown as a band at the top of the
  opportunity window, above everything else, because a prohibition read after the message is
  written is a prohibition read too late.

---

## 9. Pricing context

**The floor exists and the console never negotiates.** The batch note carries it; the console shows
it and does not compute from it, discount it, or offer it.

Pricing is a conversation between Thyab and a client. Software that suggests a number is software
that has taken a position in that conversation.

---

## 10. What the console deliberately does not do

| Not built | Why |
|---|---|
| **Analysis** | It counts what happened. It does not tell Thyab what it means; that is the judgement he is paid for |
| **Bookkeeping** | Invoices, taxes and accounts are a different system with different obligations |
| **Automated chasing** | No sequences and no second nudge. A follow-up that a machine decided to send is a follow-up nobody meant |
| **Payment processing** | Money touching this surface changes what a compromise costs |
| **Scheduling, A/B testing, tracking pixels** | Each one changes what Thrive is: a person who looked at your business, not a funnel |

---

## 11. Open questions, and who decides each

| Question | Who decides | Status |
|---|---|---|
| Whether outreach moves to a separate sending subdomain | **Thyab.** DNS, not code | Recommended in `docs/DELIVERABILITY.md`. Trigger: complaint rate reaching 0.1 percent |
| Whether the two shipped page templates get their body copy rewritten | **Thyab.** A design re-approval | Raised in `docs/ARABIC.md`. The replacement sentence is ready |
| Whether the six stock message templates are translated | **Thyab.** Content | A counterpart copies structure and leaves content empty, deliberately |
| Whether Workspace is worth it | **Thyab.** Cost against ceilings | The console reports both ceilings. `docs/RUNWAY.md` |
| Whether a second person will operate the console | **Thyab** | The `actor` field is already written, set to `thyab` |
| What the follow-up threshold should be | **Thyab.** Currently 3 days | Configurable, not yet configured |
