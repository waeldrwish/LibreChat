# دليل العمل الإلزامي: التطوير والدفع والنشر

هذا الدليل ملزم لكل من يعمل على هذا الـ fork (`waeldrwish/LibreChat`)، مطورين ووكلاء ذكاء اصطناعي.
ملفا `CLAUDE.md` و`AGENTS.md` مكتوبان لمستودع upstream، وحيث يتعارضان مع هذا الدليل في الفروع أو
الترجمة أو النشر **فهذا الدليل هو المرجع**. مثال ذلك أن فرع `dev` الذي يذكرانه غير موجود هنا. بقية قواعد
`CLAUDE.md` سارية كما هي: حدود الحزم والأنواع والاختبارات والتنسيق.

---

## الممنوعات المطلقة

مخالفة أي بند هنا توقف الدمج، أو توجب التراجع عن النشر.

1. **ممنوع الدفع المباشر إلى `feature/arabic-admin-panel`.** كل دفع إليه يبني صورة الإنتاج وينشرها إلى GHCR فوراً، دون تشغيل أي اختبار.
2. **ممنوع أي commit على `main`.** هذا الفرع مرآة لـ `upstream/main` فقط.
3. **ممنوع `git push --force` على هذين الفرعين.** على فرعك الشخصي مسموح `--force-with-lease` فقط.
4. **ممنوع `git commit --no-verify`.**
5. **ممنوع رفع الأسرار إلى Git.** يشمل ذلك `.env` و`librechat.yaml` وكل مفتاح أو كلمة مرور أو token، ولا تُلصق في PR أو issue أو سجل أو لقطة شاشة.
6. **ممنوع نشر الوسم `:latest` على الإنتاج.** النشر يكون بالـ SHA الكامل فقط.
7. **ممنوع البناء على سيرفر الإنتاج**، سواء بـ `docker compose build` أو بـ `up --build`.
8. **ممنوع تشغيل سكربتات التحديث المدمجة على أي سيرفر لهذا الـ fork:** `npm run update` و`update:docker` و`update:deployed` و`rebase:deployed` و`reinstall:docker`. كلها تنفّذ `git checkout main && git pull origin main`، و`main` هنا مرآة قديمة لـ upstream لا تحتوي على أي عمل عربي. راجع `config/update.js` و`config/deployed-update.js`.
9. **ممنوع النشر دون نسخة احتياطية من قاعدة البيانات** أُخذت في جلسة النشر نفسها.
10. **ممنوع حذف حقل في مخطط Mongo أو إعادة تسميته أو تغيير نوعه داخل إصدار واحد.** التغييرات إضافية فقط (القسم 1.5).
11. **ممنوع `rebase` لفرع التكامل على upstream.** المزامنة بـ merge فقط (القسم 2.5).
12. **ممنوع فتح PR نحو `danny-avila/LibreChat`** إلا بقرار صريح من المالك.

---

## 0. الوضع الحالي للمستودع

| العنصر | القيمة |
|---|---|
| `origin` | `github.com/waeldrwish/LibreChat` |
| `upstream` | `github.com/danny-avila/LibreChat` |
| فرع التكامل والإنتاج | `feature/arabic-admin-panel` |
| `main` في origin | مرآة لـ upstream متأخرة 922 commit عن `upstream/main`، ولا تحتوي على عمل الـ fork |
| نقطة تفرّع العمل العربي | `86c5884c0`، وupstream متقدم عليها بـ 619 commit |
| خط بناء الصورة | `.github/workflows/arabic-admin-image.yml` |
| الصورة | `ghcr.io/waeldrwish/librechat-arabic-admin` بوسمين: `:latest` و`:<SHA كامل>`، لمعمارية `linux/amd64` فقط |
| ملفات التشغيل على السيرفر | `docker-compose.yml` ومعه `docker-compose.override.yml` (نسخة من `docker-compose.arabic.yml`) |
| الحماية المحلية | hook الـ `pre-commit` في husky: lint-staged (ترتيب الاستيرادات وprettier وeslint) ثم `scripts/static-checks.mts` |
| الحماية على GitHub | لا يوجد أي فحص إلزامي |

