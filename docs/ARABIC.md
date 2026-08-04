# The Arabic rewrite, string by string

WO-013 §8. The review's judgement was blunt and correct: the Arabic read like a machine.

**Read it aloud. If it sounds like a machine, it is one.** That is the test no check can perform,
which is why this table exists: Thyab is the native speaker and these are judgement calls, so they
are in one place rather than scattered through an interface he would have to hunt.

Sixty two strings changed. Every one of them is below, old beside new.

## The rules they were changed under

| # | Rule |
|---|---|
| 1 | State names are nouns and verbal nouns, never verbs, and never a doer. The interface reports what happened; it does not narrate who did it |
| 2 | No grammatical dual as a bare count label. `فتحتان` is correct and reads as a machine. The dual stays allowed in an ordinary noun phrase |
| 3 | Never translate an English idiom, and never explain when a short line will do |
| 4 | The lane and state table, final |
| 5 | Guillemets, Arabic comma, Arabic question mark, Western numerals |
| 6 | No letter-spacing and no text-transform on Arabic, ever |
| 7 | Arabic runs 20 to 30 percent longer, so no fixed width and no truncation |

Rules 1, 2, 5 and 6 are enforced by `tools/verify.js` and fail the build.
`tools/arabic.py` introduces one violation of each and proves the build goes red.

## The four Thyab confirmed, which are final

| Was | Not this either | Is |
|---|---|---|
| `أُرسلت` | `أرسلناها` | `تم الإرسال` |
| `فُتحت` | `فتحوها` | `تم الفتح` |
| `رُدّ عليها` | `ردّوا` | `ردود` |
| `تم إنشاؤه` | `أنشأناه` | `تم الإنشاء` |

## Rule 3, the sentence supplied and used verbatim

`أخبرنا بما تريده أكثر ازدحامًا` was a literal rendering of "tell us what you most want busier" and
means nothing in Arabic. It is now, exactly:

> `قل لنا من أين تحب أن نبدأ، وسنشارك معك خطة 90 يومًا التالية`

No list of options after it, no clarifying clause, no second question stacked on the first.

**The English was read for tone as well.** "Tell us what you most want busier" is not good English
either; the English hint now names two concrete pairs instead of an abstraction.

## Every string that changed

