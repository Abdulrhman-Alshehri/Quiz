# Facilitator guide: running the NPS Live Quiz

One page for the person running the workshop. You need: a laptop with the presenter console, a projector showing the big screen, and phones for participants.

## The day before

1. Open the live site, then **Presenter console**, and sign in. If the console does not load, the free Supabase project may be paused: ask the project owner to restore it in the Supabase dashboard (it takes a few minutes).
2. Create a session (for example "NPS orientation, Riyadh, 15 Oct"). Keep 20 seconds per question unless the group reads English slowly; 25 to 30 seconds is fair for second-language readers.
3. Scan the QR code with your own phone, join as "Test", and play one question: launch it, answer, reveal. Then use **Reset the whole session** (type RESET) so the test does not count.
4. Check the room's Wi-Fi reaches the site on a phone. If it does not, plan to ask everyone to use mobile data.

## Room set-up

- **Laptop:** the presenter console. Never project it: it shows the answer key.
- **Projector:** click **Open big screen** in the console and drag that window to the projector (full screen with F11).
- Keep the console open for the whole session, especially in automatic mode.

## Running it

| Step | Presenter does | Room sees |
|---|---|---|
| Arrival | Leave the session on the waiting room | QR code, join code and names as people join |
| After each chapter of the deck | Press **Start chapter N** | Chapter title on the big screen and phones |
| Each question | Press **Show question X of 5** | 4 seconds to read the question, then 4 answers and the timer |
| Timer ends | Press **Reveal the answer** (or let automatic mode do it) | Right answer, how the room answered and a one-line explanation |
| After question 5 | Press **Show chapter N results** | Leaderboard top 10; each phone shows its own score and rank |
| End of the workshop | Press **End session** and confirm | Final podium; every phone shows its final position |

The big button in the console always shows the next step. **Automatic mode** reveals when time is up (or when everyone has answered) and moves on after 8 seconds.

Use the 20 seconds after each reveal: the explanation on screen is the teaching moment. If most of the room got a question wrong, spend a minute on it before moving on.

## If something goes wrong

- **A phone shows "Reconnecting…":** the answer already sent is saved; ask them to switch to mobile data or reload.
- **Someone refreshes or closes the page:** they open the same link again and continue where they were.
- **An inappropriate or duplicate name:** remove it in the console leaderboard.
- **You need to stop the clock:** **Pause timer**, then **Resume timer**.
- **A chapter ran badly** (wrong chapter, network failure): reveal the open question, then **Reset** that chapter and start it again. Answers are voided, not lost.
- **Running out of time:** **Skip the rest of this chapter** shows the results straight away.

## After the session

1. **Download results (CSV):** one row per participant with chapter scores, total, accuracy and completion.
2. **Download question analysis (CSV):** one row per question with how many chose each option. A question most people got wrong points to content to re-teach, or to a badly worded question.
3. Store the files according to your data retention rules; they contain names.

Players see only the top 10 on the big screen; nobody is shown last in front of the room.
