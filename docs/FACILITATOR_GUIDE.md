# Facilitator guide: running the NPS Live Quiz

One page for the person running the workshop. You need: a laptop with the presenter console, a projector showing the big screen, and phones for participants. The site is in Arabic; button names below are quoted exactly as they appear.

## The day before

1. Open the live site, then **لوحة تحكم المقدم** (presenter console), and sign in with **دخول**. If the console does not load, the free Supabase project may be paused: ask the project owner to restore it in the Supabase dashboard (it takes a few minutes).
2. Finish any question edits first (see "Editing questions" below): a session copies the questions when it is created.
3. Create a session with **إنشاء الجلسة** (for example "ورشة تعريف NPS، الرياض، 15 أكتوبر"). Keep **كما في بنك الأسئلة** for the time per question (20 seconds, 30 for multiple choice); choose **مدة موحدة** only if you want one time for every question.
4. Scan the QR code with your own phone, join as "تجربة", and play one question: launch it, answer, reveal. Then use **إعادة تعيين الجلسة كاملة** (type تصفير to confirm) so the test does not count.
5. Check the room's Wi-Fi reaches the site on a phone. If it does not, plan to ask everyone to use mobile data.

## Editing questions

In the console, press **تحرير الأسئلة**. Each chapter is a card with its questions in order.

- **إضافة فصل** / **تعديل الفصل**: a chapter's title and the short description shown when it starts. Up to 10 chapters.
- **إضافة سؤال** / **تعديل**: the question, its type, 2 to 6 options, the right answer(s), the explanation shown after the reveal, the time and the source (for example the slide number). Up to 10 questions per chapter. Open **معاينة كما يراها المشارك** to see it as phones will.
- Types: **اختيار واحد** (one right answer, one tap); **اختيار متعدد** (two or more right answers; players tick and press «تأكيد الإجابة»; points only for exactly the right set); **صح أو خطأ** (fixed options صح / خطأ).
- **↑ ↓** move a chapter or question. **إيقاف** takes it out of new sessions without deleting it; **الموقوفة** at the bottom brings it back.
- **السجل** shows every saved version of a question; **استعادة هذه النسخة** puts an earlier one back.
- A chapter with no questions blocks new sessions; the page says which one.
- Edits do not change a session that already exists. Edit first, then create the workshop session.
- The page checks each question before saving (missing right answer, two options with the same text, a multiple-choice question with only one right answer…) and says what to fix.

## Room set-up

- **Laptop:** the presenter console. Never project it: it shows the answer key.
- **Projector:** click **فتح الشاشة الكبيرة** (open big screen) in the console and drag that window to the projector (full screen with F11).
- Keep the console open for the whole session, especially in automatic mode.

## Running it

| Step | Presenter does | Room sees |
|---|---|---|
| Arrival | Leave the session on the waiting room | QR code, join code and names as people join |
| After each chapter of the deck | Press **ابدأ الفصل N** (start chapter N) | Chapter title on the big screen and phones |
| Each question | Press **اعرض السؤال X من Y** (show question X of Y) | 4 seconds to read the question, then the answers and the timer. For multiple choice the screen says «اختر كل الإجابات الصحيحة، ثم اضغط «تأكيد الإجابة»» |
| Timer ends | Press **اكشف الإجابة** (reveal the answer), or let automatic mode do it | Right answer(s), how the room answered and a one-line explanation |
| After the chapter's last question | Press **اعرض نتائج الفصل N** (show chapter N results) | Leaderboard top 10; each phone shows its own score and rank |
| End of the workshop | Press **إنهاء الجلسة** (end session) and confirm | Final podium; every phone shows its final position |

The big button in the console always shows the next step. **الوضع التلقائي** (automatic mode) reveals when time is up (or when everyone has answered) and moves on after 8 seconds.

Use the seconds after each reveal: the explanation on screen is the teaching moment. If most of the room got a question wrong, spend a minute on it before moving on.

Before the first multiple-choice question, tell the room once: tick every right answer, then press «تأكيد الإجابة»; only the complete right set earns points. If someone forgets to confirm, the phone sends what they ticked when time runs out.

## If something goes wrong

- **A phone shows "جارٍ إعادة الاتصال…" (reconnecting):** the answer already sent is saved; ask them to switch to mobile data or reload.
- **Someone refreshes or closes the page:** they open the same link again and continue where they were.
- **An inappropriate or duplicate name:** remove it in the console leaderboard.
- **You need to stop the clock:** **إيقاف مؤقت** (pause), then **استئناف** (resume).
- **A chapter ran badly** (wrong chapter, network failure): reveal the open question, then **إعادة تعيين** (reset) that chapter and start it again. Answers are voided, not lost.
- **Running out of time:** **تخطي بقية هذا الفصل** (skip the rest of this chapter) shows the results straight away.

## After the session

1. **تنزيل النتائج (CSV)** (download results): one row per participant with chapter scores, total, accuracy and completion.
2. **تنزيل تحليل الأسئلة (CSV)** (download question analysis): one row per question with its type, the right answer(s) and how many chose each option (for multiple choice a person counts once for every option they ticked). A question most people got wrong points to content to re-teach, or to a badly worded question.
3. Store the files according to your data retention rules; they contain names. Column headers are in Arabic; Excel opens them correctly (the files are UTF-8 with a byte-order mark).

Players see only the top 10 on the big screen; nobody is shown last in front of the room.
