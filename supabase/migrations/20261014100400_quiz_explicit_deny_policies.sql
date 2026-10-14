-- NPS Live Quiz: make "no direct access" explicit.
-- These tables are only reached through the database functions. Row-level
-- security already denies everything when no policy exists; these policies
-- state that intent so a reviewer (or the Supabase advisor) can see it.
create policy "No direct access; use the quiz functions" on public.bank_chapters
  for all to anon, authenticated using (false) with check (false);
create policy "No direct access; use the quiz functions" on public.bank_questions
  for all to anon, authenticated using (false) with check (false);
create policy "No direct access; use the quiz functions" on public.session_chapters
  for all to anon, authenticated using (false) with check (false);
create policy "No direct access; use the quiz functions" on public.session_questions
  for all to anon, authenticated using (false) with check (false);
create policy "No direct access; use the quiz functions" on public.participants
  for all to anon, authenticated using (false) with check (false);
create policy "No direct access; use the quiz functions" on public.answers
  for all to anon, authenticated using (false) with check (false);
