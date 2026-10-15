# NPS Live Quiz

A live, phone-based quiz with a leaderboard for the **service advisor NPS orientation workshop**. The whole site, the questions and the exports are in **Arabic** (right to left). A presenter runs chapters of timed questions (single choice, multiple choice and true/false) that are written and edited in the presenter console; advisors join by scanning a QR code and typing a name, with no accounts or passwords. The answer keys, deadlines and scoring all run in the database, so participants cannot see answers early or change their scores.

- **Frontend:** React 18 + Vite, plain CSS, hosted on GitHub Pages (static).
- **Look and feel:** follows the NPS orientation deck: Almajdouie logo, brand blue `#134A9C` bands and section pages, light grey pages with white cards. Latin letters and digits use Calibri (Carlito, an open font with the same metrics, where Calibri is not installed); Arabic uses IBM Plex Sans Arabic (open licence). Numbers stay in Western digits (0–9), as on the deck. Styles are in `src/styles.css`; the logo is `src/assets/almajdouie-logo-white.png`.
- **Backend:** Supabase (Postgres, row-level security, database functions, Realtime).
- **Live site:** https://abdulrhman-alshehri.github.io/Quiz/ (the path is case-sensitive: `/Quiz/`, not `/quiz/`).
- **Permanent join link for slides:** https://abdulrhman-alshehri.github.io/Quiz/#/join (always opens the newest open session).

| Screen | Address | Who |
|---|---|---|
| Start page | `#/` | Anyone |
| Join | `#/join?code=ABC234` (from the QR code) or `#/join` (newest open session) | Participants |
| Play | `#/play` | Participants (opens after joining) |
| Big screen | `#/screen/ABC234` | Projector (opened from the console) |
| Presenter console | `#/admin` | Presenter (passcode) |
| Question bank editor | `#/admin/bank` | Presenter (passcode) |

For running a workshop, see the [facilitator guide](docs/FACILITATOR_GUIDE.md).

---

## 1. How it works

```
 Phones (participants)        Projector (big screen)        Laptop (presenter console)
        │  join, answer               │  read-only                   │  passcode-protected
        └──────────────┬──────────────┴──────────────┬───────────────┘
                       │ HTTPS: database functions (RPC) only
                       ▼
            Supabase Postgres ─ Realtime (pushes "session changed") ─► all screens refetch
```

- **One authoritative clock.** When the presenter launches a question, the database sets `question_started_at` (after a 4-second "read the question" lead-in) and `question_deadline`. Phones draw the countdown from that deadline, corrected for their own clock drift. The database alone decides whether an answer arrived in time (deadline plus a 1-second network allowance).
- **Scoring in the database.** `submit_answer` looks up the private answer key, computes points from the database time and stores the answer once (a unique index rejects a second answer). The browser never sends a score.
- **Answers stay hidden until the reveal.** By default, nobody (including the leaderboard) learns whether an open question was answered correctly until the presenter reveals it. A session can be switched to show right/wrong immediately.
- **Live updates.** Every screen listens to Supabase Realtime for changes to its session and refetches. If Realtime is slow or blocked, each screen keeps polling (every 1.2 to 4 seconds), so the quiz keeps working.
- **Nothing is erased by the app.** Resets void answers (kept for audit), sign-outs expire tokens, and removing a question or chapter from the bank (or importing a new bank) retires it with a date; it can be restored.
- **Sessions copy the bank.** A session takes a copy of the bank when it is created, so editing the bank never changes a session that already exists.

### Scoring

Default (the PRD formula), for a correct answer:

`points = round(1000 × remaining time ÷ question time)`, so 1,000 for an instant answer and 0 at the deadline. Wrong and unanswered questions score 0.

Optional per session, **"Knowledge first, speed as a bonus"**: `round(1000 × (1 − (elapsed ÷ question time) ÷ 2))`, so a correct answer earns 500 to 1,000. This keeps someone who knows the content from losing to someone who guesses fast. With the PRD formula, 5 correct slow answers (15 s of 20) earn 1,250 while 3 correct fast answers (2 s) earn 2,700.

**Question types.** *Single choice* (اختيار واحد): one right answer, one tap. *True/false* (صح أو خطأ): the fixed options صح / خطأ, scored like single choice. *Multiple choice* (اختيار متعدد): two or more right answers; players tick every option they think is right, then press «تأكيد الإجابة». It is **all or nothing**: points only for exactly the set of right answers (one missing or one extra scores 0). If time runs out with options ticked but not confirmed, the phone sends them. Each question has 2 to 6 options (أ to و; ids A to F) and its own time (20 seconds by default, 30 for multiple choice), unless the presenter sets one time for the whole session.

