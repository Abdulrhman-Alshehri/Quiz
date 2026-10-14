-- NPS Live Quiz: presenter (admin) API. Every function checks the admin token first.
-- Nothing here erases data: sign-outs expire tokens, resets void answers, and
-- removing a whole session is done by the project owner in the Supabase dashboard.

-- ===========================================================================
-- Admin: authentication
-- ===========================================================================
create or replace function public.admin_login(p_passcode text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_key   text := app_private.client_key();
  v_fails int;
  v_hash  text;
  v_token text;
  v_exp   timestamptz := now() + interval '12 hours';
begin
  select count(*) into v_fails from app_private.admin_login_attempts
  where client_key = v_key and not success and attempted_at > now() - interval '15 minutes';
  if v_fails >= 8 then
    return jsonb_build_object('ok', false, 'error', 'TOO_MANY_ATTEMPTS');
  end if;

  select passcode_hash into v_hash from app_private.admin_config where id = 1;
  if v_hash is null then
    return jsonb_build_object('ok', false, 'error', 'ADMIN_NOT_CONFIGURED');
  end if;

  if p_passcode is null or char_length(p_passcode) > 200
     or extensions.crypt(p_passcode, v_hash) <> v_hash then
    insert into app_private.admin_login_attempts (client_key, success) values (v_key, false);
    return jsonb_build_object('ok', false, 'error', 'INVALID_PASSCODE');
  end if;

  insert into app_private.admin_login_attempts (client_key, success) values (v_key, true);
  v_token := app_private.new_token();
  insert into app_private.admin_tokens (token_hash, expires_at)
  values (app_private.hash_token(v_token), v_exp);
  return jsonb_build_object('ok', true, 'token', v_token, 'expiresAt', v_exp);
end $$;

create or replace function public.admin_logout(p_admin_token text)
returns void language sql security definer set search_path = '' as $$
  update app_private.admin_tokens set expires_at = now()
   where token_hash = app_private.hash_token(p_admin_token) and expires_at > now()
$$;

create or replace function public.admin_check(p_admin_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_admin(p_admin_token);
  return jsonb_build_object('ok', true,
    'expiresAt', (select t.expires_at from app_private.admin_tokens t
                  where t.token_hash = app_private.hash_token(p_admin_token)));
end $$;

create or replace function public.admin_change_passcode(p_admin_token text, p_current text, p_new text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_hash text;
begin
  perform app_private.require_admin(p_admin_token);
  select passcode_hash into v_hash from app_private.admin_config where id = 1;
  if p_current is null or extensions.crypt(p_current, v_hash) <> v_hash then
    raise exception 'INVALID_PASSCODE';
  end if;
  if p_new is null or char_length(p_new) < 10 or char_length(p_new) > 72 then
    raise exception 'PASSCODE_TOO_SHORT';
  end if;
  update app_private.admin_config
     set passcode_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10)), updated_at = now()
   where id = 1;
  -- Sign out every other admin device.
  update app_private.admin_tokens set expires_at = now()
   where token_hash <> app_private.hash_token(p_admin_token) and expires_at > now();
  return jsonb_build_object('ok', true);
end $$;

-- ===========================================================================
-- Admin: sessions
-- ===========================================================================
create or replace function public.admin_list_sessions(p_admin_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_admin(p_admin_token);
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', s.id, 'code', s.code, 'title', s.title, 'status', s.status, 'phase', s.phase,
            'registrationOpen', s.registration_open, 'createdAt', s.created_at, 'endedAt', s.ended_at,
            'participants', (select count(*) from public.participants p
                             where p.session_id = s.id and p.removed_at is null))
          order by s.created_at desc), '[]'::jsonb)
          from public.sessions s);
end $$;

