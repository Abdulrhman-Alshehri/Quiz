# Go-live: question editor and question types

**Status: live since 15 October 2026.** See "Go-live record" at the end. The steps below stay as the pattern for the next database change.

## What changes

- **Database:** one migration, `supabase/migrations/20261015100000_quiz_question_types_and_editor.sql`. It adds question types (single choice, multiple choice, true/false), 2 to 6 options, the editor's functions and each question's version history. Right answers and players' selections are now stored as lists; the old single-letter columns stay as read-only copies so older code keeps working.
- **Site:** the editor page (`#/admin/bank`) and the new question types on phones, the big screen, the console and the CSV exports.
- **Unchanged:** the 20 live questions and their answers, existing sessions and results, the passcode, the join link and the QR codes.

## Why the order is fixed

Database first, then site. The new site does not work on the old database; the current site does work on the new one. Tested on 15 October:

- The current site's own tests, run against the new database: backend 59/59, browsers 25/25. (Run with the earlier Arabic bank: `main`'s backend test has some right answers written into it, and two of its checks assume the earlier ch2-q1. Against today's AR Final bank those two fail whether or not the migration is applied. The branch's tests read the answers from the bank.)
- A session started on the old database, with the migration applied while it waited between questions, then carried on: earlier answers and points kept, an answer from an old page (one option) and from a new page (a list) both scored, results and question analysis correct (12/12 checks).

Phones that opened the quiz before the site update keep the old page until they reload. They keep working, but on a multiple-choice question they can only send one option. This only matters if a session runs across the update; reloading the page fixes it.

## When

- Not while any session is in a question. The migration briefly locks the answer tables; an answer sent in that moment can fail.
- Recommended: at least one working day before the next workshop, followed by a 10-minute rehearsal on real phones. If the workshop is sooner, go live after it: the current site already runs the workshop with the AR Final questions, imported on 15 October.

## Steps (about 30 minutes)

Claude can run steps 1 to 5 through the Supabase connector and GitHub. Step 5's manual check needs the presenter and two phones.

### 1. Pre-checks (read-only)

```sql
-- A. Open sessions. Stop if any row shows in_question_now = true, and ask the
--    presenter about any session updated in the last two hours.
--    (A session left in phase 'question' long after its deadline is not active.)
select code, title, status, phase, updated_at,
       phase = 'question' and question_deadline > now() - interval '10 minutes' as in_question_now
from public.sessions
where status <> 'ended'
order by updated_at desc;

-- B. Constraint names the migration replaces. The list must include
--    bank_questions_options_check and bank_questions_chapter_id_sort_order_key.
select conname from pg_constraint
where conrelid = 'public.bank_questions'::regclass
order by conname;

-- C. Counts to compare after the migration.
select (select count(*) from public.bank_chapters where retired_at is null) as chapters,
       (select count(*) from public.bank_questions q
          join public.bank_chapters c on c.id = q.chapter_id
         where q.retired_at is null and c.retired_at is null)          as questions,
       (select count(*) from public.sessions)                           as sessions,
       (select count(*) from public.answers)                            as answers;

-- D. Questions the new rules would refuse. Must return no rows, or the migration stops
--    (empty or over-long option text, two options with the same text, option ids not A, B, C… in order).
select q.id
from public.bank_questions q
where exists (select 1 from jsonb_array_elements(q.options) o
              where trim(o->>'text') = '' or char_length(o->>'text') > 120)
   or (select count(distinct lower(trim(o->>'text'))) from jsonb_array_elements(q.options) o)
      <> jsonb_array_length(q.options)
   or (select array_agg(o->>'id' order by n) from jsonb_array_elements(q.options) with ordinality as x(o, n))
      is distinct from (array['A','B','C','D','E','F'])[1:jsonb_array_length(q.options)]
   or char_length(q.source_ref) > 200;
```

Also: save the Supabase advisors (security and performance) to compare with step 3, and download the bank from the console (**تنزيل البنك (JSON)**) into the restricted folder.

Advisors on 15 October: performance, none. Security, two warnings that each list 28 functions ("Public Can Execute SECURITY DEFINER Function" and the same for signed-in users). That is by design: the quiz has no user accounts, so every database function is called with the public key, and each presenter function checks the presenter token first. The backend test confirms all 31 presenter functions refuse a forged token.

Last run on the live project: 15 October, 14:36 Riyadh time. B and D passed; C gave 4 chapters, 20 questions (the AR Final bank, imported at 13:24), 14 sessions, 226 answers. Two sessions were still open: ZA9MM9 (chapter results, last used 12:05) and 9T7KT6 (left in a question since 14 October, 16:59). Neither blocks the migration; the presenter may want to end them first. Run all four checks again on the day.

### 2. Apply the migration

Use the Supabase CLI (`supabase db push`) or the connector's `apply_migration` with the name `quiz_question_types_and_editor` and the file's contents. Both record it in the migration history next to the seven earlier ones. Do not paste it into the SQL editor: that works but leaves no record.

It takes about a second. If it stops with an error, run check G below before anything else.

### 3. Verify the database

