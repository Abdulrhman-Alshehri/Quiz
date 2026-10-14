# NPS Live Quiz

A live, phone-based quiz with a leaderboard for the **service advisor NPS orientation workshop**. A presenter runs four chapters of five timed multiple-choice questions; advisors join by scanning a QR code and typing a name, with no accounts or passwords. The answer keys, deadlines and scoring all run in the database, so participants cannot see answers early or change their scores.

- **Frontend:** React 18 + Vite, plain CSS, hosted on GitHub Pages (static).
- **Look and feel:** follows the NPS orientation deck: Almajdouie logo, brand blue `#134A9C` bands and section pages, light grey pages with white cards, and Calibri (Carlito, an open font with the same metrics, where Calibri is not installed). Styles are in `src/styles.css`; the logo is `src/assets/almajdouie-logo-white.png`.
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
- **Nothing is erased by the app.** Resets void answers (kept for audit), sign-outs expire tokens, and importing a new question bank retires old questions with a date.

### Scoring

Default (the PRD formula), for a correct answer:

`points = round(1000 × remaining time ÷ question time)`, so 1,000 for an instant answer and 0 at the deadline. Wrong and unanswered questions score 0.

Optional per session, **"Knowledge first, speed as a bonus"**: `round(1000 × (1 − (elapsed ÷ question time) ÷ 2))`, so a correct answer earns 500 to 1,000. This keeps someone who knows the content from losing to someone who guesses fast. With the PRD formula, 5 correct slow answers (15 s of 20) earn 1,250 while 3 correct fast answers (2 s) earn 2,700.

Leaderboard ties are broken by: correct answers, then average response time, then join time, then participant id.

### What the presenter can do

Create sessions; open and close joining; show the QR code and links; start chapters; launch, pause, resume and reveal questions; run questions automatically; see live answer counts and the full leaderboard; remove a participant (for example an inappropriate name); reset a chapter or the session (typed confirmation); end the session; download two CSVs (results per participant, analysis per question); import and download the question bank; change the passcode.

---

## 2. Repository layout

```
src/
  pages/          Landing, Join, Play (participant), Screen (projector), AdminHome, AdminSession, Setup
  components/     Plate (join code), Timer, Options, QrCode, Leaderboard, ConfirmDialog, ui
  lib/            api (database functions), useFeed (Realtime + polling), clock, router, storage, errors
  utils/          scoring (mirror of the database formula), csv (safe export), exports, names, format
supabase/migrations/   SQL for tables, security and functions (apply in file-name order)
question-bank/         Format and an empty template (the real bank with answers is NOT stored here)
tests/unit/            Vitest unit tests (scoring, CSV safety, names, error mapping)
tests/api/             Backend test against a real project (59 checks)
tests/e2e/             Browser test: presenter, big screen and three phones (25 checks)
docs/                  Facilitator guide and test checklist
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
5. Sign in to the presenter console and use **Question bank → Import a new bank** with your bank file (see `question-bank/README.md`).

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

### Backend and browser tests (against a real project)

```bash
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_KEY=<publishable key> ADMIN_PASSCODE=... npm run test:api
ADMIN_PASSCODE=... BASE_URL=http://localhost:4173/ npm run test:e2e
```

Both create sessions titled `[Test] …` and end them. Remove them later from the Supabase Table Editor if you want a clean list.

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
- **English only.** The interface and questions are in English. Arabic names display correctly, but an Arabic interface is not built.

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