create or replace function public.admin_create_session(p_admin_token text, p_title text, p_settings jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_title    text := trim(coalesce(p_title, ''));
  v_settings jsonb;
  v_code     text;
  v_id       uuid;
  v_dur      int;
begin
  perform app_private.require_admin(p_admin_token);
  if v_title = '' then
    v_title := 'NPS Orientation ' || to_char(now() at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI');
  end if;
  if char_length(v_title) > 120 then raise exception 'TITLE_TOO_LONG'; end if;
  v_settings := app_private.normalize_settings(p_settings);

  if (select count(*) from public.bank_chapters c where c.retired_at is null) <> 4
     or exists (select 1 from public.bank_chapters c
                where c.retired_at is null
                  and (select count(*) from public.bank_questions q
                       where q.chapter_id = c.id and q.retired_at is null) <> 5) then
    raise exception 'BANK_NOT_READY';
  end if;

  v_code := app_private.gen_session_code();
  insert into public.sessions (code, title, settings) values (v_code, v_title, v_settings)
  returning id into v_id;

  insert into public.session_chapters (session_id, chapter_id, title, description, sort_order)
  select v_id, c.id, c.title, c.description, c.sort_order
  from public.bank_chapters c where c.retired_at is null;

  v_dur := nullif(v_settings->>'durationOverride', '')::int;
  insert into public.session_questions (session_id, question_id, chapter_id, sort_order, question_text,
                                        options, correct_option_id, explanation,
                                        duration_seconds, default_duration_seconds)
  select v_id, q.id, q.chapter_id, q.sort_order, q.question_text, q.options, q.correct_option_id,
         q.explanation, coalesce(v_dur, q.duration_seconds), q.duration_seconds
  from public.bank_questions q
  where q.retired_at is null;

  return jsonb_build_object('sessionId', v_id, 'code', v_code, 'title', v_title);
end $$;

create or replace function public.admin_get_session(p_admin_token text, p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_s        public.sessions;
  v_q        public.session_questions;
  v_n        int;
  v_active   int;
  v_total    int;
  v_chapters jsonb;
  v_question jsonb := null;
  v_live     jsonb := null;
  v_dist     jsonb;
  v_lb       jsonb;
begin
  perform app_private.require_admin(p_admin_token);
  select * into v_s from public.sessions s where s.id = p_session_id;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;

  select count(*), count(*) filter (where p.last_seen_at > now() - interval '25 seconds')
    into v_n, v_active
  from public.participants p where p.session_id = v_s.id and p.removed_at is null;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.chapter_id, 'title', c.title, 'description', c.description,
           'order', c.sort_order, 'status', c.status,
           'questionCount', qc.n, 'revealedCount', qc.revealed,
           'completedBy', (select count(*) from (
                             select a.participant_id
                             from public.answers a
                             join public.participants p on p.id = a.participant_id and p.removed_at is null
                             where a.session_id = c.session_id and a.chapter_id = c.chapter_id and a.voided_at is null
                             group by a.participant_id
                             having count(*) >= qc.n) x))
         order by c.sort_order), '[]'::jsonb)
    into v_chapters
  from public.session_chapters c
  cross join lateral (
    select count(*)::int as n, (count(*) filter (where q.revealed_at is not null))::int as revealed
    from public.session_questions q
    where q.session_id = c.session_id and q.chapter_id = c.chapter_id) qc
  where c.session_id = v_s.id;

  if v_s.active_question_id is not null then
    select * into v_q from public.session_questions q
    where q.session_id = v_s.id and q.question_id = v_s.active_question_id;
    select count(*) into v_total from public.session_questions q
    where q.session_id = v_s.id and q.chapter_id = v_q.chapter_id;

    v_question := jsonb_build_object(
      'id', v_q.question_id, 'chapterId', v_q.chapter_id, 'index', v_q.sort_order, 'total', v_total,
      'text', v_q.question_text, 'options', v_q.options,
      'correctOptionId', v_q.correct_option_id, 'explanation', v_q.explanation,
      'durationSeconds', v_q.duration_seconds,
      'startedAt', v_s.question_started_at, 'deadline', v_s.question_deadline,
      'paused', v_s.paused, 'pausedRemainingMs', v_s.paused_remaining_ms,
      'launchedAt', v_q.launched_at, 'revealedAt', v_q.revealed_at);

    select coalesce(jsonb_object_agg(o.value->>'id',
             (select count(*) from public.answers a
              where a.session_id = v_s.id and a.question_id = v_q.question_id
                and a.voided_at is null and a.selected_option_id = o.value->>'id')), '{}'::jsonb)
      into v_dist
    from jsonb_array_elements(v_q.options) o;

    select jsonb_build_object(
             'answered',  count(*) filter (where a.status = 'answered'),
             'timedOut',  count(*) filter (where a.status = 'timed_out'),
             'correct',   count(*) filter (where a.is_correct),
             'incorrect', count(*) filter (where a.status = 'answered' and not a.is_correct),
             'notAnswered', greatest(0, v_n - count(*)),
             'distribution', v_dist)
      into v_live
    from public.answers a
    join public.participants p on p.id = a.participant_id and p.removed_at is null
    where a.session_id = v_s.id and a.question_id = v_q.question_id and a.voided_at is null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'participantId', l.participant_id, 'rank', l.rank, 'displayName', l.display_name,
           'totalPoints', l.total_points, 'correctCount', l.correct_count,
           'incorrectCount', l.incorrect_count, 'timedOutCount', l.timed_out_count,
           'answeredCount', l.answered_count, 'accuracy', l.accuracy,
           'avgResponseMs', l.avg_response_ms, 'chaptersCompleted', l.chapters_completed,
           'chapterPoints', l.chapter_points, 'joinedAt', l.joined_at,
           'active', l.last_seen_at > now() - interval '25 seconds') order by l.rank), '[]'::jsonb)
    into v_lb
  from app_private.leaderboard(v_s.id) l;

  return jsonb_build_object(
    'serverTime', now(),
    'session', jsonb_build_object(
        'id', v_s.id, 'code', v_s.code, 'title', v_s.title, 'status', v_s.status, 'phase', v_s.phase,
        'registrationOpen', v_s.registration_open, 'activeChapterId', v_s.active_chapter_id,
        'activeQuestionId', v_s.active_question_id, 'paused', v_s.paused,
        'settings', v_s.settings, 'version', v_s.version,
        'createdAt', v_s.created_at, 'endedAt', v_s.ended_at),
    'participantCount', v_n,
    'activeCount', v_active,
    'chapters', v_chapters,
    'question', v_question,
    'live', v_live,
    'leaderboard', v_lb);
