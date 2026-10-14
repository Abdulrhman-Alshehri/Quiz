# Question bank

The questions live in the database, not in this repository. This repository is public, and a file with the answer key would let anyone read the answers before a session.

- **See or download the current bank:** presenter console → Question bank → Download bank (JSON). The file contains the answer key; keep it in a restricted folder.
- **Replace the bank:** edit that file, then presenter console → Question bank → Import a new bank. The whole file is checked before anything changes. Questions that are not in the new file are retired with a date, not deleted. Sessions that already exist keep the questions they started with.

## Rules the import enforces

- Exactly **4 chapters**, each with exactly **5 questions**.
- Each question has exactly **4 options** with ids `A`, `B`, `C`, `D` in that order, and one `correctOptionId`.
- Ids use lower-case letters, digits, `-` or `_` (for example `ch2-q4`). Reusing an id updates that question; a new id adds one.
- Question text up to 300 characters, options up to 120, explanation up to 400, `durationSeconds` from 5 to 120 (default 20).

`question-bank.template.json` shows the format with placeholder text.

## Writing good questions for a 20-second phone quiz

- Test a behaviour the advisor must perform (verify the mobile number, never ask for a score), not trivia.
- Keep the question under about 90 characters and each option under about 45, so it reads in time in a second language.
- Make every wrong option plausible, and keep options a similar length (the longest option is often guessed as right).
- Spread the correct letter across A to D.
- Avoid facts that are still provisional in the source deck (figures marked "Pending input"); they change and make the bank wrong.
- Write the explanation as the teaching point: it is shown on the big screen at every reveal.

## Current bank (October 2026)

20 questions written from `NPS_Orientation_Service_Advisors_EN_Draft.pptx` (Draft v0.1 for Academy review), five per chapter: Customer Data Platform, NPS 1.0 Measurement, NPS 2.0 Management, CX Microservices. The file with answers was handed over privately; review it with the Academy before the deck is approved, and re-import if the deck changes.