```sql
-- E. Run C again: the same numbers.

-- F. Every live question now has a type. Expected today: single | 20.
select q.question_type, count(*)
from public.bank_questions q
join public.bank_chapters c on c.id = q.chapter_id
where q.retired_at is null and c.retired_at is null
group by 1;

-- G. Applied fully? Expected: 4 | s.
--    0 | (empty) means nothing was applied: the current site is fine; fix the error and retry.
--    Anything else means it was applied in part: do not publish the site; fix forward first.
select (select count(*) from pg_proc
         where pronamespace = 'public'::regnamespace
           and proname in ('admin_save_chapter', 'admin_save_question',
                           'admin_question_history', 'admin_revert_question')) as editor_functions,
       (select attgenerated from pg_attribute
         where attrelid = 'public.answers'::regclass and attname = 'selected_option_id') as answers_column;
```

Then run the Supabase advisors again. Expected: the same two security warnings, now listing 38 functions (the 10 editor functions added), and no performance warnings. Any other new warning: stop and look before publishing the site.

### 4. Publish the site

Merge `feature/question-editor` into `main` and push. GitHub Actions builds and publishes in about two minutes. Check the run is green, then open https://abdulrhman-alshehri.github.io/Quiz/#/admin, sign in and press **تحرير الأسئلة**.

### 5. Verify the live site

Automated checks that never change the bank. They create sessions titled `[Test] …` and end them. Run them with a temporary presenter token so the passcode is not shared:

```sql
-- Make a token for one hour (replace <random> with a long random string).
insert into app_private.admin_tokens (token_hash, expires_at)
values (app_private.hash_token('<random>'), now() + interval '1 hour');
```

```bash
# Browser test first: the backend test signs the token out when it finishes.
ADMIN_TOKEN=<random> BASE_URL=https://abdulrhman-alshehri.github.io/Quiz/ npm run test:e2e                                 # 24 checks (wrong-passcode check skipped)
SUPABASE_URL=https://ntilqaoarrduzsklxnvz.supabase.co SUPABASE_KEY=<publishable key> ADMIN_TOKEN=<random> npm run test:api   # 60 checks
```

If a run stopped early, expire the token by hand:

```sql
update app_private.admin_tokens set expires_at = now()
where token_hash = app_private.hash_token('<random>');
```

Do not run the bank-editing tests on live (`ALLOW_BANK_CHANGES=1`, `npm run test:e2e:editor`). Both refuse the live project.

Manual check, 10 minutes, on two real phones (one iPhone, one Android): the editor shows the same chapters and questions as check C, with no warning; open a question and close it without saving; create a session "[Test] go-live", join with both phones, play one question to the reveal, end the session. Then update `docs/TEST_CHECKLIST.md`.

## If something goes wrong

- **Site problem, database fine:** revert the merge on `main` and push. The previous site returns in about two minutes and works on the new database (tested, see above).
- **Database problem:** there is no prepared reverse migration. The old database functions cannot write to the new answer columns, so going back means writing one, about one to two hours of work. The migration itself loses no data: right answers and selections are copied into the new list columns before the old columns become read-only copies.
- **A question edited by mistake:** **السجل** on that question puts an earlier version back. To restore the whole bank, import the file downloaded in step 1.

## Known limits after go-live

- One shared passcode: the history shows when a question changed, not who changed it.
- Edits apply to new sessions only. Edit first, then create the workshop session.
- The Arabic how-to deck does not cover the editor or the new question types yet.

## Go-live record, 15 October 2026 (Riyadh time)

- **14:36, pre-checks:** A to D passed (the database was confirmed unchanged after each cancelled attempt below). Open sessions: 8EY23D (workshop, between chapters), ZA9MM9 (chapter results), 9T7KT6 (left in a question since 14 October, deadline long past). None blocked the migration.
- **About 15:30, migration:** the connector's `apply_migration` was cancelled three times at the approval step, so the presenter pasted the file into the SQL Editor and ran it. Two consequences, both handled:
  - No row in the migration history. Added by hand at 15:40 (`20261015100000`, `quiz_question_types_and_editor`). Its `statements` holds a note with the file's commit (`e366d95`) and sha256, not the SQL itself. That only matters for Supabase branching, which the free plan does not offer.
  - The editor stored the pasted function sources with Windows line endings (CRLF). The migration has no text value that spans a line, so this is whitespace only. Compared with line endings ignored, the live schema matches the tested one exactly: 63 functions (sources, security, settings and permissions), 102 columns, 43 constraints, 22 indexes, 7 policies, table permissions and row-level security.
- **Checks E to G and advisors:** 4 chapters and 20 questions, all single choice; editor functions 4, `answers.selected_option_id` generated. Advisors: the same two security warnings, now 38 functions; performance, only an INFO note (the new history index not used yet).
- **15:38, site:** `feature/question-editor` merged into `main` (`176a40e`); the GitHub Actions deploy passed.
- **15:39 to 15:46, live checks** with temporary presenter tokens (all expired afterwards; every `[Test]` session ended): browser 24/24, backend 60/60, and a short multiple-choice check through the real Data API, 16/16 (the exact set scores; a partial set or an extra option scores 0; a second answer counts once; an unknown option is refused). The local stand-in cannot test that path, so this was the first proof on the real API.
- **15:40 to 15:41:** the presenter changed ch1-q3 and ch1-q4 to multiple choice in the editor. Saved and logged correctly (3 history entries). Sessions created before 15:40, including 8EY23D, keep the earlier single-choice versions.
- **Still to do:** the manual check on two real phones (step 5).

If a later change is pasted into the SQL Editor again: add the history row by hand, and compare function sources with `replace(prosrc, chr(13), '')`.
