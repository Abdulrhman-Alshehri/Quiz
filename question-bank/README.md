# Question bank

The questions live in the database, not in this repository. This repository is public, and a file with the answer key would let anyone read the answers before a session.

## Two ways to change the bank

- **The editor (most changes):** presenter console → **تحرير الأسئلة** (`#/admin/bank`). Add, edit, reorder, retire and restore chapters and questions; change a question's type; see each question's saved versions and put an earlier one back. Every save is checked first and the page says what to fix. See "Editing questions" in `docs/FACILITATOR_GUIDE.md`.
- **A file (replacing the whole bank):** presenter console → Question bank → **تنزيل البنك (JSON)**, edit the file, then **استيراد بنك جديد**. The whole file is checked before anything changes. Questions that are not in the new file are retired with a date, not deleted. The downloaded file contains the answer key; keep it in a restricted folder.

Either way, sessions that already exist keep the questions they started with. Edit first, then create the workshop session.

The editor has one shared passcode, so the version history shows when something changed, not who changed it.

## Question types and scoring

| Type (`type`) | Options | Right answers | Scoring |
|---|---|---|---|
| Single choice (`single`) | 2 to 6 | exactly 1 | Right answer scores by speed (up to 1,000 points) |
| Multiple choice (`multiple`) | 3 to 6 | 2 or more | All or nothing: only exactly the right set scores; one missing or one extra option scores 0 |
| True / false (`true_false`) | always `A` صح, `B` خطأ | exactly 1 | As single choice |

On phones, multiple choice shows tick boxes and a «تأكيد الإجابة» button. If the time runs out before the player confirms, the phone sends what was ticked.

## Rules the editor and the import enforce

- **1 to 10 chapters**, each with **1 to 10 questions**. A chapter with no questions blocks new sessions until it gets a question or is retired.
- Option ids are `A` to `F`, in order, with no gaps (shown on screen as أ ب ج د هـ و). Option texts are 1 to 120 characters and must differ from each other.
- Right answers go in `correctOptionIds` (a list, even for one answer).
- Ids use lower-case letters, digits, `-` or `_` (chapters up to 40 characters, questions up to 60; for example `ch2-q4`). Reusing an id updates that question; a new id adds one. The editor makes ids itself (`ch5`, `ch5-q3`).
- Chapter title up to 120 characters, description up to 300. Question text up to 300 characters, explanation up to 400, source up to 200, `durationSeconds` from 5 to 120 (default 20; 30 for multiple choice).

`question-bank.template.json` shows the file format (`"format": 2`) with one example of each type.

**Older files still import.** A question with `correctOptionId` (one letter) and no `type` is read as single choice, so banks downloaded before the editor existed import unchanged.

## Writing good questions for a 20-second phone quiz

- Test a behaviour the advisor must perform (verify the mobile number, never ask for a score), not trivia.
- Keep the question under about 90 characters and each option under about 45, so it reads in time in a second language.
- Make every wrong option plausible, and keep options a similar length (the longest option is often guessed as right).
- Spread the right answer across the positions.
- **Multiple choice:** use it for "which of these…" questions with 2 or 3 right answers out of 4 or 5. All-or-nothing scoring is strict, so make each option clearly right or clearly wrong against the source, and tell the room how it works before the first one. Avoid "all of the above".
- **True / false:** a guess is right half the time, so use it sparingly, for a single clear fact or a common misconception. Avoid negatives ("ليس…") in the statement.
- Avoid facts that are still provisional in the source deck (figures marked "Pending input"); they change and make the bank wrong.
- Write the explanation as the teaching point: it is shown on the big screen at every reveal.

## Current bank (October 2026)

20 questions written from `NPS_Orientation_Service_Advisors_EN_Draft.pptx` (Draft v0.1 for Academy review), five per chapter: Customer Data Platform, NPS 1.0 Measurement, NPS 2.0 Management, CX Microservices. The file with answers was handed over privately; review it with the Academy before the deck is approved, and re-import if the deck changes.

From 14 October 2026 the live bank was the Arabic version (`2026-10-14.2-ar`): same ids, same correct letters, Arabic text. Terms used: المروجون / المحايدون / المنتقدون (promoters / passives / detractors), السجل الذهبي (Golden Record), أمر العمل (job card), فحص مركبة العميل (CVI), اتفاقية الإصلاح الرقمية (DRA). Sessions created before the switch keep their English questions.

Since 15 October 2026, 13:24 Riyadh time, the live bank is the AR Final version (`2026-10-15.1-ar-final`, written from the AR Final deck; the file `question-bank-ar-final-2026-10-15.private.json` was handed over privately). Same ids; the right letter moved in six questions (ch2-q1, ch2-q3, ch3-q1, ch3-q3, ch4-q1, ch4-q3). Sessions created before the import keep the earlier Arabic questions.

Two questions, ch1-q4 and ch3-q2, rest on points the AR Final deck has not settled (a figure on slide 8, and slides 26 and 31 disagreeing on one step). If the deck changes, change those questions. The details are in the private handover notes, not here, because they give away answers.
