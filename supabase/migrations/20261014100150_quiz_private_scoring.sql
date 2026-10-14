-- NPS Live Quiz: standings, per-chapter results and closing a question.

-- Standings for a session. Only answers to revealed questions count, so the
-- leaderboard never leaks whether an open question was answered correctly
-- (unless the session uses immediate feedback). Ties: points, correct answers,
-- average response time, join time, participant id.
create or replace function app_private.leaderboard(p_session_id uuid)
returns table (
  participant_id     uuid,
  display_name       text,
  joined_at          timestamptz,
  last_seen_at       timestamptz,
  total_points       int,
  correct_count      int,
  incorrect_count    int,
  timed_out_count    int,
  answered_count     int,
  accuracy           numeric,
  avg_response_ms    int,
  chapters_completed int,
  chapter_points     jsonb,
  rank               int)
language sql stable set search_path = '' as $$
  with s as (
    select coalesce(se.settings->>'feedbackMode', 'on_reveal') as fm
    from public.sessions se where se.id = p_session_id
  ),
  qn as (
    select q.chapter_id, count(*)::int as n
    from public.session_questions q where q.session_id = p_session_id
    group by q.chapter_id
  ),
  a as (
    select a.participant_id, a.chapter_id, a.status, a.is_correct, a.points_awarded, a.response_time_ms
    from public.answers a
    join public.session_questions q on q.session_id = a.session_id and q.question_id = a.question_id
    cross join s
    where a.session_id = p_session_id
      and a.voided_at is null
      and (q.revealed_at is not null or s.fm = 'immediate')
  ),
  per_p as (
    select p.id as participant_id, p.display_name, p.joined_at, p.last_seen_at,
           coalesce(sum(a.points_awarded), 0)::int                          as total_points,
           (count(*) filter (where a.is_correct))::int                       as correct_count,
           (count(*) filter (where a.status = 'answered' and not a.is_correct))::int as incorrect_count,
           (count(*) filter (where a.status = 'timed_out'))::int             as timed_out_count,
           (count(*) filter (where a.status = 'answered'))::int              as answered_count,
           avg(a.response_time_ms) filter (where a.status = 'answered')      as avg_rt
    from public.participants p
    left join a on a.participant_id = p.id
    where p.session_id = p_session_id and p.removed_at is null
    group by p.id, p.display_name, p.joined_at, p.last_seen_at
  ),
  per_c as (
    select a.participant_id, a.chapter_id, sum(a.points_awarded)::int as pts, count(*)::int as cnt
    from a group by a.participant_id, a.chapter_id
  ),
  per_c_agg as (
    select c.participant_id,
           jsonb_object_agg(c.chapter_id, c.pts) as chapter_points,
           (count(*) filter (where c.cnt >= qn.n))::int as chapters_completed
    from per_c c join qn on qn.chapter_id = c.chapter_id
    group by c.participant_id
  )
  select pp.participant_id, pp.display_name, pp.joined_at, pp.last_seen_at,
         pp.total_points, pp.correct_count, pp.incorrect_count, pp.timed_out_count, pp.answered_count,
         case when (pp.correct_count + pp.incorrect_count + pp.timed_out_count) > 0
              then round(100.0 * pp.correct_count / (pp.correct_count + pp.incorrect_count + pp.timed_out_count), 1)
              else 0 end,
         round(pp.avg_rt)::int,
         coalesce(ca.chapters_completed, 0),
         coalesce(ca.chapter_points, '{}'::jsonb),
         (row_number() over (order by pp.total_points desc, pp.correct_count desc,
                                      pp.avg_rt asc nulls last, pp.joined_at asc, pp.participant_id asc))::int
  from per_p pp
  left join per_c_agg ca on ca.participant_id = pp.participant_id
$$;

-- Per-chapter results for one participant (same reveal rule as the leaderboard).
create or replace function app_private.participant_chapter_stats(p_session_id uuid, p_participant_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  with s as (
    select coalesce(se.settings->>'feedbackMode', 'on_reveal') as fm
    from public.sessions se where se.id = p_session_id
  ),
  a as (
    select a.chapter_id, a.status, a.is_correct, a.points_awarded, a.response_time_ms
    from public.answers a
    join public.session_questions q on q.session_id = a.session_id and q.question_id = a.question_id
    cross join s
    where a.session_id = p_session_id and a.participant_id = p_participant_id
      and a.voided_at is null
      and (q.revealed_at is not null or s.fm = 'immediate')
  )
  select coalesce(jsonb_object_agg(c.chapter_id, jsonb_build_object(
           'points',        coalesce((select sum(x.points_awarded) from a x where x.chapter_id = c.chapter_id), 0),
           'correct',       (select count(*) from a x where x.chapter_id = c.chapter_id and x.is_correct),
           'answered',      (select count(*) from a x where x.chapter_id = c.chapter_id and x.status = 'answered'),
           'timedOut',      (select count(*) from a x where x.chapter_id = c.chapter_id and x.status = 'timed_out'),
           'seen',          (select count(*) from a x where x.chapter_id = c.chapter_id),
           'avgResponseMs', (select round(avg(x.response_time_ms))::int from a x
                             where x.chapter_id = c.chapter_id and x.status = 'answered'))), '{}'::jsonb)
  from public.session_chapters c
  where c.session_id = p_session_id
$$;

-- Close the open question: record time-outs for everyone without an answer and
-- move the session to the reveal phase. Caller must hold the session row lock.
create or replace function app_private.reveal_current(p_session_id uuid)
returns void language plpgsql volatile set search_path = '' as $$
declare
  v_s public.sessions;
begin
  select * into v_s from public.sessions where id = p_session_id for update;
  if not found or v_s.phase <> 'question' or v_s.active_question_id is null then
    return;
  end if;

  insert into public.answers (session_id, participant_id, question_id, chapter_id,
                              selected_option_id, status, is_correct, points_awarded,
                              response_time_ms, submitted_at)
  select v_s.id, p.id, q.question_id, q.chapter_id, null, 'timed_out', false, 0, null, now()
  from public.participants p
  join public.session_questions q on q.session_id = v_s.id and q.question_id = v_s.active_question_id
  where p.session_id = v_s.id
    and p.removed_at is null
    and not exists (select 1 from public.answers a
                    where a.participant_id = p.id and a.question_id = q.question_id and a.voided_at is null)
  on conflict do nothing;

  update public.session_questions
     set revealed_at = now()
   where session_id = v_s.id and question_id = v_s.active_question_id;

  update public.sessions
     set phase = 'reveal', paused = false, paused_remaining_ms = null,
         version = version + 1, updated_at = now()
   where id = v_s.id;
end $$;