لماذا لا تعمل الاختبارات اليوم؟ workflows الاختبار الموروثة من upstream (`backend-review` و`frontend-review` و`static-checks`)
تعمل على `pull_request` أو على الدفع إلى `dev` فقط. لذلك الدفع المباشر إلى فرع التكامل لا يشغّل أي اختبار، ويبني الصورة مباشرة.

حقائق تحكم اختيار ما يُنشر:

- عند وصول دفع جديد يُلغى البناء الجاري (`cancel-in-progress: true`)، فقد يبقى commit مدموج بلا صورة.
- يبدأ البناء فقط إذا تغيّر أحد هذه: `api/` و`client/` و`packages/` و`config/` و`skill/` و`package*.json` و`Dockerfile`. الدمج الذي يغيّر التوثيق وحده لا ينتج صورة.
- النتيجة: **الـ SHA الذي يُنشر هو SHA آخر بناء ناجح، وليس بالضرورة رأس الفرع.**
- التشغيل اليدوي للبناء (`workflow_dispatch`) من أي فرع يكتب فوق `:latest` أيضاً، وهذا سبب إضافي لمنعه على الإنتاج.

---

## 1. التطوير

### 1.1 البيئة

- إصدار Node هو `24.16.0` بالضبط (`.nvmrc`)، شغّل `nvm use`. إصدار npm هو `11.13.0` (`packageManager`).
- التثبيت بـ `npm ci`. استخدم `npm install` فقط عند إضافة تبعية مقصودة، وارفع `package-lock.json` في نفس الـ commit.
- بعد أي تعديل في `packages/data-provider` شغّل `npm run build:data-provider`. البناء الكامل: `npm run build`.
- للتشغيل المحلي: `npm run backend:dev` ثم `npm run frontend:dev` (المنفذ 3090).
- قاعدة بيانات محلية فقط. ممنوع ربط بيئة التطوير بقاعدة الإنتاج، وممنوع نقل بيانات مستخدمين حقيقيين إلى جهاز مطوّر.

### 1.2 الفروع

```bash
git fetch origin
git switch -c feat/<topic> origin/feature/arabic-admin-panel
```

- البادئات المسموحة: `feat/` و`fix/` و`chore/` و`i18n/` و`hotfix/` و`sync/upstream-YYYYMMDD`.
- كل فرع لموضوع واحد، ولا يتجاوز عمره أسبوعاً. العمل الأطول يُقسَّم إلى عدة طلبات دمج.
- لتحديث فرعك الشخصي:

```bash
git fetch origin
git rebase origin/feature/arabic-admin-panel
git push --force-with-lease
```

### 1.3 مكان الكود

قسم "Workspace Boundaries" في `CLAUDE.md` ملزم. هذا الجدول يحدد ما يخص الـ fork:

| ما تضيفه | مكانه |
|---|---|
| منطق خلفي جديد (TypeScript) | `packages/api/src/admin/` أو `packages/api/src/governance/` |
| ربط المسارات في Express | `api/server/routes/admin/*.js` و`api/server/services/*.js`، ربط فقط بحجم `api/server/services/Governance.js` |
| استعلامات ومخططات Mongo | `packages/data-schemas/src/methods/` و`packages/data-schemas/src/schema/` |
| أنواع ونقاط API مشتركة | `packages/data-provider/src/types/admin.ts` و`api-endpoints.ts` و`data-service.ts` |
| hooks الواجهة | `client/src/data-provider/Admin/queries.ts` و`mutations.ts` |
| صفحات لوحة الإدارة (`/admin`) | `client/src/components/Admin/<Feature>/` |
| إعداد يغيّره المشغّل | حقل في `configSchema` (`packages/data-provider/src/config.ts`) بقيمة افتراضية تحافظ على السلوك الحالي، كما في `governance` و`imageGeneration` |

**تقليل التعارض مع upstream.** كل سطر تعدّله في ملف من upstream سيتعارض في المزامنة القادمة.

- أضف ملفاً جديداً بدل تعديل ملف upstream متى أمكن.
- إن اضطررت لتعديل ملف upstream فاجعل التغيير أصغر ما يمكن: سطر استدعاء، لا منطق.
- ممنوع إعادة تنسيق ملف upstream أو إعادة ترتيبه إن لم يتطلب تغييرك ذلك.

