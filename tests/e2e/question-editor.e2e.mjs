// End-to-end run of the question editor and the three question types, in real
// browsers: the presenter builds a chapter in the editor (single choice,
// multiple choice, true/false), edits, reverts, reorders, retires and restores,
// then plays it live with a big screen and three phones.
//
//   npm run build && npm run preview          (in one terminal)
//   ALLOW_BANK_CHANGES=1 ADMIN_PASSCODE=... BASE_URL=http://localhost:4173/ node tests/e2e/question-editor.e2e.mjs
//
// It changes the question bank (adds a "[Test]" chapter, and retires it at the
// end), so it refuses to run without ALLOW_BANK_CHANGES=1. Run it against the
// local test backend (tools/local-backend), never against the live bank before
// a workshop. ADMIN_TOKEN can replace ADMIN_PASSCODE, as in live-session.e2e.mjs.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = (process.env.BASE_URL || 'http://localhost:4173/').replace(/#.*$/, '');
const PASS = process.env.ADMIN_PASSCODE;
const TOKEN = process.env.ADMIN_TOKEN;
const SHOTS = process.env.SHOTS_DIR || path.resolve('tests/e2e/output/editor');
if (process.env.ALLOW_BANK_CHANGES !== '1') throw new Error('This test edits the question bank. Set ALLOW_BANK_CHANGES=1 (test backends only).');
if (!PASS && !TOKEN) throw new Error('Set ADMIN_PASSCODE (or ADMIN_TOKEN)');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? `  [${detail}]` : ''}`);
};
const shot = (page, name, fullPage = false) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage });
const appears = (locator, timeout = 10000) => locator.waitFor({ timeout }).then(() => true, () => false);
const CHAPTER = '[Test] فصل الأنواع';

const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const browser = await chromium.launch({
  args: proxy ? [`--proxy-server=${proxy}`, '--proxy-bypass-list=localhost;127.0.0.1'] : [],
});
const errors = [];
const watch = (page, label) => {
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/WebSocket|realtime|websocket/i.test(m.text())) errors.push(`${label}: ${m.text()}`);
  });
};

async function fillQuestion(dialog, { type, text, options, right, seconds, explanation, source }) {
  await dialog.getByRole('radio', { name: type }).check();
  await dialog.getByLabel('نص السؤال').fill(text);
  if (options) {
    const letters = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];
    // Match the number of option rows to the options wanted.
    for (;;) {
      const n = await dialog.locator('.optedit__row').count();
      if (n < options.length) await dialog.getByRole('button', { name: 'إضافة خيار' }).click();
      else if (n > options.length) await dialog.getByRole('button', { name: `حذف الخيار ${letters[n - 1]}` }).click();
      else break;
    }
    for (const [i, t] of options.entries()) await dialog.getByLabel(`نص الخيار ${letters[i]}`, { exact: true }).fill(t);
  }
  for (const letter of right) await dialog.getByLabel(`${letter} إجابة صحيحة`).check();
  if (seconds) await dialog.getByLabel('المدة بالثواني').fill(String(seconds));
  if (explanation) await dialog.getByLabel(/التوضيح الذي يظهر/).fill(explanation);
  if (source) await dialog.getByLabel(/المرجع/).fill(source);
}

try {
  // ---------- presenter: sign in, open the editor ----------
  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  if (!PASS) {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await adminCtx.addInitScript(([token, exp]) => {
      try {
        window.localStorage.setItem('npsquiz:admin', JSON.stringify({ token, expiresAt: exp }));
      } catch {
        // storage blocked: the sign-in check below fails and says so
      }
    }, [TOKEN, expiresAt]);
  }
  const admin = await adminCtx.newPage();
  watch(admin, 'admin');
  await admin.goto(`${BASE}#/admin`);
  if (PASS) {
    await admin.getByLabel('رمز المرور').fill(PASS);
    await admin.getByRole('button', { name: 'دخول', exact: true }).click();
  }
  await admin.getByRole('heading', { name: 'جلسة جديدة' }).waitFor({ timeout: 15000 });
  await admin.getByRole('link', { name: 'تحرير الأسئلة' }).click();
  await admin.getByRole('heading', { name: 'بنك الأسئلة', level: 1 }).waitFor({ timeout: 15000 });
  check('editor: opens from the presenter home', true);
  const chaptersBefore = await admin.locator('.chapter-card').count();
  await shot(admin, '01-editor', true);

  // ---------- a new chapter ----------
  await admin.getByRole('button', { name: 'إضافة فصل' }).click();
  let dialog = admin.getByRole('dialog');
  await dialog.getByRole('button', { name: 'حفظ الفصل' }).click();
  check('editor: a chapter needs a title', await appears(dialog.getByText('اكتب عنوان الفصل.')));
  await dialog.getByLabel('عنوان الفصل').fill(CHAPTER);
  await dialog.getByLabel(/وصف قصير/).fill('ثلاثة أنواع من الأسئلة');
  await dialog.getByRole('button', { name: 'حفظ الفصل' }).click();
  const card = admin.locator('.chapter-card', { has: admin.getByRole('heading', { name: new RegExp(CHAPTER.replace(/[[\]]/g, '\\$&')) }) });
  await card.waitFor({ timeout: 10000 });
  check('editor: the new chapter is added last, empty, and blocks new sessions until it has a question',
    (await admin.locator('.chapter-card').count()) === chaptersBefore + 1 &&
      (await card.getByText(/لا أسئلة في هذا الفصل/).isVisible()) &&
      (await admin.getByText(/لا يمكن إنشاء جلسة بعد/).first().isVisible()));

  // ---------- single choice, with a validation round ----------
  await card.getByRole('button', { name: /إضافة سؤال/ }).click();
  dialog = admin.getByRole('dialog');
  await dialog.getByLabel('نص السؤال').fill('ما لون السماء في يوم صافٍ؟');
  await dialog.getByRole('button', { name: 'حفظ السؤال' }).click();
  check('editor: saving an incomplete question shows what is missing',
    await appears(dialog.getByText('راجع الحقول المشار إليها قبل الحفظ.')));
  await fillQuestion(dialog, {
    type: 'اختيار واحد',
    text: 'ما لون السماء في يوم صافٍ؟',
    options: ['أحمر', 'أزرق', 'أخضر'],
    right: ['ب'],
    seconds: 10,
    explanation: 'السماء زرقاء بسبب تشتت الضوء.',
    source: 'شريحة 3',
  });
  await shot(admin, '02-editor-single');
  await dialog.getByRole('button', { name: 'حفظ السؤال' }).click();
  await card.locator('.qrow').first().waitFor({ timeout: 10000 });
  check('editor: a single-choice question is saved', /الصحيحة: ب/.test(await card.locator('.qrow').first().innerText()));

  // ---------- multiple choice ----------
  await card.getByRole('button', { name: /إضافة سؤال/ }).click();
  dialog = admin.getByRole('dialog');
  await dialog.getByRole('radio', { name: 'اختيار متعدد' }).check();
  check('editor: multiple choice defaults to 30 seconds', (await dialog.getByLabel('المدة بالثواني').inputValue()) === '30');
  await fillQuestion(dialog, {
    type: 'اختيار متعدد',
    text: 'أي هذه الأعداد زوجية؟',
    options: ['اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة'],
    right: ['أ'],
    seconds: 15,
  });
  await dialog.getByRole('button', { name: 'حفظ السؤال' }).click();
  check('editor: multiple choice with one right answer is refused before saving',
    await appears(dialog.getByText(/يحتاج إجابتين صحيحتين على الأقل/)));
  await dialog.getByLabel('ج إجابة صحيحة').check();
  await dialog.getByLabel('هـ إجابة صحيحة').check();
  await dialog.locator('.qform__preview summary').click();
  await shot(admin, '03-editor-multiple', true);
  await dialog.getByRole('button', { name: 'حفظ السؤال' }).click();
  await card.locator('.qrow').nth(1).waitFor({ timeout: 10000 });
  check('editor: a five-option multiple-choice question is saved with three right answers',
    /الصحيحة: أ، ج، هـ/.test(await card.locator('.qrow').nth(1).innerText()));

  // ---------- true / false ----------
  await card.getByRole('button', { name: /إضافة سؤال/ }).click();
  dialog = admin.getByRole('dialog');
  await fillQuestion(dialog, { type: 'صح أو خطأ', text: 'الشمس تدور حول الأرض.', right: ['ب'], seconds: 10 });
  check('editor: true/false shows the fixed options صح and خطأ',
    (await dialog.locator('.optedit__fixed').allInnerTexts()).join('|') === 'صح|خطأ');
  await shot(admin, '04-editor-true-false');
  await dialog.getByRole('button', { name: 'حفظ السؤال' }).click();
  await card.locator('.qrow').nth(2).waitFor({ timeout: 10000 });
  check('editor: a true/false question is saved', /صح أو خطأ/.test(await card.locator('.qrow').nth(2).innerText()) && /الصحيحة: خطأ/.test(await card.locator('.qrow').nth(2).innerText()));

  // ---------- edit, history and revert ----------
  await card.getByRole('button', { name: 'تعديل السؤال 1' }).click();
  dialog = admin.getByRole('dialog');
  await dialog.getByLabel('نص السؤال').fill('نص معدّل للتجربة');
  await dialog.getByRole('button', { name: 'إلغاء' }).click();
  check('editor: closing with unsaved changes asks first', await appears(dialog.getByText(/لديك تغييرات لم تُحفظ/)));
  await dialog.getByRole('button', { name: 'حفظ السؤال' }).click();
  await card.getByText('نص معدّل للتجربة').waitFor({ timeout: 10000 });
  await card.getByRole('button', { name: 'سجل السؤال 1' }).click();
  dialog = admin.getByRole('dialog');
  await dialog.getByRole('heading', { name: 'سجل السؤال' }).waitFor();
  const versions = await dialog.locator('.history__item').count();
  await shot(admin, '05-editor-history');
  await dialog.getByRole('button', { name: 'استعادة هذه النسخة' }).first().click();
  await card.getByText('ما لون السماء في يوم صافٍ؟').waitFor({ timeout: 10000 });
  check('editor: history shows both versions and restores the earlier text', versions === 2);

  // ---------- reorder, retire and restore ----------
  await card.getByRole('button', { name: 'نقل السؤال 3 لأعلى' }).click();
  await admin.waitForFunction(() => {
    const c = [...document.querySelectorAll('.chapter-card')].find((x) => x.innerText.includes('[Test] فصل الأنواع'));
    return c && /الشمس/.test(c.querySelectorAll('.qrow')[1]?.innerText || '');
  });
  check('editor: questions move up and down', true);
  await card.getByRole('button', { name: 'إيقاف السؤال 2' }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'إيقاف السؤال' }).click();
  await admin.waitForFunction(() => {
    const c = [...document.querySelectorAll('.chapter-card')].find((x) => x.innerText.includes('[Test] فصل الأنواع'));
    return c && c.querySelectorAll('.qrow').length === 2;
  });
  await admin.locator('.retired summary').click();
  await admin.locator('.retired li', { hasText: 'الشمس تدور حول الأرض.' }).getByRole('button', { name: 'استعادة' }).click();
  await admin.waitForFunction(() => {
    const c = [...document.querySelectorAll('.chapter-card')].find((x) => x.innerText.includes('[Test] فصل الأنواع'));
    return c && c.querySelectorAll('.qrow').length === 3 && /الشمس/.test(c.querySelectorAll('.qrow')[2].innerText);
  });
  check('editor: a retired question is listed under «الموقوفة» and comes back at the end', true);
  await card.getByRole('button', { name: 'نقل السؤال 3 لأعلى' }).click();
  await admin.waitForFunction(() => {
    const c = [...document.querySelectorAll('.chapter-card')].find((x) => x.innerText.includes('[Test] فصل الأنواع'));
    return c && /الشمس/.test(c.querySelectorAll('.qrow')[1]?.innerText || '');
  });

  // Move the chapter to the top so it is chapter 1 in the session.
  for (let i = 0; i < chaptersBefore; i += 1) {
    await card.getByRole('button', { name: /نقل الفصل \d+ لأعلى/ }).click();
    await admin.waitForTimeout(300);
  }
  await admin.waitForFunction(() => document.querySelector('.chapter-card')?.innerText.includes('[Test] فصل الأنواع'));
  check('editor: chapters move up; the bank is ready again', await admin.getByText('البنك جاهز.').isVisible());
  await shot(admin, '06-editor-ready', true);

  const phoneEditor = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  if (!PASS) {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await phoneEditor.addInitScript(([token, exp]) => window.localStorage.setItem('npsquiz:admin', JSON.stringify({ token, expiresAt: exp })), [TOKEN, expiresAt]);
  } else {
    const stored = await admin.evaluate(() => window.localStorage.getItem('npsquiz:admin'));
    await phoneEditor.addInitScript((value) => window.localStorage.setItem('npsquiz:admin', value), stored);
  }
  const pe = await phoneEditor.newPage();
  watch(pe, 'editor-phone');
  await pe.goto(`${BASE}#/admin/bank`);
  await pe.getByRole('heading', { name: 'بنك الأسئلة', level: 1 }).waitFor({ timeout: 15000 });
  const overflow = await pe.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('editor: fits a phone screen without sideways scrolling', overflow <= 1, `${overflow}px`);
  await shot(pe, '07-editor-phone');
  await phoneEditor.close();

  // ---------- play it ----------
  await admin.getByRole('link', { name: 'العودة إلى الجلسات' }).click();
  await admin.getByLabel('العنوان على الشاشة الكبيرة').fill('[Test] Question types');
  await admin.getByRole('button', { name: 'إنشاء الجلسة' }).click();
  await admin.getByRole('button', { name: /ابدأ الفصل 1/ }).waitFor({ timeout: 15000 });
  const plate = await admin.locator('.console__status .plate__body').getAttribute('aria-label');
  const code = plate.replace('رمز الانضمام', '').replace(/\s+/g, '');
  const joinLink = await admin.locator('.copy input').first().inputValue();

  const screenCtx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const screen = await screenCtx.newPage();
  watch(screen, 'screen');
  await screen.goto(`${BASE}#/screen/${code}`);

  const phones = [];
  for (const name of ['Noura', 'Fahad', 'Reem']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    watch(page, name);
    await page.goto(joinLink);
    await page.getByLabel(/اسمك/).fill(name);
    await page.getByRole('button', { name: 'انضم الآن' }).click();
    await page.getByRole('heading', { name: /أنت معنا/ }).waitFor({ timeout: 15000 });
    phones.push({ name, ctx, page });
  }
  const [p1, p2, p3] = phones.map((p) => p.page);

  await admin.getByRole('button', { name: /ابدأ الفصل 1/ }).click();
  await p1.getByText('الفصل 1', { exact: true }).waitFor({ timeout: 15000 });

  // Q1: single choice
  await admin.getByRole('button', { name: /اعرض السؤال 1 من 3/ }).click();
  await p1.locator('.opt[data-option="B"]:not([disabled])').waitFor({ timeout: 15000 });
  await p1.locator('.opt[data-option="B"]').click();
  await p2.locator('.opt[data-option="A"]').click();
  await p1.getByText(/تم تسجيل إجابتك: ب/).waitFor({ timeout: 10000 });
  await admin.getByRole('button', { name: /اكشف الإجابة/ }).click();
  await p1.getByRole('heading', { name: 'إجابة صحيحة' }).waitFor({ timeout: 15000 });
  await p2.getByRole('heading', { name: 'ليست هذه المرة' }).waitFor({ timeout: 15000 });
  await p3.getByRole('heading', { name: 'انتهى الوقت' }).waitFor({ timeout: 15000 });
  check('single choice: right, wrong and timed-out phones get their feedback', true);

  // Q2: true / false
  await admin.getByRole('button', { name: /اعرض السؤال 2 من 3/ }).click();
  await p1.locator('.opts--tf .opt[data-option="B"]:not([disabled])').waitFor({ timeout: 15000 });
  check('true/false: phones show the two big buttons and the type', (await p1.locator('.opts--tf .opt').count()) === 2 && /صح أو خطأ/.test(await p1.locator('.q__type').innerText()));
  await shot(p1, '08-phone-true-false');
  await p1.locator('.opt[data-option="B"]').click();
  await p2.locator('.opt[data-option="A"]').click();
  await p3.locator('.opt[data-option="B"]').click();
  await p1.getByText(/تم تسجيل إجابتك: خطأ/).waitFor({ timeout: 10000 });
  await admin.getByRole('button', { name: /اكشف الإجابة/ }).click();
  await p1.getByRole('heading', { name: 'إجابة صحيحة' }).waitFor({ timeout: 15000 });
  await p2.getByRole('heading', { name: 'ليست هذه المرة' }).waitFor({ timeout: 15000 });
  check('true/false: «خطأ» scores, «صح» does not', true);

  // Q3: multiple choice, all or nothing
  await admin.getByRole('button', { name: /اعرض السؤال 3 من 3/ }).click();
  await p1.locator('.opt--multi[data-option="A"]:not([disabled])').waitFor({ timeout: 15000 });
  check('multiple choice: phones show tick boxes and a disabled confirm button',
    (await p1.locator('.opt--multi').count()) === 5 && (await p1.getByRole('button', { name: /تأكيد الإجابة/ }).isDisabled()));
  for (const id of ['A', 'C', 'E']) await p1.locator(`.opt[data-option="${id}"]`).click();
  check('multiple choice: ticked options are marked and counted on the button',
    (await p1.locator('.opt.is-checked').count()) === 3 && /تأكيد الإجابة \(3\)/.test(await p1.getByRole('button', { name: /تأكيد الإجابة/ }).innerText()));
  await shot(p1, '09-phone-multiple-ticked');
  await p1.getByRole('button', { name: /تأكيد الإجابة/ }).click();
  for (const id of ['A', 'C']) await p2.locator(`.opt[data-option="${id}"]`).click();
  await p2.getByRole('button', { name: /تأكيد الإجابة/ }).click();
  // Reem ticks the right set but never confirms: it is sent when time runs out.
  for (const id of ['A', 'C', 'E']) await p3.locator(`.opt[data-option="${id}"]`).click();
  await p1.getByText(/تم تسجيل إجابتك: أ، ج، هـ/).waitFor({ timeout: 10000 });
  await screen.waitForFunction(() => /اختر كل الإجابات الصحيحة/.test(document.body.innerText));
  await shot(screen, '10-screen-multiple-open');
  await shot(admin, '11-console-multiple');
  await p3.getByText(/انتهى الوقت فأُرسلت اختياراتك/).waitFor({ timeout: 25000 });
  check('multiple choice: ticked but unconfirmed options are sent when time runs out', true);
  await admin.getByRole('button', { name: /اكشف الإجابة/ }).click();
  await p1.getByRole('heading', { name: 'إجابة صحيحة' }).waitFor({ timeout: 15000 });
  await p2.getByRole('heading', { name: 'ليست هذه المرة' }).waitFor({ timeout: 15000 });
  await p3.getByRole('heading', { name: 'إجابة صحيحة' }).waitFor({ timeout: 15000 });
  check('multiple choice: the exact set scores; a missing option scores 0, and the phone marks what was missed',
    await p2.locator('.opt.is-missed[data-option="E"]').isVisible());
  await shot(p2, '12-phone-multiple-missed');
  await screen.locator('.tile.is-correct').first().waitFor({ timeout: 15000 });
  check('big screen: all three right answers are marked at the reveal', (await screen.locator('.tile.is-correct').count()) === 3);
  await shot(screen, '13-screen-multiple-reveal');

  await admin.getByRole('button', { name: /اعرض نتائج الفصل 1/ }).click();
  await p1.getByText('اكتمل الفصل 1').waitFor({ timeout: 15000 });
  const stats = await p1.locator('.stats > div').first().innerText();
  check('chapter results: Noura answered 3 of 3', /3 من 3/.test(stats), stats);

  const [download] = await Promise.all([
    admin.waitForEvent('download', { timeout: 15000 }),
    admin.getByRole('button', { name: 'تنزيل تحليل الأسئلة (CSV)' }).click(),
  ]);
  const itemPath = path.join(SHOTS, 'questions.csv');
  await download.saveAs(itemPath);
  const items = fs.readFileSync(itemPath, 'utf8');
  check('question analysis lists the type and every right answer', /اختيار متعدد/.test(items) && /صح أو خطأ/.test(items) && /أ، ج، هـ/.test(items));

  await admin.getByRole('button', { name: 'إنهاء الجلسة', exact: true }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'إنهاء الجلسة', exact: true }).click();
  await p1.getByText('ترتيبك النهائي').waitFor({ timeout: 15000 });

  // ---------- leave the bank as it was: retire the test chapter ----------
  await admin.goto(`${BASE}#/admin/bank`);
  await card.waitFor({ timeout: 15000 });
  await card.getByRole('button', { name: 'إيقاف الفصل' }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'إيقاف الفصل' }).click();
  await admin.waitForFunction((n) => document.querySelectorAll('.chapter-card').length === n, chaptersBefore);
  check('cleanup: the test chapter is retired and the bank is ready', await admin.getByText('البنك جاهز.').isVisible());
} catch (e) {
  check(`unexpected failure: ${e.message.split('\n')[0]}`, false);
} finally {
  check('no browser errors on any page', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots: ${SHOTS}`);
  process.exit(failed ? 1 : 0);
}
