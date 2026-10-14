# Test checklist

PRD deliverable 5. "Automated" items run with `npm run test:api` (backend, 59 checks) and `npm run test:e2e` (browsers, 25 checks) against the live Supabase project; unit tests run with `npm test` (24 tests) on every deploy.

Last full run: 14 October 2026, all automated checks passing.

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
| Unauthorised admin access | Every admin function refuses a forged token; logout invalidates the token; wrong passcode refused | Automated (api, e2e) | Pass |
| Direct database access | Answer keys, answers, participant tokens and question bank unreadable with the public key; no direct inserts or updates | Automated (api) | Pass |
| Reset and restart | Chapter reset voids answers and zeroes scores; confirmation word required; new session keeps results separate | Automated (api) | Pass |
| Pause and resume | Answers refused while paused; deadline moves forward on resume | Automated (api) | Pass |
| Registration and end | Closed joining refuses new names; ended session refuses joins and answers; phones show final position | Automated (api, e2e) | Pass |
| Name validation | Empty, whitespace-only and over-30-character names refused; duplicate names (any case) refused | Automated (api, e2e, unit) | Pass |
| Big screen privacy | No answer key or scores while a question is open; top 10 only | Automated (api, e2e) | Pass |
| Real phones on the live site | Scan the QR from the projector with iPhone and Android, on venue Wi-Fi and on mobile data | Manual, before each workshop | To do |
| Screen reader | VoiceOver / TalkBack read the question, answers and the result | Manual | To do |
| Load | 60+ phones in one session (Realtime free-plan limit is 100 messages per second) | Manual rehearsal | To do |