### 1.4 الترجمة واتجاه الواجهة (RTL)

هذا البند **يلغي** قاعدة `CLAUDE.md` التي تقول "عدّل المفاتيح الإنجليزية فقط"، لأن المفاتيح الجديدة في هذا الـ fork لا تُترجم آلياً.

- كل نص ظاهر للمستخدم يمر عبر `useLocalize()`.
- كل مفتاح جديد يُضاف إلى `client/src/locales/en/translation.json` **و** `client/src/locales/ar/translation.json` في نفس الـ commit.
- مفاتيح لوحة الإدارة تبدأ بـ `com_admin_` (613 مفتاحاً حالياً). هذه البادئة هي ما يميّز مفاتيح الـ fork عند حل تعارضات المزامنة.
- يجب أن يبقى عدد المفاتيح الناقصة في العربية صفراً. الحالي: 3605 مفتاحاً في en، و3608 في ar، والناقص 0. أمر التحقق:

```bash
node -e "const a=require('./client/src/locales/ar/translation.json'),e=require('./client/src/locales/en/translation.json');const m=Object.keys(e).filter(k=>!(k in a));console.log('missing in ar:',m.length);if(m.length){console.log(m.join('\n'));process.exit(1)}"
```

- في CSS استخدم الخصائص المنطقية فقط: `ms-` و`me-` و`ps-` و`pe-` و`start-` و`end-` و`text-start` و`text-end`.
- ممنوع في الكود الجديد: `ml-` و`mr-` و`pl-` و`pr-` و`left-` و`right-` و`text-left` و`text-right`. السبب موضح في commit `28ca8fc70`.
- كل تغيير في الواجهة يُفحص بالاتجاهين RTL وLTR، وبالوضعين الفاتح والداكن، وتُرفق لقطات الشاشة في الـ PR.

### 1.5 قاعدة البيانات

القاعدة الحاكمة: **الإصدار السابق من التطبيق يجب أن يعمل على البيانات التي كتبها الإصدار الجديد.** هذا ما يجعل التراجع ممكناً دون استعادة القاعدة.

- **مسموح:** مجموعة جديدة، أو حقل جديد اختياري أو له قيمة افتراضية، أو فهرس جديد.
- **ممنوع في إصدار واحد:** حذف حقل، أو إعادة تسميته، أو تغيير نوعه، أو جعل حقل موجود إلزامياً.
- مثل هذا التغيير يُنفّذ على إصدارين: الأول يقرأ الشكلين القديم والجديد ويكتبهما، والثاني يحذف القديم بعد أن يستقر الأول في الإنتاج.
- أي تحويل لبيانات موجودة يكون سكربتاً في `config/` على نمط `migrate-*.js`. شروطه: آمن عند تكرار تشغيله، فيه `--dry-run`، يُشغّل يدوياً بعد النسخة الاحتياطية، ويُذكر في وصف الـ PR.
- الاستعلامات تكون خلف دوال في `packages/data-schemas`، واختباراتها تعمل على `mongodb-memory-server`.
- أي تعديل على مستند مستخدم يبطل ذاكرة المصادقة المؤقتة لذلك المستخدم (قسم "Auth cache invalidation" في `CLAUDE.md`).

### 1.6 الفحوص قبل كل دفع

شغّل فحوص كل workspace غيّرته. نجاح البناء وحده لا يكفي، لأن `tsdown` لا يفحص الأنواع.

| غيّرت | شغّل |
|---|---|
| `packages/data-provider` | `npm run build:data-provider` ثم `cd packages/data-provider && npx jest <pattern>` |
| `packages/data-schemas` | `cd packages/data-schemas && npx tsc --noEmit && npx jest <pattern>` |
| `packages/api` | `cd packages/api && npx tsc --noEmit && npx jest <pattern>` |
| `api` | `cd api && npx jest <pattern>` |
| `client` | `cd client && npm run typecheck && npx jest <pattern>` |
| `packages/client` | `cd packages/client && npx tsc --noEmit && npx jest <pattern>`، مع ملاحظة أن ملفات spec هنا لا تُفحص أنواعها |
| ملفات الترجمة | أمر التحقق في القسم 1.4 |
| `Dockerfile` أو `package-lock.json` | `docker compose build api` محلياً |

