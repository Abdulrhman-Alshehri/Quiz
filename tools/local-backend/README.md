# Local test backend

A stand-in for the Supabase project, so changes that touch the database can be built and tested without touching the live one. It exists because the free Supabase organisation already has its two active projects, which leaves no room for a separate test project.

## What it is

- **PostgreSQL 16** with Supabase-like roles (`anon`, `authenticated`, `service_role`, `authenticator`), `pgcrypto` in the `extensions` schema, and every migration in `supabase/migrations`, applied in order (`bootstrap.sql`, then `reset-db.sh`).
- **`server.mjs`**, a small Node server that answers the requests this site makes to the Data API:
  - `POST /rest/v1/rpc/<function>` runs the database function as `anon`, one transaction per request, with the request headers available to the function, as PostgREST does. Errors come back in PostgREST's shape (`code`, `message`, `details`, `hint`) with matching HTTP status codes.
  - Basic table requests (`GET`, `POST`, `PATCH`, `DELETE /rest/v1/<table>`), so the tests can confirm that the public key cannot read or change tables directly.

## What it is not

- **No Realtime.** WebSocket connections are refused, so the site falls back to polling, as it does in production when Realtime is down. Everything works, a little slower; Realtime itself is only tested on the live project.
- **Not PostgREST.** Only the request shapes this site uses are supported. A problem that only PostgREST would show (schema cache, choosing between functions with the same name) would not appear here. That is why go-live includes a live check (`docs/GO_LIVE_QUESTION_EDITOR.md`).
- No Auth, Storage or Edge Functions; the quiz does not use them.

## Run it

1. PostgreSQL 16 listening on `localhost:54322`, with a `postgres` superuser that can connect without a password (any install method).
2. `npm install`
3. `npm run local:db` rebuilds the database `quiz` from scratch. It refuses any server that is not on localhost. Settings (environment variables):
   - `BANK_FILE`: question bank to import (default `question-bank/question-bank.template.json`). To test with the real questions, download the bank from the console and point to that file; keep it out of the repository (`*.private.json` is ignored).
   - `ADMIN_PASSCODE`: presenter passcode (default `local-dev-passcode`).
   - `PG_ADMIN_URL`, `DB_NAME`: server and database name, if different.
4. `npm run local:api` serves the Data API on `http://localhost:54321` (`PORT` and `DATABASE_URL` to change).
5. Point a build at it with a `.env.production.local` file (git-ignored):

   ```
   VITE_SUPABASE_URL=http://localhost:54321
   VITE_SUPABASE_PUBLISHABLE_KEY=local-dev-publishable-key-000000
   ```

   Any key of 21 characters or more works; the stand-in does not check it. While this file exists, every local `npm run build` talks to the local backend. GitHub Actions never sees it, so deploys are not affected.
6. `npm run build && npm run preview`, then open `http://localhost:4173/`.

## Tests against it

```bash
export SUPABASE_URL=http://localhost:54321 SUPABASE_KEY=local-dev-publishable-key-000000 ADMIN_PASSCODE=local-dev-passcode
npm test                                                     # unit, 47
ALLOW_BANK_CHANGES=1 npm run test:api                         # backend, 104 (61 without the variable)
BASE_URL=http://localhost:4173/ npm run test:e2e                # browsers, 25
ALLOW_BANK_CHANGES=1 BASE_URL=http://localhost:4173/ npm run test:e2e:editor   # editor and question types, 28
```

The two bank-editing runs change the question bank (the backend test puts the original back at the end; the editor test leaves a retired `[Test]` chapter). They refuse to run against the live project. Run `npm run local:db` again for a clean start.

If a browser test cannot reach `localhost` behind a proxy, set `NO_PROXY=localhost,127.0.0.1`.

## Upgrade check for a new migration

```bash
BANK_FILE=path/to/bank.private.json npm run local:upgrade-check
```

Builds a separate database (`quiz_upgrade`) from every migration except the newest, opens a session and plays one question, applies the newest migration while the session waits, then plays the next question with both the old and the new answer call and checks results, question analysis and the screens (12 checks). The bank file must be one the older database accepts, such as one downloaded from the live console. The extra database and its server (port 54331) are removed at the end.

To check that the current site works on a new database, build `main` in a separate worktree against the local backend and run its own `test:api` and `test:e2e` (as done on 15 October for the question editor).
