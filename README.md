# بوابة نماذج ومراقبي سيوف المجد — Cloudflare Workers + D1

مشروع مفتوح المصدر مخصص للنشر من GitHub على Cloudflare Workers، مع قاعدة بيانات Cloudflare D1. لا يحتاج Render ولا قاعدة بيانات مدفوعة منفصلة للبدء. يبدأ المشروع بلا نماذج أو حقول افتراضية؛ المسؤول ينشئ كل نموذج ويحدد حقوله بنفسه.

## المزايا

- إنشاء نماذج عامة متعددة وحقول ديناميكية: نص، نص طويل، رقم، بريد، رابط، هاتف، تاريخ، قائمة اختيار، ومربع اختيار.
- تحديد الحقول الإجبارية، وتفعيل/تعطيل الحقول، وتعديل ترتيبها.
- نتائج منفصلة لكل نموذج، بحث، تصدير CSV، حالات مراجعة وملاحظات.
- مستويات: مدير كامل، منشئ نماذج، مراجع، مشاهد.
- صلاحيات لكل مستخدم ولكل نموذج: قراءة، نتائج، تعديل، وإدارة.
- إدارة المستخدمين، سجل نشاط إداري، وإدارة صلاحيات لوحة الحظر.
- سجل إجراءات حظر الشات والبريد يتضمن UID والسيرفر والمدة والسبب والحالة.
- CSRF protection، جلسات عشوائية مخزنة في D1، تخزين hash لمعرّف الجلسة، وتجزئة كلمات المرور بواسطة PBKDF2-SHA-256.

> **تنبيه مهم:** سجل الحظر يوثق الإجراء ويتابع حالته، لكنه لا ينفذ الحظر داخل خادم اللعبة. التنفيذ الفعلي يحتاج API رسميًا موثقًا من خادم سيوف المجد.

## النشر على Cloudflare من GitHub

### 1. أنشئ قاعدة D1 أولًا

1. افتح [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. اذهب إلى **Workers & Pages → D1 SQL Database → Create database**.
3. سمّ القاعدة `sog-moderator-portal`.
4. انسخ **Database ID** الخاص بها.

### 2. حدّث إعداد الربط في GitHub

افتح `wrangler.jsonc` في مستودع GitHub واضغط القلم للتعديل. استبدل النص:

`REPLACE_WITH_YOUR_D1_DATABASE_ID`

بـ Database ID الذي نسخته من Cloudflare، ثم اضغط **Commit changes**.

### 3. اربط مستودع GitHub بـ Cloudflare Workers

1. في Cloudflare افتح **Workers & Pages → Create application → Workers Builds / Connect to Git**.
2. اختر GitHub ثم وافق على الوصول إلى المستودع الذي تريد نشره.
3. اختر مستودع المشروع والفرع `main` (أو الفرع الأساسي عندك).
4. إذا طلب إعداد الأوامر، استخدم:
   - Build command: `npm install`
   - Deploy command: `npm run deploy`
5. اسم الـ Worker يجب أن يكون `sog-moderator-portal` مطابقًا للاسم في `wrangler.jsonc`.
6. اضغط **Save and Deploy**.

وثائق Cloudflare الرسمية: [GitHub integration for Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/) و[إعداد D1 bindings](https://developers.cloudflare.com/d1/examples/query-d1-from-python-workers/).

### 4. أضف كلمة مرور المدير

داخل إعدادات Worker افتح **Settings → Variables and Secrets** وأضف:

- `ADMIN_PASSWORD` كـ **Secret**: كلمة مرور فريدة بطول 12 حرفًا على الأقل.
- `ADMIN_USERNAME` كـ **Text** (اختياري): `admin`؛ إن لم تضفه فسيستخدم التطبيق `admin`.

لا تخزن كلمة المرور في GitHub. يتولى التطبيق إنشاء الجداول تلقائيًا عند أول طلب، ثم ينشئ حساب المدير الأول عند وجود `ADMIN_PASSWORD` صالح. إذا أضفت السر بعد أول زيارة ولم يظهر حساب المدير، أعد نشر Worker ثم افتح `/login`.

### 5. تأكد من ربط D1

في **Settings → Bindings** تأكد أن هناك D1 binding باسم `DB` مرتبط بقاعدة `sog-moderator-portal`. الاسم `DB` حساس ويجب أن يطابق `wrangler.jsonc`.

### 6. افتح الموقع

سيظهر رابط شبيه بـ:

`https://sog-moderator-portal.<your-subdomain>.workers.dev`

افتح الرابط ثم `/login` وسجل الدخول باسم `admin` وكلمة المرور التي أضفتها في `ADMIN_PASSWORD`.

## قاعدة البيانات فين؟

قاعدة الإنتاج موجودة في **Cloudflare D1**؛ لا ترفع ملف قاعدة بيانات إلى GitHub. مخطط الجداول في `migrations/0001_schema.sql`، والتطبيق ينشئ الجداول تلقائيًا عند أول اتصال. يمكن أيضًا تشغيل المخطط من D1 Console أو عبر Wrangler عند الحاجة. لا ترفع سجلات اللاعبين أو نسخ قاعدة البيانات إلى المستودع.

## تشغيل محلي (اختياري)

يتطلب Node.js حديثًا. من جذر المشروع:

```bash
npm install
npx wrangler d1 create sog-moderator-portal
```

انسخ Database ID إلى `wrangler.jsonc` ثم أنشئ ملف `.dev.vars` (لا ترفعه إلى GitHub) يحتوي:

```dotenv
ADMIN_USERNAME=admin
ADMIN_PASSWORD=ضع_كلمة_مرور_طويلة_هنا
```

ثم شغّل:

```bash
npm run dev
```

أول زيارة تنشئ الجداول وحساب المدير في قاعدة D1 المحلية التي يحاكيها Wrangler.

## حدود الخطة المجانية

Workers Free وD1 لديهما حصص استخدام يومية وحدود CPU وتخزين. حد Workers Free المنشور حاليًا 100,000 طلب يوميًا و10ms CPU لكل طلب؛ وD1 له حدود قراءة/كتابة وتخزين. لو ظهر خطأ Worker 1102 أو اقترب الاستخدام من الحصة، راجع الحدود الحالية قبل الاستخدام الفعلي. راجع [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) و[D1 pricing](https://developers.cloudflare.com/workers/platform/pricing/).

## ملاحظات تشغيلية

- كل نموذج يبدأ فارغًا؛ أضف الحقول المطلوبة بنفسك.
- التطبيق يسمح بالإرسال العام عندما يكون النموذج نشطًا ومنشورًا للعامة.
- الأدوار العامة لا تمنح الوصول تلقائيًا إلى نتائج كل النماذج؛ الصلاحيات الفردية لكل نموذج هي التي تتحكم في النتائج والتعديل.
- لوحة الحظر لا تتصل بسيرفر اللعبة حتى توفر API رسميًا موثقًا؛ لا تضف أسرار API داخل كود الواجهة أو مستودع عام.
- قبل الاعتماد الإنتاجي، اختبر صلاحيات كل دور وفعّل سياسة نسخ احتياطي مناسبة لقاعدة D1.