وقبل فتح الـ PR شغّل الفحص الكامل على كل الفرق بين فرعك وفرع التكامل:

```bash
node scripts/static-checks.mts --against origin/feature/arabic-admin-panel --full
```

### 1.7 الأسرار

- الملفات `.env*` و`librechat.yaml` و`docker-compose.override.yml` مستثناة في `.gitignore`. لا تغيّر ذلك.
- قيم `.env.example` للعرض فقط. لكل بيئة (التطوير وstaging والإنتاج) قيم مستقلة تُولَّد مرة واحدة:

```bash
openssl rand -hex 32   # CREDS_KEY, JWT_SECRET, JWT_REFRESH_SECRET, ADMIN_PANEL_SESSION_SECRET, MEILI_MASTER_KEY
openssl rand -hex 16   # CREDS_IV
```

- **تحذير:** `CREDS_KEY` و`CREDS_IV` يشفّران مفاتيح المستخدمين المخزّنة، وتغييرهما في الإنتاج يجعل تلك المفاتيح غير قابلة للقراءة.
- **تحذير:** تغيير `JWT_SECRET` يُخرج كل المستخدمين من جلساتهم. لا تدوير لأي من هذه القيم دون خطة مكتوبة.
- على السيرفر لا تبقى نسخ `.env` الاحتياطية داخل مجلد المستودع. تُحفظ خارجه بصلاحية `600`.
- إذا تسرّب مفتاح فيُدوَّر فوراً ويُبلَّغ المالك، حتى لو حُذف الـ commit، لأن حذف الـ commit لا يمحو التاريخ من GitHub.

---

## 2. الـ commit والدفع والدمج

### 2.1 رسائل الـ commit

صيغة Conventional Commits بالإنجليزية، كما في تاريخ الفرع:

```text
feat(admin): add usage export to the limits page
fix(client): keep the RTL drawer inside the viewport
chore(docker): pin the GHCR image by commit
```

- النطاقات المعتمدة: `admin` و`governance` و`client` و`api` و`tools` و`auth` و`i18n` و`docker` و`sync`.
- كل commit لتغيير منطقي واحد.
- مثال على ما يجب تجنبه من تاريخ الفرع: commit `ae2a11cd8` جمع خطوطاً عربية، وإصلاح `SplitText`، ونصوص أخطاء، وترجمة 2284 سطراً. كان الصواب أربعة commits.
- الترجمة الكبيرة تأخذ commit مستقلاً بنطاق `i18n`.

### 2.2 hook الـ pre-commit

- يُثبَّت تلقائياً مع `npm ci` عبر script الـ `prepare`. للتأكد من وجوده: `ls .husky/_`.
- يشغّل lint-staged ثم static-checks على الملفات المرحّلة. إذا فشل فأصلح الخطأ، ولا تتجاوز الـ hook.
- لتشغيل الفحوص البطيئة مع الـ commit: `STATIC_CHECKS_FULL=1 git commit ...`.

### 2.3 الدفع

- ادفع فرعك الشخصي فقط: `git push -u origin feat/<topic>`.
- على أي فرع مشترك اسحب بـ `git pull --ff-only` فقط.
- قبل الدفع راجع `git status` و`git diff --cached --stat`، وتأكد من عدم وجود ملف لم تقصده.

### 2.4 طلب الدمج (PR)

افتح الـ PR بتحديد المستودع والفرع صراحة، لأن `gh` داخل fork قد يوجّه الطلب إلى المستودع الأصلي:

```bash
gh pr create --repo waeldrwish/LibreChat --base feature/arabic-admin-panel
```

أقسام الوصف الإلزامية:

1. **المشكلة أو الهدف:** ما الذي لا يعمل، أو ما الذي يُضاف.
2. **التغيير:** diff مركّز أو شجرة ملفات مختصرة.
3. **قاعدة البيانات:** المجموعات والحقول الجديدة، وسكربت التحويل إن وُجد، أو "لا يوجد".
4. **الإعداد:** متغيرات `.env` الجديدة، وحقول `librechat.yaml` الجديدة مع قيمها الافتراضية، أو "لا يوجد".
5. **الاختبارات:** الأوامر التي شُغّلت ونتائجها.
6. **الواجهة:** لقطات RTL وLTR.
7. **التراجع:** هل يعمل الإصدار السابق على البيانات التي يكتبها هذا الإصدار؟

