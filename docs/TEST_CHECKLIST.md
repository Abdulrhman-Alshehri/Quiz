# Test checklist

PRD deliverable 5. "Automated" items run with `npm run test:api` (backend: 61 checks; 104 with `ALLOW_BANK_CHANGES=1` on a test backend), `npm run test:e2e` (browsers, 25 checks) and `npm run test:e2e:editor` (editor and question types, 28 checks, test backends only); unit tests run with `npm test` (47 tests) on every deploy.

Last full run: 14 October 2026, all automated checks passing, including the browser test against the live site (https://abdulrhman-alshehri.github.io/Quiz/, 25/25) with Supabase Realtime connected.

After the restyle to the deck look (14 October 2026, evening): unit tests 24/24; browser test 24/24 locally and against the live site, run with a temporary presenter token instead of the passcode, so the two passcode checks were skipped (the passcode itself is unchanged and was last verified in the earlier run). The blue QR codes on the big screen decode correctly at full, 60% and 150% size.

Question editor and question types (15 October 2026, branch `feature/question-editor`): all suites pass on the local test backend (`tools/local-backend`) loaded with a copy of the current live bank (AR Final), and again with the earlier Arabic bank and the mixed-type template: unit 47/47, backend 104/104 (61/61 without the bank-editing part; 60/60 with a presenter token instead of the passcode), browser 25/25 and 28/28. Upgrade checks: the current site's own tests pass against the new database (backend 59/59, browser 25/25), and a session left open across the migration carries on (12/12).

Go-live, 15 October 2026 (details in `docs/GO_LIVE_QUESTION_EDITOR.md`): database migrated about 15:30 Riyadh time, site published 15:38. Against the live site and database, with temporary presenter tokens: browser 24/24 (passcode check skipped), backend 60/60 (bank-editing part not run on live), and a live multiple-choice check 16/16 (exact set scores; a partial set or an extra option scores 0; second answer counted once; unknown option refused). The presenter's first three edits in the editor (15:40 to 15:41) saved and logged correctly. Not yet done: the manual check on real phones.

| Area | What is checked | How | Result |
|---|---|---|---|
| Multiple participants on separate devices | Presenter, big screen and three phones in separate browsers follow the same session through a chapter | Automated (e2e) | Pass |
| Simultaneous answers | 16 answers sent at the same moment: 15 people accepted, one person's double answer counted once | Automated (api) | Pass |
| Timer expiry | Answer during the lead-in refused; answer after deadline + grace refused; no answer recorded as timed out with 0 points | Automated (api, e2e) | Pass |
| Duplicate submissions | Second answer refused with `ALREADY_ANSWERED`; score unchanged | Automated (api) | Pass |
| Refresh and reconnect | Phone reloaded mid-question keeps its place and its locked answer | Automated (e2e) | Pass |
| Scoring | Points equal `round(1000 × remaining ÷ total)`; faster correct answer scores more; wrong = 0; half-floor mode ≥ 500 | Automated (api, unit) | Pass |
| Leaderboard tie-breaking | Order by points, then correct answers, then response time, then join time | Automated (api, unit) | Pass |
| CSV export | Header, one row per participant, chapter scores, formula-injection guard, UTF-8 for Arabic names | Automated (e2e, unit) | Pass |
| Unauthorised admin access | Every admin function refuses a forged token (all 31 on the editor branch); logout invalidates the token; wrong passcode refused | Automated (api, e2e) | Pass |
| Direct database access | Answer keys, answers, participant tokens and question bank unreadable with the public key; no direct inserts or updates | Automated (api) | Pass |
| Reset and restart | Chapter reset voids answers and zeroes scores; confirmation word required; new session keeps results separate | Automated (api) | Pass |
| Pause and resume | Answers refused while paused; deadline moves forward on resume | Automated (api) | Pass |
| Registration and end | Closed joining refuses new names; ended session refuses joins and answers; phones show final position | Automated (api, e2e) | Pass |
| Name validation | Empty, whitespace-only and over-30-character names refused; duplicate names (any case) refused | Automated (api, e2e, unit) | Pass |
| Big screen privacy | No answer key or scores while a question is open; top 10 only | Automated (api, e2e) | Pass |
| Question types | Single choice, true/false and multiple choice play end to end; multiple choice scores only the exact set (a missing or extra option scores 0); ticked-but-unconfirmed options are sent at time-out; reveals mark every right answer and what was missed; counts per option | Automated (api, e2e, unit); live multiple-choice check | Pass (local and live) |
| Bank editor | Add, edit, reorder, retire and restore chapters and questions; 14 kinds of invalid question refused with a reason; limits (10 chapters, 10 questions, 2-6 options); history and revert; a stale save refused instead of overwriting; empty chapter blocks new sessions; sessions keep their copy after edits | Automated (api, e2e) | Pass (local); in use on live since 15 October |
| Bank import | Old file format (one right answer, four options) and new format both import; bad files refused, naming the question; more than 10 chapters refused | Automated (api) | Pass (local) |
| Editor on a phone | The editor page fits a 390 px screen without sideways scrolling | Automated (e2e) | Pass (local) |
| Upgrade without downtime | The current site works on the new database; a session open during the migration keeps its answers and points and carries on; an answer from a page loaded before the update still scores | Automated (`main`'s tests on the new database; `npm run local:upgrade-check`) | Pass (local) |
| Test safety | Tests that edit the bank refuse the live project, including a local build that would talk to it | Automated (guard) | Pass |
| Real phones on the live site | Scan the QR from the projector with iPhone and Android, on venue Wi-Fi and on mobile data | Manual, before each workshop | To do |
| Screen reader | VoiceOver / TalkBack read the question, answers and the result | Manual | To do |
| Load | 60+ phones in one session (Realtime free-plan limit is 100 messages per second) | Manual rehearsal | To do |
