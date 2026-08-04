# Three kinds, and the contract the shipped templates already use

Read the repository before designing anything. This file is what the repository said.

---

## 1. The three kinds

| Kind | Arabic | What it is | Where it lives | Editable |
|---|---|---|---|---|
| **Page template** | `قالب صفحة` | An HTML skeleton with named fields, built to be filled in the editor | The Library, per locale | Yes, by field |
| **Finished offer** | `عرض جاهز` | A complete HTML page for one named prospect, already written | On the opportunity, never in the Library | No, it is published as it is |
| **Outreach text** | `نص التواصل` | The words that carry the offer | On the opportunity when it is for one prospect, in the Library when it is reusable | Yes |

**The rule that ends the overlap, and it is at the top of the Library:**

> The Library holds only what gets reused. Anything belonging to one prospect lives on that
> opportunity.

That sentence decides every future case without another meeting.

---

## 2. What actually ships, measured

Thyab believed there are two built-in page templates, one Arabic and one English, for the daily
outreach page. **That is correct.**

| | `en-opp1` | `ar-opp1` |
|---|---|---|
| Name | The Signal Brief | موجز الإشارة |
| `meta.json` `lang` | `"en"` | `"ar"` |
| `meta.json` `dir` | `"ltr"` | `"rtl"` |
| `status` | `approved` | `approved` |
| Files | `meta.json`, `template.html` | `meta.json`, `template.html`, `preview.html` |
| `template.html` size | 187 KB | 367 KB |

Both are registered a second time in `library/app.js` as `APPROVED_TEMPLATES`, which is what the
Templates gallery renders.

---

## 3. The field syntax, which was not invented for this round

**`{{TOKEN}}`, where TOKEN is uppercase A to Z, digits and underscore.** Both shipped templates use
it and nothing else. This is the contract, and the upload path is built on top of it rather than
beside it.

Eight tokens appear in both templates, identically:

| Token | In `meta.json` slots | Supplied by |
|---|---|---|
| `BIZ` | yes, required | the editor |
| `QUOTE` | yes, optional | the editor |
| `QUOTE_BY` | yes, optional | the editor |
| `PROOF1` | yes, required | the editor |
| `PROOF2` | yes, required | the editor |
| `PROOF3` | yes, required | the editor |
| `WANT` | yes, required | the editor |
| `SUBJECT` | **no** | **derived**, see below |

### The second directive, which is not a token

```html
<!--QUOTE_START--> ... <!--QUOTE_END-->
```

`fillTemplate` in `library/app.js` **deletes everything between these two markers** when `QUOTE` is
empty, before it substitutes anything. It is part of the contract and an uploaded template may use
it. It is the only conditional the templates have, and there is no general form of it: the marker
names one field, `QUOTE`, and nothing else.

---

## 4. Four places the shipped templates disagree, reported rather than resolved

§3.2 of WO-013 says: if the two templates disagree with each other, say so rather than picking one.
They do, in four ways. **None is fixed in this round.** Fixing them means regenerating two 200 KB
files and re-approving two designs, which is a content decision.

### 4.1 `SUBJECT` is in the HTML and in neither `slots` list

Both templates contain `{{SUBJECT}}`. Neither `meta.json` declares it. It is not an omission: it is
**derived**, computed by `fillTemplate` as `encodeURIComponent(BIZ + " x Thrive")` and used inside a
mailto link. A person never fills it.

**This is why the upload validator distinguishes declared fields from derived ones.** A template
carrying `{{SUBJECT}}` and nothing else has zero fields a person can fill, and is not a template.

### 4.2 The two `slots` lists are two different shapes

`en-opp1` stores rich objects:

```json
{ "key": "BIZ", "label_en": "Business name", "label_ar": "اسم العمل", "type": "text", "required": true }
```

`ar-opp1` stores bare strings:

```json
["BIZ","QUOTE","QUOTE_BY","PROOF1","PROOF2","PROOF3","WANT"]
```

Same information, two encodings. The reader in `library/kinds.js` accepts both, because refusing one
would refuse a template that ships in this repository.

### 4.3 The locale is spelled three ways in three places

| Where | Field | Value |
|---|---|---|
| `templates/*/meta.json` | `lang` | `"en"` / `"ar"` |
| `APPROVED_TEMPLATES` in `app.js` | `lang` | `"EN"` / `"AR"` |
| Custom templates since WO-012 phase 4 | `locale` | `"EN"` / `"AR"` |

Three spellings of one fact. `localeOf()` in `app.js` already normalises them, which is why nothing
is visibly broken, and it is still three spellings. The upload declaration uses **lowercase**
`ar` / `en` in the HTML meta tag, matching what a person writing HTML would expect, and normalises
on the way in.

### 4.4 Only one of them ships a preview

`ar-opp1` has `preview.html`. `en-opp1` does not, and its gallery card points at a live opportunity
page instead. So the English card's thumbnail breaks if that opportunity is ever retired.

---

## 5. Declaring what a file is

An uploaded `.html` was ambiguous: nothing told the console whether it was a skeleton to build from
or a finished page for one prospect. So **the file declares itself, in its own head**:

```html
<meta name="thrive-kind"   content="page-template">
<meta name="thrive-locale" content="ar">
<meta name="thrive-name"   content="عرض يومي، عربي">
```

| Attribute | Values | Required |
|---|---|---|
| `thrive-kind` | `page-template` or `offer` | No. Absent means the console asks |
| `thrive-locale` | `ar` or `en` | **Yes on a page template.** A template with no locale belongs to neither library and cannot be saved |
| `thrive-name` | any text | No. Absent offers the filename, editable before saving |

Anything else in `thrive-kind` is refused with the reason on screen.

### Routing

| The file declares | It becomes |
|---|---|
| `page-template` | A page template in the Library tab for its locale |
| `offer` | An opportunity in the first lane, exactly as before |
| Nothing | **The console asks once**, showing the file name and a preview, with two clear choices. **It never guesses** |

### Validation before a page template is accepted

1. Parse it and list the fields it declares. **They are shown before it is saved.**
2. **Zero fields is not a template** and is refused with that sentence. A finished page has no
   fields; that is what makes it a finished page.
3. A field the editor does not know how to render is **accepted with a named warning per field**,
   never silently. The eight known tokens are in §3. An unknown token still substitutes as empty,
   which is a usable template with a hole in it, and the person is told which hole.

---

## 6. Starting from something that works

`Download a blank page template`, beside the upload control, per locale. It takes the shipped
skeleton, keeps its declarations and its fields, and empties its content. Nobody has to guess the
contract from documentation.

---

## 7. Three kinds, three treatments, so they never look alike

| Kind | Symbol | Colour | Always shows |
|---|---|---|---|
| Page template | `page` | teal | its field count and its locale |
| Finished offer | `spark` | none | the prospect it belongs to. On the board, never in the Library |
| Outreach text | `text` | none | rendered as a block of content with a copy control, never as a form field |

**Every upload ends with one sentence stating what the console decided and where the thing went.** A
file that vanishes into the right place without saying so is the same experience as one that
vanished into the wrong place.