| Key | Was | Is |
|---|---|---|
| `story_no_opens` | <span class="q">لم تُفتح أي صفحة بعد.</span> | <span class="q">لا فتح لأي صفحة بعد.</span> |
| `home_tpl_none` | بلا قالب رسالة (كُتبت يدويًا) | بلا قالب رسالة (كتابة يدوية) |
| `home_p_sent` | أُرسلت ولم تُفتح بعد | تم الإرسال وبلا فتح بعد |
| `et_duplicated` | نُسخ قالب الرسالة. | تم نسخ قالب الرسالة. |
| `tip_sent_total` | كل رسالة أُرسلت من هذا الكونسول بزر «إرسال». رسائل «نسخ للـ Gmail» تُسجَّل منفصلة ولا تُحتسب هنا. | كل رسالة خرجت من هذا الكونسول بزر «إرسال». ورسائل «نسخ للـ Gmail» لها سجل منفصل ولا تدخل في هذا العدد. |
| `home_data_local` | لا يتم تجميع فتحات المستقبِلين بعد: الأرقام أدناه تعكس ما فُتح في هذا المتصفح فقط. حدّث سكربت الوسيط إلى v4 ثم اضغط «تحديث» ليبدأ تجميع الفتحات الحقيقية. | لا تجميع لفتحات المستقبِلين بعد: الأرقام أدناه تعكس الفتح في هذا المتصفح فقط. حدّث سكربت الوسيط إلى v4 ثم اضغط «تحديث» ليبدأ تجميع الفتحات الحقيقية. |
| `conn_key_copied` | نُسخ مفتاح المزامنة. الصقه باسم SYNC_KEY في Script properties. | تم نسخ مفتاح المزامنة. الصقه باسم SYNC_KEY في Script properties. |
| `col_sent` | أُرسل | تم الإرسال |
| `col_made` | أُنشئت الصفحة | تم الإنشاء |
| `sent` | أُرسلت | تم الإرسال |
| `f_want` | زوج ما تريده أكثر ازدحامًا | من أين تحب أن نبدأ |
| `f_wanthint` | مثال: الليالي أو الرفّ | قل لنا من أين تحب أن نبدأ، وسنشارك معك خطة 90 يومًا التالية |
| `copied_toast` | نُسخ سطر المانيفست. | تم نسخ سطر المانيفست. |
| `need_fields` | عبّئ حقول المحتوى المطلوبة أولًا (النقاط الثلاث وزوج الازدحام). | عبّئ حقول المحتوى المطلوبة أولًا: النقاط الثلاث، ومن أين نبدأ. |
| `link_copied` | نُسخ الرابط الحي. | تم نسخ الرابط الحي. |
| `tpl_added` | أُضيف قالب الصفحة. | تمت إضافة قالب الصفحة. |
| `stage_sent` | أُرسلت | تم الإرسال |
| `stage_opened` | فُتحت | تم الفتح |
| `stage_replied` | رُدّ عليها | ردود |
| `cmp_sent` | أُرسل البريد من hi@thriveiii.com. | تم الإرسال من hi@thriveiii.com. |
| `cmp_copied` | نُسخ. الصقه في Gmail (hi@thriveiii.com). | تم النسخ. الصقه في Gmail (hi@thriveiii.com). |
| `kd_went_library` | أُضيف إلى مكتبة قوالب الصفحات {loc}. | تمت الإضافة إلى مكتبة قوالب الصفحات {loc}. |
| `cmp_self_sent` | أُرسلت إلى hi@thriveiii.com. ولا تُحسب من الحصة ولا تدخل السجل. | تم الإرسال إلى hi@thriveiii.com. ولا يدخل في الحصة ولا في السجل. |
| `mv_undo_del` | حُذفت. | تم الحذف. |
| `loc_counterpart_made` | أُنشئ بالبنية وبلا محتوى. لم يُترجَم شيء. | تم الإنشاء بالبنية وبلا محتوى. ولا ترجمة لشيء. |
| `lc_note_tplgone` | قالب الصفحة الذي بُنيت منه حُذف. الصفحة نفسها لم تتغيّر. | قالب الصفحة الذي بُني منه لم يعد موجودًا. والصفحة نفسها كما هي. |
| `oc_copied` | نُسخ. | تم النسخ. |
| `md_sends_h` | أُرسلت يدويًا | إرسال يدوي |
| `mw_copied` | نُسخ الرابط. | تم نسخ الرابط. |
| `mw_o_made` | أُنشئت في | تم الإنشاء في |
| `cmp_tpl_uploaded` | رُفع قالب الرسالة واختير. | تم رفع قالب الرسالة واختياره. |
| `lane_live` | جاهزة | جاهزة للإرسال |
| `lane_sent` | أُرسلت | تم الإرسال |
| `lane_opened` | فُتحت | تم الفتح |
| `lane_replied` | رُدّ عليها | ردود |
| `board.lane_live` | جاهزة | جاهزة للإرسال |
| `board.lane_sent` | أُرسلت | تم الإرسال |
| `board.lane_opened` | فُتحت | تم الفتح |
| `board.lane_replied` | رُدّ عليها | ردود |
| `board.tok_opens.one` | فتحة واحدة | مرة واحدة |
| `board.tok_opens.two` | فتحتان | مرتين |
| `board.tok_opens.few` | {n} فتحات | {n} مرات |
| `board.tok_opens.many` | {n} فتحة | {n} مرة |
| `board.tok_opens.other` | {n} فتحة | {n} مرة |
| `board.story_opens.one` | فُتحت صفحاتك <b>مرة واحدة</b>. | تم فتح صفحاتك <b>مرة واحدة</b>. |
| `board.story_opens.two` | فُتحت صفحاتك <b>مرتين</b>. | تم فتح صفحاتك <b>مرتين</b>. |
| `board.story_opens.few` | فُتحت صفحاتك <b>{n}</b> مرات. | تم فتح صفحاتك <b>{n}</b> مرات. |
| `board.story_opens.many` | فُتحت صفحاتك <b>{n}</b> مرة. | تم فتح صفحاتك <b>{n}</b> مرة. |
| `board.story_opens.other` | فُتحت صفحاتك <b>{n}</b> مرة. | تم فتح صفحاتك <b>{n}</b> مرة. |
| `board.act_s_opens.one` | فُتحت صفحاتك <b>مرة واحدة</b>. | تم فتح صفحاتك <b>مرة واحدة</b>. |
| `board.act_s_opens.two` | فُتحت صفحاتك <b>مرتين</b>. | تم فتح صفحاتك <b>مرتين</b>. |
| `board.act_s_opens.few` | فُتحت صفحاتك <b>{n}</b> مرات. | تم فتح صفحاتك <b>{n}</b> مرات. |
| `board.act_s_opens.many` | فُتحت صفحاتك <b>{n}</b> مرة. | تم فتح صفحاتك <b>{n}</b> مرة. |
| `board.act_s_opens.other` | فُتحت صفحاتك <b>{n}</b> مرة. | تم فتح صفحاتك <b>{n}</b> مرة. |
| `board.subj_count.two` | حرفان | حرفين |
| `board.rp_repaired.zero` | لم يُكتب أي سجل. | لا سجلات مكتوبة. |
| `board.rp_repaired.one` | كُتب سجل واحد. سيظهر مع أول مزامنة. | تمت كتابة سجل واحد. سيظهر مع أول مزامنة. |
| `board.rp_repaired.two` | كُتب سجلان. سيظهران مع أول مزامنة. | تمت كتابة سجلين. سيظهران مع أول مزامنة. |
| `board.rp_repaired.few` | كُتبت {n} سجلات. ستظهر مع أول مزامنة. | تمت كتابة {n} سجلات. ستظهر مع أول مزامنة. |
| `board.rp_repaired.many` | كُتب {n} سجلًا. ستظهر مع أول مزامنة. | تمت كتابة {n} سجلًا. ستظهر مع أول مزامنة. |
| `board.rp_repaired.other` | كُتب {n} سجل. ستظهر مع أول مزامنة. | تمت كتابة {n} سجل. ستظهر مع أول مزامنة. |
| `board.loc_count.two` | قالبان | قالبين |
## What did not change, and why

**The two page templates still carry the old sentences in their bodies.**
`templates/ar-opp1/template.html` says `أخبرنا بما تريده أكثر ازدحامًا` and
`templates/en-opp1/template.html` says "Tell us what you most want busier". Those are 367 KB and
187 KB approved designs, and changing the words inside a published page template is a content
decision with a re-approval attached, not a string fix. Every page already published from them
carries the old wording too, and rewriting the template does not rewrite those.

It is recorded in the review packet as **open**, with the replacement sentence ready, rather than
done quietly. The interface labels that point at the same field were softened, because those stand
alone and cost nothing: `The busier-pair` was jargon and is now `What they want busier`.