قائمة تحقق تُلصق في كل PR:

```markdown
- [ ] الفرع مبني على آخر origin/feature/arabic-admin-panel
- [ ] فحوص القسم 1.6 لكل workspace تغيّر، و static-checks --full
- [ ] لا مفاتيح ناقصة في ar/translation.json
- [ ] لا خصائص CSS اتجاهية (ml/mr/pl/pr/left/right) في الكود الجديد
- [ ] تغييرات قاعدة البيانات إضافية فقط
- [ ] كل إعداد جديد له حقل في configSchema وقيمة افتراضية
- [ ] لا أسرار في الـ diff ولا في الوصف ولا في اللقطات
```

شروط الدمج:

- كل الفحوص الإلزامية ناجحة (بعد تنفيذ القسم 5).
- موافقة مراجع واحد على الأقل غير كاتب الـ PR، وكل المحادثات محلولة.
- طريقة الدمج: **Squash and merge** لطلبات الميزات والإصلاحات، و**Create a merge commit** لطلبات مزامنة upstream فقط. دمج المزامنة بـ squash يقطع صلة الـ commits بـ upstream، فتتكرر كل التعارضات في المزامنة التالية.
- بعد الدمج يُحذف الفرع.

### 2.5 مزامنة upstream

- **الوتيرة:** مرة كل شهر، وفوراً عند صدور إصدار أمني من upstream.
- **الفجوة الحالية:** 619 commit. أول مزامنة ستكون كبيرة، وتحتاج PR مخصصاً ويوم عمل كاملاً.

```bash
git fetch upstream
git fetch origin

# 1) حدّث المرآة. إذا فشل --ff-only فهناك commit على main: توقف وبلّغ المالك.
git switch main
git merge --ff-only upstream/main
git push origin main

# 2) أنشئ فرع المزامنة من فرع التكامل، واقرأ ما تغيّر في upstream قبل الدمج
git switch -c sync/upstream-$(date +%Y%m%d) origin/feature/arabic-admin-panel
git diff $(git merge-base HEAD main) main -- .env.example librechat.example.yaml UPGRADING.md
git merge --no-ff main
```

حل التعارضات:

- **ملف `client/src/locales/ar/translation.json`:** احتفظ بمفاتيح الطرفين. القيمة العربية من الـ fork تفوز في المفاتيح التي ترجمها الـ fork، ومفاتيح upstream الجديدة تُضاف وتُراجع ترجمتها. بعدها شغّل أمر التحقق في القسم 1.4، وتأكد أن الملف JSON صالح.
- **ملف `client/src/locales/en/translation.json`:** نسخة upstream، مضافاً إليها مفاتيح `com_admin_` وبقية مفاتيح الـ fork.
- **ملفات upstream التي عدّلها الـ fork** (المسارات وcontrollers و`config.ts`): خذ نسخة upstream الجديدة وأعد تطبيق تعديل الـ fork عليها، لا العكس.
- **ملف `package-lock.json`:** لا تحلّه يدوياً. خذ نسخة upstream، ثم شغّل `npm install` ليُعاد توليده، وراجع الفرق.

بعد الحل، كل ما يلي إلزامي:

```bash
npm ci
npm run build
npm run test:all
node scripts/static-checks.mts --against origin/feature/arabic-admin-panel --full
docker compose build api
```

- كل متغير أو إعداد جديد ظهر في فرق الخطوة الثانية يُكتب في وصف الـ PR تحت "الإعداد".
- عنوان الـ PR: `chore(sync): merge upstream main <short-sha>`، ويُدمج بـ **Create a merge commit**.

---

## 3. النشر على السيرفر

### 3.1 المسار

```text
feat/<topic> --PR--> feature/arabic-admin-panel --> arabic-admin-image.yml
                                                          |
                                                          v
                               ghcr.io/waeldrwish/librechat-arabic-admin:<SHA>
                                                          |
                                  staging (if any) <------+
                                                          v
                                   production @ <SHA>  --fail-->  rollback @ <previous SHA>
```

