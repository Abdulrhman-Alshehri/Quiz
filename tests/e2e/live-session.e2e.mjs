// End-to-end run of a live session in real browsers: one presenter, one big
// screen and three phones, against the real Supabase project.
//
//   npm run build && npm run preview          (in one terminal)
//   ADMIN_PASSCODE=... BASE_URL=http://localhost:4173/ npm run test:e2e
//
// Instead of the passcode you can pass ADMIN_TOKEN, a valid presenter sign-in
// token (for example from a signed-in browser's storage, key "npsquiz:admin");
// the two sign-in checks are then skipped.
//
// Screenshots go to tests/e2e/output (or SHOTS_DIR). The session it creates is
// titled "[Test] ..." and is ended at the end of the run. The right answers are
// read from the presenter console, so the test works with any question bank.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = (process.env.BASE_URL || 'http://localhost:4173/').replace(/#.*$/, '');
const PASS = process.env.ADMIN_PASSCODE;
const TOKEN = process.env.ADMIN_TOKEN;
const SHOTS = process.env.SHOTS_DIR || path.resolve('tests/e2e/output');
fs.mkdirSync(SHOTS, { recursive: true });
if (!PASS && !TOKEN) throw new Error('Set ADMIN_PASSCODE (or ADMIN_TOKEN)');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? `  [${detail}]` : ''}`);
};
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const appears = (locator, timeout = 10000) => locator.waitFor({ timeout }).then(() => true, () => false);

// The open question's options and right answers, as the presenter console shows them.
async function answerKey(admin) {
  const rows = admin.locator('.console__question .dist__row');
  await rows.first().waitFor({ timeout: 20000 });
  const all = await rows.evaluateAll((els) => els.map((e) => e.dataset.option));
  const right = await admin.locator('.console__question .dist__row.is-key').evaluateAll((els) => els.map((e) => e.dataset.option));
  return { all, right, wrong: all.find((id) => !right.includes(id)) || all[0] };
}

// One tap for single choice and true/false; tick every option then confirm for multiple choice.
async function answerOn(page, ids, timeout = 40000) {
  await page.locator(`.opt[data-option="${ids[0]}"]:not([disabled])`).waitFor({ timeout });
  const multi = (await page.locator('.opt--multi').count()) > 0;
  if (!multi) {
    await page.locator(`.opt[data-option="${ids[0]}"]`).click();
    return;
  }
  for (const id of ids) await page.locator(`.opt[data-option="${id}"]`).click();
  await page.getByRole('button', { name: /تأكيد الإجابة/ }).click();
}

// If this machine reaches the internet through a proxy, hand it to Chromium
// directly so the local preview server is still reached without it.
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

try {
  // ---------- presenter ----------
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
    await admin.getByLabel('رمز المرور').fill('wrong-passcode');
    await admin.getByRole('button', { name: 'دخول', exact: true }).click();
    check('presenter: wrong passcode shows an error', await appears(admin.getByText('رمز المرور غير صحيح.')));
    await shot(admin, '00-admin-sign-in');
    await admin.getByLabel('رمز المرور').fill(PASS);
    await admin.getByRole('button', { name: 'دخول', exact: true }).click();
  }
  await admin.getByRole('heading', { name: 'جلسة جديدة' }).waitFor({ timeout: 15000 });
  check(PASS ? 'presenter: signs in' : 'presenter: signed in with a presenter token (passcode checks skipped)', true);
  await shot(admin, '01-admin-home');

  await admin.getByLabel('العنوان على الشاشة الكبيرة').fill('[Test] End-to-end run');
  await admin.getByRole('radio', { name: /مدة موحدة/ }).check();
  await admin.getByLabel('عدد الثواني لكل سؤال').fill('10');
  await admin.getByRole('button', { name: 'إنشاء الجلسة' }).click();
  await admin.getByRole('button', { name: /ابدأ الفصل 1/ }).waitFor({ timeout: 15000 });
  const plateLabel = await admin.locator('.console__status .plate__body').getAttribute('aria-label');
  const code = plateLabel.replace('رمز الانضمام', '').replace(/\s+/g, '');
  check('presenter: session created with a 6-character code', /^[A-Z0-9]{6}$/.test(code), code);
  const joinLink = await admin.locator('.copy input').first().inputValue();
  check('presenter: join link uses the deployed address, not localhost-only paths', joinLink.startsWith(BASE) && joinLink.includes(`#/join?code=${code}`), joinLink);
  await shot(admin, '02-admin-console-lobby');

  // ---------- big screen ----------
  const screenCtx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const screen = await screenCtx.newPage();
  watch(screen, 'screen');
  await screen.goto(`${BASE}#/screen/${code}`);
  await screen.getByRole('heading', { name: 'امسح للانضمام' }).waitFor({ timeout: 15000 });
  check('screen: lobby shows QR and plate', await screen.locator('.lobby__qr img').isVisible());

  // ---------- phones ----------
  const phones = [];
  for (const name of ['Majid', 'Saleh', 'Omar']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    watch(page, name);
    await page.goto(joinLink);
    phones.push({ name, ctx, page });
  }
  const [p1, p2, p3] = phones;
  await p1.page.getByRole('button', { name: 'انضم الآن' }).click();
  check('phone: empty name is refused', await appears(p1.page.getByText('اكتب اسمك للانضمام.')));
  await shot(p1.page, '03-phone-join-error');
  for (const p of phones) {
    await p.page.getByLabel(/اسمك/).fill(`  ${p.name}  `);
    await p.page.getByRole('button', { name: 'انضم الآن' }).click();
    await p.page.getByRole('heading', { name: /أنت معنا/ }).waitFor({ timeout: 15000 });
  }
  check('phones: three people joined', true);
  await shot(p1.page, '04-phone-waiting-room');

  const dupCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const dup = await dupCtx.newPage();
  await dup.goto(joinLink);
  await dup.getByLabel(/اسمك/).fill('majid');
  await dup.getByRole('button', { name: 'انضم الآن' }).click();
  check('phone: duplicate name is refused', await appears(dup.getByText(/انضم شخص بهذا الاسم/)));
  await dupCtx.close();

  await screen.waitForFunction(() => /عدد المنضمين\s*3/.test(document.body.innerText), null, { timeout: 15000 });
  check('screen: lobby counts 3 people', true);
  await shot(screen, '05-screen-lobby');

  // ---------- chapter 1 ----------
  await admin.getByRole('button', { name: /ابدأ الفصل 1/ }).click();
  await p1.page.getByText('الفصل 1', { exact: true }).waitFor({ timeout: 15000 });
  check('phones follow the presenter into chapter 1', true);
  await shot(p1.page, '06-phone-chapter-intro');
  await shot(screen, '07-screen-chapter-intro');

  const firstButton = admin.getByRole('button', { name: /اعرض السؤال 1 من \d+/ });
  const perChapter = Number((await firstButton.innerText()).match(/من (\d+)/)[1]);
  await firstButton.click();
  await p1.page.getByText(/تفتح الإجابات خلال/).waitFor({ timeout: 15000 });
  check('phones get the lead-in with the question text first', await p1.page.locator('#q-text').isVisible());
  await shot(p1.page, '08-phone-lead-in');
  const key1 = await answerKey(admin);
  await answerOn(p1.page, key1.right); // right
  await answerOn(p2.page, [key1.wrong]); // wrong
  await p1.page.getByText(/تم تسجيل إجابتك: /).waitFor({ timeout: 10000 });
  const other = key1.all.find((id) => !key1.right.includes(id));
  check('phone: answer is locked in and other options are disabled', await p1.page.locator(`.opt[data-option="${other}"]`).isDisabled());
  await shot(p1.page, '09-phone-answered');
  await shot(p3.page, '09b-phone-question-open');
  await screen.waitForFunction(() => /2\s+من 3 أجابوا/.test(document.body.innerText), null, { timeout: 15000 });
  check('screen: shows 2 of 3 answered, without the answer key', (await screen.locator('.tile.is-correct').count()) === 0);
  await shot(screen, '10-screen-question');
  await shot(admin, '11-admin-console-question');

  await p1.page.reload();
  await p1.page.getByText(/تم تسجيل إجابتك: /).waitFor({ timeout: 15000 });
  check('phone: refresh keeps the participant and the locked answer', true);

  await admin.getByRole('button', { name: 'اكشف الإجابة', exact: true }).waitFor({ timeout: 20000 });
  await admin.getByRole('button', { name: 'اكشف الإجابة', exact: true }).click();
  await p1.page.getByRole('heading', { name: 'إجابة صحيحة' }).waitFor({ timeout: 15000 });
  await p2.page.getByRole('heading', { name: 'ليست هذه المرة' }).waitFor({ timeout: 15000 });
  await p3.page.getByRole('heading', { name: 'انتهى الوقت' }).waitFor({ timeout: 15000 });
  check('reveal: correct, wrong and timed-out phones each get the right feedback', true);
  const pts = Number((await p1.page.locator('.reveal__points').innerText()).replace(/[^\d]/g, ''));
  check('reveal: correct answer earned speed points (0-1000)', pts > 0 && pts <= 1000, String(pts));
  await shot(p1.page, '12-phone-reveal-correct');
  await shot(p2.page, '13-phone-reveal-wrong');
  await screen.locator('.tile.is-correct').waitFor({ timeout: 15000 });
  await shot(screen, '14-screen-reveal');

  // ---------- automatic mode for the rest of the chapter ----------
  await admin.getByLabel(/الوضع التلقائي/).check();
  for (let i = 1; i < perChapter; i += 1) {
    await admin.locator('#live-title', { hasText: new RegExp(`السؤال ${i + 1} من ${perChapter}`) }).waitFor({ timeout: 40000 });
    const key = await answerKey(admin);
    for (const [j, p] of phones.entries()) await answerOn(p.page, j === 0 ? key.right : [key.wrong]);
    await p1.page.locator('.reveal__title').waitFor({ timeout: 30000 });
  }
  await p1.page.getByText('اكتمل الفصل 1').waitFor({ timeout: 40000 });
  check(`automatic mode ran questions 2-${perChapter} and showed chapter results`, true);
  const correctText = await p1.page.locator('.stats > div').first().innerText();
  check(`chapter results: Majid answered ${perChapter} of ${perChapter} correctly`, new RegExp(`${perChapter} من ${perChapter}`).test(correctText), correctText);
  await shot(p1.page, '15-phone-chapter-results');
  await screen.getByRole('heading', { name: 'اكتمل الفصل 1' }).waitFor({ timeout: 15000 });
  const top = await screen.locator('.board__row').first().innerText();
  check('screen: leaderboard ranks Majid first', /Majid/.test(top), top);
  await shot(screen, '16-screen-leaderboard');
  await admin.getByLabel(/الوضع التلقائي/).uncheck();
  await shot(admin, '17-admin-console-after-chapter');

  // ---------- exports ----------
  const [download] = await Promise.all([
    admin.waitForEvent('download', { timeout: 15000 }),
    admin.getByRole('button', { name: 'تنزيل النتائج (CSV)' }).click(),
  ]);
  const csvPath = path.join(SHOTS, 'results.csv');
  await download.saveAs(csvPath);
  const csv = fs.readFileSync(csvPath, 'utf8').replace(/^﻿/, '');
  const lines = csv.trim().split(/\r\n/);
  check('CSV export: header plus one row per participant', lines.length === 4 && lines[0].startsWith('معرف الجلسة,'), `${lines.length} lines`);
  check('CSV export: Majid ranked 1 with chapter 1 points', /,1,[0-9a-f-]{36},Majid,/.test(lines[1]), lines[1]);

  const [download2] = await Promise.all([
    admin.waitForEvent('download', { timeout: 15000 }),
    admin.getByRole('button', { name: 'تنزيل تحليل الأسئلة (CSV)' }).click(),
  ]);
  const itemPath = path.join(SHOTS, 'questions.csv');
  await download2.saveAs(itemPath);
  const items = fs.readFileSync(itemPath, 'utf8').trim().split(/\r\n/);
  const totals = await admin.locator('.console-chapters__item').evaluateAll((els) =>
    els.reduce((n, e) => n + Number((e.innerText.match(/من\s*(\d+)/) || [0, 0])[1]), 0),
  );
  check(`question analysis: one row per question (${totals})`, items.length === totals + 1, `${items.length} lines`);

  // ---------- end ----------
  await admin.getByRole('button', { name: 'إنهاء الجلسة', exact: true }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'إنهاء الجلسة', exact: true }).click();
  await p2.page.getByText('ترتيبك النهائي').waitFor({ timeout: 15000 });
  check('phones show final position after the session ends', true);
  await shot(p2.page, '18-phone-final');
  await screen.getByRole('heading', { name: 'النتائج النهائية' }).waitFor({ timeout: 15000 });
  await shot(screen, '19-screen-final');

  const late = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const lp = await late.newPage();
  await lp.goto(joinLink);
  check('ended session: join page says it has ended', await appears(lp.getByText('انتهت هذه المسابقة. شكرًا لمشاركتك.')));
  await late.close();
} catch (e) {
  check(`unexpected failure: ${e.message.split('\n')[0]}`, false);
} finally {
  check('no browser errors on any page', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots: ${SHOTS}`);
  process.exit(failed ? 1 : 0);
}