Leaderboard ties are broken by: correct answers, then average response time, then join time, then participant id.

### What the presenter can do

Create sessions; open and close joining; show the QR code and links; start chapters; launch, pause, resume and reveal questions; run questions automatically; see live answer counts and the full leaderboard; remove a participant (for example an inappropriate name); reset a chapter or the session (typed confirmation); end the session; download two CSVs (results per participant, analysis per question); change the passcode.

**Question bank editor** (`#/admin/bank`, button «تحرير الأسئلة»): add, rename, reorder and retire chapters (1 to 10); add, edit, reorder and retire questions (1 to 10 per chapter); change a question's type, options, right answers, explanation, time and source; preview a question as phones show it; see each question's history and put back an earlier version; restore anything retired; import or download the whole bank as JSON. The database checks every save again. Each save carries the version it started from, so if two people edit the same question, the second save is refused instead of overwriting the first.

---

## 2. Repository layout

```
src/
  pages/          Landing, Join, Play (participant), Screen (projector), AdminHome, AdminSession, AdminBank (editor), Setup
  components/     Plate (join code), Timer, Options, QrCode, Leaderboard, ConfirmDialog, Modal, BankFile, DurationChoice, ui
  lib/            api (database functions), useFeed (Realtime + polling), clock, router, storage, errors
  utils/          scoring (mirror of the database formula), bank (editor rules), csv (safe export), exports, names, format
supabase/migrations/   SQL for tables, security and functions (apply in file-name order)
question-bank/         Format and a template (the real bank with answers is NOT stored here)
tools/local-backend/   Local PostgreSQL + Data API stand-in, to run everything without the live project; upgrade check for new migrations
tests/unit/            Vitest unit tests (scoring, editor rules, CSV safety, names)
tests/api/             Backend test (61 checks; 104 with ALLOW_BANK_CHANGES=1 on a test backend)
tests/e2e/             Browser tests: a live session (25 checks) and the editor with all question types (28 checks)
docs/                  Facilitator guide, test checklist, go-live runbook for the question editor
.github/workflows/     Build and deploy to GitHub Pages
```

---

## 3. Set up Supabase (only needed for a new project)

The production project (`nps-live-quiz`, region `eu-central-1`) is already set up with the migrations, the question bank and a presenter passcode. To build another copy:

1. Create a Supabase project.
2. In **SQL Editor**, run the files in `supabase/migrations/` one by one, in file-name order.
3. Set the presenter passcode (SQL Editor; replace the text in quotes):
   ```sql
   insert into app_private.admin_config (id, passcode_hash)
   values (1, extensions.crypt('YOUR-LONG-PASSCODE', extensions.gen_salt('bf', 10)))
   on conflict (id) do update set passcode_hash = excluded.passcode_hash, updated_at = now();
   ```
4. Put the project URL and **publishable** key (Project Settings → API Keys) in `.env.production`.
5. Sign in to the presenter console, open **تحرير الأسئلة**, and either write the questions there or import a bank file (see `question-bank/README.md`).

Both values in `.env.production` are public by design. Never put a `service_role` key, a secret key or the database password in this repository.

---

## 4. Deploy to GitHub Pages

One-time switch (repository owner):

1. Open **Settings → Pages** in this repository.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Open **Actions → Deploy to GitHub Pages → Run workflow** (or push any commit to `main`).

After that, every push to `main` runs the unit tests, builds and publishes. The site uses hash links (`#/join`), so direct links and refreshes never return a 404, and all asset paths are relative, so the build works at any Pages address.

**Check after each deploy:** open the site, open the presenter console, create a test session and scan the QR code with a phone. The QR code is generated from the address the console is opened at, so open the console from the live site, never from `localhost`.

---

## 5. Run locally

```bash
npm install
npm run dev            # http://localhost:5173
npm test               # unit tests
npm run build && npm run preview   # production build on http://localhost:4173
```

To point a local copy at a different project, create `.env.local` from `.env.example`.

### Local backend (no live project needed)

`tools/local-backend` runs the migrations on a local PostgreSQL and serves the same database functions the site calls, so every change can be built and tested without touching the live project. See `tools/local-backend/README.md`. In short:

```bash
npm run local:db                      # rebuild the local database (migrations, passcode, bank)
npm run local:api                     # Data API stand-in on http://localhost:54321
# .env.production.local: VITE_SUPABASE_URL=http://localhost:54321, VITE_SUPABASE_PUBLISHABLE_KEY=<any 21+ characters>
npm run build && npm run preview
```

### Backend and browser tests