### 3.2 من ينشر ومتى

- لا ينشر إلى الإنتاج إلا المالك، أو من يفوّضه كتابياً.
- النشر في ساعات العمل فقط. لا نشر قبل عطلة نهاية الأسبوع أو قبل إجازة، إلا لإصلاح عاجل.
- نشر واحد في كل مرة. يُعلَن في قناة الفريق قبل النشر وبعده، مع الـ SHA.

### 3.3 تجهيز السيرفر (مرة واحدة)

- **المعمارية:** `amd64`، لأن الصورة تُبنى لـ `linux/amd64` فقط.
- **مجلد التشغيل:** نسخة Git من المستودع (المسار `/opt/librechat` في الأمثلة). تُثبَّت على نفس SHA الصورة المنشورة، لأن `docker-compose.yml` يربط مجلد `./skill` من النسخة. ممنوع تعديل أي ملف متتبَّع داخلها.
- **ملف `docker-compose.override.yml` على السيرفر:** بلا `build:`، فيستحيل البناء على السيرفر:

```yaml
services:
  api:
    image: ghcr.io/waeldrwish/librechat-arabic-admin:${LIBRECHAT_IMAGE_TAG:?set LIBRECHAT_IMAGE_TAG in .env}
    ports: !override
      - "127.0.0.1:${PORT}:${PORT}"
    volumes:
      - type: bind
        source: ./librechat.yaml
        target: /app/librechat.yaml
  admin-panel:
    ports: !override
      - "127.0.0.1:${ADMIN_PANEL_PORT:-3000}:3000"
```

- **الوسم المنشور:** في `.env` على السيرفر: `LIBRECHAT_IMAGE_TAG=<SHA كامل من 40 حرفاً>`.
- **إصدار Compose:** الوسم `!override` يحتاج Docker Compose 2.24.4 أو أحدث.
- **سبب الربط على `127.0.0.1`:** الملف `docker-compose.yml` ينشر `${PORT}` و`${ADMIN_PANEL_PORT}` على كل الواجهات، ومنافذ Docker المنشورة **تتجاوز قواعد UFW**.
- **مصدر الإعدادات:** إن لم تستخدم `librechat.yaml` فاحذف `volumes` من الملف أعلاه.

الشبكة والأمان:

- **reverse proxy:** التطبيق يعمل خلف reverse proxy (nginx أو Caddy) بشهادة HTTPS.
- **الجدار الناري:** المنفذان 80 و443 مفتوحان للعموم، والمنفذ 22 لعناوين محددة فقط.
- **المنافذ الداخلية:** ممنوع إزالة التعليق عن منافذ `mongodb` أو `meilisearch`، وممنوع كشف `vectordb` أو `rag_api`. خدمة MongoDB تعمل بـ `--noauth`، وخدمة `vectordb` بكلمة المرور الافتراضية `mypassword`، فأمانهما قائم بالكامل على أنهما غير مكشوفين.
- **إعدادات HTTPS:** فعّل `ADMIN_PANEL_SESSION_COOKIE_SECURE=true`، واجعل `DOMAIN_CLIENT` و`DOMAIN_SERVER` بعناوين `https`، واضبط `TRUST_PROXY` حسب الـ proxy.
- **التسجيل:** سياسة التسجيل محددة صراحة في `ALLOW_REGISTRATION` و`ALLOW_SOCIAL_REGISTRATION`.
- **ملف `.env`:** `chmod 600 .env`، ومالكه مستخدم النشر.
- **الوصول إلى GHCR:** إن كانت الحزمة خاصة فسجّل الدخول بـ `docker login ghcr.io` باستخدام token خاص بالسيرفر صلاحيته `read:packages` فقط. ممنوع وضع token شخصي بصلاحية كتابة على السيرفر.

### 3.4 قبل النشر

1. **اختر الـ SHA:** آخر تشغيل ناجح لـ "Arabic Admin Panel Image" في صفحة Actions. استخدم الـ SHA الكامل، لا المختصر.
2. **تأكد أن الصورة موجودة:**
   ```bash
   docker manifest inspect ghcr.io/waeldrwish/librechat-arabic-admin:<SHA>
   ```