end $$;

create or replace function public.admin_update_settings(p_admin_token text, p_session_id uuid, p_settings jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_s   public.sessions;
  v_new jsonb;
begin
  perform app_private.require_admin(p_admin_token);
  select * into v_s from public.sessions s where s.id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if v_s.status = 'ended' then raise exception 'SESSION_ENDED'; end if;

  v_new := app_private.normalize_settings(p_settings, v_s.settings);

  if coalesce(p_settings, '{}'::jsonb) ? 'durationOverride' then
    if jsonb_typeof(v_new->'durationOverride') = 'null' then
      update public.session_questions q
         set duration_seconds = coalesce(q.default_duration_seconds, q.duration_seconds)
       where q.session_id = v_s.id and q.launched_at is null;
    else
      update public.session_questions q
         set duration_seconds = (v_new->>'durationOverride')::int
       where q.session_id = v_s.id and q.launched_at is null;
    end if;
  end if;

  update public.sessions set settings = v_new, version = version + 1, updated_at = now()
   where id = v_s.id;
  return v_new;
end $$;

create or replace function public.admin_set_registration(p_admin_token text, p_session_id uuid, p_open boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_admin(p_admin_token);
  update public.sessions
     set registration_open = coalesce(p_open, false), version = version + 1, updated_at = now()
   where id = p_session_id and status <> 'ended';
  if not found then raise exception 'SESSION_NOT_FOUND_OR_ENDED'; end if;
end $$;

create or replace function public.admin_start_chapter(p_admin_token text, p_session_id uuid, p_chapter_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_s        public.sessions;
  v_status   text;
  v_revealed int;
begin
  perform app_private.require_admin(p_admin_token);
  select * into v_s from public.sessions s where s.id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if v_s.status = 'ended' then raise exception 'SESSION_ENDED'; end if;
  if v_s.phase = 'question' then raise exception 'QUESTION_IN_PROGRESS'; end if;

  select c.status into v_status from public.session_chapters c
  where c.session_id = v_s.id and c.chapter_id = p_chapter_id;
  if not found then raise exception 'CHAPTER_NOT_FOUND'; end if;
  if v_status = 'completed' then raise exception 'CHAPTER_COMPLETED'; end if;

  select count(*) into v_revealed from public.session_questions q
  where q.session_id = v_s.id and q.chapter_id = p_chapter_id and q.revealed_at is not null;

  update public.session_chapters
     set status = 'open', opened_at = coalesce(opened_at, now())
   where session_id = v_s.id and chapter_id = p_chapter_id;

  update public.sessions
     set status = 'live', phase = 'chapter_intro', active_chapter_id = p_chapter_id,
         active_question_id = null, active_question_index = v_revealed,
         question_started_at = null, question_deadline = null,
         paused = false, paused_remaining_ms = null,
         version = version + 1, updated_at = now()
   where id = v_s.id;
end $$;

create or replace function public.admin_next_question(p_admin_token text, p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_s     public.sessions;
  v_q     public.session_questions;
  v_lead  int;
  v_start timestamptz;
begin
  perform app_private.require_admin(p_admin_token);
  select * into v_s from public.sessions s where s.id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if v_s.status = 'ended' then raise exception 'SESSION_ENDED'; end if;
  if v_s.phase not in ('chapter_intro', 'reveal') then raise exception 'INVALID_PHASE'; end if;
  if v_s.active_chapter_id is null then raise exception 'NO_ACTIVE_CHAPTER'; end if;

  select * into v_q from public.session_questions q
  where q.session_id = v_s.id and q.chapter_id = v_s.active_chapter_id and q.revealed_at is null
  order by q.sort_order
  limit 1;
  if not found then raise exception 'NO_MORE_QUESTIONS'; end if;

  v_lead  := coalesce((v_s.settings->>'leadInMs')::int, 4000);
  v_start := now() + make_interval(secs => v_lead / 1000.0);

  update public.session_questions set launched_at = now()
   where session_id = v_s.id and question_id = v_q.question_id;

  update public.sessions
     set phase = 'question', active_question_id = v_q.question_id, active_question_index = v_q.sort_order,
         question_started_at = v_start,
         question_deadline = v_start + make_interval(secs => v_q.duration_seconds),
         paused = false, paused_remaining_ms = null,
         version = version + 1, updated_at = now()
   where id = v_s.id;

  return jsonb_build_object('questionId', v_q.question_id, 'index', v_q.sort_order,
                            'startedAt', v_start,
                            'deadline', v_start + make_interval(secs => v_q.duration_seconds));
end $$;

create or replace function public.admin_reveal(p_admin_token text, p_session_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_s public.sessions;
begin
  perform app_private.require_admin(p_admin_token);
  select * into v_s from public.sessions s where s.id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if v_s.phase <> 'question' then raise exception 'INVALID_PHASE'; end if;
  perform app_private.reveal_current(v_s.id);
end $$;

create or replace function public.admin_finish_chapter(p_admin_token text, p_session_id uuid, p_force boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_s public.sessions;
begin
  perform app_private.require_admin(p_admin_token);
  select * into v_s from public.sessions s where s.id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if v_s.status = 'ended' then raise exception 'SESSION_ENDED'; end if;
  if v_s.phase = 'question' then raise exception 'QUESTION_IN_PROGRESS'; end if;
  if v_s.active_chapter_id is null then raise exception 'NO_ACTIVE_CHAPTER'; end if;
  if not coalesce(p_force, false) and exists (
       select 1 from public.session_questions q
       where q.session_id = v_s.id and q.chapter_id = v_s.active_chapter_id and q.revealed_at is null) then
    raise exception 'CHAPTER_NOT_FINISHED';
  end if;

  update public.session_chapters
     set status = 'completed', completed_at = now()
   where session_id = v_s.id and chapter_id = v_s.active_chapter_id;

  update public.sessions
     set phase = 'chapter_results', active_question_id = null, active_question_index = null,
         question_started_at = null, question_deadline = null,
         paused = false, paused_remaining_ms = null,
         version = version + 1, updated_at = now()
   where id = v_s.id;
end $$;

create or replace function public.admin_pause(p_admin_token text, p_session_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_s   public.sessions;
  v_dur int;
begin
  perform app_private.require_admin(p_admin_token);
  select * into v_s from public.sessions s where s.id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if v_s.phase <> 'question' then raise exception 'INVALID_PHASE'; end if;
  if v_s.paused then return; end if;
  select q.duration_seconds * 1000 into v_dur from public.session_questions q
  where q.session_id = v_s.id and q.question_id = v_s.active_question_id;
  update public.sessions
     set paused = true,
         paused_remaining_ms = greatest(0, least(v_dur,
                                 (extract(epoch from (question_deadline - now())) * 1000)::int)),
         version = version + 1, updated_at = now()
   where id = v_s.id;
end $$;

create or replace function public.admin_resume(p_admin_token text, p_session_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_s        public.sessions;
  v_dur      int;
  v_deadline timestamptz;
begin
  perform app_private.require_admin(p_admin_token);
  select * into v_s from public.sessions s where s.id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if v_s.phase <> 'question' or not v_s.paused then return; end if;
  select q.duration_seconds into v_dur from public.session_questions q
  where q.session_id = v_s.id and q.question_id = v_s.active_question_id;
  v_deadline := now() + make_interval(secs => coalesce(v_s.paused_remaining_ms, 0) / 1000.0);
  update public.sessions
     set paused = false, paused_remaining_ms = null,
         question_deadline = v_deadline,
         question_started_at = v_deadline - make_interval(secs => v_dur),
         version = version + 1, updated_at = now()
   where id = v_s.id;
end $$;

create or replace function public.admin_end_session(p_admin_token text, p_session_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_s public.sessions;
begin
  perform app_private.require_admin(p_admin_token);
  select * into v_s from public.sessions s where s.id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if v_s.status = 'ended' then return; end if;
  if v_s.phase = 'question' then
    perform app_private.reveal_current(v_s.id);
  end if;
  update public.sessions
     set status = 'ended', phase = 'ended', registration_open = false,
         paused = false, paused_remaining_ms = null, ended_at = now(),
         version = version + 1, updated_at = now()
   where id = v_s.id;
end $$;

create or replace function public.admin_reset_chapter(p_admin_token text, p_session_id uuid,
                                                     p_chapter_id text, p_confirm text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_s public.sessions;
  v_n int;
begin
  perform app_private.require_admin(p_admin_token);
  if p_confirm is distinct from 'RESET' then raise exception 'CONFIRMATION_REQUIRED'; end if;
  select * into v_s from public.sessions s where s.id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if v_s.status = 'ended' then raise exception 'SESSION_ENDED'; end if;
  if not exists (select 1 from public.session_chapters c
                 where c.session_id = v_s.id and c.chapter_id = p_chapter_id) then
    raise exception 'CHAPTER_NOT_FOUND';
  end if;

  -- Answers are voided, not erased, so a reset can be audited.
  update public.answers set voided_at = now(), void_reason = 'chapter_reset'
   where session_id = v_s.id and chapter_id = p_chapter_id and voided_at is null;
  get diagnostics v_n = row_count;

  update public.session_questions set launched_at = null, revealed_at = null
   where session_id = v_s.id and chapter_id = p_chapter_id;
  update public.session_chapters set status = 'locked', opened_at = null, completed_at = null
   where session_id = v_s.id and chapter_id = p_chapter_id;

  if v_s.active_chapter_id = p_chapter_id then
    update public.sessions
       set phase = 'idle', active_chapter_id = null, active_question_id = null,
           active_question_index = null, question_started_at = null, question_deadline = null,
           paused = false, paused_remaining_ms = null,
           version = version + 1, updated_at = now()
     where id = v_s.id;
  else
    perform app_private.bump(v_s.id);
  end if;
  return jsonb_build_object('voidedAnswers', v_n);
end $$;

create or replace function public.admin_reset_session(p_admin_token text, p_session_id uuid, p_confirm text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_s public.sessions;
  v_n int;
begin
  perform app_private.require_admin(p_admin_token);
  if p_confirm is distinct from 'RESET' then raise exception 'CONFIRMATION_REQUIRED'; end if;
  select * into v_s from public.sessions s where s.id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if v_s.status = 'ended' then raise exception 'SESSION_ENDED'; end if;

  update public.answers set voided_at = now(), void_reason = 'session_reset'
   where session_id = v_s.id and voided_at is null;
  get diagnostics v_n = row_count;

  update public.session_questions set launched_at = null, revealed_at = null where session_id = v_s.id;
  update public.session_chapters set status = 'locked', opened_at = null, completed_at = null
   where session_id = v_s.id;
  update public.sessions
     set status = 'lobby', phase = 'idle', active_chapter_id = null, active_question_id = null,
         active_question_index = null, question_started_at = null, question_deadline = null,
         paused = false, paused_remaining_ms = null,
         version = version + 1, updated_at = now()
   where id = v_s.id;
  return jsonb_build_object('voidedAnswers', v_n);
end $$;

create or replace function public.admin_remove_participant(p_admin_token text, p_participant_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_session uuid;
begin
  perform app_private.require_admin(p_admin_token);
  update public.participants set removed_at = now()
   where id = p_participant_id and removed_at is null
  returning session_id into v_session;
  if v_session is null then raise exception 'PARTICIPANT_NOT_FOUND'; end if;
  perform app_private.bump(v_session);
end $$;

-- ===========================================================================
-- Admin: exports
-- ===========================================================================
create or replace function public.admin_export_results(p_admin_token text, p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_s        public.sessions;
  v_chapters int;
begin
  perform app_private.require_admin(p_admin_token);
  select * into v_s from public.sessions s where s.id = p_session_id;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  select count(*) into v_chapters from public.session_chapters c where c.session_id = v_s.id;

  return jsonb_build_object(
    'exportedAt', now(),
    'session', jsonb_build_object('id', v_s.id, 'code', v_s.code, 'title', v_s.title,
                                  'status', v_s.status, 'createdAt', v_s.created_at),
    'chapters', (select coalesce(jsonb_agg(jsonb_build_object('id', c.chapter_id, 'title', c.title)
                                           order by c.sort_order), '[]'::jsonb)
                 from public.session_chapters c where c.session_id = v_s.id),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
               'participantId', l.participant_id, 'displayName', l.display_name, 'joinedAt', l.joined_at,
               'rank', l.rank, 'totalPoints', l.total_points, 'chapterPoints', l.chapter_points,
               'correct', l.correct_count, 'incorrect', l.incorrect_count, 'timedOut', l.timed_out_count,
               'answered', l.answered_count, 'accuracy', l.accuracy, 'avgResponseMs', l.avg_response_ms,
               'chaptersCompleted', l.chapters_completed,
               'completionStatus', case
                   when l.chapters_completed >= v_chapters then 'completed'
                   when (l.answered_count + l.timed_out_count) > 0 then 'in_progress'
                   else 'not_started' end) order by l.rank), '[]'::jsonb)
             from app_private.leaderboard(v_s.id) l));
end $$;

create or replace function public.admin_export_item_analysis(p_admin_token text, p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_admin(p_admin_token);
  if not exists (select 1 from public.sessions s where s.id = p_session_id) then
    raise exception 'SESSION_NOT_FOUND';
  end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(t) order by t."chapterOrder", t."questionOrder"), '[]'::jsonb)
    from (
      select c.sort_order                                            as "chapterOrder",
             c.chapter_id                                            as "chapterId",
             c.title                                                 as "chapterTitle",
             q.sort_order                                            as "questionOrder",
             q.question_id                                           as "questionId",
             q.question_text                                         as "questionText",
             q.correct_option_id                                     as "correctOptionId",
             (q.revealed_at is not null)                             as "played",
             count(a.id) filter (where a.status = 'answered')        as "answered",
             count(a.id) filter (where a.is_correct)                 as "correct",
             count(a.id) filter (where a.status = 'timed_out')       as "timedOut",
             case when count(a.id) > 0
                  then round(100.0 * count(a.id) filter (where a.is_correct) / count(a.id), 1) end
                                                                     as "pctCorrect",
             count(a.id) filter (where a.selected_option_id = 'A')   as "optionA",
             count(a.id) filter (where a.selected_option_id = 'B')   as "optionB",
             count(a.id) filter (where a.selected_option_id = 'C')   as "optionC",
             count(a.id) filter (where a.selected_option_id = 'D')   as "optionD",
             round(avg(a.response_time_ms) filter (where a.status = 'answered'))::int
                                                                     as "avgResponseMs"
      from public.session_questions q
      join public.session_chapters c on c.session_id = q.session_id and c.chapter_id = q.chapter_id
      left join public.answers a
             on a.session_id = q.session_id and a.question_id = q.question_id and a.voided_at is null
            and exists (select 1 from public.participants p where p.id = a.participant_id and p.removed_at is null)
      where q.session_id = p_session_id
      group by c.sort_order, c.chapter_id, c.title, q.sort_order, q.question_id,
               q.question_text, q.correct_option_id, q.revealed_at
    ) t);
end $$;

-- ===========================================================================
-- Admin: question bank
-- ===========================================================================
create or replace function public.admin_get_bank(p_admin_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_admin(p_admin_token);
  return jsonb_build_object(
    'exportedAt', now(),
    'chapters', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'title', c.title, 'description', c.description,
        'questions', (select coalesce(jsonb_agg(jsonb_build_object(
                         'id', q.id, 'text', q.question_text, 'options', q.options,
                         'correctOptionId', q.correct_option_id, 'explanation', q.explanation,
                         'durationSeconds', q.duration_seconds, 'sourceRef', q.source_ref)
                       order by q.sort_order), '[]'::jsonb)
                      from public.bank_questions q where q.chapter_id = c.id and q.retired_at is null))
      order by c.sort_order), '[]'::jsonb)
      from public.bank_chapters c where c.retired_at is null));
end $$;

create or replace function public.admin_import_bank(p_admin_token text, p_bank jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_admin(p_admin_token);
  return app_private.import_bank(p_bank);
end $$;
