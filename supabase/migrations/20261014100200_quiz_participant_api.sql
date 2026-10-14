-- NPS Live Quiz: participant and big-screen API (see 20261014100100 for conventions).

-- ===========================================================================
-- Public: participants and big screen
-- ===========================================================================
create or replace function public.get_server_time()
returns timestamptz language sql stable set search_path = '' as $$
  select now()
$$;

-- Find a session by code, or (no code) the newest session that is not ended.
-- The no-code form lets one printed QR code always reach the current session.
create or replace function public.resolve_session(p_code text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_s public.sessions;
begin
  if p_code is null or trim(p_code) = '' then
    select * into v_s from public.sessions s
    where s.status <> 'ended'
    order by s.registration_open desc, s.created_at desc
    limit 1;
  else
    select * into v_s from public.sessions s where s.code = upper(trim(p_code));
  end if;
  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;
  return jsonb_build_object('sessionId', v_s.id, 'code', v_s.code, 'title', v_s.title,
                            'status', v_s.status, 'registrationOpen', v_s.registration_open);
end $$;

create or replace function public.join_session(p_code text, p_display_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_s     public.sessions;
  v_name  text;
  v_token text;
  v_id    uuid;
begin
  select * into v_s from public.sessions s where s.code = upper(trim(coalesce(p_code, '')));
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if v_s.status = 'ended' then raise exception 'SESSION_ENDED'; end if;
  if not v_s.registration_open then raise exception 'REGISTRATION_CLOSED'; end if;

  v_name := regexp_replace(trim(coalesce(p_display_name, '')), '\s+', ' ', 'g');
  if v_name = '' then raise exception 'NAME_REQUIRED'; end if;
  if char_length(v_name) > 30 then raise exception 'NAME_TOO_LONG'; end if;
  if v_name ~ '[[:cntrl:]]' then raise exception 'NAME_INVALID'; end if;

  v_token := app_private.new_token();
  begin
    insert into public.participants (session_id, display_name, name_key, token_hash)
    values (v_s.id, v_name, lower(v_name), app_private.hash_token(v_token))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'NAME_TAKEN';
  end;

  return jsonb_build_object('participantId', v_id, 'token', v_token, 'sessionId', v_s.id,
                            'code', v_s.code, 'displayName', v_name);
end $$;

create or replace function public.get_participant_state(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_p        public.participants;
  v_s        public.sessions;
  v_q        public.session_questions;
  v_a        public.answers;
  v_fm       text;
  v_show     boolean;
  v_total    int;
  v_count    int;
  v_stats    jsonb;
  v_chapters jsonb;
  v_question jsonb := null;
  v_standing jsonb := null;
begin
  v_p := app_private.participant_by_token(p_token);
  if v_p.last_seen_at < now() - interval '10 seconds' then
    update public.participants set last_seen_at = now() where id = v_p.id;
  end if;

  select * into v_s from public.sessions s where s.id = v_p.session_id;
  v_fm := coalesce(v_s.settings->>'feedbackMode', 'on_reveal');

  v_stats := app_private.participant_chapter_stats(v_s.id, v_p.id);
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.chapter_id, 'title', c.title, 'description', c.description,
           'order', c.sort_order, 'status', c.status,
           'questionCount', (select count(*) from public.session_questions q
                             where q.session_id = c.session_id and q.chapter_id = c.chapter_id),
           'stats', coalesce(v_stats->c.chapter_id, '{}'::jsonb)) order by c.sort_order), '[]'::jsonb)
    into v_chapters
  from public.session_chapters c where c.session_id = v_s.id;

  if v_s.phase in ('question', 'reveal') and v_s.active_question_id is not null then
    select * into v_q from public.session_questions q
    where q.session_id = v_s.id and q.question_id = v_s.active_question_id;
    select count(*) into v_total from public.session_questions q
    where q.session_id = v_s.id and q.chapter_id = v_q.chapter_id;
    select * into v_a from public.answers a
    where a.participant_id = v_p.id and a.question_id = v_q.question_id and a.voided_at is null;
    v_show := v_s.phase = 'reveal' or v_fm = 'immediate';

    v_question := jsonb_build_object(
      'id', v_q.question_id, 'chapterId', v_q.chapter_id,
      'index', v_q.sort_order, 'total', v_total,
      'text', v_q.question_text, 'options', v_q.options,
      'durationSeconds', v_q.duration_seconds,
      'startedAt', v_s.question_started_at, 'deadline', v_s.question_deadline,
      'paused', v_s.paused, 'pausedRemainingMs', v_s.paused_remaining_ms,
      'revealed', v_s.phase = 'reveal',
      'correctOptionId', case when v_s.phase = 'reveal' then v_q.correct_option_id end,
      'explanation', case when v_s.phase = 'reveal' then v_q.explanation end,
      'myAnswer', case when v_a.id is null then null else jsonb_build_object(
          'selectedOptionId', v_a.selected_option_id,
          'status', v_a.status,
          'responseTimeMs', v_a.response_time_ms,
          'isCorrect', case when v_show then v_a.is_correct end,
          'points', case when v_show then v_a.points_awarded end) end);
  end if;

  if v_s.phase <> 'question' or v_fm = 'immediate' then
    select jsonb_build_object(
             'rank', l.rank, 'totalPoints', l.total_points,
             'correctCount', l.correct_count, 'incorrectCount', l.incorrect_count,
             'timedOutCount', l.timed_out_count, 'answeredCount', l.answered_count,
             'accuracy', l.accuracy, 'avgResponseMs', l.avg_response_ms,
             'chaptersCompleted', l.chapters_completed, 'chapterPoints', l.chapter_points)
      into v_standing
    from app_private.leaderboard(v_s.id) l
    where l.participant_id = v_p.id;
  end if;

  select count(*) into v_count from public.participants p
  where p.session_id = v_s.id and p.removed_at is null;

  return jsonb_build_object(
    'serverTime', now(),
    'session', jsonb_build_object(
        'id', v_s.id, 'code', v_s.code, 'title', v_s.title, 'status', v_s.status,
        'phase', v_s.phase, 'registrationOpen', v_s.registration_open,
        'activeChapterId', v_s.active_chapter_id, 'paused', v_s.paused,
        'version', v_s.version, 'feedbackMode', v_fm,
        'scoringMode', coalesce(v_s.settings->>'scoringMode', 'linear')),
    'participant', jsonb_build_object('id', v_p.id, 'displayName', v_p.display_name, 'joinedAt', v_p.joined_at),
    'participantCount', v_count,
    'chapters', v_chapters,
    'question', v_question,
    'standing', v_standing);