```bash
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_KEY=<publishable key> ADMIN_PASSCODE=... npm run test:api
ADMIN_PASSCODE=... BASE_URL=http://localhost:4173/ npm run test:e2e
# Editor and question types: they change the bank, so test backends only
ALLOW_BANK_CHANGES=1 SUPABASE_URL=http://localhost:54321 SUPABASE_KEY=local-dev-key-000000000000 ADMIN_PASSCODE=local-dev-passcode npm run test:api
ALLOW_BANK_CHANGES=1 ADMIN_PASSCODE=local-dev-passcode BASE_URL=http://localhost:4173/ npm run test:e2e:editor
```

With `ALLOW_BANK_CHANGES=1` both tests refuse to run against the live project, and against any other hosted Supabase project unless `ALLOW_REMOTE_BANK_CHANGES=1` is also set. The browser test checks where the site it opens actually sends its requests, so a local build made without `.env.production.local` (which talks to the live project) is refused too.

The tests read the right answers from the bank, so they work with any bank. They create sessions titled `[Test] …` and end them. Remove them later from the Supabase Table Editor if you want a clean list. Never run them against the live project during a workshop: while a test runs, its `[Test]` session is the newest open session, so the permanent join link on the slides (`#/join`) opens the test instead of the workshop.

The browser test also accepts `ADMIN_TOKEN` instead of `ADMIN_PASSCODE`: a valid presenter sign-in token (for example the `token` value stored under `npsquiz:admin` in a signed-in browser). It then skips the two passcode checks, so the passcode itself never has to be shared.

---

## 6. Security model

| Data | Who can read it | How it is protected |
|---|---|---|
| Answer keys (`bank_questions`, `session_questions`) | Presenter only, through `admin_*` functions | Row-level security with no public policy; table privileges revoked |
| Answers, participants, tokens | Nobody directly | Same; participants see only their own results through `get_participant_state` |
| Session row (`sessions`) | Anyone with the key | Readable for Realtime; holds no answers, tokens or personal data |
| Presenter passcode, admin tokens, sign-in attempts | Nobody | `app_private` schema, not exposed by the API; passcode stored as a bcrypt hash; tokens stored as SHA-256 hashes, valid 12 hours |

- Every write goes through a database function with a fixed `search_path`.
- After 8 wrong passcodes from one network in 15 minutes, sign-in is blocked for that network.
- Participant names are stored per session. Results can be exported for reporting. Decide a retention period with your data protection lead: names and scores of employees are personal data under the Saudi PDPL, and this project stores them in Frankfurt (`eu-central-1`), because Supabase offers no Saudi region.

---

## 7. Limits to know before a workshop

- **Free-plan pause.** Supabase pauses free projects after about a week with no activity. Open the presenter console the day before each workshop; if the project is paused, restore it from the Supabase dashboard. For regular use, the Pro plan removes the pause.
- **Free-plan Realtime limits:** 200 concurrent connections and 100 messages per second. Each state change sends one message to every screen, so above about 80 phones some updates may arrive by polling instead (1 to 4 seconds later). The 4-second lead-in absorbs that delay before answers open.
- **Network.** Phones need internet access to `*.supabase.co` and `*.github.io`. Corporate Wi-Fi sometimes blocks these; mobile data is the fallback.
- **One phone, one place.** A participant's place is saved in the phone's browser. Private browsing or clearing site data means joining again under a new name.
- **Arabic only.** The interface, the question bank and the CSV headers are in Arabic. Join codes stay in Latin letters and digits so they are easy to type on any keyboard. Answer options show as أ ب ج د هـ و; their ids in the database are A to F.
- **Edit before you create the session.** A session copies the bank when it is created. After editing questions, create a new session for the workshop.

---

## 8. Troubleshooting

| Problem | Fix |
|---|---|
| The page says "not connected to its database" | `.env.production` is missing values; set them and push. |
| "No quiz uses that code" | The session was ended or the code was mistyped; the code is on the big screen. |
| Phones stuck on "Reconnecting…" | Network blocked. Switch phones to mobile data. Answers already sent are saved. |
| Console says "sign-in has expired" | Sign in again; tokens last 12 hours. |
| Someone joined with the wrong name | Remove them in the console leaderboard; they can join again. |
| A question was launched by mistake | Reveal it, then reset the chapter (answers are voided, not lost) and start again. |
| Wrong passcode too many times | Wait 15 minutes, or change the passcode with the SQL in section 3. |
| "لا يمكن إنشاء جلسة بعد" when creating a session | The bank has a chapter with no questions (or none at all). The message names it; add a question in «تحرير الأسئلة» or retire that chapter. |
| "تغيّر هذا العنصر من جهاز آخر" when saving a question | Someone saved the same question after you opened it. Press «افتح أحدث نسخة», check their change, and edit again. |
