/* Bilingual dictionary + helpers for the Thrive Opportunity Library */
const I18N = {
  en: {
    _dir: "ltr",
    nav_library: "Library",
    nav_editor: "Editor",
    nav_templates: "Templates",
    brand: "Thrive Digital Solutions",

    lib_title: "Opportunity Library",
    lib_sub: "Every prospect page, classified by name, send date, location and phone. Links live at thriveiii.com/opp/&lt;name&gt;.",
    search_ph: "Search by business, location, template…",
    sort_label: "Sort",
    sort_new: "Newest sent",
    sort_old: "Oldest sent",
    sort_az: "Business A–Z",
    filter_all: "All templates",
    new_opp: "New opportunity",
    export_manifest: "Export manifest.json",
    col_sent: "Sent",
    col_location: "Location",
    col_phone: "Phone",
    open_page: "Open page",
    edit: "Edit",
    remove: "Remove",
    empty: "No opportunities yet. Open the Editor to create the first one.",
    draft: "Draft (local)",
    sent: "Sent",
    none: "—",

    ed_title: "Template Editor",
    ed_sub: "Fill an approved template or upload a finished HTML page, then export the file and its link.",
    mode_fill: "Fill a template",
    mode_upload: "Upload HTML",
    f_template: "Template",
    f_biz: "Business name",
    f_slug: "Link slug",
    f_slughint: "The URL becomes thriveiii.com/opp/&lt;slug&gt;",
    f_sent: "Send date",
    f_location: "Location",
    f_phone: "Phone (if any)",
    f_quote: "Quote (owner or business)",
    f_quotehint: "Leave empty to hide the quote block. Never invent a quote.",
    f_quoteby: "Quote attribution",
    f_proof1: "What you built · 1",
    f_proof2: "What you built · 2",
    f_proof3: "What you built · 3",
    f_want: "The busier-pair",
    f_wanthint: "e.g. the nights or the shelf, the rack or the runway",
    upload_dz: "Drop a finished .html file here, or click to choose",
    uploaded: "Loaded file: ",
    preview_url: "Live link (after you commit the file)",
    dl_page: "Download page (index.html)",
    save_lib: "Save to library",
    copy_manifest: "Copy manifest entry",
    saved_toast: "Saved to your library (this browser).",
    copied_toast: "Manifest entry copied.",
    dl_toast: "Page downloaded. Commit it to opp/",
    need_biz: "Enter a business name first.",
    help_title: "How to publish",
    help_body: "1) Download the page. 2) In your GitHub repo, put it at <code>opp/&lt;slug&gt;/index.html</code>. 3) Commit. It goes live at <code>thriveiii.com/opp/&lt;slug&gt;</code> in about a minute. 4) Paste the link into your email.",

    tpl_title: "Approved Templates",
    tpl_sub: "Only approved templates are used for outreach. Each has a fixed id.",
    use_template: "Use this template",
    dl_template: "Download template",
    status_approved: "Approved",
  },
  ar: {
    _dir: "rtl",
    nav_library: "المكتبة",
    nav_editor: "المحرر",
    nav_templates: "القوالب",
    brand: "ثرايف للحلول الرقمية",

    lib_title: "مكتبة الفرص",
    lib_sub: "كل صفحة فرصة، مصنّفة بالاسم وتاريخ الإرسال والموقع والهاتف. الروابط على thriveiii.com/opp/&lt;الاسم&gt;.",
    search_ph: "ابحث بالاسم أو الموقع أو القالب…",
    sort_label: "ترتيب",
    sort_new: "الأحدث إرسالًا",
    sort_old: "الأقدم إرسالًا",
    sort_az: "الاسم أ–ي",
    filter_all: "كل القوالب",
    new_opp: "فرصة جديدة",
    export_manifest: "تصدير manifest.json",
    col_sent: "أُرسل",
    col_location: "الموقع",
    col_phone: "الهاتف",
    open_page: "فتح الصفحة",
    edit: "تحرير",
    remove: "حذف",
    empty: "لا فرص بعد. افتح المحرر لإنشاء أول واحدة.",
    draft: "مسودة (محلية)",
    sent: "أُرسلت",
    none: "—",

    ed_title: "محرر القوالب",
    ed_sub: "عبّئ قالبًا معتمدًا أو ارفع صفحة HTML جاهزة، ثم صدّر الملف ورابطه.",
    mode_fill: "تعبئة قالب",
    mode_upload: "رفع HTML",
    f_template: "القالب",
    f_biz: "اسم العمل",
    f_slug: "لاحقة الرابط",
    f_slughint: "يصبح الرابط thriveiii.com/opp/&lt;اللاحقة&gt;",
    f_sent: "تاريخ الإرسال",
    f_location: "الموقع",
    f_phone: "الهاتف (إن وُجد)",
    f_quote: "اقتباس (المالك أو المنشأة)",
    f_quotehint: "اتركه فارغًا لإخفاء كتلة الاقتباس. لا تختلق اقتباسًا أبدًا.",
    f_quoteby: "نسبة الاقتباس",
    f_proof1: "ما بنيته · 1",
    f_proof2: "ما بنيته · 2",
    f_proof3: "ما بنيته · 3",
    f_want: "زوج ما تريده أكثر ازدحامًا",
    f_wanthint: "مثال: الليالي أو الرفّ",
    upload_dz: "أسقط ملف .html جاهزًا هنا، أو انقر للاختيار",
    uploaded: "حُمِّل الملف: ",
    preview_url: "الرابط الحي (بعد رفع الملف)",
    dl_page: "تنزيل الصفحة (index.html)",
    save_lib: "حفظ في المكتبة",
    copy_manifest: "نسخ سطر المانيفست",
    saved_toast: "حُفظت في مكتبتك (هذا المتصفح).",
    copied_toast: "نُسخ سطر المانيفست.",
    dl_toast: "نُزّلت الصفحة. ارفعها إلى opp/",
    need_biz: "أدخل اسم العمل أولًا.",
    help_title: "كيف تنشر",
    help_body: "١) نزّل الصفحة. ٢) في مستودع GitHub، ضعها في <code>opp/&lt;slug&gt;/index.html</code>. ٣) ارفع التغيير. ٤) تصبح حيّة على <code>thriveiii.com/opp/&lt;slug&gt;</code> خلال دقيقة، ثم ألصق الرابط في بريدك.",

    tpl_title: "القوالب المعتمدة",
    tpl_sub: "القوالب المعتمدة فقط تُستخدم للتواصل. لكل واحد معرّف ثابت.",
    use_template: "استخدم هذا القالب",
    dl_template: "تنزيل القالب",
    status_approved: "معتمد",
  }
};

function getLang(){ return localStorage.getItem("thrive_lang") || "en"; }
function setLang(l){ localStorage.setItem("thrive_lang", l); applyLang(); }
function t(key){ const l=getLang(); return (I18N[l] && I18N[l][key]) || I18N.en[key] || key; }

function applyLang(){
  const l = getLang(), dict = I18N[l];
  document.documentElement.lang = l;
  document.documentElement.dir = dict._dir;
  document.querySelectorAll("[data-i18n]").forEach(el=>{ el.innerHTML = t(el.getAttribute("data-i18n")); });
  document.querySelectorAll("[data-i18n-ph]").forEach(el=>{ el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph")).replace(/&lt;/g,"<").replace(/&gt;/g,">")); });
  const lb = document.getElementById("langbtn");
  if(lb) lb.textContent = (l==="en") ? "العربية" : "English";
  if(window.onLangApplied) window.onLangApplied();
}
function initLang(){
  const lb = document.getElementById("langbtn");
  if(lb) lb.addEventListener("click", ()=> setLang(getLang()==="en"?"ar":"en"));
  applyLang();
}