end $$;

create or replace function public.submit_answer(p_token text, p_question_id text, p_option_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_now       timestamptz := now();
  v_p         public.participants;
  v_s         public.sessions;
  v_q         public.session_questions;
  v_existing  public.answers;
  v_dur_ms    int;
  v_elapsed   int;
  v_remaining int;
  v_correct   boolean;
  v_points    int;
  v_fm        text;
  v_id        uuid;
begin
  v_p := app_private.participant_by_token(p_token);

  -- Shared lock: many answers can be recorded at once, but a reveal waits for them.
  select * into v_s from public.sessions s where s.id = v_p.session_id for share;
  if v_s.status = 'ended' then raise exception 'SESSION_ENDED'; end if;
  if v_s.phase <> 'question' then raise exception 'QUESTION_CLOSED'; end if;
  if v_s.active_question_id is distinct from p_question_id then raise exception 'QUESTION_NOT_ACTIVE'; end if;
  if v_s.paused then raise exception 'QUESTION_PAUSED'; end if;
  if v_now < v_s.question_started_at then raise exception 'QUESTION_NOT_STARTED'; end if;
  if v_now > v_s.question_deadline
             + make_interval(secs => coalesce((v_s.settings->>'graceMs')::int, 1000) / 1000.0) then
    raise exception 'DEADLINE_PASSED';
  end if;
  if coalesce(p_option_id, '') not in ('A','B','C','D') then raise exception 'INVALID_OPTION'; end if;

  select * into v_q from public.session_questions q
  where q.session_id = v_s.id and q.question_id = p_question_id;

  v_dur_ms    := v_q.duration_seconds * 1000;
  v_elapsed   := greatest(0, least(v_dur_ms, (extract(epoch from (v_now - v_s.question_started_at)) * 1000)::int));
  v_remaining := greatest(0, least(v_dur_ms, (extract(epoch from (v_s.question_deadline - v_now)) * 1000)::int));
  v_correct   := p_option_id = v_q.correct_option_id;
  v_points    := app_private.question_points(v_correct, v_elapsed, v_remaining, v_dur_ms,
                                             coalesce(v_s.settings->>'scoringMode', 'linear'));
  v_fm        := coalesce(v_s.settings->>'feedbackMode', 'on_reveal');

  insert into public.answers (session_id, participant_id, question_id, chapter_id, selected_option_id,
                              status, is_correct, points_awarded, response_time_ms, submitted_at)
  values (v_s.id, v_p.id, p_question_id, v_q.chapter_id, p_option_id,
          'answered', v_correct, v_points, v_elapsed, v_now)
  on conflict (participant_id, question_id) where voided_at is null do nothing
  returning id into v_id;

  if v_id is null then
    select * into v_existing from public.answers a
    where a.participant_id = v_p.id and a.question_id = p_question_id and a.voided_at is null;
    return jsonb_build_object(
      'accepted', false, 'reason', 'ALREADY_ANSWERED',
      'selectedOptionId', v_existing.selected_option_id,
      'responseTimeMs', v_existing.response_time_ms,
      'isCorrect', case when v_fm = 'immediate' then v_existing.is_correct end,
      'points', case when v_fm = 'immediate' then v_existing.points_awarded end);
  end if;

  update public.participants set last_seen_at = v_now where id = v_p.id;

  return jsonb_build_object(
    'accepted', true,
    'selectedOptionId', p_option_id,
    'submittedAt', v_now,
    'responseTimeMs', v_elapsed,
    'isCorrect', case when v_fm = 'immediate' then v_correct end,
    'points', case when v_fm = 'immediate' then v_points end);
end $$;

-- Big-screen view. Shows nothing that is not already public in the room:
-- no answer key before the reveal, and only the top N of the leaderboard.
create or replace function public.get_screen_state(p_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_s        public.sessions;
  v_q        public.session_questions;
  v_n        int;
  v_size     int;
  v_total    int;
  v_answered int;
  v_chapter  jsonb;
  v_question jsonb := null;
  v_reveal   jsonb := null;
  v_lb       jsonb := null;
begin
  select * into v_s from public.sessions s where s.code = upper(trim(coalesce(p_code, '')));
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;

  select count(*) into v_n from public.participants p where p.session_id = v_s.id and p.removed_at is null;
  v_size := coalesce((v_s.settings->>'screenLeaderboardSize')::int, 10);

  select jsonb_build_object('id', c.chapter_id, 'title', c.title, 'description', c.description,
                            'order', c.sort_order, 'status', c.status,
                            'questionCount', (select count(*) from public.session_questions q
                                              where q.session_id = c.session_id and q.chapter_id = c.chapter_id))
    into v_chapter
  from public.session_chapters c
  where c.session_id = v_s.id and c.chapter_id = v_s.active_chapter_id;

  if v_s.phase in ('question', 'reveal') and v_s.active_question_id is not null then
    select * into v_q from public.session_questions q
    where q.session_id = v_s.id and q.question_id = v_s.active_question_id;
    select count(*) into v_total from public.session_questions q
    where q.session_id = v_s.id and q.chapter_id = v_q.chapter_id;
    select count(*) into v_answered from public.answers a
    where a.session_id = v_s.id and a.question_id = v_q.question_id
      and a.voided_at is null and a.status = 'answered';

    v_question := jsonb_build_object(
      'id', v_q.question_id, 'index', v_q.sort_order, 'total', v_total,
      'text', v_q.question_text, 'options', v_q.options,
      'durationSeconds', v_q.duration_seconds,
      'startedAt', v_s.question_started_at, 'deadline', v_s.question_deadline,
      'paused', v_s.paused, 'pausedRemainingMs', v_s.paused_remaining_ms,
      'answeredCount', v_answered);

    if v_s.phase = 'reveal' then
      select jsonb_build_object(
               'correctOptionId', v_q.correct_option_id,
               'explanation', v_q.explanation,
               'distribution', (select coalesce(jsonb_object_agg(o.value->>'id',
                                  (select count(*) from public.answers a
                                   where a.session_id = v_s.id and a.question_id = v_q.question_id
                                     and a.voided_at is null and a.selected_option_id = o.value->>'id')), '{}'::jsonb)
                                from jsonb_array_elements(v_q.options) o),
               'correctCount', (select count(*) from public.answers a
                                where a.session_id = v_s.id and a.question_id = v_q.question_id
                                  and a.voided_at is null and a.is_correct),
               'timedOutCount', (select count(*) from public.answers a
                                 where a.session_id = v_s.id and a.question_id = v_q.question_id
                                   and a.voided_at is null and a.status = 'timed_out'))
        into v_reveal;
    end if;
  end if;

  if v_s.phase <> 'question' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'rank', l.rank, 'displayName', l.display_name, 'totalPoints', l.total_points,
             'correctCount', l.correct_count, 'accuracy', l.accuracy,
             'chaptersCompleted', l.chapters_completed) order by l.rank), '[]'::jsonb)
      into v_lb
    from app_private.leaderboard(v_s.id) l
    where l.rank <= v_size;
  end if;

  return jsonb_build_object(
    'serverTime', now(),
    'session', jsonb_build_object('id', v_s.id, 'code', v_s.code, 'title', v_s.title,
                                  'status', v_s.status, 'phase', v_s.phase,
                                  'registrationOpen', v_s.registration_open,
                                  'paused', v_s.paused, 'version', v_s.version),
    'participantCount', v_n,
    'chapter', v_chapter,
    'chapters', (select coalesce(jsonb_agg(jsonb_build_object('id', c.chapter_id, 'title', c.title,
                                                              'order', c.sort_order, 'status', c.status)
                                           order by c.sort_order), '[]'::jsonb)
                 from public.session_chapters c where c.session_id = v_s.id),
    'question', v_question,
    'reveal', v_reveal,
    'leaderboard', v_lb);
end $$;
