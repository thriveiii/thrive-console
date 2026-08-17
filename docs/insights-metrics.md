# Insights metric dictionary (P4)

Every number shown on Insights names its definition and its ONE source (the ledger it is computed from), so
no surface can invent a definition and two surfaces can never disagree. Opens-by-person and anonymous page
views are separate metrics and never merge. The dictionary lives in code as `window.INSIGHTS_METRICS`.

| Metric | Definition | Single source |
|---|---|---|
| sent | messages sent (status sent or copied) | `console_mail` rows, status in (sent, copied) |
| opens (campaign) | page opens at or after the first send, campaign level | `campaignStats.opens` (`console_hits`) |
| unique | distinct visitor ids that opened the page | `campaignStats.unique` (`console_hits.vid`) |
| replies | distinct replying people, including one extracted to a child opp | `campaignStats.replies` (`console_inbound` + `recipientState`) |
| person opens | a person's own token-bearing opens (P2), never the page total | `console_hits` where `data.r` is one of the person's send ids |
| anonymous views | page opens carrying no token; nobody is named | `campaignStats.viewsAnon` (`console_hits`, no `r`) |
| bounces | hard/soft delivery failures naming the recipient | `console_inbound` kind=auto with `bounce` |

## The four shipped defects this brief deletes

1. **Page opens copied onto every person.** "Who is paying attention" did `person.opens += outOpens(slug)` for
   every campaign a person was mailed for, so a campaign's 4 opens showed as 4 on ~14 rows. Now a person's
   opens are **token-bearing (P2) only**: a `console_hits` row whose `data.r` is one of that person's send
   ids. A page-level open is never copied onto a person, and an anonymous view (no `r`) belongs to nobody.
   The stand labels (answered you / read it, went quiet / sent, not opened / no sign of life) recompute from
   personal signals only.

2. **Person rows duplicated across addresses (incl. typo domains).** The person list is an address list; the
   ledger's identity is the address, so rows are not silently merged. Instead near-duplicate addresses
   (`nearDupAddrs`: same local part with a known typo domain such as `gmial.com` / `hotmial.com`, a domain
   one edit away, or the whole address within one edit) are **flagged** "possible duplicate, review in
   Contact Book (P10)". The merge is P10, by Thyab's hand.

3. **Reply attribution split across surfaces.** A campaign reply extracts to a child opp (D2), so it once read
   as "replied 0" on the campaign and a reply on the person. `campaignStats.replies` already counts the
   extracted-child reply (via `recipientState`), so the campaign row and the person row show the same reply
   count; the campaign row now also carries a small indicator that the conversation lives on an individual
   card, so the split is explained rather than contradictory.

4. **Headline metrics and table sums did not visibly share definitions.** The dictionary above is the one
   place definitions live; person-level distinct openers reconcile to `campaignStats.openersTokened`, and
   anonymous views (`viewsAnon`) reconcile separately. The two are never summed.

## Historical honesty

Pre-token history has no per-person opens and is never backfilled or guessed. A person whose sends predate P2
(no `snd_` token id, so no pixel could have fired) renders **"before personal tracking"** in the opens cell,
not a zero.

## Evidence

`tools/insights_truth_test.py` (9 checks): the dictionary keeps person opens and anonymous views separate;
the one token-bearing opener shows opens 1 while a trackable-but-unopened person shows 0 and no row reads the
borrowed campaign total; a pre-token person renders "before personal tracking"; the typo-domain twin is
flagged not merged; person-level distinct openers equal `campaignStats.openersTokened` with anonymous views
counted separately; the table is stable. Fails-when-broken proven by reinstating the opens-copy.