3. **اقرأ ما سيُنشر:**
   ```bash
   git log --oneline <OLD>..<NEW>
   git diff <OLD> <NEW> -- .env.example librechat.example.yaml UPGRADING.md config/
   ```
   كل متغير أو إعداد جديد يُضاف إلى `.env` و`librechat.yaml` على السيرفر **قبل** التشغيل.
4. **سكربتات التحويل:** إن كان في الفرق سكربت تحويل بيانات (`config/migrate-*.js`)، فيجب أن تكون خطة تشغيله مكتوبة قبل البدء.
5. **التحقق المسبق:** على staging بنفس الـ SHA إن وُجد. إن لم يوجد، شغّل نفس الصورة محلياً بقاعدة تجريبية.

### 3.5 خطوات النشر

```bash
cd /opt/librechat
NEW=<SHA الجديد كاملاً>
OLD=$(grep '^LIBRECHAT_IMAGE_TAG=' .env | cut -d= -f2)
B=/var/backups/librechat/$(date +%Y%m%d-%H%M)-$OLD
mkdir -p "$B"

# 1) نسخة احتياطية، إلزامية. توقف إن كان أي ملف منها فارغاً.
docker exec chat-mongodb mongodump --db LibreChat --archive --gzip > "$B/mongo.archive.gz"
docker exec vectordb pg_dump -U myuser mydatabase | gzip > "$B/vectordb.sql.gz"
tar czf "$B/files.tar.gz" .env librechat.yaml uploads images
ls -lh "$B"

# 2) ثبّت ملفات التشغيل على نفس الـ SHA
git fetch origin
git checkout --detach "$NEW"

# 3) بدّل الوسم، واسحب الصورة، وشغّل
sed -i "s/^LIBRECHAT_IMAGE_TAG=.*/LIBRECHAT_IMAGE_TAG=$NEW/" .env
docker compose pull api
docker compose up -d

# 4) تحقق
docker compose ps
curl -fsS http://127.0.0.1:<PORT>/health        # يطبع OK
docker exec LibreChat printenv BUILD_COMMIT     # يساوي $NEW
docker compose logs --since 10m api | grep -iE "error|fatal"
```

ثم فحص يدوي لا يتجاوز خمس دقائق، بحساب اختبار:

- تسجيل الدخول والخروج.
- محادثة جديدة يصل ردها متدفقاً.
- رفع ملف.
- لوحة `/admin` تفتح بالعربية واتجاه RTL، وصفحتا المستخدمين والاستخدام تعملان.
- صفحة Settings ثم About تعرض الـ SHA الجديد.

اختبار آلي اختياري من جهاز مطوّر، لا من السيرفر:

```bash
E2E_BASE_URL=https://<domain> E2E_STORAGE_STATE=<file> npm run e2e:deployed
```

ملف storage state يحمل جلسة حقيقية، فلا يُرفع إلى Git أبداً (`**/storageState.json` مستثنى).

أخيراً سجّل النشر في سجل ثابت: التاريخ، والـ SHA القديم والجديد، ومن نفّذ، ومسار النسخة الاحتياطية.

### 3.6 التراجع

**متى:** فشل `/health`، أو تعطّل الدخول أو المحادثة، أو تكرار الأخطاء في السجلات، أو أي شك في تلف البيانات.
القرار يُتخذ خلال 15 دقيقة من النشر: تراجع أولاً، وحقّق بعد ذلك.

```bash
cd /opt/librechat
git checkout --detach <OLD>
sed -i "s/^LIBRECHAT_IMAGE_TAG=.*/LIBRECHAT_IMAGE_TAG=<OLD>/" .env
docker compose pull api
docker compose up -d
curl -fsS http://127.0.0.1:<PORT>/health
```

استعادة قاعدة البيانات **ليست** جزءاً من التراجع العادي. بفضل القسم 1.5 يعمل الإصدار السابق على البيانات الجديدة.
الاستعادة تمحو كل ما كُتب بعد النسخة الاحتياطية، ولا تتم إلا بقرار من المالك:

```bash
docker exec -i chat-mongodb mongorestore --archive --gzip --drop < "$B/mongo.archive.gz"
```

### 3.7 الإصلاح العاجل (hotfix)

قد يحمل فرع التكامل تغييرات مدموجة لم تُنشر بعد، لذلك لا يمر الإصلاح العاجل عبره:

1. **أنشئ الفرع من الـ SHA المنشور:** `git switch -c hotfix/<topic> <SHA_المنشور>`.
2. **أصلح واختبر:** الإصلاح، واختبار يغطي الخلل، وفحوص القسم 1.6.
3. **ابنِ الصورة:** من Actions اختر Arabic Admin Panel Image ثم Run workflow على فرع `hotfix/<topic>`. ينتج ذلك الوسم `:<SHA الإصلاح>`. سيكتب فوق `:latest` أيضاً، ولا أثر لذلك لأن `:latest` ممنوع على الإنتاج.
4. **انشر:** الـ SHA الجديد بخطوات القسم 3.5.
5. **أعد الإصلاح إلى فرع التكامل:** افتح PR من `hotfix/<topic>` إلى `feature/arabic-admin-panel` في اليوم نفسه، كي لا يضيع الإصلاح في النشر التالي.

---

## 4. الأدوار

- **المالك:** يدمج في فرع التكامل، ويزامن upstream، وينشر إلى الإنتاج، ويحفظ الأسرار.
- **المطوّر:** يعمل على فروعه، ويفتح طلبات الدمج، ويشغّل فحوص القسم 1.6، ويكتب وصفاً كاملاً.
- **المراجع:** يقرأ الـ diff كاملاً على صفحة الـ PR نفسها، ويتحقق من بنود قاعدة البيانات والإعداد والترجمة قبل الموافقة.

---

## 5. فرض القواعد (لم يُنفَّذ بعد)

معظم ما سبق قواعد مكتوبة فقط. المفروض تقنياً اليوم هو hook الـ pre-commit المحلي وحده، ويمكن تجاوزه.
هذه مهام فرضها، مرتبة حسب الأولوية:

1. **حماية الفروع على GitHub (Settings ثم Rules):**
   - على `feature/arabic-admin-panel`: PR إلزامي، وفحوص إلزامية، ومنع force push والحذف.
   - على `main`: منع الحذف وforce push، والدفع للمالك فقط.
2. **workflow فحص خاص بالـ fork** (مثلاً `.github/workflows/arabic-ci.yml`):
   - يعمل على `pull_request` نحو فرع التكامل.
   - يشغّل `npm ci`، والبناء، و`tsc --noEmit` لكل workspace، وjest، و`static-checks --against`، وتحقق الترجمة.
   - يُجعل فحصاً إلزامياً ضمن البند 1.
   - سبب الحاجة إليه: workflows upstream مصممة لـ `dev` و`main`، وبعضها يحتاج أسرار upstream، ولم يُتحقق من سلوكها على PR داخل الـ fork.
3. **ربط بناء الصورة بنجاح الفحص**، مع إيقاف نشر `:latest`، أو قصره على التطوير وإضافة وسم إصدار `ar-vX.Y.Z` لكل نشر إنتاج.
4. **تعديل `docker-compose.arabic.yml`** ليستخدم `${LIBRECHAT_IMAGE_TAG:?...}` بدل `:latest`، ويحذف `build:`، فيطابق القسم 3.3.
5. **سكربتا `deploy.sh` و`rollback.sh`** على السيرفر، ينفّذان القسمين 3.5 و3.6 حرفياً، ويرفضان العمل دون نسخة احتياطية غير فارغة.
6. **تعطيل workflows upstream غير المناسبة** من صفحة Actions، لا بحذف ملفاتها، فالحذف يولّد تعارضات في كل مزامنة. مثال: `pr-retarget-dev.yml` يحاول نقل أي PR موجه إلى `main` نحو فرع `dev`، وهو غير موجود هنا.
7. **سطر إحالة إلى هذا الدليل في أعلى `CLAUDE.md` و`AGENTS.md`.** وكلاء الذكاء الاصطناعي يقرؤون هذين الملفين، وهما يوجّهانهم حالياً إلى فرع `dev`، وإلى عدم تعديل الترجمة العربية.
